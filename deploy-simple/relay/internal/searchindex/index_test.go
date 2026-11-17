package searchindex

import (
	"os"
	"path/filepath"
	"testing"

	bleve "github.com/blevesearch/bleve/v2"
	"go.etcd.io/bbolt"
)

func openRaw(t *testing.T, dir string, key []byte) *bbolt.DB {
	t.Helper()

	db, err := bbolt.Open(filepath.Join(dir, "events.db"), 0600, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if err := db.Update(func(tx *bbolt.Tx) error {
		bucket, err := tx.CreateBucketIfNotExists([]byte("rawEventStore"))
		if err != nil {
			return err
		}
		if key == nil {
			return nil
		}
		return bucket.Put(key, []byte("x"))
	}); err != nil {
		t.Fatal(err)
	}

	return db
}

func TestPrepareRefusesInvalidExistingDir(t *testing.T) {
	dir := t.TempDir()
	db := openRaw(t, dir, nil)

	indexPath := filepath.Join(dir, "search")
	if err := os.Mkdir(indexPath, 0700); err != nil {
		t.Fatal(err)
	}

	if err := Prepare(indexPath, db); err == nil {
		t.Fatal("expected Prepare to refuse an existing directory without index_meta.json")
	}
}

func TestPrepareRefusesMissingIndexOverRawEvents(t *testing.T) {
	dir := t.TempDir()
	db := openRaw(t, dir, []byte("01234567"))

	if err := Prepare(filepath.Join(dir, "search"), db); err == nil {
		t.Fatal("expected Prepare to refuse a missing index over raw events")
	}
}

func TestPrepareRefusesEmptyIndexOverRawEvents(t *testing.T) {
	dir := t.TempDir()
	db := openRaw(t, dir, []byte("01234567"))

	indexPath := filepath.Join(dir, "search")
	index, err := bleve.New(indexPath, indexMapping())
	if err != nil {
		t.Fatal(err)
	}
	if err := index.Close(); err != nil {
		t.Fatal(err)
	}

	if err := Prepare(indexPath, db); err == nil {
		t.Fatal("expected Prepare to refuse a valid but empty index over raw events")
	}
}

func TestPrepareAcceptsPopulatedIndexOverRawEvents(t *testing.T) {
	dir := t.TempDir()
	db := openRaw(t, dir, []byte("01234567"))

	indexPath := filepath.Join(dir, "search")
	index, err := bleve.New(indexPath, indexMapping())
	if err != nil {
		t.Fatal(err)
	}
	if err := index.Index("01234567", map[string]any{"c": "hello", "k": "1"}); err != nil {
		t.Fatal(err)
	}
	if err := index.Close(); err != nil {
		t.Fatal(err)
	}

	if err := Prepare(indexPath, db); err != nil {
		t.Fatalf("expected populated index to be accepted: %v", err)
	}
}
