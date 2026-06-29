// Package policy implements the dual-mode write gate that mirrors the logic of
// the strfry write-policy.py plugin (see ../write-policy.py). It is pure Go with
// no external dependencies, so it can be unit-tested in isolation.
//
// Gate rules (in priority order, matching write-policy.py):
//
//  1. A market-relevant kind is accepted from ANY pubkey (the marketplace is
//     open to all sellers).
//  2. The root operator npub is always accepted (bootstrap + personal events).
//  3. An allowlisted pubkey is accepted even for non-market kinds (verified
//     sellers / future trust tiers).
//  4. Everything else is rejected.
package policy

import (
	"bufio"
	"os"
	"strings"
	"sync"
	"time"
)

// MARKET_KINDS is the set of market-relevant Nostr event kinds that the
// aggregator accepts from any pubkey. This mirrors the MARKET_KINDS set in
// write-policy.py exactly — every kind the Plebeian Market app reads or writes.
// Keep this in sync with the python plugin when it changes.
var MARKET_KINDS = map[int]struct{}{
	// --- Identity & social ---
	0:    {}, // Metadata (user profiles)
	3:    {}, // Contacts / follow lists (relay discovery)
	5:    {}, // Deletions

	// --- Communication ---
	1:    {}, // Text notes (used for bug reports)
	4:    {}, // DMs (NIP-04)
	7:    {}, // Reactions
	13:   {}, // NIP-59 seals (private order details)
	14:   {}, // General communication (order messages between buyer/seller)
	16:   {}, // Order processing and status updates
	17:   {}, // Payment receipts and verification
	1059: {}, // NIP-59 gift wraps (private order details)
	1111: {}, // Comments (product reviews, discussion)

	// --- Marketplace ---
	30018: {}, // NIP-15 products (legacy format)
	30402: {}, // NIP-99 classified listings (products)
	30405: {}, // Collections
	30406: {}, // Shipping options
	31989: {}, // NIP-89 handler recommendation
	31990: {}, // NIP-89 app handler info

	// --- Payments ---
	9735: {}, // Zap receipts (NIP-57)

	// --- Lists & app settings ---
	10000: {}, // Mute lists (NIP-51)
	10002: {}, // Relay lists (NIP-65)
	30000: {}, // App settings, vanity URLs, NIP-05 names
	30078: {}, // Cart persistence, relay preferences, v4v data
	9775:  {}, // App-specific data (NDKKind.AppSpecificData, e.g. NWC wallet lists)

	// --- Misc app kinds ---
	25910: {}, // ctxvm client messages
}

// Policy is the dual-mode write gate. The zero value is a policy that rejects
// everything except market kinds. Set RootHex and/or Allowed to open rules 2/3.
type Policy struct {
	// RootHex is the hex pubkey of the relay operator (lower-case, no 0x).
	// Events from this pubkey are always accepted. Empty disables rule 2.
	RootHex string

	// Allowed is the additional-trust allowlist (verified sellers, premium
	// tier, etc.). May be nil. Override Allowed to supply a live, hot-reloaded
	// set (e.g. a *FileAllowlist).
	Allowed Allowlist
}

// Allowlist abstracts an optional additional-trust pubkey set. Implementations
// must be safe for concurrent use because Decide is called from the relay's
// write path.
type Allowlist interface {
	// contains reports whether the given (lower-cased, hex) pubkey is trusted.
	contains(hex string) bool
}

// emptyAllowlist is the no-op allowlist used when Policy.Allowed is nil.
type emptyAllowlist struct{}

func (emptyAllowlist) contains(string) bool { return false }

// SetAllowlist is an in-memory, immutable allowlist backed by a map of
// lower-cased hex pubkeys. Useful for tests and static configs.
type SetAllowlist map[string]struct{}

// AllowlistOf returns a SetAllowlist from the given hex pubkeys (each will be
// lower-cased).
func AllowlistOf(hexes ...string) SetAllowlist {
	s := make(SetAllowlist, len(hexes))
	for _, h := range hexes {
		s[strings.ToLower(strings.TrimSpace(h))] = struct{}{}
	}
	return s
}

func (s SetAllowlist) contains(hex string) bool {
	_, ok := s[hex]
	return ok
}

// Decide applies the four gate rules and returns (accept, reason). When accept
// is false, reason carries a human-readable message suitable for the client.
func (p Policy) Decide(pubkey string, kind int) (accept bool, reason string) {
	al := p.Allowed
	if al == nil {
		al = emptyAllowlist{}
	}

	// 1. Market-relevant kind from ANY pubkey -> accept (marketplace is open).
	if _, ok := MARKET_KINDS[kind]; ok {
		return true, ""
	}

	pk := strings.ToLower(strings.TrimSpace(pubkey))

	// 2. Root operator npub -> always accept (bootstrap + personal events).
	if p.RootHex != "" && pk == strings.ToLower(strings.TrimSpace(p.RootHex)) {
		return true, ""
	}

	// 3. Allowlisted pubkey -> accept (verified sellers / future trust tiers).
	if al.contains(pk) {
		return true, ""
	}

	// 4. Everything else -> reject.
	return false, "blocked: kind " + itoa(kind) + " not in market set and pubkey not trusted"
}

// itoa is a stdlib-free int->string to keep the package dependency-free.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [12]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// FileAllowlist is a hot-reloading allowlist backed by a newline-delimited file
// of hex pubkeys (one per line, '#' comments allowed). It re-reads the file when
// its mtime changes, matching the python plugin's hot-reload behaviour. Safe for
// concurrent use.
type FileAllowlist struct {
	path string

	mu       sync.Mutex
Members  map[string]struct{}
	mtime    time.Time
}

// NewFileAllowlist returns a FileAllowlist that will load (and hot-reload) the
// file at path. The first call to contains triggers the initial load.
func NewFileAllowlist(path string) *FileAllowlist {
	return &FileAllowlist{path: path}
}

// contains reports whether hex (already lower-cased by the caller) is in the
// allowlist. It reloads the file on mtime change.
func (f *FileAllowlist) contains(hex string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reloadIfStale()
	if len(f.Members) == 0 {
		return false
	}
	_, ok := f.Members[hex]
	return ok
}

// reloadIfStale re-reads the file if its mtime changed since the last load.
// Caller must hold f.mu.
func (f *FileAllowlist) reloadIfStale() {
	var mt time.Time
	if st, err := os.Stat(f.path); err == nil {
		mt = st.ModTime()
	} else {
		// Missing/unreadable file -> empty set, remember the zero mtime so we
		// retry when the file appears.
		mt = time.Time{}
	}
	if mt.Equal(f.mtime) {
		return
	}
	f.Members = loadAllowlistFile(f.path)
	f.mtime = mt
}

// loadAllowlistFile reads a newline-delimited allowlist, ignoring blanks and
// '#' comment lines. Returns nil for a missing file.
func loadAllowlistFile(path string) map[string]struct{} {
	fh, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer fh.Close()

	out := make(map[string]struct{})
	sc := bufio.NewScanner(fh)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		out[strings.ToLower(line)] = struct{}{}
	}
	return out
}
