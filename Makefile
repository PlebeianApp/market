.PHONY: e2e-start e2e-dev e2e-dev-bg e2e-login e2e-stop e2e-clean e2e-firewall \
       e2e-test-resolved e2e-test-dedup e2e-test-extra-cost \
       e2e-test-invalid e2e-test-not-found e2e-test-all

PUBLIC_IP   := $(shell hostname -I 2>/dev/null | awk '{print $$1}')
RELAY_URL   := ws://localhost:10547
PUBLIC_RELAY_URL := ws://$(PUBLIC_IP):10547
BASE_URL    := http://localhost:34567
APP_SK      := e2e0000000000000000000000000000000000000000000000000000000000001
MERCHANT_SK := 5c81bffa8303bbd7726d6a5a1170f3ee46de2addabefd6a735845166af01f5c0
MERCHANT_PK := 86a82cab18b293f53cbaaae8cdcbee3f7ec427fdf9f9c933db77800bb5ef38a0
RELAY_PID   := .e2e-relay.pid
NOW         := $(shell date +%s)
PUB_SCRIPT  := scripts/publish-auction.sh

REF_WORLD   := 30406:$(MERCHANT_PK):worldwide-standard
REF_DIGITAL := 30406:$(MERCHANT_PK):digital-delivery
REF_PICKUP  := 30406:$(MERCHANT_PK):local-pickup---bitcoin-store

e2e-start:
	@echo "==> Starting relay on port 10547..."
	@if [ -f $(RELAY_PID) ] && kill -0 $$(cat $(RELAY_PID)) 2>/dev/null; then \
		echo "    Relay already running (PID $$(cat $(RELAY_PID)))"; \
	else \
		nak serve --hostname 0.0.0.0 > /dev/null 2>&1 & \
		sleep 2; \
		ss -tlnp | grep ':10547 ' | grep -oP 'pid=\K[0-9]+' | head -1 > $(RELAY_PID); \
		echo "    Relay started (PID $$(cat $(RELAY_PID)))"; \
	fi
	@echo "==> Seeding relay config..."
	@bun e2e-new/seed-relay.ts
	@echo "==> Seeding merchant profile..."
	@echo '{"kind":0,"content":"{\"name\":\"TestMerchant\",\"display_name\":\"Test Merchant\",\"about\":\"Manual E2E test merchant\",\"lud16\":\"plebeianuser@coinos.io\"}","tags":[]}' | nak event --sec $(MERCHANT_SK) $(RELAY_URL) > /dev/null 2>&1
	@echo "    Profile published"
	@echo "==> Seeding shipping options..."
	@echo '{"kind":30406,"content":"Shipping: Worldwide Standard","tags":[["d","worldwide-standard"],["title","Worldwide Standard"],["price","5000","sats"],["service","standard"],["country","US"],["country","CA"],["country","GB"],["country","DE"]]}' | nak event --sec $(MERCHANT_SK) $(RELAY_URL) > /dev/null 2>&1
	@echo "    Published: Worldwide Standard"
	@echo '{"kind":30406,"content":"Shipping: Digital Delivery","tags":[["d","digital-delivery"],["title","Digital Delivery"],["price","0","sats"],["service","digital"]]}' | nak event --sec $(MERCHANT_SK) $(RELAY_URL) > /dev/null 2>&1
	@echo "    Published: Digital Delivery"
	@echo '{"kind":30406,"content":"Shipping: Local Pickup","tags":[["d","local-pickup---bitcoin-store"],["title","Local Pickup - Bitcoin Store"],["price","0","sats"],["service","pickup"],["pickup-street","456 Satoshi Lane"],["pickup-city","Austin"],["pickup-state","TX"],["pickup-postal-code","78701"],["pickup-country","US"],["pickup-address","456 Satoshi Lane, Austin, TX, 78701, US"]]}' | nak event --sec $(MERCHANT_SK) $(RELAY_URL) > /dev/null 2>&1
	@echo "    Published: Local Pickup - Bitcoin Store"
	@echo ""
	@echo "==> Environment ready."
	@echo "    Relay: $(RELAY_URL)"
	@echo "    App:   $(BASE_URL)"
	@echo "    Run 'make e2e-dev' in another terminal to start the dev server."
	@echo "    Run 'make e2e-login' to get the merchant private key."

e2e-dev:
	NODE_ENV=test PORT=34567 APP_RELAY_URL=$(PUBLIC_RELAY_URL) \
	APP_PRIVATE_KEY=$(APP_SK) LOCAL_RELAY_ONLY=true \
	NIP46_RELAY_URL=$(PUBLIC_RELAY_URL) \
	bun --hot src/index.tsx --host 0.0.0.0

e2e-dev-bg:
	@echo "==> Starting dev server in background..."
	@setsid bash -c 'NODE_ENV=test PORT=34567 APP_RELAY_URL=$(PUBLIC_RELAY_URL) \
		APP_PRIVATE_KEY=$(APP_SK) LOCAL_RELAY_ONLY=true \
		NIP46_RELAY_URL=$(PUBLIC_RELAY_URL) \
		bun --hot src/index.tsx --host 0.0.0.0 >> /tmp/e2e-dev.log 2>&1' &
	@sleep 8
	@if ss -tlnp | grep -q 34567; then \
		echo "    Dev server started (PID $$(ss -tlnp | grep 34567 | grep -oP 'pid=\K[0-9]+' | head -1))"; \
		echo "    Relay URL (browser): $(PUBLIC_RELAY_URL)"; \
		echo "    App URL: http://$(PUBLIC_IP):34567"; \
	else \
		echo "    ERROR: Dev server failed to start. Check /tmp/e2e-dev.log"; \
	fi

