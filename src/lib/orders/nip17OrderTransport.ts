import type { Event } from 'nostr-tools'
import { createNip17GiftWrapsWithSigner } from '../nostr/nip17'
import { NIP59_GIFT_WRAP_KIND } from '../nostr/nip59'
import {
	buildNip17DmRelayListFilter,
	resolveNip17RelayTargetsFromEvents,
	type Nip17DmRelayListEvent,
	type Nip17DmRelayListFilter,
	type Nip17RelayTargetsResult,
} from '../nostr/nip17Relays'
import { unwrapNip17OrderMessages, type UnwrappedNip17OrderMessage } from './nip17OrderRead'
import { assertOrderMessageRumor, type OrderMessageRumor } from './orderMessageRumor'

export type Nip17OrderTransportSigner = Parameters<typeof createNip17GiftWrapsWithSigner>[0]['signer']

export type Nip17OrderTransportTarget = 'sender' | 'recipient'

export type FetchNip17RelayListEventsParams = {
	target: Nip17OrderTransportTarget
	pubkey: string
	filter: Nip17DmRelayListFilter
}

export type PublishNip17OrderTransportGiftWrapParams = {
	target: Nip17OrderTransportTarget
	relays: string[]
	giftWrap: Event
}

export type Nip17OrderGiftWrapFilter = {
	kinds: [typeof NIP59_GIFT_WRAP_KIND]
	'#p': [string]
}

export type PublishNip17OrderTransportMessageParams = {
	rumor: OrderMessageRumor
	signer: Nip17OrderTransportSigner
	fetchRelayListEvents: (params: FetchNip17RelayListEventsParams) => Promise<Nip17DmRelayListEvent[]>
	publishGiftWrap: (params: PublishNip17OrderTransportGiftWrapParams) => Promise<unknown>
	createdAt?: number
}

export type Nip17OrderTransportError = {
	code:
		| 'invalid_order_message'
		| 'signer_pubkey_unavailable'
		| 'signer_pubkey_mismatch'
		| 'relay_list_fetch_failed'
		| 'relay_targets_not_ready'
		| 'gift_wrap_creation_failed'
		| 'gift_wrap_publish_failed'
}

export type Nip17OrderTransportGiftWrapAttempt = {
	target: Nip17OrderTransportTarget
	relays: string[]
	giftWrapId: string
	giftWrapKind: typeof NIP59_GIFT_WRAP_KIND
	wrapRecipientPubkey: string
}

export type PublishNip17OrderTransportResult =
	| {
			status: 'validation_failed'
			error: Nip17OrderTransportError
	  }
	| {
			status: 'relay_targets_failed'
			rumorId: string
			error: Nip17OrderTransportError
			senderFilter: Nip17DmRelayListFilter
			recipientFilter: Nip17DmRelayListFilter
			relayTargets: Nip17RelayTargetsResult | null
	  }
	| {
			status: 'wrap_failed'
			rumorId: string
			error: Nip17OrderTransportError
			relayTargets: Nip17RelayTargetsResult
	  }
	| {
			status: 'sender_publish_failed'
			rumorId: string
			error: Nip17OrderTransportError
			relayTargets: Nip17RelayTargetsResult
			sender: Nip17OrderTransportGiftWrapAttempt
	  }
	| {
			status: 'recipient_publish_failed'
			rumorId: string
			error: Nip17OrderTransportError
			relayTargets: Nip17RelayTargetsResult
			sender: Nip17OrderTransportGiftWrapAttempt
			recipient: Nip17OrderTransportGiftWrapAttempt
	  }
	| {
			status: 'published'
			rumorId: string
			relayTargets: Nip17RelayTargetsResult
			sender: Nip17OrderTransportGiftWrapAttempt
			recipient: Nip17OrderTransportGiftWrapAttempt
	  }

export type ReadNip17OrderTransportMessagesParams = {
	activeUserPubkey: string
	signer: Nip17OrderTransportSigner | null | undefined
	fetchGiftWraps: (filter: Nip17OrderGiftWrapFilter) => Promise<Event[]>
}

export type ReadNip17OrderTransportMessagesResult = {
	filter: Nip17OrderGiftWrapFilter
	messages: UnwrappedNip17OrderMessage[]
}

export function buildNip17OrderGiftWrapFilter(activeUserPubkey: string): Nip17OrderGiftWrapFilter {
	return {
		kinds: [NIP59_GIFT_WRAP_KIND],
		'#p': [activeUserPubkey],
	}
}

