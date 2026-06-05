/**
 * @nostr-dev-kit/wallet's internal `publishWithRetry` invokes
 * `event.publish(relaySet)` without an `await` at its callers (see
 * `updateExternalState` / `createTokenEvent` in
 * `node_modules/@nostr-dev-kit/wallet/dist/index.js` around line 1340)
 * and on a failed publish schedules another retry via `setTimeout` —
 * also unawaited. The thrown `NDKPublishError` therefore escapes as an
 * **unhandled promise rejection**, which the Bun dev overlay surfaces
 * as a full-screen "Unhandled Promise Rejection" panel that interrupts
 * the bid UX.
 *
 * We can't fix this upstream from here (the wallet module owns the
 * call sites), and the failure is genuinely non-fatal for our flow: the
 * local wallet state is updated regardless of whether the kind-7375
 * token event propagates to a remote relay. So this module installs a
 * **narrowly-targeted** `window.unhandledrejection` listener that:
 *
 *   1. Matches only the specific NDK relay-publish failure shape
 *      (message contains "Not enough relays received the event" and
 *      the stack frame names `publishWithRetry`).
 *   2. Calls `event.preventDefault()` so the dev overlay doesn't pop.
 *   3. Logs a single console warning per minute (rate-limited to avoid
 *      spamming when the wallet's setTimeout retry loop fires every
 *      10s against a dead relay).
 *
 * Anything that doesn't match the wallet-publish shape falls through
 * untouched, so genuine programming errors still surface. If/when the
 * wallet module starts awaiting its internal publishes — or we pin a
 * version that does — this suppressor can be removed.
 */

const RATE_LIMIT_MS = 60_000

let installed = false
let lastWarnAt = 0

interface UnhandledRejectionLike {
	reason: unknown
	preventDefault: () => void
}

const matchesWalletPublishError = (reason: unknown): boolean => {
	if (!reason) return false
	const err = reason as { name?: string; message?: string; stack?: string }
	const message = err.message ?? String(reason)
	const stack = err.stack ?? ''
	const looksLikePublishError = message.includes('Not enough relays received the event') || err.name === 'NDKPublishError'
	// `publishWithRetry` is the wallet-internal frame that throws; if
	// it's in the stack we know the rejection came from the
	// unawaited-publish sharp edge described above.
	const fromWallet = stack.includes('publishWithRetry') || stack.includes('@nostr-dev-kit/wallet')
	return looksLikePublishError && fromWallet
}

const handleUnhandledRejection = (event: UnhandledRejectionLike): void => {
	if (!matchesWalletPublishError(event.reason)) return
	event.preventDefault()
	const now = Date.now()
	if (now - lastWarnAt < RATE_LIMIT_MS) return
	lastWarnAt = now
	const reason = event.reason as { message?: string }
	console.warn(
		`[wallet] Suppressed NDK publish error (wallet state event failed to reach a relay; local state is still correct). ` +
			`Details: ${reason?.message ?? 'unknown'}`,
	)
}

/**
 * Idempotent installer — safe under HMR / React StrictMode double-mount.
 */
export const installWalletPublishErrorSuppression = (): void => {
	if (installed) return
	if (typeof window === 'undefined') return
	installed = true
	window.addEventListener('unhandledrejection', handleUnhandledRejection as unknown as EventListener)
}
