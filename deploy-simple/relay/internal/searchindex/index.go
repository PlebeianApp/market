// Package searchindex owns the compact mapping and offline rebuild of the
// relay's derived search index. Raw events always remain in BoltDB.
package searchindex

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"fiatjaf.com/nostr"
	bleve "github.com/blevesearch/bleve/v2"
	"github.com/blevesearch/bleve/v2/mapping"
	"go.etcd.io/bbolt"
)

// These field names and types match the pinned eventstore/bleve backend.
// Keep them compatible so existing indexes can be opened without a migration.
func document(evt nostr.Event) map[string]any {
	return map[string]any{
		"c": evt.Content, "k": strconv.Itoa(int(evt.Kind)),
		"p": evt.PubKey.Hex()[56:], "a": float64(evt.CreatedAt),
	}
}

func indexMapping() *mapping.IndexMappingImpl {
	m := mapping.NewIndexMapping()
	doc := mapping.NewDocumentStaticMapping()
	for _, name := range []string{"c", "k", "p"} {
		field := mapping.NewTextFieldMapping()
		// Retain the legacy standard analyzer, including tokenization of kinds
		// and author suffixes; changing it would change existing query results.
		field.Store = false
		field.IncludeTermVectors = false
		field.IncludeInAll = false
		field.DocValues = false
		doc.AddFieldMappingsAt(name, field)
	}
	createdAt := mapping.NewNumericFieldMapping()
	createdAt.Store = false
	createdAt.IncludeInAll = false
	createdAt.DocValues = false
	doc.AddFieldMappingsAt("a", createdAt)
	m.DefaultMapping = doc
	return m
}

func create(path string) (bleve.Index, error) {
	// Reserve the exact directory atomically, including against symlinks.
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	if err := os.Mkdir(path, 0700); err != nil {
		return nil, fmt.Errorf("create new search output %s: %w", path, err)
	}
	return bleve.New(path, indexMapping())
}

// Prepare creates a compact index only for an empty raw store. It never
// replaces an existing index, nor silently opens an empty index over old data.
func Prepare(path string, raw *bbolt.DB) error {
	if _, err := os.Lstat(filepath.Join(path, incompleteFile)); !errors.Is(err, os.ErrNotExist) {
		if err != nil {
			return err
		}
		return fmt.Errorf("search rebuild is incomplete at %s; preserve the current index and rebuild into a new directory", path)
	}
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := raw.View(func(tx *bbolt.Tx) error {
		bucket := tx.Bucket([]byte("rawEventStore"))
		if bucket == nil {
			return fmt.Errorf("unrecognized raw event store")
		}
		if key, _ := bucket.Cursor().First(); key != nil {
			return fmt.Errorf("search index is missing but raw events exist; build a replacement with --rebuild-search-to before starting the relay")
		}
		return nil
	}); err != nil {
		return err
	}
	index, err := create(path)
	if err != nil {
		return fmt.Errorf("create compact search index: %w", err)
	}
	return index.Close()
}
