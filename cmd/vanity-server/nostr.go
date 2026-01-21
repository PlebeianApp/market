package main

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

const (
	// Vanity event kinds
	KindVanityConfig       = 30408
	KindVanityRequest      = 30409
	KindVanityConfirmation = 30410
)

// VanityConfirmation represents a validated vanity URL binding
type VanityConfirmation struct {
	EventID     string
	UserPubkey  string
	Name        string
	Domain      string
	ValidUntil  int64
	PaymentHash string
	Revoked     bool
	RevokedAt   int64
}

// IsExpired checks if the confirmation has expired
func (vc *VanityConfirmation) IsExpired() bool {
	return time.Now().Unix() > vc.ValidUntil
}

// IsRevoked checks if the confirmation has been revoked
func (vc *VanityConfirmation) IsRevoked() bool {
	return vc.Revoked
}

// NostrClient handles Nostr relay connections and event operations
type NostrClient struct {
	config     *Config
	relay      *nostr.Relay
	privateKey string
	publicKey  string
	mu         sync.RWMutex
}

// NewNostrClient creates a new Nostr client
func NewNostrClient(cfg *Config) (*NostrClient, error) {
	// Derive public key from private key
	publicKey, err := nostr.GetPublicKey(cfg.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("invalid private key: %w", err)
	}

	client := &NostrClient{
		config:     cfg,
		privateKey: cfg.PrivateKey,
		publicKey:  publicKey,
	}

	// Connect to relay
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	relay, err := nostr.RelayConnect(ctx, cfg.RelayURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to relay: %w", err)
	}

	client.relay = relay
	log.Printf("Connected to relay: %s", cfg.RelayURL)
	log.Printf("Server public key: %s", publicKey)

	return client, nil
}

// Close closes the relay connection
func (nc *NostrClient) Close() {
	nc.mu.Lock()
	defer nc.mu.Unlock()

	if nc.relay != nil {
		nc.relay.Close()
	}
}

// GetPublicKey returns the server's public key
func (nc *NostrClient) GetPublicKey() string {
	return nc.publicKey
}

// FetchVanityConfirmation fetches a vanity confirmation for the given name and domain
func (nc *NostrClient) FetchVanityConfirmation(name, domain string) (*VanityConfirmation, error) {
	nc.mu.RLock()
	defer nc.mu.RUnlock()

	dTag := fmt.Sprintf("%s:%s", strings.ToLower(name), domain)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Query for Kind 30410 events with matching d-tag from this server
	filter := nostr.Filter{
		Kinds:   []int{KindVanityConfirmation},
		Authors: []string{nc.publicKey},
		Tags:    nostr.TagMap{"d": []string{dTag}},
		Limit:   1,
	}

	events, err := nc.relay.QuerySync(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}

	if len(events) == 0 {
		return nil, nil
	}

	return parseVanityConfirmation(events[0])
}

// FetchVanityRequest fetches a vanity request by event ID
func (nc *NostrClient) FetchVanityRequest(eventID string) (*nostr.Event, error) {
	nc.mu.RLock()
	defer nc.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	filter := nostr.Filter{
		Kinds: []int{KindVanityRequest},
		IDs:   []string{eventID},
		Limit: 1,
	}

	events, err := nc.relay.QuerySync(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}

	if len(events) == 0 {
		return nil, nil
	}

	return events[0], nil
}

