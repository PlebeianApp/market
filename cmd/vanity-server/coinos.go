package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// CoinosMonitor monitors a coinos.io wallet for incoming payments
type CoinosMonitor struct {
	config      *Config
	nostrClient *NostrClient
	httpClient  *http.Client
	ctx         context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup
	lastCheck   int64
}

// CoinosPayment represents a payment from the coinos API
type CoinosPayment struct {
	ID          string  `json:"id"`
	Amount      int64   `json:"amount"`      // Amount in sats
	Tip         int64   `json:"tip"`         // Tip amount
	Hash        string  `json:"hash"`        // Payment hash
	Memo        string  `json:"memo"`        // Payment memo/comment
	Rate        float64 `json:"rate"`        // Exchange rate at time of payment
	Currency    string  `json:"currency"`    // Currency code
	Received    bool    `json:"received"`    // Whether payment was received (vs sent)
	Confirmed   bool    `json:"confirmed"`   // Whether payment is confirmed
	CreatedAt   string  `json:"created_at"`  // ISO timestamp
	ConfirmedAt string  `json:"confirmed_at"`// ISO timestamp when confirmed
	Type        string  `json:"type"`        // Payment type: lightning, bitcoin, liquid, internal
	Address     string  `json:"address"`     // Address for on-chain payments
	Preimage    string  `json:"preimage"`    // Lightning preimage
}

// CoinosPaymentsResponse is the response from /api/payments/list
type CoinosPaymentsResponse struct {
	Payments []CoinosPayment `json:"payments"`
}

// NewCoinosMonitor creates a new coinos payment monitor
func NewCoinosMonitor(cfg *Config, nostrClient *NostrClient) (*CoinosMonitor, error) {
	if cfg.CoinosToken == "" {
		return nil, fmt.Errorf("coinos token is required")
	}

	ctx, cancel := context.WithCancel(context.Background())

	monitor := &CoinosMonitor{
		config:      cfg,
		nostrClient: nostrClient,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		ctx:       ctx,
		cancel:    cancel,
		lastCheck: time.Now().Add(-5 * time.Minute).Unix(),
	}

	// Verify connection by fetching account info
	if err := monitor.verifyConnection(); err != nil {
		cancel()
		return nil, fmt.Errorf("failed to verify coinos connection: %w", err)
	}

	log.Printf("Connected to coinos API: %s", cfg.CoinosAPIURL)
	return monitor, nil
}

// verifyConnection checks that we can connect to the coinos API
func (m *CoinosMonitor) verifyConnection() error {
	req, err := http.NewRequestWithContext(m.ctx, "GET", m.config.CoinosAPIURL+"/api/users/me", nil)
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", "Bearer "+m.config.CoinosToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("coinos API returned status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// Start begins monitoring for incoming payments
func (m *CoinosMonitor) Start() {
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		m.pollPayments()
	}()
}

// Stop stops the coinos monitor
func (m *CoinosMonitor) Stop() {
	m.cancel()
	m.wg.Wait()
}

// pollPayments periodically checks for new payments
func (m *CoinosMonitor) pollPayments() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	// Initial check
	m.checkPayments()

	for {
		select {
		case <-m.ctx.Done():
			return
		case <-ticker.C:
			m.checkPayments()
		}
	}
}

// checkPayments fetches recent payments and processes vanity payments
func (m *CoinosMonitor) checkPayments() {
	payments, err := m.fetchPayments()
	if err != nil {
		log.Printf("Coinos payment fetch error: %v", err)
		return
	}

	for _, payment := range payments {
		m.processPayment(payment)
	}

	// Update last check time
	m.lastCheck = time.Now().Unix()
}

// fetchPayments retrieves recent incoming payments from coinos
func (m *CoinosMonitor) fetchPayments() ([]CoinosPayment, error) {
	url := fmt.Sprintf("%s/api/payments/list?received=true&start=%d&limit=50",
		m.config.CoinosAPIURL, m.lastCheck)

	req, err := http.NewRequestWithContext(m.ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+m.config.CoinosToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("coinos API returned status %d: %s", resp.StatusCode, string(body))
	}

	var result CoinosPaymentsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		// Try decoding as array directly (coinos may return array or object)
		resp.Body.Close()
		req, _ = http.NewRequestWithContext(m.ctx, "GET", url, nil)
		req.Header.Set("Authorization", "Bearer "+m.config.CoinosToken)
		req.Header.Set("Content-Type", "application/json")
		resp, err = m.httpClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()

		var payments []CoinosPayment
		if err := json.NewDecoder(resp.Body).Decode(&payments); err != nil {
			return nil, fmt.Errorf("failed to decode payments: %w", err)
		}
		return payments, nil
	}

	return result.Payments, nil
}

// processPayment checks if a payment is a vanity payment and processes it
func (m *CoinosMonitor) processPayment(payment CoinosPayment) {
	// Only process confirmed, received payments
	if !payment.Received || !payment.Confirmed {
		return
	}

	// Look for vanity payment memo format: vanity:<name>:<domain>:<request-id>
	memo := payment.Memo
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

	// Verify payment amount (payment.Amount is in sats)
	if payment.Amount < m.config.PriceSats {
		log.Printf("Vanity payment insufficient: %d sats (need %d)", payment.Amount, m.config.PriceSats)
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

	// Use payment hash or ID as the payment proof
	paymentHash := payment.Hash
	if paymentHash == "" {
		paymentHash = payment.ID
	}

	// Publish the confirmation
	err = m.nostrClient.PublishVanityConfirmation(requestEvent, paymentHash)
	if err != nil {
		log.Printf("Failed to publish vanity confirmation: %v", err)
		return
	}

	log.Printf("Vanity %s registered for %s", name, requestEvent.PubKey)
}
