package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/yinpengfei/komari-plugin-return-route/internal/probe"
)

func main() {
	encoded := flag.String("config-b64", "", "Base64 JSON configuration (public literal IP targets only)")
	version := flag.Bool("version", false, "Print collector version")
	flag.Parse()
	if *version {
		fmt.Println(probe.Version)
		return
	}
	if len(*encoded) > 32768 {
		fail("configuration too large")
	}
	raw, err := base64.StdEncoding.DecodeString(*encoded)
	if err != nil {
		fail("invalid base64 configuration")
	}
	var c probe.Config
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err = dec.Decode(&c); err != nil {
		fail("invalid JSON configuration")
	}
	if err = probe.Validate(c); err != nil {
		fail(err.Error())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()
	result := probe.Run(ctx, c, probe.Trace)
	out, err := json.Marshal(result)
	if err != nil || len(out) > 1<<20 {
		fail("report exceeds output limit")
	}
	fmt.Println(string(out))
}
func fail(message string) {
	out, _ := json.Marshal(map[string]any{"schema": 1, "error": message})
	fmt.Println(string(out))
	os.Exit(1)
}
