import { NDKEvent } from '@nostr-dev-kit/ndk'
import type NDK from '@nostr-dev-kit/ndk'
import { ZAP_RELAYS } from '@/lib/constants'

/**
 *
 * Builds a kind-9734 zap request with the correct tags,
 * signs it via NDK, and POSTs to the generic `/api/zapPurchase`
 * endpoint which resolves the right `ZapPurchaseManager` automatically.
 */
export interface ZapPurchaseInvoiceOptions {
	ndk: NDK
	appPubkey: string
	appRelay: string
	zapLabel: string //L-tag label identifying this purchase type (e.g. "vanity-register")
	registryTag: string //tag name for registry key in the zap request (e.g. "vanity")
	registryKey: string //The actual registry key value (e.g. "alice-store")
	amountSats: number
}

export interface ZapPurchaseInvoiceResult {
	pr: string // BOLT11 payment request

	invoiceId: string // Client-generated invoice identifier for tracking
}

/**
 * Create a signed zap request and request a Lightning invoice from the server.
 *
 * This is the client-side counterpart to `ZapPurchaseManager.generateInvoice()`.
 * The server route auto-resolves the correct manager from the zap request's L tag,
 * so callers only need to provide the purchase-specific parameters.
 *
 * @example
 * // Vanity URL purchase
 * const { pr, invoiceId } = await zapPurchase({
 *   ndk,
 *   appPubkey: config.appPublicKey,
 *   appRelay: config.appRelay,
 *   zapLabel: 'vanity-register',
 *   registryTag: 'vanity',
 *   registryKey: 'my-shop',
 *   amountSats: 10000,
 * })
 *
 */
export async function zapPurchase(opts: ZapPurchaseInvoiceOptions): Promise<ZapPurchaseInvoiceResult> {
	const { ndk, appPubkey, appRelay, zapLabel, registryTag, registryKey, amountSats } = opts

	// Build and sign a kind-9734 zap request
	const zapRequest = new NDKEvent(ndk)
	zapRequest.kind = 9734
	zapRequest.content = ''
	zapRequest.tags = [
		['p', appPubkey],
		['amount', (amountSats * 1000).toString()],
		['L', zapLabel],
		[registryTag, registryKey],
		['relays', ...Array.from(new Set([appRelay, ...ZAP_RELAYS].filter(Boolean)))],
	]

	await zapRequest.sign()

	const invoiceId = `${zapLabel}-${registryKey}-${amountSats}-${Date.now()}`

	// POST to the generic zap purchase invoice endpoint
	const res = await fetch('/api/zapPurchase', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			amountSats,
			registryKey,
			zapRequest: zapRequest.rawEvent(),
		}),
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(text || `Failed to create invoice (${res.status})`)
	}

	const data = (await res.json()) as { pr?: string; error?: string }
	if (!data.pr) {
		throw new Error(data.error || 'Failed to create invoice')
	}

	return { pr: data.pr, invoiceId }
}

// ── Domain-specific purchase helpers ─────────────────────────
// Thin wrappers that hide zapLabel/registryTag details.
// Each purchase type exposes a simple (ctx, options) signature.

/**
 * Shared context every purchase helper needs.
 */
export interface PurchaseContext {
	ndk: NDK
	appPubkey: string
	appRelay: string
}

/**
 * Purchase a vanity URL for a pubkey.
 *
 * @example
 * const invoice = await purchaseVanityForPubkey(
 *   { ndk, appPubkey, appRelay },
 *   { name: 'my-shop', amountSats: 10000 },
 * )
 */
export async function purchaseVanityForPubkey(
	ctx: PurchaseContext,
	options: { name: string; amountSats: number },
): Promise<ZapPurchaseInvoiceResult> {
	return zapPurchase({
		...ctx,
		zapLabel: 'vanity-register',
		registryTag: 'vanity',
		registryKey: options.name.toLowerCase(),
		amountSats: options.amountSats,
	})
}
