package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"iter"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"fiatjaf.com/nostr"
	"fiatjaf.com/nostr/eventstore"
	eventstorebleve "fiatjaf.com/nostr/eventstore/bleve"
	eventstoreboltdb "fiatjaf.com/nostr/eventstore/boltdb"
	"fiatjaf.com/nostr/khatru"
	"fiatjaf.com/nostr/khatru/policies"
	"fiatjaf.com/nostr/nip11"
	"github.com/PlebeianTech/market/deploy-simple/relay/internal/searchindex"
)

var version = "dev"

type config struct {
	Name            string
	Description     string
	Contact         string
	Icon            string
	PubKey          string
	PublicURL       string
	ListenAddr      string
	DataDir         string
	SearchIndexDir  string
	RawEventStore   string
	MaxQueryLimit   int
	MinFreeBytes    uint64
	SupportedNIPs   []int
	ReadHeaderMs    time.Duration
	ShutdownTimeout time.Duration
}

type compositeStore struct {
	raw    *eventstoreboltdb.BoltBackend
	search *eventstorebleve.BleveBackend
	config config
	mu     sync.RWMutex
	closed bool
}

func main() {
	rebuildTo := flag.String("rebuild-search-to", "", "Build a compact search index in a new directory while the relay is stopped; preserve the existing index and raw events")
	flag.Parse()
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	if *rebuildTo != "" {
		count, err := searchindex.Rebuild(filepath.Join(cfg.RawEventStore, "events.db"), *rebuildTo, 2<<30)
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("compact search index complete: %d events at %s; active index unchanged", count, *rebuildTo)
		return
	}

	store, cleanup, err := openStore(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer cleanup()

	relay := khatru.NewRelay()
	relay.ServiceURL = cfg.PublicURL
	relay.Info.Name = cfg.Name
	relay.Info.Description = cfg.Description
	relay.Info.Contact = cfg.Contact
	relay.Info.Icon = cfg.Icon
	relay.Info.Software = "https://github.com/PlebeianTech/market/tree/master/deploy-simple/relay"
	relay.Info.Version = version
	relay.Info.AddSupportedNIPs(cfg.SupportedNIPs)
	relay.Info.Limitation = &nip11.RelayLimitationDocument{
		MaxLimit: cfg.MaxQueryLimit,
	}

	if cfg.PubKey != "" {
		pubKey, err := nostr.PubKeyFromHex(cfg.PubKey)
		if err != nil {
			log.Fatalf("invalid RELAY_PUBKEY: %v", err)
		}
		relay.Info.PubKey = &pubKey
	}

	relay.OnEvent = policies.SeqEvent(
		policies.ValidateKind,
		policies.RejectEventsWithBase64Media,
		policies.RejectUnprefixedNostrReferences,
	)
	relay.OnRequest = policies.SeqRequest(policies.NoComplexFilters)
	relay.UseEventstore(store, cfg.MaxQueryLimit)

	router := relay.Router()
	router.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})

	server := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           relay,
		ReadHeaderTimeout: cfg.ReadHeaderMs,
	}

	go func() {
		log.Printf("market-relay %s listening on %s (%s)", version, cfg.ListenAddr, cfg.PublicURL)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	sigCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-sigCtx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("relay shutdown failed: %v", err)
	}
}

func loadConfig() (config, error) {
	minFreeBytes, err := strconv.ParseUint(envOr("RELAY_MIN_FREE_BYTES", "536870912"), 10, 64)
	if err != nil {
		return config{}, fmt.Errorf("invalid RELAY_MIN_FREE_BYTES: %w", err)
	}
	cfg := config{
		Name:            envOr("RELAY_NAME", "Plebeian Market Relay"),
		Description:     envOr("RELAY_DESCRIPTION", "Plebeian Market application relay"),
		Contact:         os.Getenv("RELAY_CONTACT"),
		Icon:            os.Getenv("RELAY_ICON"),
		PubKey:          os.Getenv("RELAY_PUBKEY"),
		PublicURL:       envOr("RELAY_PUBLIC_URL", "ws://localhost:10547"),
		ListenAddr:      envOr("RELAY_LISTEN_ADDR", "127.0.0.1:10547"),
		DataDir:         envOr("RELAY_DATA_DIR", "/var/lib/market-relay"),
		SearchIndexDir:  envOr("RELAY_SEARCH_INDEX_DIR", "/var/lib/market-relay/search"),
		RawEventStore:   envOr("RELAY_RAW_DB_DIR", "/var/lib/market-relay/raw"),
		MaxQueryLimit:   envOrInt("RELAY_MAX_QUERY_LIMIT", 500),
		MinFreeBytes:    minFreeBytes,
		SupportedNIPs:   envOrInts("RELAY_SUPPORTED_NIPS", []int{1, 11, 50}),
		ReadHeaderMs:    time.Duration(envOrInt("RELAY_READ_HEADER_TIMEOUT_MS", 10000)) * time.Millisecond,
		ShutdownTimeout: time.Duration(envOrInt("RELAY_SHUTDOWN_TIMEOUT_MS", 10000)) * time.Millisecond,
	}

	for _, dir := range []string{cfg.DataDir, cfg.RawEventStore} {
		if err := os.MkdirAll(filepath.Clean(dir), 0o755); err != nil {
			return config{}, fmt.Errorf("create relay dir %s: %w", dir, err)
		}
	}

	return cfg, nil
}

