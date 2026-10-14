import type { Event } from 'nostr-tools'
import { DM_GIFT_WRAP_KIND, DM_RELAYS_KIND, dmRelaySourceFromEvents, resolveDmRelayTargets, wrapDm } from '../../core/dm/ts/index.ts'
import type { DmRelayListEvent, DmRelayTargets } from '../../core/dm/ts/index.ts'
import { createWorkflowError, type WorkflowError } from '../../core/errors'
import type { EncryptingSigner } from '../../core/ports/encryptingSigner'
import { unwrapNip17OrderMessages, type UnwrappedNip17OrderMessage } from './nip17OrderRead'
import { assertOrderMessageRumor, type OrderMessageRumor } from './orderMessageRumor'

export type Nip17OrderTransportSigner = EncryptingSigner

export type Nip17OrderTransportTarget = 'sender' | 'recipient'

/** The `10050` fetch filter — a request shape, not a parse; the parse belongs to relay-config. */
type Nip17DmRelayListFilter = {
	kinds: [typeof DM_RELAYS_KIND]
	authors: [string]
	limit: 1
}

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
	kinds: [typeof DM_GIFT_WRAP_KIND]
	'#p': [string]
}

export type PublishNip17OrderTransportMessageParams = {
	rumor: OrderMessageRumor
	signer: Nip17OrderTransportSigner
	fetchRelayListEvents: (params: FetchNip17RelayListEventsParams) => Promise<DmRelayListEvent[]>
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
	failure: WorkflowError
}

export type Nip17OrderTransportGiftWrapAttempt = {
	target: Nip17OrderTransportTarget
	relays: string[]
	giftWrapId: string
	giftWrapKind: typeof DM_GIFT_WRAP_KIND
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
			relayTargets: DmRelayTargets | null
	  }
	| {
			status: 'wrap_failed'
			rumorId: string
			error: Nip17OrderTransportError
			relayTargets: DmRelayTargets
	  }
	| {
			status: 'sender_publish_failed'
			rumorId: string
			error: Nip17OrderTransportError
			relayTargets: DmRelayTargets
			sender: Nip17OrderTransportGiftWrapAttempt
	  }
	| {
			status: 'recipient_publish_failed'
			rumorId: string
			error: Nip17OrderTransportError
			relayTargets: DmRelayTargets
			sender: Nip17OrderTransportGiftWrapAttempt
			recipient: Nip17OrderTransportGiftWrapAttempt
	  }
	| {
			status: 'published'
			rumorId: string
			relayTargets: DmRelayTargets
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
		kinds: [DM_GIFT_WRAP_KIND],
		'#p': [activeUserPubkey],
	}
}

function buildNip17DmRelayListFilter(pubkey: string): Nip17DmRelayListFilter {
	return {
		kinds: [DM_RELAYS_KIND],
		authors: [pubkey],
		limit: 1,
	}
}