export async function publishNip17OrderTransportMessage(
	params: PublishNip17OrderTransportMessageParams,
): Promise<PublishNip17OrderTransportResult> {
	let recipientPubkey: string
	try {
		assertOrderMessageRumor(params.rumor)
		recipientPubkey = getOrderRumorRecipientPubkey(params.rumor)
	} catch {
		return validationFailed('invalid_order_message')
	}

	let signerPubkey: string
	try {
		signerPubkey = await getSignerPubkey(params.signer)
	} catch {
		return validationFailed('signer_pubkey_unavailable')
	}

	if (signerPubkey !== params.rumor.pubkey) {
		return validationFailed('signer_pubkey_mismatch')
	}

	const senderFilter = buildNip17DmRelayListFilter(signerPubkey)
	const recipientFilter = buildNip17DmRelayListFilter(recipientPubkey)

	let senderEvents: Nip17DmRelayListEvent[]
	let recipientEvents: Nip17DmRelayListEvent[]
	try {
		senderEvents = await params.fetchRelayListEvents({
			target: 'sender',
			pubkey: signerPubkey,
			filter: senderFilter,
		})
		recipientEvents = await params.fetchRelayListEvents({
			target: 'recipient',
			pubkey: recipientPubkey,
			filter: recipientFilter,
		})
	} catch {
		return {
			status: 'relay_targets_failed',
			rumorId: params.rumor.id,
			error: { code: 'relay_list_fetch_failed' },
			senderFilter,
			recipientFilter,
			relayTargets: null,
		}
	}

	const relayTargets = resolveNip17RelayTargetsFromEvents({
		recipientPubkey,
		senderPubkey: signerPubkey,
		recipientEvents,
		senderEvents,
	})

	if (!relayTargets.ready || relayTargets.recipient.status !== 'ready' || relayTargets.sender.status !== 'ready') {
		return {
			status: 'relay_targets_failed',
			rumorId: params.rumor.id,
			error: { code: 'relay_targets_not_ready' },
			senderFilter,
			recipientFilter,
			relayTargets,
		}
	}

	let wraps: Awaited<ReturnType<typeof createNip17GiftWrapsWithSigner>>
	try {
		wraps = await createNip17GiftWrapsWithSigner({
			rumor: params.rumor,
			signer: params.signer,
			recipientPubkey,
			createdAt: params.createdAt,
		})
	} catch {
		return {
			status: 'wrap_failed',
			rumorId: params.rumor.id,
			error: { code: 'gift_wrap_creation_failed' },
			relayTargets,
		}
	}

	if (wraps.sender.giftWrap.kind !== NIP59_GIFT_WRAP_KIND || wraps.recipient.giftWrap.kind !== NIP59_GIFT_WRAP_KIND) {
		return {
			status: 'wrap_failed',
			rumorId: params.rumor.id,
			error: { code: 'gift_wrap_creation_failed' },
			relayTargets,
		}
	}

	const sender = giftWrapRecord({
		target: 'sender',
		relays: relayTargets.sender.relays,
		giftWrap: wraps.sender.giftWrap,
	})
	const recipient = giftWrapRecord({
		target: 'recipient',
		relays: relayTargets.recipient.relays,
		giftWrap: wraps.recipient.giftWrap,
	})

	const senderPublished = await publishGiftWrap(params.publishGiftWrap, {
		target: 'sender',
		relays: relayTargets.sender.relays,
		giftWrap: wraps.sender.giftWrap,
	})

	if (!senderPublished) {
		return {
			status: 'sender_publish_failed',
			rumorId: wraps.rumor.id ?? params.rumor.id,
			error: { code: 'gift_wrap_publish_failed' },
			relayTargets,
			sender,
		}
	}

	const recipientPublished = await publishGiftWrap(params.publishGiftWrap, {
		target: 'recipient',
		relays: relayTargets.recipient.relays,
		giftWrap: wraps.recipient.giftWrap,
	})

	if (!recipientPublished) {
		return {
			status: 'recipient_publish_failed',
			rumorId: wraps.rumor.id ?? params.rumor.id,
			error: { code: 'gift_wrap_publish_failed' },
			relayTargets,
			sender,
			recipient,
		}
	}

	return {
		status: 'published',
		rumorId: wraps.rumor.id ?? params.rumor.id,
		relayTargets,
		sender,
		recipient,
	}
}

export async function readNip17OrderTransportMessages(
	params: ReadNip17OrderTransportMessagesParams,
): Promise<ReadNip17OrderTransportMessagesResult> {
	const filter = buildNip17OrderGiftWrapFilter(params.activeUserPubkey)
	const giftWraps = await params.fetchGiftWraps(filter)
	const messages = await unwrapNip17OrderMessages({
		giftWraps,
		signer: params.signer,
	})

	return {
		filter,
		messages,
	}
}

function validationFailed(code: Nip17OrderTransportError['code']): PublishNip17OrderTransportResult {
	return {
		status: 'validation_failed',
		error: { code },
	}
}

async function getSignerPubkey(signer: Nip17OrderTransportSigner): Promise<string> {
	const user = await signer.user()
	if (!user?.pubkey) throw new Error('Signer pubkey unavailable')
	return user.pubkey
}

function getOrderRumorRecipientPubkey(rumor: OrderMessageRumor): string {
	const recipientTags = rumor.tags.filter((tag) => tag[0] === 'p')

	if (recipientTags.length !== 1 || typeof recipientTags[0]?.[1] !== 'string' || recipientTags[0][1].length === 0) {
		throw new Error('NIP-17 order rumor must have exactly one recipient p tag')
	}

	return recipientTags[0][1]
}

function giftWrapRecord(params: PublishNip17OrderTransportGiftWrapParams): Nip17OrderTransportGiftWrapAttempt {
	return {
		target: params.target,
		relays: [...params.relays],
		giftWrapId: params.giftWrap.id,
		giftWrapKind: NIP59_GIFT_WRAP_KIND,
		wrapRecipientPubkey: getGiftWrapRecipientPubkey(params.giftWrap),
	}
}

function getGiftWrapRecipientPubkey(giftWrap: Event): string {
	return giftWrap.tags.find((tag) => tag[0] === 'p')?.[1] ?? ''
}

async function publishGiftWrap(
	publish: (params: PublishNip17OrderTransportGiftWrapParams) => Promise<unknown>,
	params: PublishNip17OrderTransportGiftWrapParams,
): Promise<boolean> {
	try {
		const result = await publish({
			target: params.target,
			relays: params.relays,
			giftWrap: params.giftWrap,
		})

		return publishResultHasRelaySuccess(result)
	} catch {
		return false
	}
}

function publishResultHasRelaySuccess(result: unknown): boolean {
	if (result instanceof Set) return result.size > 0
	if (Array.isArray(result)) return result.length > 0
	if (typeof result === 'object' && result !== null && 'size' in result && typeof (result as { size?: unknown }).size === 'number') {
		return (result as { size: number }).size > 0
	}
	return true
}
