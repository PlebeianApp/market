# NIP-53 Deployment & Testing Plan

## Branch: `feat/nip53-auction-live-chat`
## Target: `auctions/p2pk-path-oracle-via-cvm-v1`

## Overview

Three deliverables across two repos:
1. **Market repo** (`~/plebeian-testing-15.05.2026/market`) — UI component tests via Playwright
2. **Tollgate repo** (`~/tollgate-infrastructure-kit`) — Playwright smoke tests against live VPS
3. **Tollgate repo** — Ansible playbook to deploy test market instance + run E2E on VPS

All changes are **additive and isolated** — they will not modify any existing playbook, role, Caddy config, or service.

## Architecture on VPS (test-market.orangesync.tech)

```
/opt/tollgate/plebeian-market-test/
├── docker-compose.yml          # market app + nak relay containers
├── .env                        # APP_RELAY_URL, APP_PRIVATE_KEY, etc.
└── caddy-snippet.conf          # Caddy route for test-market subdomain

Docker containers:
  tollgate-test-market    → port 34568 (market app, bun dev)
  tollgate-test-relay     → port 10548 (isolated nak relay)

NOT on tollgate-net network (isolated).
NOT in setup-all.yml (optional, run separately).
```

## Isolation Guarantees

- Separate Docker containers, separate network
- Separate ports: 34568 (market), 10548 (relay) — no conflicts with strfry:7777, etc.
- Caddy route injected via `import` + snippet file, NOT modifying main Caddyfile template
- DNS: `test-market.orangesync.tech` A record created/removed by playbook
- Full teardown playbook removes containers, DNS record, Caddy route

---

## Checklist

### Part 1: Market Repo — UI Component Tests
- [x] Create `e2e/tests/auction-live-chat-ui.spec.ts`
  - [x] Test: Empty state message "No messages yet. Be the first!"
  - [x] Test: Message count displays "0 messages" initially
  - [x] Test: Status indicator is gray dot when auction is planned
  - [x] Test: Send message via Enter key, verify input clears
  - [x] Test: Chat panel hidden on mobile viewport (375px)
  - [x] Test: Chat panel visible on desktop viewport
  - [x] Test: Unauthenticated user sees "Log in to join" prompt
  - [x] Test: Chat messages display with relative timestamp

### Part 2: Tollgate Repo — Playwright Smoke Tests
- [x] Create `tests/e2e/tests/plebeian-market.spec.ts`
  - [x] Test: Health check — GET returns < 500
  - [x] Test: SPA loads — page title, body visible
  - [x] Test: Auctions page accessible
  - [x] Test: Products page accessible
  - [x] Test: Login dialog opens
  - [x] Test: Test relay HTTP endpoint responds
  - [x] Test: Test relay NIP-11 info document
  - [x] Test: Test relay WebSocket upgrade succeeds

### Part 3: Tollgate Repo — Ansible Role
- [x] Create `ansible/playbooks/26-plebeian-market-test.yml` (thin playbook)
- [x] Create `ansible/roles/plebeian_market_test/tasks/main.yml`
  - [x] Create directory
  - [x] Write docker-compose.yml (market + nak relay)
  - [x] Start containers, wait for ports
  - [x] Create DNS A records for test-market + test-relay
  - [x] Add Caddy route snippet via import, reload Caddy
  - [x] Teardown: remove containers, DNS, Caddy route, directory
- [x] Create `ansible/roles/plebeian_market_test/templates/docker-compose.yml.j2`
- [x] Create `ansible/roles/plebeian_market_test/templates/plebeian-market-test.conf.j2`
- [x] Create `ansible/roles/plebeian_market_test/defaults/main.yml`
- [x] Create `ansible/roles/plebeian_market_test/handlers/main.yml`

### Part 4: Tollgate Repo — Integration Test
- [x] Create `tests/integration/test_plebeian_market.sh`
  - [x] Check Docker containers running
  - [x] Check ports 34568 + 10548 listening
  - [x] Check HTTP responses
  - [x] Check Caddy routing via subdomain
  - [x] Check compose file + caddy snippet exist

### Part 5: Tollgate Repo — Convenience Script
- [x] Create `scripts/test-plebeian.sh`
  - [x] deploy: run playbook
  - [x] test: run integration + E2E
  - [x] teardown: clean up
  - [x] full: deploy → test → teardown

### Part 6: Documentation
- [x] Update `NIP53-TESTING.md` with deployment checkboxes
- [x] Create `NIP53-DEPLOYMENT-PLAN.md`

### Part 7: Commit
- [ ] Commit market repo changes
- [ ] Commit tollgate repo changes
