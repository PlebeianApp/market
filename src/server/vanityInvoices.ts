import { Invoice } from '@getalby/lightning-tools'

export type PendingVanityInvoice = {
	bolt11: string
	paymentHash?: string
	amountSats: number
	vanityName: string
	requesterPubkey: string
	issuedAtSec: number
}

type ConfirmedVanityInvoice = PendingVanityInvoice & {
	confirmedAtSec: number
}

const pendingByBolt11 = new Map<string, PendingVanityInvoice>()
const confirmedByBolt11 = new Map<string, ConfirmedVanityInvoice>()

function nowSec() {
	return Math.floor(Date.now() / 1000)
}

function prune(map: Map<string, { issuedAtSec?: number; confirmedAtSec?: number }>, maxAgeSec: number) {
	const cutoff = nowSec() - maxAgeSec
	for (const [key, value] of map.entries()) {
		const ts = value.confirmedAtSec ?? value.issuedAtSec ?? 0
		if (ts < cutoff) map.delete(key)
	}
}

export function rememberPendingVanityInvoice(input: Omit<PendingVanityInvoice, 'paymentHash' | 'issuedAtSec'> & { issuedAtSec?: number }) {
	const bolt11 = input.bolt11
	if (!bolt11) throw new Error('bolt11 required')

	let paymentHash: string | undefined
	try {
		const invoice = new Invoice({ pr: bolt11 })
		paymentHash = invoice.paymentHash
	} catch {
		// Best-effort; preimage validation still works using invoice.validatePreimage.
		paymentHash = undefined
	}

	const entry: PendingVanityInvoice = {
		...input,
		bolt11,
		paymentHash,
		issuedAtSec: input.issuedAtSec ?? nowSec(),
	}

	pendingByBolt11.set(bolt11, entry)
	// Keep the confirmed map from growing forever
	prune(confirmedByBolt11, 60 * 60 * 6)
	// Keep pending from growing forever
	prune(pendingByBolt11, 60 * 60)
	return entry
}

export function getPendingVanityInvoice(bolt11: string): PendingVanityInvoice | null {
	return pendingByBolt11.get(bolt11) ?? null
}

export function confirmVanityInvoice(bolt11: string): PendingVanityInvoice | null {
	const pending = pendingByBolt11.get(bolt11)
	if (!pending) return null

	pendingByBolt11.delete(bolt11)

	confirmedByBolt11.set(bolt11, {
		...pending,
		confirmedAtSec: nowSec(),
	})

	// Avoid unbounded growth
	prune(confirmedByBolt11, 60 * 60 * 6)
	return pending
}

export function wasVanityInvoiceConfirmed(bolt11: string): boolean {
	return confirmedByBolt11.has(bolt11)
}

