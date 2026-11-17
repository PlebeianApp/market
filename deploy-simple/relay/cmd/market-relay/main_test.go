package main

import (
	"testing"

	"fiatjaf.com/nostr"
)

func TestScopedKinds(t *testing.T) {
	s := &compositeStore{searchKinds: kindSet([]nostr.Kind{0, 30402})}

	if got := len(s.scopedKinds(nil)); got != 2 {
		t.Fatalf("empty filter: got %d kinds, want 2", got)
	}

	got := s.scopedKinds([]nostr.Kind{1, 30402})
	if len(got) != 1 || got[0] != 30402 {
		t.Fatalf("intersection: got %v, want [30402]", got)
	}

	if got := s.scopedKinds([]nostr.Kind{1}); len(got) != 0 {
		t.Fatalf("non-searchable kind: got %v, want empty", got)
	}
}

func TestEnvKindsRejectsInvalid(t *testing.T) {
	for _, value := range []string{"0,65536", "0,banana"} {
		t.Setenv("RELAY_SEARCH_KINDS", value)
		if _, err := envKinds("RELAY_SEARCH_KINDS", []int{0}); err == nil {
			t.Fatalf("%q: expected an error", value)
		}
	}
}