func openStore(cfg config) (eventstore.Store, func(), error) {
	rawStore := &eventstoreboltdb.BoltBackend{
		Path: filepath.Join(cfg.RawEventStore, "events.db"),
	}
	if err := rawStore.Init(); err != nil {
		return nil, nil, fmt.Errorf("init BoltDB raw store: %w", err)
	}
	if err := searchindex.Prepare(cfg.SearchIndexDir, rawStore.DB); err != nil {
		rawStore.Close()
		return nil, nil, err
	}

	searchStore := &eventstorebleve.BleveBackend{
		Path:          cfg.SearchIndexDir,
		RawEventStore: rawStore,
	}
	if err := searchStore.Init(); err != nil {
		rawStore.Close()
		return nil, nil, fmt.Errorf("open Bleve search store (existing data preserved; recovery requires an explicit rebuild): %w", err)
	}

	store := &compositeStore{
		raw:    rawStore,
		search: searchStore,
		config: cfg,
	}
	return store, store.Close, nil
}

func (s *compositeStore) Init() error {
	return nil
}

func (s *compositeStore) Close() {
	// WebSocket handlers can outlive http.Server.Shutdown. Drain their active
	// store operations and refuse new ones before closing either backend.
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	s.search.Close()
	s.raw.Close()
}

func (s *compositeStore) QueryEvents(filter nostr.Filter, maxLimit int) iter.Seq[nostr.Event] {
	return func(yield func(nostr.Event) bool) {
		s.mu.RLock()
		defer s.mu.RUnlock()
		if s.closed {
			return
		}
		if len(strings.TrimSpace(filter.Search)) >= 2 {
			s.search.QueryEvents(filter, maxLimit)(yield)
		} else {
			s.raw.QueryEvents(filter, maxLimit)(yield)
		}
	}
}

func (s *compositeStore) DeleteEvent(id nostr.ID) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed {
		return errors.New("relay store is closed")
	}
	if err := s.raw.DeleteEvent(id); err != nil {
		return err
	}
	if err := s.search.DeleteEvent(id); err != nil {
		return err
	}
	return nil
}

func (s *compositeStore) SaveEvent(evt nostr.Event) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed {
		return errors.New("relay store is closed")
	}
	if err := s.checkWriteBudget(); err != nil {
		return err
	}
	if err := s.raw.SaveEvent(evt); err != nil {
		return err
	}
	if err := s.search.SaveEvent(evt); err != nil {
		return err
	}
	return nil
}

func (s *compositeStore) ReplaceEvent(evt nostr.Event) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed {
		return errors.New("relay store is closed")
	}
	if err := s.checkWriteBudget(); err != nil {
		return err
	}
	filter := nostr.Filter{Kinds: []nostr.Kind{evt.Kind}, Authors: []nostr.PubKey{evt.PubKey}}
	if evt.Kind.IsAddressable() {
		filter.Tags = nostr.TagMap{"d": []string{evt.Tags.GetD()}}
	}

	var previous []nostr.Event
	for existing := range s.raw.QueryEvents(filter, 10) {
		previous = append(previous, existing)
	}

	if err := s.raw.ReplaceEvent(evt); err != nil {
		return err
	}

	for _, existing := range previous {
		if existing.ID == evt.ID {
			continue
		}
		if err := s.search.DeleteEvent(existing.ID); err != nil {
			return err
		}
	}

	stored := false
	for existing := range s.raw.QueryEvents(nostr.Filter{IDs: []nostr.ID{evt.ID}}, 1) {
		if existing.ID == evt.ID {
			stored = true
			break
		}
	}
	if stored {
		if err := s.search.SaveEvent(evt); err != nil {
			return err
		}
	}

	return nil
}

func (s *compositeStore) CountEvents(filter nostr.Filter) (uint32, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed {
		return 0, errors.New("relay store is closed")
	}
	if len(strings.TrimSpace(filter.Search)) >= 2 {
		return 0, errors.New("count with search filter is not supported")
	}
	return s.raw.CountEvents(filter)
}

func (s *compositeStore) checkWriteBudget() error {
	for _, path := range []string{s.config.RawEventStore, s.config.SearchIndexDir} {
		if err := searchindex.CheckFreeSpace(path, s.config.MinFreeBytes); err != nil {
			return fmt.Errorf("error: relay storage reserve reached; retry later: %w", err)
		}
	}
	return nil
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envOrInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envOrInts(key string, fallback []int) []int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parts := strings.Split(value, ",")
	values := make([]int, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		parsed, err := strconv.Atoi(part)
		if err != nil {
			return fallback
		}
		values = append(values, parsed)
	}

	if len(values) == 0 {
		return fallback
	}
	return values
}
