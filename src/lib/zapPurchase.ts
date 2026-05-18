import { NDKEvent } from '@nostr-dev-kit/ndk'
import type NDK from '@nostr-dev-kit/ndk'
import { ZAP_RELAYS } from '@/lib/constants'

// Builds a kind-9734 zap request with the correct tags,
export interface ZapPurchaseInvoiceOptions {
	ndk: NDK
	appPubkey: string
	appRelay: string
	zapLabel: string
	registryTag: string
	registryKey: string
	amountSats: number
}

export interface ZapPurchaseInvoiceResult {
	pr: string
	invoiceId: string
}

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

// Shared context every purchase helper needs.
export interface PurchaseContext {
	ndk: NDK
	appPubkey: string
	appRelay: string
}

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

export async function purchaseNip05ForPubkey(
	ctx: PurchaseContext,
	options: { username: string; amountSats: number },
): Promise<ZapPurchaseInvoiceResult> {
	return zapPurchase({
		...ctx,
		zapLabel: 'nip05-register',
		registryTag: 'nip05',
		registryKey: options.username.toLowerCase(),
		amountSats: options.amountSats,
	})
}
