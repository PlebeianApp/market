SHELL := /bin/bash
SSH := ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR
VPS := debian@23.182.128.51
REMOTE_BASE := /home/debian

BRANCHES := shipping-dedupe bidding-mint trusted-mint

.PHONY: deploy-all deploy-shipping-dedupe deploy-bidding-mint deploy-trusted-mint \
        start-all stop-all restart-all status logs \
        test-all test-shipping-dedupe test-bidding-mint test-trusted-mint \
        build-all build-shipping-dedupe build-bidding-mint build-trusted-mint \
        caddy-setup health-check

# --- Build ---

build-all: build-shipping-dedupe build-bidding-mint build-trusted-mint

build-shipping-dedupe:
	git checkout fix/auction-shipping-ref-dedupe
	bun install --frozen-lockfile 2>/dev/null || bun install
	bun run generate-routes && bun run build

build-bidding-mint:
	git checkout fix/862-bidding-with-any-mint
	bun install --frozen-lockfile 2>/dev/null || bun install
	bun run generate-routes && bun run build

build-trusted-mint:
	git checkout feat/auction-trusted-mint-state-ownership-v2
	bun install --frozen-lockfile 2>/dev/null || bun install
	bun run generate-routes && bun run build

# --- Deploy (tar + single upload for speed) ---

deploy-all: deploy-shipping-dedupe deploy-bidding-mint deploy-trusted-mint

deploy-shipping-dedupe: build-shipping-dedupe
	$(call DEPLOY_BRANCH,shipping-dedupe,3101)

deploy-bidding-mint: build-bidding-mint
	$(call DEPLOY_BRANCH,bidding-mint,3102)

deploy-trusted-mint: build-trusted-mint
	$(call DEPLOY_BRANCH,trusted-mint,3103)

define DEPLOY_BRANCH
	@echo "=== Packaging $(1) ==="
	tar czf /tmp/market-$(1).tar.gz dist src package.json bun.lock tsconfig.json contextvm 2>/dev/null || tar czf /tmp/market-$(1).tar.gz dist src package.json bun.lock tsconfig.json
	@echo "=== Uploading $(1) to port $(2) ==="
	$(SSH) $(VPS) "mkdir -p $(REMOTE_BASE)/market-$(1) $(REMOTE_BASE)/logs"
	scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR /tmp/market-$(1).tar.gz $(VPS):/tmp/market-$(1).tar.gz
	$(SSH) $(VPS) "cd $(REMOTE_BASE)/market-$(1) && tar xzf /tmp/market-$(1).tar.gz && rm /tmp/market-$(1).tar.gz"
	$(SSH) $(VPS) "printf 'NODE_ENV=development\nPORT=$(2)\nAPP_RELAY_URL=wss://relay.damus.io\nAPP_PRIVATE_KEY=0000000000000000000000000000000000000000000000000000000000000001\nCVM_SERVER_KEY=0000000000000000000000000000000000000000000000000000000000000001\n' > $(REMOTE_BASE)/market-$(1)/.env"
	$(SSH) $(VPS) "source ~/.bashrc && cd $(REMOTE_BASE)/market-$(1) && ~/.bun/bin/bun install --production 2>&1 | tail -1"
	$(SSH) $(VPS) "printf 'module.exports={apps:[{name:\"$(1)\",script:\"src/index.tsx\",interpreter:process.env.HOME+\"/.bun/bin/bun\",cwd:\"$(REMOTE_BASE)/market-$(1)\",instances:1,exec_mode:\"fork\",env_file:\".env\",error_file:\"$(REMOTE_BASE)/logs/$(1)-error.log\",out_file:\"$(REMOTE_BASE)/logs/$(1)-out.log\",merge_logs:true,autorestart:true,max_restarts:10,min_uptime:\"10s\",restart_delay:5000,max_memory_restart:\"500M\",kill_timeout:5000,listen_timeout:10000}]};\n' > $(REMOTE_BASE)/market-$(1)/ecosystem.config.cjs"
	$(SSH) $(VPS) "source ~/.bashrc && cd $(REMOTE_BASE)/market-$(1) && pm2 startOrReload ecosystem.config.cjs 2>&1 | tail -3 && pm2 save --force"
	@echo "=== $(1) deployed on port $(2) ==="
endef

# --- Caddy ---

caddy-setup:
	$(SSH) $(VPS) "printf 'shipping-dedupe.plebeian.orangesync.tech {\n  root * $(REMOTE_BASE)/market-shipping-dedupe/dist\n  encode gzip\n  handle /api/* { reverse_proxy localhost:3101 }\n  @ws header Connection *Upgrade*\n  handle @ws { reverse_proxy localhost:3101 }\n  handle { try_files {path} /index.html\n    file_server }\n}\n\nbidding-mint.plebeian.orangesync.tech {\n  root * $(REMOTE_BASE)/market-bidding-mint/dist\n  encode gzip\n  handle /api/* { reverse_proxy localhost:3102 }\n  @ws header Connection *Upgrade*\n  handle @ws { reverse_proxy localhost:3102 }\n  handle { try_files {path} /index.html\n    file_server }\n}\n\ntrusted-mint.plebeian.orangesync.tech {\n  root * $(REMOTE_BASE)/market-trusted-mint/dist\n  encode gzip\n  handle /api/* { reverse_proxy localhost:3103 }\n  @ws header Connection *Upgrade*\n  handle @ws { reverse_proxy localhost:3103 }\n  handle { try_files {path} /index.html\n    file_server }\n}\n' | sudo tee /etc/caddy/Caddyfile > /dev/null && sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && sudo systemctl reload caddy"
	@echo "=== Caddy configured ==="

# --- Process management ---

start-all:
	@for name in $(BRANCHES); do $(SSH) $(VPS) "source ~/.bashrc && cd $(REMOTE_BASE)/market-$$name && pm2 startOrReload ecosystem.config.cjs 2>&1 | tail -1"; done

stop-all:
	$(SSH) $(VPS) "source ~/.bashrc && pm2 stop $(BRANCHES) 2>/dev/null || true"

restart-all: stop-all start-all

status:
	$(SSH) $(VPS) "source ~/.bashrc && pm2 ls"

health-check:
	@for port in 3101 3102 3103; do echo -n "Port $$port: "; $(SSH) $(VPS) "curl -sf http://localhost:$$port/api/config > /dev/null && echo OK || echo FAIL"; done

logs:
	@read -p "Branch name (shipping-dedupe|bidding-mint|trusted-mint): " name; \
	$(SSH) $(VPS) "source ~/.bashrc && pm2 logs $$name"

# --- Tests ---

test-all: test-shipping-dedupe test-bidding-mint test-trusted-mint

test-shipping-dedupe:
	git checkout fix/auction-shipping-ref-dedupe
	@echo "=== Tests: shipping-dedupe ==="
	bun test src/lib/__tests__/auctionShippingRefs.test.ts
	bun run test:unit
	bun run test:integration

test-bidding-mint:
	git checkout fix/862-bidding-with-any-mint
	@echo "=== Tests: bidding-mint ==="
	bun test src/lib/__tests__/auctionMintSelection.test.ts src/lib/__tests__/auctionMintSelection.integration.test.ts
	bun run test:unit
	bun run test:integration

test-trusted-mint:
	git checkout feat/auction-trusted-mint-state-ownership-v2
	@echo "=== Tests: trusted-mint ==="
	bun test src/lib/__tests__/auctionMintSync.test.ts
	bun run test:unit
	bun run test:integration
