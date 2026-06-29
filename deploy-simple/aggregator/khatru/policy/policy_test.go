package policy

import (
	"os"
	"path/filepath"
	"testing"
)

// TestDecide_MarketKindAnyPubkey mirrors the primary rule in write-policy.py:
// a market-relevant kind is accepted from ANY pubkey (the marketplace is open
// to all sellers). This is the dual-mode gate's "public" tier.
func TestDecide_MarketKindAnyPubkey(t *testing.T) {
	p := Policy{RootHex: "aaaa"}
	for _, k := range []int{0, 1, 3, 7, 9735, 10002, 30402, 30405, 30406, 30018, 25910} {
		if ok, _ := p.Decide("unknownpubkey", k); !ok {
			t.Errorf("kind %d should be accepted from any pubkey, got reject", k)
		}
	}
}

// TestDecide_NonMarketKindRejectedFromUnknown mirrors rule 4: an event that is
// neither a market kind nor from a trusted pubkey must be rejected.
func TestDecide_NonMarketKindRejectedFromUnknown(t *testing.T) {
	p := Policy{RootHex: "aaaa"}
	ok, msg := p.Decide("unknownpubkey", 99999)
	if ok {
		t.Fatal("non-market kind from unknown pubkey should be rejected")
	}
	if msg == "" {
		t.Error("reject should carry a reason message")
	}
}

// TestDecide_RootNpubAlwaysAccepted mirrors rule 2: the root operator npub is
// always accepted (bootstrap + personal non-market events) before any scrape
// has populated the allowlist.
func TestDecide_RootNpubAlwaysAccepted(t *testing.T) {
	p := Policy{RootHex: "aabbcc"}
	if ok, _ := p.Decide("aabbcc", 99999); !ok {
		t.Error("root npub non-market event should be accepted")
	}
	// root npub is case-insensitive (hex normalised to lower)
	if ok, _ := p.Decide("AABBCC", 99999); !ok {
		t.Error("root npub match should be case-insensitive")
	}
}

// TestDecide_AllowlistedPubkeyAccepted mirrors rule 3: an allowlisted pubkey
// is accepted even for non-market kinds (verified sellers, future trust tiers).
func TestDecide_AllowlistedPubkeyAccepted(t *testing.T) {
	p := Policy{RootHex: "aaaa", Allowed: AllowlistOf("deadbeef")}
	if ok, _ := p.Decide("deadbeef", 99999); !ok {
		t.Error("allowlisted pubkey non-market event should be accepted")
	}
	// case-insensitive
	if ok, _ := p.Decide("DEADBEEF", 99999); !ok {
		t.Error("allowlist match should be case-insensitive")
	}
}

// TestFileAllowlist_HotReload verifies the file-backed allowlist re-reads when
// its mtime changes (hot reload, matching the python plugin behaviour).
func TestFileAllowlist_HotReload(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "allowed.npubs")
	if err := os.WriteFile(path, []byte("# comment\nfeedface\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	al := NewFileAllowlist(path)
	if !al.contains("feedface") {
		t.Fatal("expected feedface in allowlist on first load")
	}
	// rewrite with a different member + bump mtime
	if err := os.WriteFile(path, []byte("cafebabe\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !al.contains("cafebabe") {
		t.Fatal("expected hot-reload to pick up cafebabe")
	}
	if al.contains("feedface") {
		t.Fatal("feedface should have been removed after reload")
	}
}

// TestFileAllowlist_MissingFileGraceful: a missing allowlist file must not
// panic — it behaves as an empty set (matching the python FileNotFoundError path).
func TestFileAllowlist_MissingFileGraceful(t *testing.T) {
	al := NewFileAllowlist(filepath.Join(t.TempDir(), "does-not-exist"))
	if al.contains("anyone") {
		t.Fatal("missing allowlist file should report no members")
	}
}
