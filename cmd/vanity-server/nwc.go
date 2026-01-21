package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip04"
)

// NWCMonitor monitors a Nostr Wallet Connect wallet for incoming payments
type NWCMonitor struct {
	config      *Config
	nostrClient *NostrClient
	relay       *nostr.Relay
	walletPubkey string
	secret      string
	ctx         context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup
}

// NWCTransaction represents a wallet transaction from list_transactions
type NWCTransaction struct {
	Type            string `json:"type"`
	Invoice         string `json:"invoice,omitempty"`
	Description     string `json:"description,omitempty"`
	DescriptionHash string `json:"description_hash,omitempty"`
	Preimage        string `json:"preimage,omitempty"`
	PaymentHash     string `json:"payment_hash,omitempty"`
	Amount          int64  `json:"amount"`
	FeesPaid        int64  `json:"fees_paid,omitempty"`
	CreatedAt       int64  `json:"created_at"`
	SettledAt       int64  `json:"settled_at,omitempty"`
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
}

// NWCResponse represents a response from the NWC wallet
type NWCResponse struct {
	ResultType string           `json:"result_type"`
	Error      *NWCError        `json:"error,omitempty"`
	Result     *json.RawMessage `json:"result,omitempty"`
}

// NWCError represents an error from NWC
type NWCError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// NewNWCMonitor creates a new NWC monitor
func NewNWCMonitor(cfg *Config, nostrClient *NostrClient) (*NWCMonitor, error) {
	// Parse NWC URI: nostr+walletconnect://<pubkey>?relay=<relay>&secret=<secret>
	nwcURI := strings.TrimPrefix(cfg.NwcURI, "nostr+walletconnect://")

	parts := strings.SplitN(nwcURI, "?", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid NWC URI format")
	}

	walletPubkey := parts[0]
	params, err := url.ParseQuery(parts[1])
	if err != nil {
		return nil, fmt.Errorf("failed to parse NWC params: %w", err)
	}

	relayURL := params.Get("relay")
	secret := params.Get("secret")

	if walletPubkey == "" || relayURL == "" || secret == "" {
		return nil, fmt.Errorf("NWC URI missing required parameters")
	}

	ctx, cancel := context.WithCancel(context.Background())

	monitor := &NWCMonitor{
		config:       cfg,
		nostrClient:  nostrClient,
		walletPubkey: walletPubkey,
		secret:       secret,
		ctx:          ctx,
		cancel:       cancel,
	}

	// Connect to the NWC relay
	relay, err := nostr.RelayConnect(ctx, relayURL)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to connect to NWC relay: %w", err)
	}

	monitor.relay = relay
	log.Printf("Connected to NWC relay: %s", relayURL)
	log.Printf("Monitoring wallet: %s", walletPubkey)

	return monitor, nil
}

// Start begins monitoring for incoming payments
func (m *NWCMonitor) Start() {
	m.wg.Add(1)
	defer m.wg.Done()

	// Poll for transactions periodically
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	// Track last check time
	lastCheck := time.Now().Add(-5 * time.Minute)

	for {
		select {
		case <-m.ctx.Done():
			return
		case <-ticker.C:
			m.checkTransactions(lastCheck.Unix())
			lastCheck = time.Now()
		}
	}
}

// Stop stops the NWC monitor
func (m *NWCMonitor) Stop() {
	m.cancel()
	m.wg.Wait()
	if m.relay != nil {
		m.relay.Close()
	}
}

// checkTransactions queries recent transactions and processes vanity payments
func (m *NWCMonitor) checkTransactions(since int64) {
	// Request list_transactions from wallet
	request := map[string]interface{}{
		"method": "list_transactions",
		"params": map[string]interface{}{
			"from":   since,
			"limit":  50,
			"type":   "incoming",
		},
	}

	response, err := m.sendNWCRequest(request)
	if err != nil {
		log.Printf("NWC list_transactions error: %v", err)
		return
	}

	if response.Error != nil {
		log.Printf("NWC error: %s - %s", response.Error.Code, response.Error.Message)
		return
	}

	if response.Result == nil {
		return
	}

	// Parse transactions
	var result struct {
		Transactions []NWCTransaction `json:"transactions"`
	}
	if err := json.Unmarshal(*response.Result, &result); err != nil {
		log.Printf("Failed to parse transactions: %v", err)
		return
	}

	// Process each transaction
	for _, tx := range result.Transactions {
		m.processTransaction(tx)
	}
}

