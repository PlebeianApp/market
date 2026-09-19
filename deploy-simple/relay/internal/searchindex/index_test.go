package searchindex

import (
	"crypto/sha256"
	"fmt"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"fiatjaf.com/nostr"
	eventstorebleve "fiatjaf.com/nostr/eventstore/bleve"
	eventstoreboltdb "fiatjaf.com/nostr/eventstore/boltdb"
	"go.etcd.io/bbolt"
)

func newRawStore(t *testing.T) *eventstoreboltdb.BoltBackend {
	t.Helper()
	raw := &eventstoreboltdb.BoltBackend{Path: filepath.Join(t.TempDir(), "events.db")}
	if err := raw.Init(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(raw.Close)
	return raw
}

func fixture(i int) nostr.Event {
	return nostr.Event{
		ID:     nostr.ID(sha256.Sum256([]byte(fmt.Sprintf("index fixture %d", i)))),
		PubKey: nostr.PubKey(sha256.Sum256([]byte("fixture author"))),
		Kind:   nostr.Kind(1 + i%2), CreatedAt: nostr.Timestamp(1700000000 + i),
		Content: fmt.Sprintf("catalog listing %d ", i) + strings.Repeat("handmade durable useful product description ", 200),
		Tags:    nostr.Tags{},
	}
}

func fileHash(t *testing.T, path string) [32]byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return sha256.Sum256(data)
}

func directoryBytes(t *testing.T, path string) int64 {
	t.Helper()
	var size int64
	if err := filepath.WalkDir(path, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			info, err := entry.Info()
			if err != nil {
				return err
			}
			size += info.Size()
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return size
}

func TestCompactRebuildPreservesLegacySearchAndRawEvents(t *testing.T) {
	raw := newRawStore(t)
	oldPath := filepath.Join(t.TempDir(), "legacy")
	legacy := &eventstorebleve.BleveBackend{Path: oldPath, RawEventStore: raw}
	if err := legacy.Init(); err != nil {
		t.Fatal(err)
	}
	closeLegacy := sync.OnceFunc(legacy.Close)
	t.Cleanup(closeLegacy)
	const eventCount = 150
	for i := range eventCount {
		evt := fixture(i)
		if err := raw.SaveEvent(evt); err != nil {
			t.Fatal(err)
		}
		if err := legacy.SaveEvent(evt); err != nil {
			t.Fatal(err)
		}
	}
	filters := []nostr.Filter{
		{Search: "handmade"},
		{Search: "handmade", Kinds: []nostr.Kind{1}},
		{Search: "handmade", Since: 1700000100, Until: 1700000125},
		{Search: "absentword"},
	}
	ids := func(index *eventstorebleve.BleveBackend, filter nostr.Filter) []string {
		var result []string
		for evt := range index.QueryEvents(filter, eventCount+1) {
			result = append(result, evt.ID.Hex())
		}
		slices.Sort(result)
		return result
	}
	var expected [][]string
	for _, filter := range filters {
		expected = append(expected, ids(legacy, filter))
	}
	closeLegacy()
	raw.Close()
	rawBefore := fileHash(t, raw.Path)
	oldBytes := directoryBytes(t, oldPath)
	oldMetadata := fileHash(t, filepath.Join(oldPath, "index_meta.json"))
	newPath := filepath.Join(t.TempDir(), "compact")
	count, err := Rebuild(raw.Path, newPath, 0)
	if err != nil || count != eventCount {
		t.Fatalf("rebuild: count=%d error=%v", count, err)
	}
	if fileHash(t, raw.Path) != rawBefore || fileHash(t, filepath.Join(oldPath, "index_meta.json")) != oldMetadata || directoryBytes(t, oldPath) != oldBytes {
		t.Fatal("offline rebuild changed the raw store or old index")
	}
	newBytes := directoryBytes(t, newPath)
	t.Logf("same %d events: legacy=%d bytes compact=%d bytes (%.1f%% reduction)", eventCount, oldBytes, newBytes, 100*(1-float64(newBytes)/float64(oldBytes)))
	if newBytes >= oldBytes/2 {
		t.Errorf("compact mapping did not remove redundant storage: legacy=%d compact=%d", oldBytes, newBytes)
	}
	if err := raw.Init(); err != nil {
		t.Fatal(err)
	}
	compact := &eventstorebleve.BleveBackend{Path: newPath, RawEventStore: raw}
	if err := compact.Init(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(compact.Close)
	for i, filter := range filters {
		if actual := ids(compact, filter); !slices.Equal(actual, expected[i]) {
			t.Errorf("rebuild changed search results for %s", filter)
		}
	}
	// The unmodified eventstore backend must continue writing the compact schema.
	next := fixture(eventCount)
	if err := raw.SaveEvent(next); err != nil {
		t.Fatal(err)
	}
	if err := compact.SaveEvent(next); err != nil {
		t.Fatal(err)
	}
	if hits := ids(compact, nostr.Filter{Search: "handmade", Since: next.CreatedAt}); len(hits) != 1 || hits[0] != next.ID.Hex() {
		t.Fatal("new events were not searchable after the rebuild")
	}
}

func TestRebuildRefusesLiveRawStoreAndExistingOutput(t *testing.T) {
	raw := newRawStore(t)
	output := filepath.Join(t.TempDir(), "replacement")
	if _, err := Rebuild(raw.Path, output, 0); err == nil {
		t.Fatal("rebuild ignored the running relay's database lock")
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatal("blocked rebuild created output")
	}
	raw.Close()
	for _, useSymlink := range []bool{false, true} {
		path := filepath.Join(t.TempDir(), "existing")
		if useSymlink {
			if err := os.Symlink(raw.Path, path); err != nil {
				t.Fatal(err)
			}
		} else if err := os.WriteFile(path, []byte("preserve"), 0600); err != nil {
			t.Fatal(err)
		}
		before := fileHash(t, path)
		if _, err := Rebuild(raw.Path, path, 0); err == nil {
			t.Fatal("rebuild accepted an existing output path")
		}
		if fileHash(t, path) != before {
			t.Fatal("rebuild changed existing output")
		}
	}
	if _, err := Rebuild(raw.Path, output, math.MaxUint64); err == nil {
		t.Fatal("rebuild ignored disk reserve")
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatal("rebuild created output despite insufficient disk")
	}
}

func TestFailedRebuildCannotBeOpenedByRelay(t *testing.T) {
	raw := newRawStore(t)
	if err := raw.DB.Update(func(tx *bbolt.Tx) error {
		return tx.Bucket([]byte("rawEventStore")).Put([]byte("invalid"), []byte("corrupt data"))
	}); err != nil {
		t.Fatal(err)
	}
	raw.Close()
	output := filepath.Join(t.TempDir(), "partial")
	if _, err := Rebuild(raw.Path, output, 0); err == nil {
		t.Fatal("rebuild silently skipped corrupt raw data")
	}
	if _, err := os.Stat(filepath.Join(output, incompleteFile)); err != nil {
		t.Fatal("failed rebuild lost its incomplete marker")
	}
	if err := raw.Init(); err != nil {
		t.Fatal(err)
	}
	if err := Prepare(output, raw.DB); err == nil {
		t.Fatal("relay accepted an incomplete rebuild")
	}
}
