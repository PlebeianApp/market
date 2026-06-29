package main

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
	"github.com/plebeianmarket/market-agg-relay/policy"
)

// marketKindsList returns the policy.MARKET_KINDS set as a []int for use in
// Nostr subscription filters.
func marketKindsList() []int {
	kinds := make([]int, 0, len(policy.MARKET_KINDS))
	for k := range policy.MARKET_KINDS {
		kinds = append(kinds, k)
	}
	return kinds
}

// scraper continuously discovers relays from the seed npub's social graph and
// pulls market-relevant events into the local relay store. It runs until ctx
// is cancelled.
type scraper struct {
	seedHex         string
	bootstrapRelays []string
	store           nostr.RelayStore // SaveEvent-compatible interface
	pool            *nostr.SimplePool
}

// run drives the scrape loop: discover relays, subscribe to market kinds,
// write events to the store, sleep, repeat. It blocks until ctx is cancelled.
func (s *scraper) run(ctx context.Context, interval time.Duration) {
	s.pool = nostr.NewSimplePool(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		relays := s.discoverRelays(ctx)
		if len(relays) == 0 {
			log.Printf("[scraper] no relays discovered; falling back to bootstrap list")
			relays = s.bootstrapRelays
		}
		log.Printf("[scraper] discovered %d relays", len(relays))

		s.scrapeOnce(ctx, relays)

		log.Printf("[scraper] sleeping %v before next cycle", interval)
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

// discoverRelays fetches the seed npub's kind 3 (contacts) and kind 10002
// (relay list) from bootstrap relays, then follows each contact's kind 10002
// to build a broad set of relay URLs to scrape.
func (s *scraper) discoverRelays(ctx context.Context) []string {
	relaySet := make(map[string]struct{})

	// Step 1: fetch seed's kind 3 + 10002
	seedEvents := s.pool.SubManyEose(ctx, s.bootstrapRelays, nostr.Filters{
		{Authors: []string{s.seedHex}, Kinds: []int{3, 10002}},
	})

	contacts := make(map[string]struct{})
	for ev := range seedEvents {
		if ev.Event == nil {
			continue
		}
		switch ev.Kind {
		case 3:
			for _, tag := range ev.Tags {
				if len(tag) >= 2 && tag[0] == "p" {
					contacts[strings.ToLower(tag[1])] = struct{}{}
				}
			}
		case 10002:
			for _, tag := range ev.Tags {
				if len(tag) >= 2 && tag[0] == "r" {
					if isValidRelayURL(tag[1]) {
						relaySet[tag[1]] = struct{}{}
					}
				}
			}
		}
	}

	log.Printf("[scraper] seed has %d contacts, %d direct relays", len(contacts), len(relaySet))

	// Step 2: fetch each contact's kind 10002 to discover their relays.
	if len(contacts) > 0 {
		contactHexes := make([]string, 0, len(contacts))
		for pk := range contacts {
			contactHexes = append(contactHexes, pk)
		}

		relayListEvents := s.pool.SubManyEose(ctx, s.bootstrapRelays, nostr.Filters{
			{Authors: contactHexes, Kinds: []int{10002}},
		})

		for ev := range relayListEvents {
			if ev.Event == nil {
				continue
			}
			for _, tag := range ev.Tags {
				if len(tag) >= 2 && tag[0] == "r" {
					if isValidRelayURL(tag[1]) {
						relaySet[tag[1]] = struct{}{}
					}
				}
			}
		}
	}

	// Always include the bootstrap relays themselves.
	for _, r := range s.bootstrapRelays {
		relaySet[r] = struct{}{}
	}

	out := make([]string, 0, len(relaySet))
	for r := range relaySet {
		out = append(out, r)
	}
	return out
}

// scrapeOnce opens a long-lived subscription on the given relays for
// market-relevant kinds and writes received events to the local store. It
// blocks until ctx is cancelled or the subscription ends.
func (s *scraper) scrapeOnce(ctx context.Context, relays []string) {
	kinds := marketKindsList()
	sub := s.pool.SubMany(ctx, relays, nostr.Filters{
		{Kinds: kinds},
	})

	count := 0
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-sub:
			if !ok {
				log.Printf("[scraper] subscription ended")
				return
			}
			if ev.Event == nil {
				continue
			}
			// Verify the event signature before storing (defence in depth).
			if sigOk, _ := ev.CheckSignature(); !sigOk {
				continue
			}
			if err := s.store.Publish(ctx, *ev.Event); err != nil {
				log.Printf("[scraper] store error for event %s: %v", ev.ID, err)
			}
			count++
			if count%100 == 0 {
				log.Printf("[scraper] wrote %d events this cycle", count)
			}
		}
	}
}

// isValidRelayURL returns true if u looks like a ws/wss URL.
func isValidRelayURL(u string) bool {
	if u == "" {
		return false
	}
	parsed, err := url.Parse(u)
	if err != nil {
		return false
	}
	return parsed.Scheme == "ws" || parsed.Scheme == "wss"
}

// npubToHex decodes a bech32 npub to lowercase hex.
func npubToHex(npub string) (string, error) {
	prefix, val, err := nip19.Decode(npub)
	if err != nil {
		return "", err
	}
	hexStr, ok := val.(string)
	if !ok || prefix != "npub" {
		return "", fmt.Errorf("expected npub, got prefix %q", prefix)
	}
	return strings.ToLower(hexStr), nil
}
