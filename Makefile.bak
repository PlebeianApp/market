.PHONY: deploy-local deploy deploy-domain stop-local status-local status logs logs-local seed \
        dev build start format test test-local check-deploy-env help \
        test-headed test-ui test-debug

include deploy.env
export

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

check-deploy-env:
	@test -f deploy.env || (echo "ERROR: deploy.env not found. Copy deploy.env.example:" && echo "  cp deploy.env.example deploy.env" && exit 1)
	@echo "deploy.env loaded."

# ---------------------------------------------------------------------------
# Local development shortcuts
# ---------------------------------------------------------------------------

dev:
	bun run dev

build:
	bun run build

start:
	bun run start

format:
	bun run format

# ---------------------------------------------------------------------------
# Testing (Playwright E2E)
# ---------------------------------------------------------------------------

test:
	@echo "==> Starting nak relay for tests..."
	@(lsof -i :10547 > /dev/null 2>&1) || (nak serve --hostname 0.0.0.0 &)
	@echo "==> Waiting for relay on port 10547..."
	@while ! lsof -i :10547 > /dev/null 2>&1; do sleep 0.5; done
	@sleep 1
	NODE_OPTIONS='--dns-result-order=ipv4first' bunx playwright test --config=e2e-new/playwright.config.ts; \
		EXIT=$$?; \
		kill $$(lsof -t -i :10547) 2>/dev/null || true; \
		exit $$EXIT

test-headed:
	@echo "==> Starting nak relay for tests..."
	@(lsof -i :10547 > /dev/null 2>&1) || (nak serve --hostname 0.0.0.0 &)
	@echo "==> Waiting for relay on port 10547..."
	@while ! lsof -i :10547 > /dev/null 2>&1; do sleep 0.5; done
	@sleep 1
	NODE_OPTIONS='--dns-result-order=ipv4first' bunx playwright test --config=e2e-new/playwright.config.ts --headed; \
		EXIT=$$?; \
		kill $$(lsof -t -i :10547) 2>/dev/null || true; \
		exit $$EXIT

test-ui:
	NODE_OPTIONS='--dns-result-order=ipv4first' bunx playwright test --config=e2e-new/playwright.config.ts --ui

test-debug:
	NODE_OPTIONS='--dns-result-order=ipv4first' bunx playwright test --config=e2e-new/playwright.config.ts --debug

# ---------------------------------------------------------------------------
# Deployment: localhost
# ---------------------------------------------------------------------------

stop-local:
	@echo "==> Stopping local services..."
	@-lsof -t -i :3000 2>/dev/null | xargs kill 2>/dev/null || true
	@-lsof -t -i :10547 2>/dev/null | xargs kill 2>/dev/null || true
	@sudo systemctl stop market nak 2>/dev/null || true
	@sleep 2
	@echo "==> Ports 3000 and 10547 cleared."

status-local:
	@sudo systemctl status market --no-pager 2>/dev/null || echo "market service not found"
	@echo "---"
	@sudo systemctl status nak --no-pager 2>/dev/null || echo "nak service not found"

logs-local:
	journalctl -u market -u nak -f

deploy-local: stop-local check-deploy-env
	@echo "==> Deploying to localhost..."
	@bash -c 'read -s -p "Sudo password: " PASS && echo && \
		ansible-playbook ansible/deploy.yml \
			-i localhost, \
			-c local \
			-e "ansible_become_method=su" \
			-e "ansible_become_password=$$PASS" \
			-e "app_dir=$(LOCAL_APP_DIR)" \
			-e "app_user=$(LOCAL_APP_USER)" \
			-e "bun_install_dir=/home/$(LOCAL_APP_USER)/.bun"; unset PASS'

test-local: check-deploy-env
	@echo "==> Starting nak relay for tests..."
	@(lsof -i :10547 > /dev/null 2>&1) || (nak serve --hostname 0.0.0.0 &)
	@echo "==> Waiting for relay on port 10547..."
	@while ! lsof -i :10547 > /dev/null 2>&1; do sleep 0.5; done
	@sleep 1
	@echo "==> Running E2E tests on localhost..."
	@echo "    Seeding relay..."
	@bun e2e-new/seed-relay.ts
	@echo "    Starting app server..."
	@NODE_ENV=test APP_RELAY_URL=ws://localhost:10547 APP_PRIVATE_KEY=$(TEST_APP_PRIVATE_KEY) bun dev & \
	APP_PID=$$!; \
	sleep 10; \
	NODE_OPTIONS='--dns-result-order=ipv4first' bunx playwright test --config=e2e-new/playwright.config.ts; \
	EXIT=$$?; \
	kill $$APP_PID 2>/dev/null || true; \
	kill $$(lsof -t -i :10547) 2>/dev/null || true; \
	exit $$EXIT

# ---------------------------------------------------------------------------
# Deployment: remote VPS via SSH
# ---------------------------------------------------------------------------