e2e-firewall:
	@echo "==> Opening firewall for ports 34567 and 10547..."
	@sudo iptables -C INPUT -p tcp --dport 34567 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 2 -p tcp --dport 34567 -j ACCEPT
	@sudo iptables -C INPUT -p tcp --dport 10547 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 2 -p tcp --dport 10547 -j ACCEPT
	@echo "    Done. Ports 34567 and 10547 are open."

e2e-login:
	@echo ""
	@echo "==> Login as devUser1 (TestMerchant)"
	@echo ""
	@echo "    nsec: nsec18cmyxjcca6y8s3yhegt7nmrcxw9pn4ugnqe68jfc8km3sr2c5d2srsltll"
	@echo "    hex:  $(MERCHANT_SK)"
	@echo ""
	@echo "    1. Open http://$(PUBLIC_IP):34567"
	@echo "    2. Click Login -> Private Key tab"
	@echo "    3. Paste the nsec above"
	@echo "    4. Click Login"
	@echo ""

e2e-test-resolved:
	@echo "==> Test 1: Resolved shipping options"
	@RELAY_URL=$(RELAY_URL) BASE_URL=$(BASE_URL) MERCHANT_SK=$(MERCHANT_SK) MERCHANT_PK=$(MERCHANT_PK) \
		$(PUB_SCRIPT) \
		"E2E Test - Resolved Shipping" \
		"manual-e2e-resolved-$(NOW)" \
		"Auction with 2 valid unique shipping refs" \
		'["shipping_option","$(REF_WORLD)"]' \
		'["shipping_option","$(REF_DIGITAL)"]'

e2e-test-dedup:
	@echo "==> Test 2: Deduplication (same ref + same extraCost)"
	@RELAY_URL=$(RELAY_URL) BASE_URL=$(BASE_URL) MERCHANT_SK=$(MERCHANT_SK) MERCHANT_PK=$(MERCHANT_PK) \
		$(PUB_SCRIPT) \
		"E2E Test - Dedup Shipping" \
		"manual-e2e-dedup-$(NOW)" \
		"Auction with duplicate shipping_option tags" \
		'["shipping_option","$(REF_DIGITAL)"]' \
		'["shipping_option","$(REF_DIGITAL)"]'

e2e-test-extra-cost:
	@echo "==> Test 3: Different extra costs (same ref, different extraCost)"
	@RELAY_URL=$(RELAY_URL) BASE_URL=$(BASE_URL) MERCHANT_SK=$(MERCHANT_SK) MERCHANT_PK=$(MERCHANT_PK) \
		$(PUB_SCRIPT) \
		"E2E Test - Extra Cost Shipping" \
		"manual-e2e-extra-cost-$(NOW)" \
		"Auction with same shipping ref but different extraCost values" \
		'["shipping_option","$(REF_WORLD)","0"]' \
		'["shipping_option","$(REF_WORLD)","500"]'

e2e-test-invalid:
	@echo "==> Test 4: Invalid shipping reference"
	@RELAY_URL=$(RELAY_URL) BASE_URL=$(BASE_URL) MERCHANT_SK=$(MERCHANT_SK) MERCHANT_PK=$(MERCHANT_PK) \
		$(PUB_SCRIPT) \
		"E2E Test - Invalid Shipping Ref" \
		"manual-e2e-invalid-$(NOW)" \
		"Auction with malformed shipping reference" \
		'["shipping_option","not-a-valid-shipping-reference"]'

e2e-test-not-found:
	@echo "==> Test 5: Not found shipping reference"
	@RELAY_URL=$(RELAY_URL) BASE_URL=$(BASE_URL) MERCHANT_SK=$(MERCHANT_SK) MERCHANT_PK=$(MERCHANT_PK) \
		$(PUB_SCRIPT) \
		"E2E Test - NotFound Shipping Ref" \
		"manual-e2e-not-found-$(NOW)" \
		"Auction with valid-format ref to nonexistent shipping event" \
		'["shipping_option","30406:$(MERCHANT_PK):nonexistent-shipping-option"]'

e2e-test-all: e2e-test-resolved e2e-test-dedup e2e-test-extra-cost e2e-test-invalid e2e-test-not-found

e2e-stop:
	@PIDS=$$(ss -tlnp | grep ':10547 ' | grep -oP 'pid=\K[0-9]+' | sort -u); \
	if [ -n "$$PIDS" ]; then \
		echo $$PIDS | xargs kill 2>/dev/null; \
		echo "==> Relay stopped (PIDs: $$PIDS)"; \
	else \
		echo "==> No relay running on port 10547"; \
	fi; \
	DEV_PIDS=$$(ss -tlnp | grep ':34567 ' | grep -oP 'pid=\K[0-9]+' | sort -u); \
	if [ -n "$$DEV_PIDS" ]; then \
		echo $$DEV_PIDS | xargs kill 2>/dev/null; \
		echo "==> Dev server stopped (PIDs: $$DEV_PIDS)"; \
	fi; \
	rm -f $(RELAY_PID)

e2e-clean: e2e-stop
	rm -f $(RELAY_PID)
