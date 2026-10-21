package probe

import (
	"context"
	"fmt"
	"net/netip"
	"strings"
	"sync"
	"time"
)

const Version = "0.1.0"
const Dataset = "backtrace-6c2b9ff7"

type Target struct {
	ID      string `json:"id"`
	Carrier string `json:"carrier"`
	Name    string `json:"name"`
	Region  string `json:"region"`
	Address string `json:"address"`
	Family  int    `json:"family"`
}
type Config struct {
	Schema    int      `json:"schema"`
	RequestID string   `json:"request_id"`
	Targets   []Target `json:"targets"`
}
type Hop struct {
	TTL   int     `json:"ttl"`
	IP    string  `json:"ip"`
	ASN   string  `json:"asn,omitempty"`
	RTTMS float64 `json:"rtt_ms"`
}
type Attempt struct {
	Hops    []Hop  `json:"hops"`
	Reached bool   `json:"reached"`
	Error   string `json:"error,omitempty"`
}
type TargetResult struct {
	Target         Target              `json:"target"`
	Status         string              `json:"status"`
	Attempts       []Attempt           `json:"attempts"`
	Classification RouteClassification `json:"classification"`
}
type Report struct {
	Schema     int            `json:"schema"`
	RequestID  string         `json:"request_id"`
	Version    string         `json:"version"`
	Dataset    string         `json:"dataset"`
	StartedAt  string         `json:"started_at"`
	FinishedAt string         `json:"finished_at"`
	Results    []TargetResult `json:"results"`
}

func Validate(c Config) error {
	if c.Schema != 1 || len(c.RequestID) < 1 || len(c.RequestID) > 100 || len(c.Targets) < 1 || len(c.Targets) > 18 {
		return fmt.Errorf("invalid request envelope")
	}
	seen := map[string]bool{}
	for _, t := range c.Targets {
		ip, e := netip.ParseAddr(t.Address)
		if e != nil || ip.Zone() != "" || ip.Is4In6() || !ip.IsGlobalUnicast() || ip.IsPrivate() || (t.Family != 4 && t.Family != 6) || ip.Is4() != (t.Family == 4) {
			return fmt.Errorf("target %s must be a public literal IPv%d address", t.ID, t.Family)
		}
		if t.Carrier != "CT" && t.Carrier != "CU" && t.Carrier != "CM" {
			return fmt.Errorf("unknown carrier")
		}
		if len(t.ID) < 1 || len(t.ID) > 80 || seen[t.ID] || len(t.Name) > 120 || len(t.Region) > 80 {
			return fmt.Errorf("invalid or duplicate target")
		}
		seen[t.ID] = true
	}
	return nil
}

type TraceFunc func(context.Context, string) Attempt

func Run(ctx context.Context, c Config, trace TraceFunc) Report {
	r := Report{Schema: 1, RequestID: c.RequestID, Version: Version, Dataset: Dataset, StartedAt: time.Now().UTC().Format(time.RFC3339), Results: make([]TargetResult, len(c.Targets))}
	sem := make(chan struct{}, 2)
	var wg sync.WaitGroup
	for i, t := range c.Targets {
		wg.Add(1)
		go func(i int, t Target) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				r.Results[i] = TargetResult{Target: t, Status: "timeout", Classification: ClassifyReturnRoute(t.Carrier, nil)}
				return
			}
			child, cancel := context.WithTimeout(ctx, 55*time.Second)
			defer cancel()
			tr := TargetResult{Target: t, Status: "unavailable", Attempts: []Attempt{}}
			classes := []RouteClassification{}
			responded := false
			for n := 0; n < 3 && child.Err() == nil; n++ {
				a := trace(child, t.Address)
				tr.Attempts = append(tr.Attempts, a)
				ev := []RouteHopEvidence{}
				for _, h := range a.Hops {
					if h.IP != "" {
						responded = true
					}
					if h.ASN != "" {
						ev = append(ev, RouteHopEvidence{Distance: h.TTL, ASNs: []string{h.ASN}})
					}
				}
				if a.Reached {
					tr.Status = "available"
				}
				classes = append(classes, ClassifyReturnRoute(t.Carrier, ev))
			}
			if tr.Status != "available" && responded {
				tr.Status = "partial"
			}
			if !responded && len(tr.Attempts) > 0 {
				for _, a := range tr.Attempts {
					if strings.Contains(a.Error, "permission") || strings.Contains(a.Error, "permitted") {
						tr.Status = "permission_denied"
					}
				}
			}
			if !responded {
				for _, a := range tr.Attempts {
					if strings.Contains(a.Error, "network is unreachable") || strings.Contains(a.Error, "cannot assign requested address") || strings.Contains(a.Error, "address family not supported") {
						tr.Status = "network_unavailable"
					}
				}
			}
			if !responded && child.Err() != nil {
				tr.Status = "timeout"
			}
			tr.Classification = combineRouteClassifications(t.Carrier, classes)
			r.Results[i] = tr
		}(i, t)
	}
	wg.Wait()
	r.FinishedAt = time.Now().UTC().Format(time.RFC3339)
	return r
}

func ASN(ip string) string { return ipv4Asn(ip) }
