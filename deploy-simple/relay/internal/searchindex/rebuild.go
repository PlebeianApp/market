package searchindex

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"fiatjaf.com/nostr"
	"fiatjaf.com/nostr/eventstore/codec/betterbinary"
	bleve "github.com/blevesearch/bleve/v2"
	"go.etcd.io/bbolt"
	"golang.org/x/sys/unix"
)

const incompleteFile = ".rebuild-incomplete"

// Rebuild reads the pinned BoltDB raw-event format without migrations or
// writes. The relay must be stopped: its exclusive database lock is respected.
// Only the new output directory is written. Failed output is retained and
// marked incomplete; it must never be promoted to the active index.
func Rebuild(rawPath, output string, minFreeBytes uint64) (count uint64, resultErr error) {
	raw, err := bbolt.Open(rawPath, 0600, &bbolt.Options{ReadOnly: true, Timeout: time.Second})
	if err != nil {
		return 0, fmt.Errorf("open raw events read-only (stop the relay before rebuilding): %w", err)
	}
	rawClosed := false
	defer func() {
		if !rawClosed {
			resultErr = errors.Join(resultErr, raw.Close())
		}
	}()
	if err := raw.View(func(tx *bbolt.Tx) error {
		if tx.Bucket([]byte("rawEventStore")) == nil {
			return fmt.Errorf("unrecognized raw event store; refusing to build an empty replacement")
		}
		return nil
	}); err != nil {
		return 0, err
	}
	if err := CheckFreeSpace(filepath.Dir(output), minFreeBytes); err != nil {
		return 0, err
	}
	// Reserve output before writing the incomplete marker. Bleve accepts this
	// newly created directory, but no valid index exists until after the marker
	// is durable. Even an interruption during setup cannot leave usable partial
	// output without a marker.
	if err := os.Mkdir(output, 0700); err != nil {
		return 0, fmt.Errorf("create new rebuild output: %w", err)
	}
	marker := filepath.Join(output, incompleteFile)
	if err := markIncomplete(output); err != nil {
		return 0, err
	}
	index, err := bleve.New(output, indexMapping())
	if err != nil {
		return 0, err
	}
	closed := false
	defer func() {
		if !closed {
			resultErr = errors.Join(resultErr, index.Close())
		}
	}()

	batch := index.NewBatch()
	batchBytes := 0
	flush := func() error {
		if batch.Size() == 0 {
			return nil
		}
		if err := CheckFreeSpace(output, minFreeBytes); err != nil {
			return err
		}
		if err := index.Batch(batch); err != nil {
			return err
		}
		batch = index.NewBatch()
		batchBytes = 0
		return nil
	}
	err = raw.View(func(tx *bbolt.Tx) error {
		return tx.Bucket([]byte("rawEventStore")).ForEach(func(_, value []byte) error {
			var evt nostr.Event
			if err := betterbinary.Unmarshal(value, &evt); err != nil {
				return fmt.Errorf("decode raw event %d: %w", count+1, err)
			}
			if err := batch.Index(evt.ID.Hex(), document(evt)); err != nil {
				return err
			}
			count++
			batchBytes += len(evt.Content)
			// Bound both document count and text volume. A large event can
			// exceed the text budget once, but cannot accumulate in a batch.
			if batch.Size() >= 100 || batchBytes >= 1<<20 {
				return flush()
			}
			return nil
		})
	})
	if err != nil {
		return count, err
	}
	if err := flush(); err != nil {
		return count, err
	}
	indexed, err := index.DocCount()
	if err != nil {
		return count, err
	}
	if indexed != count {
		return count, fmt.Errorf("rebuild count mismatch: raw=%d indexed=%d", count, indexed)
	}
	closed = true
	if err := index.Close(); err != nil {
		return count, err
	}
	rawClosed = true
	if err := raw.Close(); err != nil {
		return count, err
	}
	if err := os.Remove(marker); err != nil {
		return count, err
	}
	return count, nil
}

func markIncomplete(output string) error {
	file, err := os.OpenFile(filepath.Join(output, incompleteFile), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, writeErr := file.WriteString("Rebuild incomplete. Do not activate this index.\n")
	if err := errors.Join(writeErr, file.Sync(), file.Close()); err != nil {
		return err
	}
	dir, err := os.Open(output)
	if err != nil {
		return err
	}
	return errors.Join(dir.Sync(), dir.Close())
}

// CheckFreeSpace applies a reserve to the filesystem containing path. It does
// not reserve blocks against other processes or background index compaction.
// A zero minimum explicitly disables the check.
func CheckFreeSpace(path string, minimum uint64) error {
	if minimum == 0 {
		return nil
	}
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return fmt.Errorf("read free disk space: %w", err)
	}
	free := stat.Bavail * uint64(stat.Bsize)
	if free < minimum {
		return fmt.Errorf("insufficient free disk: %d bytes available, %d required", free, minimum)
	}
	return nil
}
