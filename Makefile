SHELL := /usr/bin/env bash

.PHONY: help install bootstrap format format-check test-price-core test-unit test-integration test-integration-local test-e2e-new test-e2e-pricing test-pricing dev-contextvm contextvm-server fetch-btc-price manual-happy-path browser-contextvm

RELAY_URL ?= ws://localhost:10547
PLAYWRIGHT_ARGS ?=
BUN := $(shell command -v bun 2>/dev/null || printf '%s/.bun/bin/bun' "$$HOME")

help:
	@echo "Targets:"
	@echo "  make install                - install bun deps and nak if missing"
	@echo "  make dev-contextvm          - start local relay + ContextVM currency server"
	@echo "  make format                 - format the ContextVM apply-list markdown"
	@echo "  make format-check           - run prettier check for the repo"
	@echo "  make test-price-core        - run the core ContextVM pricing unit tests"
	@echo "  make test-unit              - run the broader ContextVM/unit suite"
	@echo "  make test-integration       - run the ContextVM client integration test"
	@echo "  make test-integration-local - start local relay + ContextVM server, then run integration"
	@echo "  make test-e2e-new           - run the E2E suite with optional PLAYWRIGHT_ARGS"
	@echo "  make test-e2e-pricing       - run the pricing-focused E2E subset"
	@echo "  make test-pricing           - run the pricing-focused validation bundle"
	@echo "  make contextvm-server       - start the ContextVM server"
	@echo "  make fetch-btc-price        - probe BTC price via the local relay"
	@echo "  make manual-happy-path      - print the local ContextVM manual verification plan"
	@echo "  make browser-contextvm      - start relay + currency server + app for browser validation"

install:
	@if [ ! -x "$(BUN)" ]; then \
		if command -v curl >/dev/null 2>&1; then \
			curl -fsSL https://bun.sh/install | bash; \
		else \
			echo "error: bun is not installed and curl is unavailable"; \
			exit 1; \
		fi; \
	fi
	@"$(BUN)" install
	@if ! command -v nak >/dev/null 2>&1; then \
		if command -v go >/dev/null 2>&1; then \
			go install github.com/fiatjaf/nak@latest; \
		else \
			echo "error: nak is not installed and go is unavailable"; \
			exit 1; \
		fi; \
	fi

bootstrap: install

format: install
	"$(BUN)" x prettier --write docs/contextvm-minimal-apply-list.md

format-check: install
	"$(BUN)" x prettier --check .

test-price-core: install
	"$(BUN)" test contextvm/tools/__tests__/price-sources.test.ts \
		contextvm/tools/__tests__/rates-cache.test.ts \
		contextvm/__tests__/currency-server.test.ts

# Broader unit coverage for the ContextVM feature
# (the package script already scopes to the relevant test folders)
test-unit: install
	"$(BUN)" run test:unit

test-integration: install
	@set -e; \
	trap 'kill $$dev_pid >/dev/null 2>&1 || true' EXIT INT TERM; \
	test_app_private_key="$$(nak key generate)"; \
	$(MAKE) --no-print-directory dev-contextvm >/tmp/contextvm-test-integration-dev.log 2>&1 & dev_pid=$$!; \
	i=0; until "$(BUN)" run scripts/fetch-btc-price.ts "$(RELAY_URL)" >/tmp/contextvm-test-integration-price-check.log 2>&1; do \
		i=$$((i + 1)); \
		if [ $$i -ge 30 ]; then \
			echo "error: dev-contextvm did not become ready"; \
			echo "dev log: /tmp/contextvm-test-integration-dev.log"; \
			exit 1; \
		fi; \
		sleep 1; \
	done; \
	TEST_APP_PRIVATE_KEY="$$test_app_private_key" APP_PRIVATE_KEY="$$test_app_private_key" NODE_ENV=test APP_RELAY_URL="$(RELAY_URL)" LOCAL_RELAY_ONLY=true NIP46_RELAY_URL="$(RELAY_URL)" PORT=34567 "$(BUN)" run test:integration

