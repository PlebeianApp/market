// Command market-agg-relay is a Khatru-based aggregator relay for Plebeian
// Market. It combines a market-kind-gated relay (the write path) with a
// scraper that continuously pulls market-relevant events from the Nostr relay
// graph into local SQLite storage (the read/caching path).
//
// This is the Khatru-only alternative to the strfry aggregator in the parent
// directory. It uses the same dual-mode write-policy gate (ported to Go) and
// adds NIP-77 negentropy sync support natively, with no external subprocess.
//
// Configuration is via environment variables (see loadConfig in config.go):
//
//	SEED_NPUB        (required) bech32 npub of the relay operator
//	DB_PATH          SQLite database path (default ./market-agg.db)
//	LISTEN_ADDR      bind address (default :3334)
//	ALLOWED_PATH     allowlist file path (default ./allowed.npubs)
//	BOOTSTRAP_RELAYS comma-separated initial relay URLs
//	SCRAPE_INTERVAL  seconds between scrape cycles (default 3600)
package main

import (
	"context"
	"log"
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/fiatjaf/eventstore"
	"github.com/fiatjaf/eventstore/sqlite3"
	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"

	"github.com/plebeianmarket/market-agg-relay/policy"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.SetPrefix("[market-agg] ")

	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}
	log.Printf("starting khatru aggregator relay")
	log.Printf("  seed:    %s -> %s", cfg.SeedNpub, cfg.SeedHex)
	log.Printf("  db:      %s", cfg.DBPath)
	log.Printf("  listen:  %s", cfg.ListenAddr)
	log.Printf("  scrape:  every %ds", cfg.ScrapeInterval)

	// --- Storage: SQLite backend ---
	db := &sqlite3.SQLite3Backend{
		DatabaseURL: cfg.DBPath,
	}
	if err := db.Init(); err != nil {
		log.Fatalf("failed to init sqlite store: %v", err)
	}
	defer db.Close()

	// --- Write-policy gate (ported from write-policy.py) ---
	allowedList := policy.NewFileAllowlist(cfg.AllowedPath)
	gate := policy.Policy{
		RootHex: cfg.SeedHex,
		Allowed: allowedList,
	}

	// --- Khatru relay ---
	relay := khatru.NewRelay()
	relay.Negentropy = true // NIP-77 sync support

	// Write gate: RejectEvent runs before storage hooks.
	relay.RejectEvent = append(relay.RejectEvent, func(ctx context.Context, event *nostr.Event) (bool, string) {
		accept, reason := gate.Decide(event.PubKey, event.Kind)
		return !accept, reason // RejectEvent returns (reject=true to block)
	})

	// Storage hooks: wire the SQLite backend directly.
	relay.StoreEvent = append(relay.StoreEvent, db.SaveEvent)
	relay.QueryEvents = append(relay.QueryEvents, db.QueryEvents)
	relay.DeleteEvent = append(relay.DeleteEvent, db.DeleteEvent)
	relay.ReplaceEvent = append(relay.ReplaceEvent, db.ReplaceEvent)

	// Post-save hook: log what we store (useful during scrape).
	relay.OnEventSaved = append(relay.OnEventSaved, func(ctx context.Context, event *nostr.Event) {
		log.Printf("stored event %s kind=%d pubkey=%s", event.ID, event.Kind, event.PubKey[:16])
	})

	// --- Scraper goroutine ---
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	storeWrapper := eventstore.RelayWrapper{Store: db}
	sc := &scraper{
		seedHex:         cfg.SeedHex,
		bootstrapRelays: cfg.BootstrapRelays,
		store:           storeWrapper,
	}
	go sc.run(ctx, time.Duration(cfg.ScrapeInterval)*time.Second)

	// --- HTTP server ---
	host, portStr, err := net.SplitHostPort(cfg.ListenAddr)
	if err != nil {
		// ListenAddr might be just ":3334" — SplitHostPort handles that.
		host, portStr = "", strings.TrimPrefix(cfg.ListenAddr, ":")
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		log.Fatalf("invalid LISTEN_ADDR port %q: %v", portStr, err)
	}

	// Graceful shutdown on SIGINT/SIGTERM.
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Printf("shutdown signal received")
		cancel()
		// Use a fresh context for the HTTP shutdown (the scrape ctx is now
		// cancelled, which would make httpServer.Shutdown return immediately).
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		relay.Shutdown(shutdownCtx)
	}()

	started := make(chan bool, 1)
	log.Printf("listening on %s:%d", host, port)
	if err := relay.Start(host, port, started); err != nil {
		log.Fatalf("relay server error: %v", err)
	}
}
