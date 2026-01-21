package main

import (
	"log"
	"net/http"
	"strings"

	"github.com/nbd-wtf/go-nostr/nip19"
)

// Server handles HTTP requests for vanity URLs
type Server struct {
	config      *Config
	nostrClient *NostrClient
	proxy       *ReverseProxy
}

// NewServer creates a new vanity URL server
func NewServer(cfg *Config, nostrClient *NostrClient) *Server {
	return &Server{
		config:      cfg,
		nostrClient: nostrClient,
		proxy:       NewReverseProxy(cfg.UpstreamURL),
	}
}

// ServeHTTP handles incoming HTTP requests
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	// Handle root path - redirect to upstream
	if path == "/" || path == "" {
		http.Redirect(w, r, s.config.UpstreamURL, http.StatusTemporaryRedirect)
		return
	}

	// Extract the potential vanity name (first path segment)
	name := strings.TrimPrefix(path, "/")

	// If path contains more segments, it's not a vanity URL
	if strings.Contains(name, "/") {
		// Redirect to upstream with the full path
		http.Redirect(w, r, s.config.UpstreamURL+path, http.StatusTemporaryRedirect)
		return
	}

	// Check if it's a reserved name
	if IsReservedName(name) {
		http.Redirect(w, r, s.config.UpstreamURL+path, http.StatusTemporaryRedirect)
		return
	}

	// Normalize name to lowercase
	name = strings.ToLower(name)

	// Validate name format (alphanumeric, hyphens, underscores only)
	if !isValidVanityName(name) {
		http.NotFound(w, r)
		return
	}

	// Look up the vanity confirmation
	confirmation, err := s.nostrClient.FetchVanityConfirmation(name, s.config.Domain)
	if err != nil {
		log.Printf("Error fetching vanity confirmation for %s: %v", name, err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// No valid confirmation found
	if confirmation == nil {
		http.NotFound(w, r)
		return
	}

	// Check if expired or revoked
	if confirmation.IsExpired() {
		log.Printf("Vanity %s is expired", name)
		http.NotFound(w, r)
		return
	}

	if confirmation.IsRevoked() {
		log.Printf("Vanity %s is revoked", name)
		http.NotFound(w, r)
		return
	}

	// Encode pubkey to npub
	npub, err := nip19.EncodePublicKey(confirmation.UserPubkey)
	if err != nil {
		log.Printf("Error encoding pubkey: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// Proxy to the user's profile page
	targetPath := "/p/" + npub
	log.Printf("Proxying vanity %s to %s", name, targetPath)

	s.proxy.ServeHTTP(w, r, targetPath)
}

// isValidVanityName checks if a name contains only valid characters
func isValidVanityName(name string) bool {
	if name == "" || len(name) > 64 {
		return false
	}

	for _, c := range name {
		if !((c >= 'a' && c <= 'z') ||
			(c >= '0' && c <= '9') ||
			c == '-' || c == '_') {
			return false
		}
	}

	// Must start with a letter or number
	first := name[0]
	if !((first >= 'a' && first <= 'z') || (first >= '0' && first <= '9')) {
		return false
	}

	return true
}
