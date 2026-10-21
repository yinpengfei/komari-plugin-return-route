package probe

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"net"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
	"golang.org/x/net/ipv6"
)

// Trace sends only ICMP probes to the provided literal address. No DNS or
// auxiliary lookup is performed. Socket deadlines enforce the context budget.
func Trace(ctx context.Context, address string) Attempt {
	out := Attempt{Hops: []Hop{}}
	dst := net.ParseIP(address)
	if dst == nil {
		out.Error = "invalid IP"
		return out
	}
	network, bind, protocol := "ip6:ipv6-icmp", "::", 58
	var requestType icmp.Type = ipv6.ICMPTypeEchoRequest
	if dst.To4() != nil {
		network, bind, protocol = "ip4:icmp", "0.0.0.0", 1
		requestType = ipv4.ICMPTypeEcho
	}
	conn, err := icmp.ListenPacket(network, bind)
	if err != nil {
		out.Error = err.Error()
		return out
	}
	defer conn.Close()
	var nonce [2]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		out.Error = err.Error()
		return out
	}
	id := int(binary.BigEndian.Uint16(nonce[:]))
	buf := make([]byte, 2048)
	for ttl := 1; ttl <= 30 && ctx.Err() == nil; ttl++ {
		if protocol == 1 {
			err = conn.IPv4PacketConn().SetTTL(ttl)
		} else {
			err = conn.IPv6PacketConn().SetHopLimit(ttl)
		}
		if err != nil {
			out.Error = err.Error()
			return out
		}
		packet, e := (&icmp.Message{Type: requestType, Code: 0, Body: &icmp.Echo{ID: id, Seq: ttl, Data: []byte("komari-return-route")}}).Marshal(nil)
		if e != nil {
			out.Error = e.Error()
			return out
		}
		started := time.Now()
		deadline := started.Add(750 * time.Millisecond)
		if end, ok := ctx.Deadline(); ok && end.Before(deadline) {
			deadline = end
		}
		if e = conn.SetDeadline(deadline); e != nil {
			out.Error = e.Error()
			return out
		}
		if _, e = conn.WriteTo(packet, &net.IPAddr{IP: dst}); e != nil {
			out.Error = e.Error()
			return out
		}
		for ctx.Err() == nil {
			n, peer, e := conn.ReadFrom(buf)
			if e != nil {
				break
			}
			reply, e := icmp.ParseMessage(protocol, buf[:n])
			if e != nil {
				continue
			}
			matched, reached, unreachable := matchReply(reply, protocol, id, ttl)
			if !matched {
				continue
			}
			src, ok := peer.(*net.IPAddr)
			if !ok {
				continue
			}
			if reached && !src.IP.Equal(dst) {
				continue
			}
			out.Hops = append(out.Hops, Hop{TTL: ttl, IP: src.IP.String(), ASN: ASN(src.IP.String()), RTTMS: float64(time.Since(started).Microseconds()) / 1000})
			if reached {
				out.Reached = true
				return out
			}
			if unreachable {
				out.Error = "destination unreachable"
				return out
			}
			break
		}
	}
	if ctx.Err() != nil {
		out.Error = ctx.Err().Error()
	}
	return out
}

func matchReply(msg *icmp.Message, protocol, id, seq int) (bool, bool, bool) {
	if echo, ok := msg.Body.(*icmp.Echo); ok {
		isReply := (protocol == 1 && msg.Type == ipv4.ICMPTypeEchoReply) || (protocol == 58 && msg.Type == ipv6.ICMPTypeEchoReply)
		return isReply && echo.ID == id && echo.Seq == seq, isReply, false
	}
	var data []byte
	unreachable := false
	switch body := msg.Body.(type) {
	case *icmp.TimeExceeded:
		data = body.Data
	case *icmp.DstUnreach:
		data = body.Data
		unreachable = true
	default:
		return false, false, false
	}
	offset := 40
	if protocol == 1 {
		if len(data) < 20 || data[0]>>4 != 4 || data[9] != 1 {
			return false, false, false
		}
		offset = int(data[0]&15) * 4
		if offset < 20 {
			return false, false, false
		}
	} else {
		if len(data) < 40 || data[0]>>4 != 6 || data[6] != 58 {
			return false, false, false
		}
	}
	if len(data) < offset+8 {
		return false, false, false
	}
	expectedType := byte(128)
	if protocol == 1 {
		expectedType = 8
	}
	if data[offset] != expectedType {
		return false, false, false
	}
	return int(binary.BigEndian.Uint16(data[offset+4:])) == id && int(binary.BigEndian.Uint16(data[offset+6:])) == seq, false, unreachable
}

func Smoke(ctx context.Context, address string) error {
	a := Trace(ctx, address)
	if !a.Reached {
		return fmt.Errorf("ICMP loopback failed: %s", a.Error)
	}
	return nil
}
