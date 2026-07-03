# Makefile — e2e benchmarking targets for the Plebeian Market test suite.
#
# These targets wrap scripts/e2e-benchmark.sh and scripts/e2e-benchmark-report.py
# so the whole team runs A/B backend comparisons and flake detection the same way.
#
# The runner exports NOSTR_BACKEND=ndk|applesauce on every Playwright run so the
# app can switch Nostr I/O adapters. NOTE: this only changes app behaviour once
# the branch under test actually reads NOSTR_BACKEND (e.g. via src/lib/nostr/
# io.ts); on plain `master` the app is NDK-only, so "applesauce" runs are
# NDK-equivalent until the adapter switch lands.
#
# Common targets:
#   make e2e-benchmark-all          all specs, 3x, both backends
#   make e2e-benchmark-ndk          all specs, 3x, NDK only
#   make e2e-benchmark-applesauce   all specs, 3x, applesauce only
#   make e2e-benchmark-quick        all specs, 1x, both backends (smoke)
#   make e2e-benchmark-spec SPEC=x  single spec, 5x, both backends
#   make e2e-benchmark-ab SPEC=x    single spec, 10x, both backends (A/B)
#   make e2e-benchmark-flaky        known-flaky specs, 5x, both backends
#   make e2e-benchmark-report       summarise the latest run
#
# See docs/e2e-benchmarking.md for the full guide.

.DEFAULT_GOAL := help
.PHONY: help e2e-benchmark-all e2e-benchmark-ndk e2e-benchmark-applesauce \
        e2e-benchmark-quick e2e-benchmark-spec e2e-benchmark-ab \
        e2e-benchmark-flaky e2e-benchmark-report

BENCH         := bash scripts/e2e-benchmark.sh
REPORT        := python3 scripts/e2e-benchmark-report.py
# Specs with a known flake history — revisit as the suite stabilises.
FLAKY_SPECS   := auth,cart,pii-exposure,payments

help: ## Show this help.
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-28s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

e2e-benchmark-all: ## All specs, 3x, both backends (full flake + A/B sweep).
	$(BENCH) --specs all --repeat 3 --backend both

e2e-benchmark-ndk: ## All specs, 3x, NDK backend only.
	$(BENCH) --specs all --repeat 3 --backend ndk

e2e-benchmark-applesauce: ## All specs, 3x, applesauce backend only.
	$(BENCH) --specs all --repeat 3 --backend applesauce

e2e-benchmark-quick: ## All specs, 1x, both backends (fast smoke; no flake signal).
	$(BENCH) --specs all --repeat 1 --backend both --no-strict

e2e-benchmark-spec: ## Single spec, 5x, both backends. Usage: make e2e-benchmark-spec SPEC=auth
	@test -n "$(SPEC)" || { echo "Usage: make e2e-benchmark-spec SPEC=<spec>"; exit 2; }
	$(BENCH) --specs $(SPEC) --repeat 5 --backend both

e2e-benchmark-ab: ## Single spec, 10x, both backends (statistical A/B compare). Usage: make e2e-benchmark-ab SPEC=cart
	@test -n "$(SPEC)" || { echo "Usage: make e2e-benchmark-ab SPEC=<spec>"; exit 2; }
	$(BENCH) --specs $(SPEC) --repeat 10 --backend both

e2e-benchmark-flaky: ## Known-flaky specs, 5x, both backends (flake regression watch).
	$(BENCH) --specs $(FLAKY_SPECS) --repeat 5 --backend both

e2e-benchmark-report: ## Summarise the latest benchmark run.
	$(REPORT)