// PublishVanityConfirmation publishes a Kind 30410 confirmation event
func (nc *NostrClient) PublishVanityConfirmation(
	requestEvent *nostr.Event,
	paymentHash string,
) error {
	nc.mu.Lock()
	defer nc.mu.Unlock()

	// Extract name and domain from request event
	var name, domain string
	for _, tag := range requestEvent.Tags {
		if len(tag) >= 2 {
			switch tag[0] {
			case "name":
				name = tag[1]
			case "domain":
				domain = tag[1]
			}
		}
	}

	if name == "" || domain == "" {
		return fmt.Errorf("request event missing name or domain tags")
	}

	dTag := fmt.Sprintf("%s:%s", strings.ToLower(name), domain)
	validUntil := time.Now().Unix() + nc.config.DurationSeconds

	event := &nostr.Event{
		Kind:      KindVanityConfirmation,
		CreatedAt: nostr.Timestamp(time.Now().Unix()),
		Tags: nostr.Tags{
			{"d", dTag},
			{"p", requestEvent.PubKey},
			{"e", requestEvent.ID},
			{"name", name},
			{"domain", domain},
			{"valid_until", strconv.FormatInt(validUntil, 10)},
			{"payment_hash", paymentHash},
		},
		Content: "",
	}

	// Sign the event
	err := event.Sign(nc.privateKey)
	if err != nil {
		return fmt.Errorf("failed to sign event: %w", err)
	}

	// Publish
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err = nc.relay.Publish(ctx, *event)
	if err != nil {
		return fmt.Errorf("failed to publish: %w", err)
	}

	log.Printf("Published vanity confirmation: %s -> %s (valid until %d)", name, requestEvent.PubKey, validUntil)
	return nil
}

// PublishVanityConfig publishes a Kind 30408 config event
func (nc *NostrClient) PublishVanityConfig(lud16 string) error {
	nc.mu.Lock()
	defer nc.mu.Unlock()

	event := &nostr.Event{
		Kind:      KindVanityConfig,
		CreatedAt: nostr.Timestamp(time.Now().Unix()),
		Tags: nostr.Tags{
			{"d", nc.config.Domain},
			{"lud16", lud16},
			{"price", strconv.FormatInt(nc.config.PriceSats, 10)},
			{"duration", strconv.FormatInt(nc.config.DurationSeconds, 10)},
		},
		Content: "",
	}

	err := event.Sign(nc.privateKey)
	if err != nil {
		return fmt.Errorf("failed to sign event: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err = nc.relay.Publish(ctx, *event)
	if err != nil {
		return fmt.Errorf("failed to publish: %w", err)
	}

	log.Printf("Published vanity config for domain: %s", nc.config.Domain)
	return nil
}

// RevokeVanityConfirmation publishes a revocation for a vanity name
func (nc *NostrClient) RevokeVanityConfirmation(name, domain string) error {
	nc.mu.Lock()
	defer nc.mu.Unlock()

	dTag := fmt.Sprintf("%s:%s", strings.ToLower(name), domain)
	now := time.Now().Unix()

	event := &nostr.Event{
		Kind:      KindVanityConfirmation,
		CreatedAt: nostr.Timestamp(now),
		Tags: nostr.Tags{
			{"d", dTag},
			{"name", name},
			{"domain", domain},
			{"revoked", strconv.FormatInt(now, 10)},
		},
		Content: "",
	}

	err := event.Sign(nc.privateKey)
	if err != nil {
		return fmt.Errorf("failed to sign event: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err = nc.relay.Publish(ctx, *event)
	if err != nil {
		return fmt.Errorf("failed to publish: %w", err)
	}

	log.Printf("Revoked vanity: %s", name)
	return nil
}

// parseVanityConfirmation extracts confirmation details from an event
func parseVanityConfirmation(event *nostr.Event) (*VanityConfirmation, error) {
	vc := &VanityConfirmation{
		EventID: event.ID,
	}

	for _, tag := range event.Tags {
		if len(tag) < 2 {
			continue
		}

		switch tag[0] {
		case "p":
			vc.UserPubkey = tag[1]
		case "name":
			vc.Name = tag[1]
		case "domain":
			vc.Domain = tag[1]
		case "valid_until":
			val, _ := strconv.ParseInt(tag[1], 10, 64)
			vc.ValidUntil = val
		case "payment_hash":
			vc.PaymentHash = tag[1]
		case "revoked":
			vc.Revoked = true
			val, _ := strconv.ParseInt(tag[1], 10, 64)
			vc.RevokedAt = val
		}
	}

	return vc, nil
}
