import { DEFAULT_PUBLIC_RELAYS, MAIN_RELAY_BY_STAGE, ZAP_RELAYS, type Stage } from '@/lib/constants'

/**
 * Stage-aware relay policy. Pure functions only — no store reads,
 * no NDK instance access, no DOM/network side effects. Callers in
 * `stores/ndk.ts` resolve the inputs (stage + the app relay from
 * configStore) and pass them in.
 *
 * Why this lives in its own file:
 *   - keeps `stores/ndk.ts` focused on NDK lifecycle (init/connect/
 *     signer wiring) without 100+ lines of policy mixed in;
 *   - makes each rule unit-testable in isolation — feed in
 *     `(stage, appRelay, ...)` and assert the output;
 *   - matches the way the policy gets used (computed once at boot
 *     + every time the watchdog re-evaluates), so co-locating the
 *     three resolvers helps future-me see the whole picture.
 *
 * Browser stages and what each one wants:
 *   - `production`: app relay + DEFAULT_PUBLIC_RELAYS for reads;
 *     all connected relays for writes (NDK default — return
 *     `undefined` for the write set so NDK fans out).
 *   - `staging` (covers auctionsdev and staging): app relay only
 *     for both reads and writes. We MUST NOT leak staging events
 *     to public discovery relays.
 *   - `development`: app relay only (typically `ws://localhost:10547`).
 *     Same reasoning as staging.
 *
 * The Bun server runtime also calls these with `LOCAL_RELAY_ONLY=true`
 * — `computeRelayUrls` accepts that flag explicitly rather than
 * sniffing `Bun.env` from inside the policy.
 */

export interface NdkConfigComputed {
	/** Read relays — what NDK subscribes to and uses for fetchEvents fan-out. */
	explicitRelayUrls: string[]
	/** Write relays — staging/dev confine writes to the app relay only. */
	writeRelayUrls: string[]
	/** NDK outbox model — disabled in non-prod to keep relay discovery off. */
	enableOutbox: boolean
}

export interface ComputeNdkConfigInput {
	stage: Stage | undefined
	/** Server-provided app relay from `/api/config` (preferred over stage defaults). */
	appRelay?: string
	/** Caller-supplied relay overrides (used during NDK re-init / tests). */
	overrideRelays?: string[]
	/** Bun-side flag forcing local-relay-only behavior. */
	localRelayOnly?: boolean
}

/**
 * Resolve the main app relay for a stage. Returns `undefined` when
 * config isn't loaded yet (`stage === undefined`) — callers should
 * treat that as "boot hasn't finished, don't assume a default."
 */
export function resolveMainRelay(stage: Stage | undefined, appRelay?: string): string | undefined {
	if (appRelay) return appRelay // Server-provided takes precedence
	if (!stage) return undefined
	return MAIN_RELAY_BY_STAGE[stage]
}

/**
 * Resolve the full read-relay set, write-relay set, and outbox flag
 * in one pass — these three derive from the same inputs and are
 * always computed together at NDK init time.
 */
export function computeNdkConfig(input: ComputeNdkConfigInput): NdkConfigComputed {
	const { stage, appRelay, overrideRelays, localRelayOnly } = input
	const mainRelay = resolveMainRelay(stage, appRelay)

	const enableOutbox = stage !== 'staging' && stage !== 'development' && !localRelayOnly

	const explicitRelayUrls = resolveExplicitRelays({ stage, mainRelay, overrideRelays, localRelayOnly })
	const writeRelayUrls =
		stage === 'staging' || stage === 'development' || localRelayOnly
			? mainRelay
				? [mainRelay]
				: []
			: explicitRelayUrls

	return { explicitRelayUrls, writeRelayUrls, enableOutbox }
}

/**
 * Read-relay set only (kept as a separate export because the watchdog
 * recomputes this on every visibility/health check without needing the
 * write set or outbox flag).
 */
export function resolveExplicitRelays(input: {
	stage: Stage | undefined
	mainRelay: string | undefined
	overrideRelays?: string[]
	localRelayOnly?: boolean
}): string[] {
	const { stage, mainRelay, overrideRelays, localRelayOnly } = input

	// Stage-locked: development & local-only mode use the main relay only.
	// AUCTIONS.md §11.0.1: dev/staging events MUST NOT reach public relays.
	if (stage === 'development' && mainRelay) return [mainRelay]
	if (localRelayOnly && mainRelay) return [mainRelay]

	// Override relays come from the caller (re-init paths, tests). Include
	// the main relay too — keeps the app relay reachable when callers add
	// a custom set.
	if (overrideRelays?.length) {
		const relays = mainRelay ? [mainRelay, ...overrideRelays] : overrideRelays
		return Array.from(new Set(relays))
	}

	// Default (production browser): main relay + the public read set.
	const relays = mainRelay ? [mainRelay, ...DEFAULT_PUBLIC_RELAYS] : DEFAULT_PUBLIC_RELAYS
	return Array.from(new Set(relays))
}

/**
 * Zap-monitoring NDK uses a wider relay set — LSPs broadcast zap
 * receipts to their own public relays, not to ours. Always returns
 * the union of ZAP_RELAYS + whatever the main read set is.
 */
export function resolveZapRelays(explicitRelays: string[]): string[] {
	return Array.from(new Set([...ZAP_RELAYS, ...explicitRelays]))
}