# Convenience wrapper for local development.
# Starts the relay and currency server in one long-running process.
dev-contextvm: install
	@set -e; \
	trap 'kill $$server_pid $$relay_pid >/dev/null 2>&1 || true' EXIT INT TERM; \
	relay_bin="$$(command -v nak 2>/dev/null || printf '%s/go/bin/nak' "$$HOME")"; \
	"$$relay_bin" serve --hostname 0.0.0.0 >/tmp/contextvm-relay.log 2>&1 & relay_pid=$$!; \
	sleep 2; \
	APP_RELAY_URL="$(RELAY_URL)" "$(BUN)" run dev:contextvm-server >/tmp/contextvm-currency-server.log 2>&1 & server_pid=$$!; \
	i=0; until "$(BUN)" run scripts/fetch-btc-price.ts "$(RELAY_URL)" >/tmp/contextvm-currency-server-check.log 2>&1; do \
		i=$$((i + 1)); \
		if [ $$i -ge 30 ]; then \
			echo "error: currency server did not become ready"; \
			echo "relay log: /tmp/contextvm-relay.log"; \
			echo "server log: /tmp/contextvm-currency-server.log"; \
			exit 1; \
		fi; \
		sleep 1; \
	done; \
	echo "ContextVM dev environment is ready"; \
	wait $$relay_pid $$server_pid

test-integration-local: test-integration

test-e2e-new: install
	@set -e; \
	trap 'kill $$app_pid $$dev_pid >/dev/null 2>&1 || true' EXIT INT TERM; \
	test_app_private_key="$$(nak key generate)"; \
	$(MAKE) --no-print-directory dev-contextvm >/tmp/contextvm-test-e2e-dev.log 2>&1 & dev_pid=$$!; \
	i=0; until "$(BUN)" run scripts/fetch-btc-price.ts "$(RELAY_URL)" >/tmp/contextvm-test-e2e-price-check.log 2>&1; do \
		i=$$((i + 1)); \
		if [ $$i -ge 30 ]; then \
			echo "error: dev-contextvm did not become ready"; \
			echo "dev log: /tmp/contextvm-test-e2e-dev.log"; \
			exit 1; \
		fi; \
		sleep 1; \
	done; \
	TEST_APP_PRIVATE_KEY="$$test_app_private_key" NODE_ENV=test APP_RELAY_URL="$(RELAY_URL)" LOCAL_RELAY_ONLY=true NIP46_RELAY_URL="$(RELAY_URL)" PORT=34567 "$(BUN)" e2e-new/seed-relay.ts; \
	APP_PRIVATE_KEY="$$test_app_private_key" TEST_APP_PRIVATE_KEY="$$test_app_private_key" NODE_ENV=test APP_RELAY_URL="$(RELAY_URL)" LOCAL_RELAY_ONLY=true NIP46_RELAY_URL="$(RELAY_URL)" PORT=34567 "$(BUN)" run dev >/tmp/contextvm-test-e2e-app.log 2>&1 & app_pid=$$!; \
	i=0; until "$(BUN)" -e 'const r = await fetch("http://localhost:34567"); process.exit(r.status < 500 ? 0 : 1)'; do \
		i=$$((i + 1)); \
		if [ $$i -ge 60 ]; then \
			echo "error: app did not become ready"; \
			echo "app log: /tmp/contextvm-test-e2e-app.log"; \
			exit 1; \
		fi; \
		sleep 1; \
	done; \
	TEST_APP_PRIVATE_KEY="$$test_app_private_key" CI=1 NODE_OPTIONS='--dns-result-order=ipv4first' "$(BUN)" run test:e2e-new -- $(PLAYWRIGHT_ARGS)

test-e2e-pricing: PLAYWRIGHT_ARGS := --grep 'Product Page - View Only'
test-e2e-pricing: test-e2e-new

test-pricing: test-price-core test-unit test-integration-local
	@echo 'Run "make test-e2e-pricing" separately if you want the Playwright BTC price flow.'

contextvm-server: install
	APP_RELAY_URL="$(RELAY_URL)" "$(BUN)" run dev:contextvm-server

fetch-btc-price: install
	"$(BUN)" run scripts/fetch-btc-price.ts "$(RELAY_URL)"

