// Local-only fixture host. It loads the actual Komari plugin manager and uses
// simulated clients/tasks; it never connects to a production panel or agent.
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/cmd/flags"
	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/internal/plugin"
	"github.com/komari-monitor/komari/pkg/rpc"
	"github.com/komari-monitor/komari/utils"
	adminapi "github.com/komari-monitor/komari/web/api/admin"
)

type fixture struct {
	handler       http.Handler
	dir           string
	mu            sync.Mutex
	tasks         map[string]map[string]any
	counter       int
	private       atomic.Bool
	duplicateName atomic.Bool
}

func register(name string, fn func(map[string]any) (any, error)) error {
	return rpc.Register(name, func(_ context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
		p := map[string]any{}
		b, _ := json.Marshal(req.Params)
		_ = json.Unmarshal(b, &p)
		v, e := fn(p)
		if e != nil {
			return nil, rpc.MakeError(rpc.InternalError, e.Error(), nil)
		}
		return v, nil
	})
}
func newFixture(archive string, themeDirs ...string) (*fixture, error) {
	utils.CurrentVersion = "1.5.2"
	dir, e := os.MkdirTemp("", "komari-return-route-fixture-")
	if e != nil {
		return nil, e
	}
	f := &fixture{dir: dir, tasks: map[string]map[string]any{}}
	flags.DatabaseType = flags.DatabaseTypeSQLite
	flags.DatabaseFile = filepath.Join(dir, "test.sqlite")
	_ = dbcore.GetDBInstance()
	plugin.DataDir = filepath.Join(dir, "plugin")
	plugin.StorageDir = filepath.Join(dir, "plugin-data")
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gin.Recovery(), func(c *gin.Context) {
		p := &rpc.Principal{Roles: []string{rpc.RoleGuest}}
		cookie, _ := c.Cookie("rr_test_admin")
		if cookie == "fixture" || c.GetHeader("Authorization") == "Bearer fixture-only" {
			p = rpc.PrincipalFromRole(rpc.RoleAdmin)
		}
		c.Set("principal", p)
		c.Next()
	})
	plugin.Init(r)
	r.GET("/api/admin/plugin/:short/*filepath", func(c *gin.Context) {
		p, _ := c.Get("principal")
		if !p.(*rpc.Principal).HasRole(rpc.RoleAdmin) {
			c.AbortWithStatus(401)
			return
		}
		adminapi.ServePluginFile(c)
	})
	fixtures := []map[string]any{{"uuid": "node-a", "name": "Oracle JP · 本地测试", "os": "Linux", "arch": "amd64", "hidden": false, "token": "DO_NOT_EXPOSE_NODE_TOKEN"}, {"uuid": "node-b", "name": "Oracle ARM · 隐藏测试节点", "os": "Linux", "arch": "arm64", "hidden": true}, {"uuid": "node-c", "name": "关闭远控 · 测试节点", "os": "Linux", "arch": "amd64", "hidden": false}}
	for _, n := range fixtures {
		if err := dbcore.GetDBInstance().Create(&models.Client{UUID: n["uuid"].(string), Token: "fixture-" + n["uuid"].(string), Name: n["name"].(string), Hidden: n["hidden"].(bool)}).Error; err != nil {
			return nil, err
		}
	}
	if e = register("admin:listClients", func(map[string]any) (any, error) {
		if f.duplicateName.Load() {
			return append(append([]map[string]any{}, fixtures...), map[string]any{"uuid": "node-duplicate", "name": fixtures[0]["name"], "hidden": false}), nil
		}
		return fixtures, nil
	}); e != nil {
		return nil, e
	}
	if e = register("admin:getSettings", func(map[string]any) (any, error) {
		return map[string]any{"private_site": f.private.Load(), "api_key": "DO_NOT_EXPOSE_SETTINGS_KEY"}, nil
	}); e != nil {
		return nil, e
	}
	if e = register("admin:exec", func(p map[string]any) (any, error) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.counter++
		id := fmt.Sprint("fixture-", f.counter)
		command, _ := p["command"].(string)
		clients, _ := p["clients"].([]any)
		if len(clients) != 1 {
			return nil, fmt.Errorf("invalid clients")
		}
		uuid := fmt.Sprint(clients[0])
		result := "collector_installed:0.1.0"
		code := 0
		if uuid == "node-c" {
			result = "Remote control is disabled."
			code = -1
		} else if strings.Contains(command, "--config-b64") {
			match := regexp.MustCompile(`--config-b64 '([A-Za-z0-9+/=]+)'`).FindStringSubmatch(command)
			if len(match) != 2 {
				return nil, fmt.Errorf("invalid fixed command")
			}
			raw, _ := base64.StdEncoding.DecodeString(match[1])
			var cfg struct {
				RequestID string           `json:"request_id"`
				Targets   []map[string]any `json:"targets"`
			}
			if e := json.Unmarshal(raw, &cfg); e != nil {
				return nil, e
			}
			rows := []map[string]any{}
			for _, target := range cfg.Targets {
				carrier := fmt.Sprint(target["carrier"])
				code, asn, ip := "ct_cn2_gia", "AS4809", "59.43.1.1"
				if carrier == "CU" {
					code, asn, ip = "cu_9929", "AS9929", "218.105.1.1"
				}
				if carrier == "CM" {
					code, asn, ip = "cm_cmin2", "AS58807", "223.118.32.1"
				}
				confidence := "confirmed"
				if target["family"] == float64(6) {
					ip = "2402:4f00:f000::1"
					if carrier == "CU" {
						code = "cu_destination_only"
						asn = "AS4837"
						confidence = "inconclusive"
					}
				}
				rows = append(rows, map[string]any{"target": target, "status": "available", "attempts": []any{map[string]any{"hops": []any{map[string]any{"ttl": 1, "ip": ip, "asn": asn, "rtt_ms": 150.2}}, "reached": true}}, "classification": map[string]any{"code": code, "confidence": confidence, "evidence": "Simulated route evidence for local integration test"}})
			}
			b, _ := json.Marshal(map[string]any{"schema": 1, "request_id": cfg.RequestID, "version": "0.1.0", "dataset": "fixture-only", "results": rows})
			result = string(b)
		}
		f.tasks[id] = map[string]any{"result": result, "exit_code": code, "finished_at": time.Now().UTC().Format(time.RFC3339), "client": uuid}
		return map[string]any{"task_id": id}, nil
	}); e != nil {
		return nil, e
	}
	if e = register("admin:getSpecificTaskResult", func(p map[string]any) (any, error) {
		f.mu.Lock()
		defer f.mu.Unlock()
		v := f.tasks[fmt.Sprint(p["task_id"])]
		if v == nil || v["client"] != p["uuid"] {
			return nil, fmt.Errorf("task not found")
		}
		return v, nil
	}); e != nil {
		return nil, e
	}
	r.GET("/test/login", func(c *gin.Context) {
		c.SetCookie("rr_test_admin", "fixture", 3600, "/", "", false, true)
		c.Redirect(302, "/admin/plugin-page")
	})
	r.GET("/admin/plugin-page", func(c *gin.Context) {
		c.Header("Content-Type", "text/html")
		c.File(filepath.Join(plugin.DataDir, "return-route", "web", "admin.html"))
	})
	themeDir := ""
	if len(themeDirs) > 0 {
		themeDir = themeDirs[0]
	}
	if themeDir != "" {
		r.Static("/assets", filepath.Join(themeDir, "assets"))
		r.Static("/images", filepath.Join(themeDir, "images"))
	}
	r.GET("/api/public", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "success", "data": gin.H{"sitename": "本地主题适配测试（模拟数据）", "description": "非线上探测结果", "record_enabled": false, "theme_settings": gin.H{"rpcTransportMode": "http", "defaultViewMode": "card", "generalCards": "[]", "disablePageAnimation": true, "visitorInfoEnabled": false}}})
	})
	r.GET("/api/me", func(c *gin.Context) { c.JSON(200, gin.H{"logged_in": false}) })
	r.GET("/", func(c *gin.Context) {
		if themeDir != "" {
			c.File(filepath.Join(themeDir, "index.html"))
			return
		}
		c.Header("Content-Type", "text/html")
		c.String(200, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Komari 三网回程 · 本地集成测试</title><style>body{font:14px system-ui;background:#f5f7fb;color:#172033;margin:24px}main{display:flex;gap:18px;flex-wrap:wrap}.km-node-card{width:340px;background:white;padding:18px;border:1px solid #dfe5ee;border-radius:14px}h2{font-size:17px}.metrics{display:flex;gap:30px;color:#68778e}</style></head><body><h1>本地集成测试</h1><p>使用真实 Komari 插件运行时、模拟节点与回程数据；不是线上检测结果。</p><main><section class="km-node-card" id="node-a"><h2>🇯🇵 Oracle JP · 本地测试</h2><p>Linux · amd64</p><div class="metrics"><span>CPU 12%</span><span>内存 32%</span></div></section><section class="km-node-card" id="node-c"><h2>🇯🇵 关闭远控 · 测试节点</h2><p>Linux · amd64</p><div class="metrics"><span>CPU 8%</span><span>内存 21%</span></div></section></main></body></html>`)
	})
	r.POST("/api/rpc2", func(c *gin.Context) {
		p, _ := c.Get("principal")
		var body struct {
			ID     any    `json:"id"`
			Method string `json:"method"`
			Params struct {
				Short string         `json:"short"`
				Data  map[string]any `json:"data"`
			} `json:"params"`
		}
		if c.BindJSON(&body) != nil {
			return
		}
		if themeDir != "" {
			var result any
			switch body.Method {
			case "rpc.ping":
				result = "pong"
			case "rpc.getVersion":
				result = gin.H{"version": "1.5.2"}
			case "common:getNodes":
				rows := map[string]any{}
				for _, n := range fixtures {
					if n["hidden"] == true {
						continue
					}
					rows[n["uuid"].(string)] = gin.H{"uuid": n["uuid"], "name": n["name"], "os": n["os"], "arch": n["arch"], "hidden": false, "cpu_name": "Local test CPU", "cpu_cores": 2, "mem_total": 1073741824, "disk_total": 10737418240, "weight": 0, "price": 0, "billing_cycle": 30, "currency": "CNY", "expired_at": "0001-01-01T00:00:00Z", "group": "本地模拟节点", "tags": "", "region": "JP", "traffic_limit": 0, "traffic_limit_type": "sum", "public_remark": "模拟数据，非线上检测结果"}
				}
				result = rows
			case "common:getNodesLatestStatus":
				rows := map[string]any{}
				for _, n := range fixtures {
					if n["hidden"] == true {
						continue
					}
					id := n["uuid"].(string)
					rows[id] = gin.H{"client": id, "online": true, "time": time.Now().UTC().Format(time.RFC3339), "cpu": 12, "ram": 350000000, "disk": 2000000000, "uptime": 86400, "net_total_up": 50000000, "net_total_down": 60000000}
				}
				result = rows
			case "common:getPingTasks":
				result = []any{}
			case "common:getRecords", "common:getPingRecords":
				result = gin.H{"records": []any{}}
			}
			if result != nil {
				c.JSON(200, gin.H{"jsonrpc": "2.0", "id": body.ID, "result": result})
				return
			}
		}
		if !p.(*rpc.Principal).HasRole(rpc.RoleAdmin) {
			c.JSON(401, gin.H{"error": "unauthorized"})
			return
		}
		if body.Method != "admin:setPluginConfiguration" || body.Params.Short != "return-route" {
			c.JSON(400, gin.H{"error": "invalid method"})
			return
		}
		if e := plugin.SaveConfiguration("return-route", body.Params.Data); e != nil {
			c.JSON(500, gin.H{"error": e.Error()})
			return
		}
		if e := plugin.Reload("return-route"); e != nil {
			c.JSON(500, gin.H{"error": e.Error()})
			return
		}
		c.JSON(200, gin.H{"jsonrpc": "2.0", "result": nil, "id": 1})
	})
	if _, e = plugin.InstallZip(archive); e != nil {
		return nil, e
	}
	preset, e := os.ReadFile(filepath.Join(plugin.DataDir, "return-route", "presets.json"))
	if e != nil {
		return nil, e
	}
	var presets map[string]any
	_ = json.Unmarshal(preset, &presets)
	targets, _ := json.Marshal(presets["beijing"])
	if e = plugin.SaveConfiguration("return-route", map[string]any{"enabled": false, "interval_minutes": 60, "history_days": 30, "nodes": `["node-a","node-b","node-c"]`, "targets": string(targets)}); e != nil {
		return nil, e
	}
	if e = plugin.SetEnabled("return-route", true, true); e != nil {
		return nil, e
	}
	f.handler = plugin.HTMLInjectHandler(r)
	return f, nil
}
func (f *fixture) close() { _ = plugin.CloseAll(); _ = os.RemoveAll(f.dir) }
func main() {
	archive := flag.String("plugin-zip", "../dist/komari-plugin-return-route-0.1.1.zip", "plugin ZIP")
	themeDir := flag.String("theme-dist", "", "optional upstream theme dist for local browser checks")
	listen := flag.String("listen", "127.0.0.1:5371", "local-only address")
	flag.Parse()
	if !strings.HasPrefix(*listen, "127.0.0.1:") {
		panic("fixture host only binds loopback")
	}
	f, e := newFixture(*archive, *themeDir)
	if e != nil {
		panic(e)
	}
	defer f.close()
	fmt.Println("LOCAL FIXTURE ONLY:", *listen)
	if e = http.ListenAndServe(*listen, f.handler); e != nil {
		panic(e)
	}
}
