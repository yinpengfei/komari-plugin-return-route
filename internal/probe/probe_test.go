package probe

import (
	"context"
	"encoding/binary"
	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
	"os"
	"strings"
	"testing"
	"time"
)

func TestValidationAndReport(t *testing.T) {
	cfg := Config{Schema: 1, RequestID: "test", Targets: []Target{{ID: "ct4", Carrier: "CT", Family: 4, Address: "219.141.140.10"}, {ID: "cm6", Carrier: "CM", Family: 6, Address: "2402:4f00:f000::1"}}}
	if e := Validate(cfg); e != nil {
		t.Fatal(e)
	}
	for _, address := range []string{"127.0.0.1", "10.0.0.1", "example.com", "1.1.1.1;id"} {
		bad := cfg
		bad.Targets = []Target{{ID: "a", Carrier: "CT", Family: 4, Address: address}}
		if Validate(bad) == nil {
			t.Errorf("accepted %s", address)
		}
	}
	r := Run(context.Background(), cfg, func(_ context.Context, address string) Attempt {
		return Attempt{Reached: true, Hops: []Hop{{TTL: 1, IP: address, ASN: ASN(address)}}}
	})
	if len(r.Results) != 2 || r.RequestID != "test" {
		t.Fatalf("bad report %+v", r)
	}
	for _, result := range r.Results {
		if result.Status != "available" || len(result.Attempts) != 3 {
			t.Fatal(result)
		}
	}
}
func TestICMPReplyCorrelation(t *testing.T) {
	data := make([]byte, 28)
	data[0] = 0x45
	data[9] = 1
	data[20] = 8
	binary.BigEndian.PutUint16(data[24:], 42)
	binary.BigEndian.PutUint16(data[26:], 7)
	m := &icmp.Message{Type: ipv4.ICMPTypeTimeExceeded, Body: &icmp.TimeExceeded{Data: data}}
	good, reached, _ := matchReply(m, 1, 42, 7)
	if !good || reached {
		t.Fatal("lost matching hop")
	}
	if yes, _, _ := matchReply(m, 1, 43, 7); yes {
		t.Fatal("accepted other socket ID")
	}
	if yes, _, _ := matchReply(m, 1, 42, 8); yes {
		t.Fatal("accepted stale sequence")
	}
	m.Body = &icmp.TimeExceeded{Data: data[:24]}
	if yes, _, _ := matchReply(m, 1, 42, 7); yes {
		t.Fatal("accepted truncated quote")
	}
}
func TestEmbeddedASNLookup(t *testing.T) {
	for ip, want := range map[string]string{"59.43.1.1": "AS4809", "202.97.1.1": "AS4134", "218.105.1.1": "AS9929", "219.158.1.1": "AS4837", "223.118.32.1": "AS58807", "2402:4f00:f000::1": "AS58807", "8.8.8.8": ""} {
		if got := ASN(ip); got != want {
			t.Errorf("ASN(%s)=%s want %s", ip, got, want)
		}
	}
}
func TestCanceledProbeIsBounded(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cfg := Config{Schema: 1, RequestID: "cancel", Targets: []Target{{ID: "a", Carrier: "CT", Family: 4, Address: "1.1.1.1"}}}
	r := Run(ctx, cfg, func(ctx context.Context, _ string) Attempt { <-ctx.Done(); return Attempt{Error: ctx.Err().Error()} })
	if r.Results[0].Status != "timeout" {
		t.Fatal(r)
	}
}
func TestLinuxICMPSmoke(t *testing.T) {
	if os.Getenv("RR_ICMP_SMOKE") != "1" {
		t.Skip("set RR_ICMP_SMOKE=1 on a privileged Linux test runner")
	}
	for _, address := range []string{"127.0.0.1", "::1"} {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		err := Smoke(ctx, address)
		cancel()
		if err != nil {
			t.Fatal(err)
		}
	}
}
func TestIPv4PrefixBoundary(t *testing.T) {
	if got := ASN("61.140.1.1"); strings.Contains(got, "10099") {
		t.Fatal("partial octet falsely matched CUG")
	}
}
