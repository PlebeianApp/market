import { DEFAULT_PUBLIC_RELAYS } from '@/lib/constants'

/**
 * Operator-controlled relay set used by the AUTHORITY reads — the app-owned
 * events that decide what the app trusts: kind 30000 `d=admins` / `d=editors`,
 * kind 10000 blacklist, kind 31990 `d=plebeian-market-handler` app settings,
 * and the other app-published lists read through `fetchLatestAppEvent`.
 *
 * Those reads are already pinned to the app pubkey via `authors: [appPubkey]`,
 * so a relay cannot forge them — it can only serve a stale copy. Reading them
 * from a set the operator controls (instead of whatever relays a session
 * happens to have) bounds who can answer with a stale copy at all.
 *
 * When more than one operator relay is configured the app reads from all of
 * them: "always at least three relays" applies ONLY to relays the operator
 * controls. Third-party public relays are never part of this set, and
 * `buildOperatorRelayUrls` refuses them by name (see DEFAULT_PUBLIC_RELAYS)
 * rather than silently trusting one.
 *
 * Production today runs a single operator relay
 * (`MAIN_RELAY_BY_STAGE.production` = wss://relay.plebeian.market), so with the
 * default configuration `buildOperatorRelayUrls(mainRelay, [])` returns exactly
 * that one relay and the read behaviour is unchanged. Additional operator
 * relays stay empty until an operator configures them (see
 * ADDITIONAL_OPERATOR_RELAYS and the `operatorRelays` config field exposed by
 * `/api/config`), so nothing changes until a second operator relay exists.
 */

/**
 * Additional operator-controlled relays compiled into this deployment.
 * EMPTY BY DEFAULT — production configures extra operator relays through the
 * `OPERATOR_RELAYS` environment variable (comma-separated), which the server
 * exposes to the browser as `config.operatorRelays`.
 * Never add a third-party public relay here.
 */
export const ADDITIONAL_OPERATOR_RELAYS: readonly string[] = []

const WEBSOCKET_URL = /^wss?:\/\//i

function isWebsocketUrl(url: string): boolean {
	return WEBSOCKET_URL.test(url) && !/\s/.test(url)
}

/** Comparison key that ignores case and a trailing slash (REST-style relay urls). */
function relayKey(url: string): string {
	return url.trim().replace(/\/+$/, '').toLowerCase()
}

const PUBLIC_RELAY_KEYS = new Set(DEFAULT_PUBLIC_RELAYS.map(relayKey))

/** True for the third-party public relays this app reads general content from. */
export function isPublicThirdPartyRelay(url: string): boolean {
	return PUBLIC_RELAY_KEYS.has(relayKey(url))
}

/**
 * Normalise operator relay configuration (env string, config array, …) into a
 * de-duplicated list of websocket urls. Anything malformed is dropped rather
 * than thrown: a typo in deployment config must not take the app down.
 */
export function parseOperatorRelayUrls(value: unknown): string[] {
	const raw: unknown[] = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : []

	const urls: string[] = []
	for (const entry of raw) {
		if (typeof entry !== 'string') continue
		const url = entry.trim()
		if (!isWebsocketUrl(url)) continue
		if (!urls.includes(url)) urls.push(url)
	}

	return urls
}

/**
 * The operator-controlled relay set: the configured app relay first, then any
 * additional operator relays, de-duplicated.
 *
 * The app relay is always kept, even if it also appears in a public relay list
 * (it is operator-chosen). Additional relays that are third-party public relays
 * are refused with a warning — the authority set must stay operator-controlled.
 */
export function buildOperatorRelayUrls(mainRelay: string | undefined, additionalRelays: ReadonlyArray<string> = []): string[] {
	const urls: string[] = []

	const main = typeof mainRelay === 'string' ? mainRelay.trim() : ''
	if (isWebsocketUrl(main) && !urls.includes(main)) urls.push(main)

	for (const candidate of parseOperatorRelayUrls(additionalRelays)) {
		if (isPublicThirdPartyRelay(candidate)) {
			console.warn(`[operator-relays] ignoring third-party public relay in the operator set: ${candidate}`)
			continue
		}
		if (!urls.includes(candidate)) urls.push(candidate)
	}

	return urls
}
