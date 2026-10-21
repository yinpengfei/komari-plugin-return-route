package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/komari-monitor/komari/internal/plugin"
)

func TestActualPluginHost(t *testing.T) {
	archive, _ := filepath.Abs("../dist/komari-plugin-return-route-0.1.0.zip")
	f, e := newFixture(archive)
	if e != nil {
		t.Fatal(e)
	}
	defer f.close()
	request := func(method, path, body string, admin bool, site string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if admin {
			r.Header.Set("Authorization", "Bearer fixture-only")
		}
		if method == "POST" {
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-Komari-Return-Route", "1")
			r.Header.Set("Sec-Fetch-Site", site)
		}
		w := httptest.NewRecorder()
		f.handler.ServeHTTP(w, r)
		return w
	}
	waitState := func() map[string]any {
		t.Helper()
		for i := 0; i < 50; i++ {
			w := request("GET", "/api/plugins/return-route/state", "", true, "")
			var d map[string]any
			_ = json.Unmarshal(w.Body.Bytes(), &d)
			if w.Code == 200 && d["configuration"] != nil {
				return d
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatalf("plugin failed to initialize: %s", plugin.GetLogs("return-route"))
		return nil
	}
	_ = waitState()
	if w := request("POST", "/api/plugins/return-route/refresh", `{"nodes":["node-a"],"kind":"probe"}`, false, "same-origin"); w.Code != 401 {
		t.Fatalf("anonymous POST %d %s", w.Code, w.Body.String())
	}
	if w := request("POST", "/api/plugins/return-route/refresh", `{"nodes":["node-a"],"kind":"probe"}`, true, "cross-site"); w.Code != 403 {
		t.Fatalf("cross-site POST %d", w.Code)
	}
	w := request("POST", "/api/plugins/return-route/refresh", `{"nodes":["node-a","node-b","node-c"],"kind":"probe"}`, true, "same-origin")
	if w.Code != 202 {
		t.Fatalf("dispatch %d %s logs %s", w.Code, w.Body.String(), plugin.GetLogs("return-route"))
	}
	for i := 0; i < 80; i++ {
		w = request("GET", "/api/plugins/return-route/detail?uuid=node-a", "", true, "")
		if strings.Contains(w.Body.String(), `"observed_at"`) {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !strings.Contains(w.Body.String(), "59.43.1.1") {
		t.Fatalf("actual runtime did not collect fixture: %s logs %s", w.Body.String(), plugin.GetLogs("return-route"))
	}
	public := request("GET", "/api/plugins/return-route/summary", "", false, "")
	if public.Code != 200 {
		t.Fatal(public.Body.String())
	}
	for _, secret := range []string{"node-b", "59.43.1.1", "219.141.140.10", "DO_NOT_EXPOSE"} {
		if strings.Contains(public.Body.String(), secret) {
			t.Fatalf("public leak: %s", secret)
		}
	}
	f.private.Store(true)
	if w := request("GET", "/api/plugins/return-route/summary", "", false, ""); w.Code != 401 {
		t.Fatal("private site leaked")
	}
	f.private.Store(false)
	if e = plugin.Reload("return-route"); e != nil {
		t.Fatal(e)
	}
	_ = waitState()
	w = request("GET", "/api/plugins/return-route/detail?uuid=node-a", "", true, "")
	if !strings.Contains(w.Body.String(), "59.43.1.1") {
		t.Fatal("reload lost data")
	}
	if _, e = plugin.InstallZip(archive); e != nil {
		t.Fatal(e)
	}
	_ = waitState()
	w = request("GET", "/api/plugins/return-route/detail?uuid=node-a", "", true, "")
	if !strings.Contains(w.Body.String(), "59.43.1.1") {
		t.Fatal("upgrade lost data")
	}
	if e = plugin.SetEnabled("return-route", false, false); e != nil {
		t.Fatal(e)
	}
	if w := request(http.MethodGet, "/api/plugins/return-route/summary", "", false, ""); w.Code != 404 {
		t.Fatal("disabled plugin still active")
	}
}