deploy: check-deploy-env
	@test -n "$(VPS_IP)" || (echo "ERROR: VPS_IP is not set in deploy.env" && exit 1)
	@test -n "$(SSH_KEY_PATH)" || (echo "ERROR: SSH_KEY_PATH is not set in deploy.env" && exit 1)
	@test -n "$(ANSIBLE_USER)" || (echo "ERROR: ANSIBLE_USER is not set in deploy.env" && exit 1)
	@echo "==> Deploying to VPS $(VPS_IP)..."
	ansible-playbook ansible/deploy.yml \
		-i "$(VPS_IP)," \
		-e "ansible_user=$(ANSIBLE_USER)" \
		-e "ansible_ssh_private_key_file=$(SSH_KEY_PATH)" \
		-e "app_dir=$(VPS_APP_DIR)" \
		-e "app_user=$(VPS_APP_USER)" \
		-e "bun_install_dir=/home/$(VPS_APP_USER)/.bun"

# ---------------------------------------------------------------------------
# Deployment: custom domain + HTTPS (run after deploy)
# ---------------------------------------------------------------------------

deploy-domain: check-deploy-env
	@test -n "$(VPS_IP)" || (echo "ERROR: VPS_IP is not set in deploy.env" && exit 1)
	@test -n "$(SSH_KEY_PATH)" || (echo "ERROR: SSH_KEY_PATH is not set in deploy.env" && exit 1)
	@test -n "$(MARKET_DOMAIN)" || (echo "ERROR: MARKET_DOMAIN is not set in deploy.env" && exit 1)
	@test -n "$(CF_API_EMAIL)" || (echo "ERROR: CF_API_EMAIL is not set in deploy.env" && exit 1)
	@test -n "$(CF_DNS_API_TOKEN)" || (echo "ERROR: CF_DNS_API_TOKEN is not set in deploy.env" && exit 1)
	@test -n "$(ACME_EMAIL)" || (echo "ERROR: ACME_EMAIL is not set in deploy.env" && exit 1)
	@echo "==> Setting up HTTPS for $(MARKET_DOMAIN)..."
	ansible-playbook ansible/deploy-domain.yml \
		-i "$(VPS_IP)," \
		-e "ansible_user=$(ANSIBLE_USER)" \
		-e "ansible_ssh_private_key_file=$(SSH_KEY_PATH)" \
		-e "market_domain=$(MARKET_DOMAIN)" \
		-e "cf_api_email=$(CF_API_EMAIL)" \
		-e "cf_dns_api_token=$(CF_DNS_API_TOKEN)" \
		-e "acme_email=$(ACME_EMAIL)"

# ---------------------------------------------------------------------------
# Remote operations
# ---------------------------------------------------------------------------

status: check-deploy-env
	@test -n "$(VPS_IP)" || (echo "ERROR: VPS_IP is not set in deploy.env" && exit 1)
	ssh -i $(SSH_KEY_PATH) $(ANSIBLE_USER)@$(VPS_IP) \
		"systemctl status market --no-pager -l; echo '---'; systemctl status nak --no-pager -l"

logs: check-deploy-env
	@test -n "$(VPS_IP)" || (echo "ERROR: VPS_IP is not set in deploy.env" && exit 1)
	ssh -i $(SSH_KEY_PATH) $(ANSIBLE_USER)@$(VPS_IP) \
		"journalctl -u market -u nak -f"

seed: check-deploy-env
	@test -n "$(VPS_IP)" || (echo "ERROR: VPS_IP is not set in deploy.env" && exit 1)
	@echo "==> Seeding marketplace data on VPS..."
	ssh -i $(SSH_KEY_PATH) $(ANSIBLE_USER)@$(VPS_IP) \
		"cd $(VPS_APP_DIR) && bun run seed"

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

help:
	@echo "Plebeian Market — Make targets"
	@echo ""
	@echo "  Local dev:"
	@echo "    make dev          Start dev server (bun --hot)"
	@echo "    make build        Production build"
	@echo "    make start        Start production server"
	@echo "    make format       Run prettier"
	@echo ""
	@echo "  Testing:"
	@echo "    make test         Run all E2E tests (headless)"
	@echo "    make test-headed  Run E2E tests with browser visible"
	@echo "    make test-ui      Run E2E tests with Playwright UI"
	@echo "    make test-debug   Run E2E tests in debug mode"
	@echo "    make test-local   Deploy to localhost then run E2E tests"
	@echo ""
	@echo "  Deployment:"
	@echo "    make stop-local      Stop all services and free ports 3000/10547"
	@echo "    make deploy-local    Deploy to localhost (systemd services)"
	@echo "    make deploy          Deploy to remote VPS via SSH"
	@echo "    make deploy-domain   Deploy + Nginx + HTTPS (Cloudflare DNS-01)"
	@echo ""
	@echo "  Local ops:"
	@echo "    make status-local    Show localhost service status"
	@echo "    make logs-local      Tail localhost service logs"
	@echo ""
	@echo "  Remote ops:"
	@echo "    make status          Show service status on VPS"
	@echo "    make logs            Tail service logs on VPS"
	@echo "    make seed            Run seed script on VPS"
	@echo ""
	@echo "  Setup:"
	@echo "    make check-deploy-env  Validate deploy.env exists"
