.PHONY: test-unit test-e2e-mint test-format test-all dev-relay dev-server dev

test-unit:
	bun test:unit

test-e2e-mint:
	NODE_OPTIONS='--dns-result-order=ipv4first' npx playwright test --config=e2e-new/playwright.config.ts tests/auction-mint-state.spec.ts

test-format:
	bun run format:check

test-all: test-unit test-e2e-mint test-format

dev-relay:
	@lsof -i :10547 -sTCP:LISTEN -t > /dev/null 2>&1 && echo "nak relay already running on :10547" || (echo "starting nak relay on :10547" && nak serve --hostname 0.0.0.0 &)

dev-server:
	@lsof -i :3000 -sTCP:LISTEN -t > /dev/null 2>&1 && echo "dev server already running on :3000" || (echo "starting dev server on :3000" && bun --hot src/index.tsx --host 0.0.0.0 &)

dev: dev-relay dev-server
	@echo "relay: ws://localhost:10547"
	@echo "app:    http://localhost:3000"