// processTransaction checks if a transaction is a vanity payment
func (m *NWCMonitor) processTransaction(tx NWCTransaction) {
	// Look for vanity payment memo format: vanity:<name>:<domain>:<request-id>
	memo := tx.Description
	if !strings.HasPrefix(memo, "vanity:") {
		return
	}

	parts := strings.Split(memo, ":")
	if len(parts) != 4 {
		log.Printf("Invalid vanity memo format: %s", memo)
		return
	}

	name := parts[1]
	domain := parts[2]
	requestID := parts[3]

	// Verify domain matches
	if domain != m.config.Domain {
		log.Printf("Vanity payment for wrong domain: %s (expected %s)", domain, m.config.Domain)
		return
	}

	// Verify payment amount
	if tx.Amount < m.config.PriceSats*1000 { // Amount is in millisats
		log.Printf("Vanity payment insufficient: %d msat (need %d)", tx.Amount, m.config.PriceSats*1000)
		return
	}

	log.Printf("Processing vanity payment: %s for %s (request: %s)", name, domain, requestID)

	// Fetch the request event
	requestEvent, err := m.nostrClient.FetchVanityRequest(requestID)
	if err != nil {
		log.Printf("Failed to fetch vanity request %s: %v", requestID, err)
		return
	}

	if requestEvent == nil {
		log.Printf("Vanity request not found: %s", requestID)
		return
	}

	// Verify the request name and domain match
	var reqName, reqDomain string
	for _, tag := range requestEvent.Tags {
		if len(tag) >= 2 {
			switch tag[0] {
			case "name":
				reqName = tag[1]
			case "domain":
				reqDomain = tag[1]
			}
		}
	}

	if strings.ToLower(reqName) != strings.ToLower(name) || reqDomain != domain {
		log.Printf("Vanity request mismatch: memo says %s:%s, event says %s:%s",
			name, domain, reqName, reqDomain)
		return
	}

	// Publish the confirmation
	err = m.nostrClient.PublishVanityConfirmation(requestEvent, tx.PaymentHash)
	if err != nil {
		log.Printf("Failed to publish vanity confirmation: %v", err)
		return
	}

	log.Printf("Vanity %s registered for %s", name, requestEvent.PubKey)
}

// sendNWCRequest sends a request to the NWC wallet and waits for response
func (m *NWCMonitor) sendNWCRequest(request map[string]interface{}) (*NWCResponse, error) {
	// Encrypt the request
	requestJSON, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Compute shared secret for NIP-04 encryption
	sharedSecret, err := nip04.ComputeSharedSecret(m.walletPubkey, m.secret)
	if err != nil {
		return nil, fmt.Errorf("failed to compute shared secret: %w", err)
	}

	encrypted, err := nip04.Encrypt(string(requestJSON), sharedSecret)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt request: %w", err)
	}

	// Create and sign the request event
	event := &nostr.Event{
		Kind:      23194,
		CreatedAt: nostr.Timestamp(time.Now().Unix()),
		Tags: nostr.Tags{
			{"p", m.walletPubkey},
		},
		Content: encrypted,
	}

	// We need to derive a keypair from the secret for signing
	// The secret IS the private key for NWC communication
	err = event.Sign(m.secret)
	if err != nil {
		return nil, fmt.Errorf("failed to sign request: %w", err)
	}

	// Subscribe to response
	ctx, cancel := context.WithTimeout(m.ctx, 30*time.Second)
	defer cancel()

	myPubkey, _ := nostr.GetPublicKey(m.secret)

	sub, err := m.relay.Subscribe(ctx, nostr.Filters{{
		Kinds:   []int{23195},
		Authors: []string{m.walletPubkey},
		Tags:    nostr.TagMap{"p": []string{myPubkey}},
		Since:   &event.CreatedAt,
	}})
	if err != nil {
		return nil, fmt.Errorf("failed to subscribe: %w", err)
	}
	defer sub.Unsub()

	// Publish the request
	err = m.relay.Publish(ctx, *event)
	if err != nil {
		return nil, fmt.Errorf("failed to publish request: %w", err)
	}

	// Wait for response
	select {
	case <-ctx.Done():
		return nil, fmt.Errorf("timeout waiting for response")
	case responseEvent := <-sub.Events:
		// Decrypt the response using the same shared secret
		decrypted, err := nip04.Decrypt(responseEvent.Content, sharedSecret)
		if err != nil {
			return nil, fmt.Errorf("failed to decrypt response: %w", err)
		}

		var response NWCResponse
		if err := json.Unmarshal([]byte(decrypted), &response); err != nil {
			return nil, fmt.Errorf("failed to parse response: %w", err)
		}

		return &response, nil
	}
}
