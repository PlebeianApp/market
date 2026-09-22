package main

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"fiatjaf.com/nostr"
	eventstoreboltdb "fiatjaf.com/nostr/eventstore/boltdb"
	"go.etcd.io/bbolt"
)

func testStoreConfig(t *testing.T) config {
	t.Helper()
	root := t.TempDir()
	cfg := config{
		DataDir: root, RawEventStore: filepath.Join(root, "raw"),
		SearchIndexDir: filepath.Join(root, "search"),
	}
	if err := os.MkdirAll(cfg.RawEventStore, 0700); err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestDiskReserveRejectsWritesWithoutLosingExistingEvents(t *testing.T) {
	cfg := testStoreConfig(t)
	store, cleanup, err := openStore(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cleanup)
	evt := testEvent(t)
	if err := store.SaveEvent(evt); err != nil {
		t.Fatal(err)
	}
	store.(*compositeStore).config.MinFreeBytes = math.MaxUint64
	next := evt
	next.Kind = 30023
	next.CreatedAt++
	next.Content = "new event during disk pressure"
	if err := next.Sign(nostr.MustSecretKeyFromHex("0000000000000000000000000000000000000000000000000000000000000001")); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveEvent(next); err == nil {
		t.Error("low disk did not reject event save")
	}
	if err := store.ReplaceEvent(next); err == nil {
		t.Error("low disk did not reject event replacement")
	}
	if found := slices.Collect(store.QueryEvents(nostr.Filter{IDs: []nostr.ID{next.ID}}, 1)); len(found) != 0 {
		t.Fatal("rejected event was written to the raw store")
	}
	for _, filter := range []nostr.Filter{{IDs: []nostr.ID{evt.ID}}, {Search: "persistent"}} {
		found := slices.Collect(store.QueryEvents(filter, 10))
		if len(found) != 1 || found[0].ID != evt.ID {
			t.Fatal("disk pressure prevented reading existing events")
		}
	}
	store.(*compositeStore).config.MinFreeBytes = 0
	if err := store.SaveEvent(next); err != nil {
		t.Fatalf("writes did not recover after disk pressure was lifted: %v", err)
	}
}

func TestMissingIndexOverExistingEventsRequiresExplicitRebuild(t *testing.T) {
	cfg := testStoreConfig(t)
	raw := &eventstoreboltdb.BoltBackend{Path: filepath.Join(cfg.RawEventStore, "events.db")}
	if err := raw.Init(); err != nil {
		t.Fatal(err)
	}
	if err := raw.SaveEvent(testEvent(t)); err != nil {
		raw.Close()
		t.Fatal(err)
	}
	raw.Close()
	if _, _, err := openStore(cfg); err == nil {
		t.Fatal("startup created an empty search index over existing events")
	}
	if _, err := os.Stat(cfg.SearchIndexDir); !os.IsNotExist(err) {
		t.Fatal("startup created a replacement index without approval")
	}
	if err := raw.Init(); err != nil {
		t.Fatalf("failed startup kept the raw database locked: %v", err)
	}
	raw.Close()
}

func testEvent(t *testing.T) nostr.Event {
	t.Helper()
	evt := nostr.Event{Kind: 1, CreatedAt: 1700000000, Content: "persistent catalog fixture", Tags: nostr.Tags{}}
	if err := evt.Sign(nostr.MustSecretKeyFromHex("0000000000000000000000000000000000000000000000000000000000000001")); err != nil {
		t.Fatal(err)
	}
	return evt
}

func TestStoreShutdownAndReopenPreservesEventsAndSearch(t *testing.T) {
	cfg := testStoreConfig(t)
	store, cleanup, err := openStore(cfg)
	if err != nil {
		t.Fatal(err)
	}
	composite := store.(*compositeStore)
	// Explicit cleanup also releases resources when testing the broken helper.
	t.Cleanup(func() {
		if _, err := composite.search.CountEvents(nostr.Filter{}); err == nil {
			composite.search.Close()
		}
		composite.raw.Close()
	})
	evt := testEvent(t)
	if err := store.SaveEvent(evt); err != nil {
		t.Fatal(err)
	}
	cleanup()
	cleanup() // Shutdown paths may converge; closing twice must be harmless.
	if err := composite.raw.DB.View(func(*bbolt.Tx) error { return nil }); !errors.Is(err, bbolt.ErrDatabaseNotOpen) {
		t.Errorf("shutdown left the raw event database open: %v", err)
	}
	if _, err := composite.search.CountEvents(nostr.Filter{}); err == nil {
		t.Error("shutdown left the search index open")
	}
	if t.Failed() {
		return
	}

	reopened, closeReopened, err := openStore(cfg)
	if err != nil {
		t.Fatalf("reopen after shutdown: %v", err)
	}
	t.Cleanup(closeReopened)
	for _, filter := range []nostr.Filter{{IDs: []nostr.ID{evt.ID}}, {Search: "persistent"}} {
		found := slices.Collect(reopened.QueryEvents(filter, 10))
		if len(found) != 1 || found[0].ID != evt.ID {
			t.Errorf("stored event missing after reopen for %s: %v", filter, found)
		}
	}
}

func TestShutdownDrainsAcceptedWrites(t *testing.T) {
	cfg := testStoreConfig(t)
	store, cleanup, err := openStore(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cleanup)
	first := testEvent(t)
	if err := store.SaveEvent(first); err != nil {
		t.Fatal(err)
	}
	results := make(chan nostr.ID, 100)
	go func() {
		defer close(results)
		for i := range 100 {
			evt := first
			evt.Content = fmt.Sprintf("persistent concurrent write %d", i)
			if err := evt.Sign(nostr.MustSecretKeyFromHex("0000000000000000000000000000000000000000000000000000000000000001")); err != nil {
				break
			}
			if err := store.SaveEvent(evt); err != nil {
				break
			}
			results <- evt.ID
		}
	}()
	firstConcurrent, ok := <-results
	if !ok {
		t.Fatal("concurrent writer failed before shutdown")
	}
	cleanup()
	accepted := []nostr.ID{first.ID, firstConcurrent}
	for id := range results {
		accepted = append(accepted, id)
	}
	if err := store.SaveEvent(first); err == nil {
		t.Fatal("store accepted writes after shutdown")
	}
	reopened, closeReopened, err := openStore(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(closeReopened)
	searchable := make(map[nostr.ID]bool)
	for evt := range reopened.QueryEvents(nostr.Filter{Search: "persistent"}, 200) {
		searchable[evt.ID] = true
	}
	for _, id := range accepted {
		if found := slices.Collect(reopened.QueryEvents(nostr.Filter{IDs: []nostr.ID{id}}, 1)); len(found) != 1 || !searchable[id] {
			t.Fatalf("shutdown lost an accepted event from raw storage or search: %s", id.Hex())
		}
	}
}

func TestOpenStorePreservesInvalidSearchIndexAndReleasesRawStore(t *testing.T) {
	for _, metadata := range []string{"missing", "invalid"} {
		t.Run(metadata, func(t *testing.T) {
			cfg := testStoreConfig(t)
			raw := &eventstoreboltdb.BoltBackend{Path: filepath.Join(cfg.RawEventStore, "events.db")}
			if err := raw.Init(); err != nil {
				t.Fatal(err)
			}
			evt := testEvent(t)
			if err := raw.SaveEvent(evt); err != nil {
				raw.Close()
				t.Fatal(err)
			}
			raw.Close()
			if err := os.Mkdir(cfg.SearchIndexDir, 0700); err != nil {
				t.Fatal(err)
			}
			sentinel := filepath.Join(cfg.SearchIndexDir, "existing.segment")
			original := []byte("existing index must survive a failed startup")
			if err := os.WriteFile(sentinel, original, 0600); err != nil {
				t.Fatal(err)
			}
			if metadata == "invalid" {
				if err := os.WriteFile(filepath.Join(cfg.SearchIndexDir, "index_meta.json"), []byte("not JSON"), 0600); err != nil {
					t.Fatal(err)
				}
			}

			store, _, err := openStore(cfg)
			if err == nil {
				t.Error("startup silently replaced the invalid search index")
				composite := store.(*compositeStore)
				composite.search.Close()
				composite.raw.Close()
			}
			if actual, err := os.ReadFile(sentinel); err != nil || !slices.Equal(actual, original) {
				t.Errorf("startup changed existing index data: %q, %v", actual, err)
			}
			db, err := bbolt.Open(raw.Path, 0600, &bbolt.Options{Timeout: 50 * time.Millisecond})
			if err != nil {
				t.Fatalf("failed startup left the raw database locked: %v", err)
			}
			raw.DB = db
			defer raw.Close()
			found := slices.Collect(raw.QueryEvents(nostr.Filter{IDs: []nostr.ID{evt.ID}}, 1))
			if len(found) != 1 || found[0].ID != evt.ID {
				t.Fatal("failed startup changed the stored raw event")
			}
		})
	}
}
