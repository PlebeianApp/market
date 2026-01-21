package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	// Load configuration
	cfg, err := LoadConfigFromEnv()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	log.Printf("Starting vanity server for domain: %s", cfg.Domain)
	log.Printf("Upstream URL: %s", cfg.UpstreamURL)
	log.Printf("Relay URL: %s", cfg.RelayURL)

	// Create Nostr client
	nostrClient, err := NewNostrClient(cfg)
	if err != nil {
		log.Fatalf("Failed to create Nostr client: %v", err)
	}

	// Create server
	server := NewServer(cfg, nostrClient)

	// Create HTTP server
	httpServer := &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      server,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start NWC monitor if configured
	var nwcMonitor *NWCMonitor
	if cfg.NwcURI != "" {
		nwcMonitor, err = NewNWCMonitor(cfg, nostrClient)
		if err != nil {
			log.Printf("Warning: Failed to create NWC monitor: %v", err)
		} else {
			go nwcMonitor.Start()
			log.Printf("NWC monitor started")
		}
	} else {
		log.Printf("NWC not configured - payment monitoring disabled")
	}

	// Start HTTP server in goroutine
	go func() {
		log.Printf("HTTP server listening on %s", cfg.ListenAddr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	// Stop NWC monitor
	if nwcMonitor != nil {
		nwcMonitor.Stop()
	}

	// Shutdown HTTP server with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}

	// Close Nostr client
	nostrClient.Close()

	log.Println("Server stopped")
}
