import { getTokenMetadata } from '@cashu/cashu-ts'
import { normalizePaymentMintUrl } from '@sdk/core/extensions'

/**
 * Where marketplace-collected payments go (ADR-0023 §7.9). Platform redeems a seller's token here before running a
 * priced action, and refunds from here when the action fails. Implementations never log or return token contents.
 */
export interface CashuCollector {
	/** Mints whose tokens are accepted; tokens from any other mint are rejected unredeemed. */
	acceptedMints(): Promise<string[]>
	/** Redeems the token into the collector wallet. Throws when it is spent, invalid, or the wallet is unreachable. */
	receive(token: string): Promise<void>
	/** Creates a token for `amount` sats at `mint`, for change or a refund. */
	send(amount: number, mint: string): Promise<string>
}

export interface CollectorTokenCheck {
	ok: boolean
	reason?: 'malformed' | 'unit' | 'mint' | 'underpaid'
	mint?: string
	amount?: number
}

/** Reads a token's mint, unit, and amount without contacting the mint. */
export function checkCollectorToken(token: string, acceptedMints: readonly string[], price: number): CollectorTokenCheck {
	let metadata: { mint: string; unit: string; amount: number }
	try {
		metadata = getTokenMetadata(token)
	} catch {
		return { ok: false, reason: 'malformed' }
	}
	if (metadata.unit !== 'sat') return { ok: false, reason: 'unit' }
	const mint = acceptedMints.find((accepted) => normalizePaymentMintUrl(accepted) === normalizePaymentMintUrl(metadata.mint))
	if (!mint) return { ok: false, reason: 'mint' }
	if (!Number.isSafeInteger(metadata.amount) || metadata.amount < price)
		return { ok: false, reason: 'underpaid', mint, amount: metadata.amount }
	return { ok: true, mint, amount: metadata.amount }
}

type FetchLike = (
	url: string,
	init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<Response>

const MINTS_CACHE_MS = 60_000
const WALLET_TIMEOUT_MS = 15_000

/**
 * The local routstrd daemon's Cashu wallet as the collector, so collected sats directly fund Routstr inference.
 * Uses the daemon's wallet routes (`/wallet/mints`, `/wallet/receive/cashu`, `/wallet/send/cashu`), which are
 * unauthenticated: the URL must be loopback, and the daemon must never be exposed.
 */
export function createRoutstrdCollector(baseUrl: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): CashuCollector {
	const origin = new URL(baseUrl)
	if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
		throw new Error('The routstrd collector must be a loopback http URL')
	}
	let cached: { mints: string[]; at: number } | undefined

	async function call(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<Record<string, unknown>> {
		const response = await fetchImpl(new URL(path, origin).toString(), {
			method: init.method,
			headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: AbortSignal.timeout(WALLET_TIMEOUT_MS),
		})
		const body = (await response.json().catch(() => undefined)) as { output?: unknown } | undefined
		// The daemon's error text can echo request data, so only the status is surfaced.
		if (!response.ok) throw new Error(`routstrd wallet ${path} failed (${response.status})`)
		const output = body?.output
		return typeof output === 'object' && output !== null && !Array.isArray(output) ? (output as Record<string, unknown>) : {}
	}

	return {
		async acceptedMints() {
			if (cached && Date.now() - cached.at < MINTS_CACHE_MS) return cached.mints
			const output = await call('/wallet/mints', { method: 'GET' })
			const mints = Array.isArray(output.mints) ? output.mints.filter((mint): mint is string => typeof mint === 'string') : []
			cached = { mints, at: Date.now() }
			return mints
		},
		async receive(token) {
			await call('/wallet/receive/cashu', { method: 'POST', body: { token } })
		},
		async send(amount, mint) {
			const output = await call('/wallet/send/cashu', { method: 'POST', body: { amount, mintUrl: mint } })
			if (typeof output.token !== 'string' || !output.token.startsWith('cashu')) throw new Error('routstrd returned no token')
			return output.token
		},
	}
}