manual-happy-path: install
	@echo "1) Terminal A: make dev-contextvm"
	@echo "2) Terminal B: export APP_PRIVATE_KEY=\"$$(nak key generate)\" && bun run startup && bun run seed"
	@echo "3) Browser/Terminal: make fetch-btc-price"
	@echo "4) Terminal C: export APP_PRIVATE_KEY=\"$$(nak key generate)\" && bun run startup && bun run dev"
	@echo "5) Browser: open http://localhost:3000/products, verify fiat pricing and EUR switch"

browser-contextvm: install
	@set -e; \
	trap 'kill $$app_pid $$server_pid $$relay_pid >/dev/null 2>&1 || true' EXIT INT TERM; \
	pkill -f 'dev:contextvm-server|dev:seed|e2e-new/seed-relay.ts|nak serve' 2>/dev/null || true; \
	lsof -ti:10547 -ti:3000 2>/dev/null | xargs -r kill -9 2>/dev/null || true; \
	sleep 2; \
	test_app_private_key="$$(nak key generate)"; \
	relay_bin="$$(command -v nak 2>/dev/null || printf '%s/go/bin/nak' "$$HOME")"; \
	"$$relay_bin" serve --port 10547 --hostname 0.0.0.0 >/tmp/contextvm-browser-relay.log 2>&1 & relay_pid=$$!; \
	i=0; until "$(BUN)" -e 'const r = await fetch("http://localhost:10547"); process.exit(r.status < 500 ? 0 : 1)'; do \
		i=$$((i + 1)); \
		if [ $$i -ge 30 ]; then \
			echo "error: relay did not become ready"; \
			echo "relay log: /tmp/contextvm-browser-relay.log"; \
			exit 1; \
		fi; \
		sleep 1; \
	done; \
	TEST_APP_PRIVATE_KEY="$$test_app_private_key" APP_RELAY_URL="$(RELAY_URL)" LOCAL_RELAY_ONLY=true NIP46_RELAY_URL="$(RELAY_URL)" PORT=34567 "$(BUN)" run e2e-new/seed-relay.ts >/tmp/contextvm-browser-relay-seed.log 2>&1; \
	APP_RELAY_URL="$(RELAY_URL)" "$(BUN)" run dev:contextvm-server >/tmp/contextvm-browser-currency-server.log 2>&1 & server_pid=$$!; \
	i=0; until "$(BUN)" run scripts/fetch-btc-price.ts "$(RELAY_URL)" >/tmp/contextvm-browser-price-check.log 2>&1; do \
		i=$$((i + 1)); \
		if [ $$i -ge 30 ]; then \
			echo "error: currency server did not become ready"; \
			echo "relay log: /tmp/contextvm-browser-relay.log"; \
			echo "server log: /tmp/contextvm-browser-currency-server.log"; \
			exit 1; \
		fi; \
		sleep 1; \
	done; \
	APP_PRIVATE_KEY="$$test_app_private_key" APP_RELAY_URL="$(RELAY_URL)" LOCAL_RELAY_ONLY=true NIP46_RELAY_URL="$(RELAY_URL)" PORT=3000 "$(BUN)" run dev:seed >/tmp/contextvm-browser-app.log 2>&1 & app_pid=$$!; \
	i=0; until "$(BUN)" -e 'const r = await fetch("http://localhost:3000/products"); process.exit(r.ok ? 0 : 1)'; do \
		i=$$((i + 1)); \
		if [ $$i -ge 60 ]; then \
			echo "error: app did not become ready"; \
			echo "app log: /tmp/contextvm-browser-app.log"; \
			exit 1; \
		fi; \
		sleep 1; \
	done; \
	echo "Browser path ready: http://localhost:3000/products"; \
	echo "Open DevTools and confirm ContextVM logs + BTC pricing."; \
	echo "Logs: /tmp/contextvm-browser-relay.log /tmp/contextvm-browser-relay-seed.log /tmp/contextvm-browser-currency-server.log /tmp/contextvm-browser-app.log"; \
	wait $$relay_pid $$server_pid $$app_pid
