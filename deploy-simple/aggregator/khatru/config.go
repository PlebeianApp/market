package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/nbd-wtf/go-nostr/nip19"
)

// Config holds all runtime configuration, sourced from environment variables.
type Config struct {
	// SeedNpub is the bech32 npub (npub1...) of the relay operator, used to
	// bootstrap the relay graph and always-accept rule.
	SeedNpub string

	// SeedHex is SeedNpub decoded to lowercase hex.
	SeedHex string

	// DBPath is the SQLite database file path.
	DBPath string

	// ListenAddr is the host:port the relay HTTP server binds to.
	ListenAddr string

	// AllowedPath is the optional allowlist file path (hot-reloaded).
	AllowedPath string

	// BootstrapRelays are the initial relay URLs used to fetch the seed npub's
	// contact list and relay list before any local data exists.
	BootstrapRelays []string

	// ScrapeInterval is how often the scraper re-discovers relays (seconds).
	ScrapeInterval int
}

// loadConfig reads configuration from environment variables with sensible
// defaults. It returns an error if a required value is missing or invalid.
func loadConfig() (Config, error) {
	cfg := Config{
		SeedNpub:       strings.TrimSpace(os.Getenv("SEED_NPUB")),
		DBPath:         envDefault("DB_PATH", "./market-agg.db"),
		ListenAddr:     envDefault("LISTEN_ADDR", ":3334"),
		AllowedPath:    envDefault("ALLOWED_PATH", "./allowed.npubs"),
		BootstrapRelays: parseRelayList(os.Getenv("BOOTSTRAP_RELAYS")),
		ScrapeInterval: envIntDefault("SCRAPE_INTERVAL", 3600),
	}

	if cfg.SeedNpub == "" {
		return cfg, fmt.Errorf("SEED_NPUB is required (bech32 npub of the relay operator)")
	}

	// Default bootstrap relays if none configured.
	if len(cfg.BootstrapRelays) == 0 {
		cfg.BootstrapRelays = []string{
			"wss://relay.plebeian.market",
			"wss://relay.damus.io",
			"wss://nos.lol",
		}
	}

	// Decode the seed npub to hex once at startup.
	prefix, val, err := nip19.Decode(cfg.SeedNpub)
	if err != nil {
		return cfg, fmt.Errorf("invalid SEED_NPUB %q: %w", cfg.SeedNpub, err)
	}
	hexStr, ok := val.(string)
	if !ok || prefix != "npub" {
		return cfg, fmt.Errorf("SEED_NPUB must be an npub (got prefix %q)", prefix)
	}
	cfg.SeedHex = strings.ToLower(hexStr)

	return cfg, nil
}

func envDefault(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func envIntDefault(key string, def int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil && n > 0 {
			return n
		}
	}
	return def
}

// parseRelayList splits a comma/space/newline-separated list of relay URLs.
func parseRelayList(raw string) []string {
	var out []string
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\n' || r == '\t'
	}) {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}
