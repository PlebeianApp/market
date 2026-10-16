import { decode } from 'light-bolt11-decoder'
import type { NostrEventLike } from '../../core/nostr/eventLike'

/** NIP-57 zap receipt kind. */
export const ZAP_RECEIPT_KIND = 9735

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type ZapReceiptFilter = {
	kinds: number[]
	authors: string[]
	limit?: number
	'#p'?: string[]
	'#e'?: string[]
}

/**
 * A provider-signed zap receipt as read from a relay. The amount is what the
 * receipt's bolt11 invoice claims; receipt presence is not settlement proof.
 */
export interface ZapReceiptRecord<E = NostrEventLike> {
	id: string
	amountMillisats: number
	message: string
	senderPubkey: string
	recipientPubkey: string
	providerPubkey?: string // nostr-pubkey of provider e.g. CoinOS, Alby
	targetEventId?: string
	targetEventKind?: number
	bolt11: string
	descriptionHash: string // SHA256 of the zap request
	createdAt: number
	rawEvent: E
}

export interface LnurlPayResponse {
	allowsNostr: boolean
	nostrPubkey: string
	callback: string
	minSendable: number
	maxSendable: number
	metadata: string
	tag: string
}

/** `lud16` from kind-0 content; throws on invalid JSON or non-object content. */
export function parseProfileLud16(profileContent: string): string | null {
	const content = JSON.parse(profileContent)
	return content.lud16 || null
}

/** LUD-16 well-known URL; throws on a lud16 without both name and domain. */
export function buildLnurlPayUrl(lud16: string): string {
	const [username, domain] = lud16.split('@')
	if (!username || !domain) throw new Error('Invalid lud16 format')
	return `https://${domain}/.well-known/lnurlp/${username}`
}

/** Throws unless the LNURL-pay response advertises NIP-57 support with a provider pubkey. */
export function assertLnurlAllowsNostr(data: LnurlPayResponse, lud16: string): LnurlPayResponse {
	if (!data.allowsNostr || !data.nostrPubkey) {
		throw new Error(`LNURL for ${lud16} does not support Nostr zaps`)
	}
	return data
}

/** Zap receipts signed by the provider, tagged to the recipient (and target event when given). */
export function buildProviderZapReceiptFilter(input: {
	providerPubkey: string
	recipientPubkey: string
	targetEventId?: string
}): ZapReceiptFilter {
	const filter: ZapReceiptFilter = {
		kinds: [ZAP_RECEIPT_KIND],
		authors: [input.providerPubkey],
		limit: 100,
	}
	filter['#p'] = [input.recipientPubkey]
	if (input.targetEventId) {
		filter['#e'] = [input.targetEventId]
	}
	return filter
}

/** Amount section of a bolt11 invoice, as the decoder reports it; undefined when absent. Throws on undecodable invoices. */
export function readBolt11AmountMillisats(bolt11: string): string | undefined {
	for (const section of decode(bolt11).sections) {
		if (section.name === 'amount') return section.value
	}
	return undefined
}

/**
 * Parse a provider zap receipt. Returns null when the bolt11 carries no amount;
 * throws when the bolt11 cannot be decoded.
 */
export function parseProviderZapReceipt<E extends NostrEventLike>(
	event: E,
	context: { recipientPubkey: string; targetEventId?: string },
): ZapReceiptRecord<E> | null {
	const senderPubkey = event.tags.find((t) => t[0] === 'P')?.[1] ?? ''
	const bolt11Tag = event.tags.find((t) => t[0] === 'bolt11')?.[1] ?? ''
	const eventId = event.tags.find((t) => t[0] === 'e')?.[1] ?? context.targetEventId

	const amountMillisatsRaw = readBolt11AmountMillisats(bolt11Tag)
	if (!amountMillisatsRaw) return null

	return {
		id: event.id,
		amountMillisats: parseInt(amountMillisatsRaw),
		message: event.content,
		senderPubkey,
		recipientPubkey: context.recipientPubkey,
		targetEventId: eventId,
		bolt11: bolt11Tag || '',
		createdAt: event.created_at || 0,
		rawEvent: event,
		providerPubkey: event.pubkey,
		descriptionHash: event.tags.find((t) => t[0] === 'bolt11')?.[2] || '',
	}
}

/** Newest first; sorts in place. */
export function sortZapReceiptsNewestFirst<Z extends { createdAt: number }>(zaps: Z[]): Z[] {
	return zaps.sort((a, b) => b.createdAt - a.createdAt)
}
