/**
 * Outbox-model policy for NDK (#1046).
 *
 * NDK's outbox model makes it discover and connect to extra merchant relays so
 * reads can fan out. That is desirable in production by default, but it must be
 * disabled:
 *   - in staging / development (it would pollute public relays with test data), and
 *   - in local-relay-only mode (test / e2e runs that must stay on the local relay).
 *
 * `disableOutbox` is the production kill-switch: when true, production can turn
 * the outbox model off via the `NEXT_PUBLIC_DISABLE_OUTBOX` env var without a
 * code change or redeploy. The Go relay (relay.plebeian.market) already carries
 * every marketplace event, so the 30–45 extra WebSocket connections the outbox
 * fan-out opens on every page load are wasted there and are a measurable source
 * of slow UI load times.
 *
 * Kept as a pure, store-free resolver so it can be unit-tested in isolation
 * without loading the NDK runtime.
 */

export interface EnableOutboxInput {
	stage: string | undefined
	/** Bun-side `LOCAL_RELAY_ONLY` flag (test / e2e runs). */
	localRelayOnly?: boolean
	/** Bun-side `NEXT_PUBLIC_DISABLE_OUTBOX` flag — production kill-switch. */
	disableOutbox?: boolean
}

/**
 * Resolve whether NDK's outbox model should be enabled.
 *
 * The outbox model is on only when: not explicitly disabled, in a production
 * stage, and not in local-relay-only mode. Behaviour is unchanged when
 * `disableOutbox` is omitted/false.
 */
export function computeEnableOutbox(input: EnableOutboxInput): boolean {
	const { stage, localRelayOnly, disableOutbox } = input
	return !disableOutbox && stage !== 'staging' && stage !== 'development' && !localRelayOnly
}