export async function publishNip17OrderTransportMessage(
	params: PublishNip17OrderTransportMessageParams,
): Promise<PublishNip17OrderTransportResult> {
	let recipientPubkey: string
	try {
		assertOrderMessageRumor(params.rumor)
		recipientPubkey = getOrderRumorRecipientPubkey(params.rumor)
	} catch (cause) {
		return validationFailed('invalid_order_message', cause)
	}

	let signerPubkey: string
	try {
		signerPubkey = await getSignerPubkey(params.signer)
	} catch (cause) {
		return validationFailed('signer_pubkey_unavailable', cause)
	}

	if (signerPubkey !== params.rumor.pubkey) {
		return validationFailed('signer_pubkey_mismatch', new Error('Signer pubkey does not match order rumor author'))
	}

	const senderFilter = buildNip17DmRelayListFilter(signerPubkey)
	const recipientFilter = buildNip17DmRelayListFilter(recipientPubkey)

	let senderEvents: DmRelayListEvent[]
	let recipientEvents: DmRelayListEvent[]
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
	} catch (cause) {
		return {
			status: 'relay_targets_failed',
			rumorId: params.rumor.id,
			error: transportError('relay_list_fetch_failed', 'fetch_relay_lists', cause),
			senderFilter,
			recipientFilter,
			relayTargets: null,
		}
	}

	// The relay targets are the dm component's — relay-config's `dmRelays` (kind 10050) for each side.
	const relayTargets = await resolveDmRelayTargets({
		relaySource: dmRelaySourceFromEvents([...senderEvents, ...recipientEvents]),
		senderPubkey: signerPubkey,
		recipientPubkey,
	})

	if (!relayTargets.ready || !relayTargets.sender || !relayTargets.recipient) {
		return {
			status: 'relay_targets_failed',
			rumorId: params.rumor.id,
			error: transportError('relay_targets_not_ready', 'resolve_relay_targets', new Error('NIP-17 relay targets are not ready')),
			senderFilter,
			recipientFilter,
			relayTargets,
		}
	}

	const senderRelays = relayTargets.sender
	const recipientRelays = relayTargets.recipient

	// The two gift wraps are the dm component's — the library's `sealRumor` + `wrapSeal`.
	let wraps: Awaited<ReturnType<typeof wrapDm>>
	try {
		wraps = await wrapDm({
			rumor: params.rumor,
			signer: params.signer,
			recipientPubkey,
		})
	} catch (cause) {
		return {
			status: 'wrap_failed',
			rumorId: params.rumor.id,
			error: transportError('gift_wrap_creation_failed', 'create_gift_wraps', cause),
			relayTargets,
		}
	}

	if (wraps.sender.kind !== DM_GIFT_WRAP_KIND || wraps.recipient.kind !== DM_GIFT_WRAP_KIND) {
		return {
			status: 'wrap_failed',
			rumorId: params.rumor.id,
			error: transportError('gift_wrap_creation_failed', 'validate_gift_wraps', new Error('Unexpected gift-wrap kind')),
			relayTargets,
		}
	}

	const sender = giftWrapRecord({
		target: 'sender',
		relays: senderRelays,
		giftWrap: wraps.sender,
	})
	const recipient = giftWrapRecord({
		target: 'recipient',
		relays: recipientRelays,
		giftWrap: wraps.recipient,
	})

	const senderPublished = await publishGiftWrap(params.publishGiftWrap, {
		target: 'sender',
		relays: senderRelays,
		giftWrap: wraps.sender,
	})

	if (!senderPublished) {
		return {
			status: 'sender_publish_failed',
			rumorId: wraps.rumor.id ?? params.rumor.id,
			error: transportError(
				'gift_wrap_publish_failed',
				'publish_sender_wrap',
				new Error('Sender gift-wrap publication was not acknowledged'),
				'uncertain',
			),
			relayTargets,
			sender,
		}
	}

	const recipientPublished = await publishGiftWrap(params.publishGiftWrap, {
		target: 'recipient',
		relays: recipientRelays,
		giftWrap: wraps.recipient,
	})

	if (!recipientPublished) {
		return {
			status: 'recipient_publish_failed',
			rumorId: wraps.rumor.id ?? params.rumor.id,
			error: transportError(
				'gift_wrap_publish_failed',
				'publish_recipient_wrap',
				new Error('Recipient gift-wrap publication was not acknowledged'),
				'uncertain',
			),
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

function validationFailed(code: Nip17OrderTransportError['code'], cause: unknown = new Error(code)): PublishNip17OrderTransportResult {
	return {
		status: 'validation_failed',
		error: transportError(code, 'validation', cause),
	}
}

function transportError(
	code: Nip17OrderTransportError['code'],
	phase: string,
	cause: unknown,
	status: 'failed' | 'uncertain' = 'failed',
): Nip17OrderTransportError {
	return { code, failure: createWorkflowError({ workflow: 'nip17_order_transport', phase, status, error: cause }) }
}

async function getSignerPubkey(signer: Nip17OrderTransportSigner): Promise<string> {
	const pubkey = await signer.getPublicKey()
	if (!pubkey) throw new Error('Signer pubkey unavailable')
	return pubkey
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
		giftWrapKind: DM_GIFT_WRAP_KIND,
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
