package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds the server configuration
type Config struct {
	ListenAddr      string // Address to listen on (e.g., ":8080")
	UpstreamURL     string // Upstream URL to proxy to (e.g., "https://plebeian.market")
	RelayURL        string // Nostr relay URL for fetching/publishing events
	PrivateKey      string // Hex-encoded private key for signing events
	Domain          string // Domain for vanity URLs (e.g., "store.plebeian.market")
	PriceSats       int64  // Price in satoshis per registration
	DurationSeconds int64  // Duration of registration in seconds

	// Coinos API configuration
	CoinosAPIURL  string // Coinos API base URL (default: https://coinos.io)
	CoinosToken   string // Coinos JWT auth token
	CoinosWebhook string // Webhook URL for payment notifications (optional)
}

// DefaultConfig returns a Config with default values
func DefaultConfig() *Config {
	return &Config{
		ListenAddr:      ":8080",
		PriceSats:       2000,
		DurationSeconds: 31536000, // 1 year
		CoinosAPIURL:    "https://coinos.io",
	}
}

// LoadConfigFromEnv loads configuration from environment variables
func LoadConfigFromEnv() (*Config, error) {
	cfg := DefaultConfig()

	if v := os.Getenv("VANITY_LISTEN_ADDR"); v != "" {
		cfg.ListenAddr = v
	}

	if v := os.Getenv("VANITY_UPSTREAM_URL"); v != "" {
		cfg.UpstreamURL = strings.TrimSuffix(v, "/")
	} else {
		return nil, fmt.Errorf("VANITY_UPSTREAM_URL is required")
	}

	if v := os.Getenv("VANITY_RELAY_URL"); v != "" {
		cfg.RelayURL = v
	} else {
		return nil, fmt.Errorf("VANITY_RELAY_URL is required")
	}

	if v := os.Getenv("VANITY_PRIVATE_KEY"); v != "" {
		cfg.PrivateKey = v
	} else {
		return nil, fmt.Errorf("VANITY_PRIVATE_KEY is required")
	}

	// Coinos API configuration
	if v := os.Getenv("COINOS_API_URL"); v != "" {
		cfg.CoinosAPIURL = strings.TrimSuffix(v, "/")
	}

	if v := os.Getenv("COINOS_TOKEN"); v != "" {
		cfg.CoinosToken = v
	}
	// Coinos token is optional - server can run without payment monitoring

	if v := os.Getenv("COINOS_WEBHOOK"); v != "" {
		cfg.CoinosWebhook = v
	}

	if v := os.Getenv("VANITY_DOMAIN"); v != "" {
		cfg.Domain = v
	} else {
		return nil, fmt.Errorf("VANITY_DOMAIN is required")
	}

	if v := os.Getenv("VANITY_PRICE_SATS"); v != "" {
		price, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid VANITY_PRICE_SATS: %w", err)
		}
		cfg.PriceSats = price
	}

	if v := os.Getenv("VANITY_DURATION_SECS"); v != "" {
		duration, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid VANITY_DURATION_SECS: %w", err)
		}
		cfg.DurationSeconds = duration
	}

	return cfg, nil
}

// ReservedNames that cannot be registered as vanity URLs
var ReservedNames = map[string]bool{
	"admin":      true,
	"api":        true,
	"help":       true,
	"support":    true,
	"status":     true,
	"docs":       true,
	"blog":       true,
	"settings":   true,
	"dashboard":  true,
	"login":      true,
	"logout":     true,
	"signup":     true,
	"product":    true,
	"products":   true,
	"collection": true,
	"user":       true,
	"profile":    true,
	"search":     true,
	"checkout":   true,
	"cart":       true,
	"p":          true,
	"c":          true,
	"assets":     true,
	"static":     true,
	"favicon":    true,
}

// IsReservedName checks if a name is reserved
func IsReservedName(name string) bool {
	return ReservedNames[strings.ToLower(name)]
}
