import type { Event } from 'nostr-tools'
import { dmRelaySourceFromEvents, resolveDmRelayTargets, wrapDm } from '../../core/dm/ts/index.ts'
import type { DmPublishPort, DmRelayListEvent, DmRelayTargets } from '../../core/dm/ts/index.ts'
import { createWorkflowError, WorkflowError } from '../../core/errors'
import type { EncryptingSigner } from '../../core/ports/encryptingSigner'
import { assertOrderMessageRumor, type OrderMessageRumor } from './orderMessageRumor'

export type Nip17OrderPublishTarget = 'recipient' | 'sender'

export type PublishNip17GiftWrapParams = {
	target: Nip17OrderPublishTarget
	relays: string[]
	giftWrap: Event
}

export type PublishNip17GiftWrapResult = unknown

type PublishNip17OrderMessageBaseParams = {
	rumor: OrderMessageRumor
	signer: EncryptingSigner
	recipientPubkey: string
	recipientRelayEvents: DmRelayListEvent[]
	senderRelayEvents: DmRelayListEvent[]
}

export type PublishNip17OrderMessageParams = PublishNip17OrderMessageBaseParams &
	(
		| { relay: DmPublishPort; publishGiftWrap?: never }
		| { relay?: never; publishGiftWrap: (params: PublishNip17GiftWrapParams) => Promise<PublishNip17GiftWrapResult> }
	)

export type PublishNip17OrderMessageResult = {
	rumorId: string
	recipientGiftWrapId: string
	senderGiftWrapId: string
	relayTargets: DmRelayTargets
}

export async function publishNip17OrderMessage(params: PublishNip17OrderMessageParams): Promise<PublishNip17OrderMessageResult> {
	let phase = 'validate_message'
	try {
		assertOrderMessageRumor(params.rumor)
		const publishGiftWrap =
			'publishGiftWrap' in params && params.publishGiftWrap
				? params.publishGiftWrap
				: async ({ relays, giftWrap }: PublishNip17GiftWrapParams) => {
						if (!('relay' in params) || !params.relay) throw new Error('NIP-17 order publishing requires a relay port')
						const result = await params.relay.publish(giftWrap, relays)
						return new Set(result.acceptedRelays)
					}

		const rumorRecipientPubkey = getOrderRumorRecipientPubkey(params.rumor)
		if (rumorRecipientPubkey !== params.recipientPubkey) {
			throw new Error('NIP-17 order rumor recipient does not match recipientPubkey')
		}

		const signerPubkey = await getSignerPubkey(params.signer)
		if (signerPubkey !== params.rumor.pubkey) {
			throw new Error('NIP-17 order rumor pubkey does not match signer pubkey')
		}

		// The relay targets are the dm component's — relay-config's `dmRelays` (kind 10050) for each side,
		// read over the library's validator and parser. No `10050` is parsed here and no `10002` is substituted.
		phase = 'resolve_relay_targets'
		const relayTargets = await resolveDmRelayTargets({
			relaySource: dmRelaySourceFromEvents([...params.recipientRelayEvents, ...params.senderRelayEvents]),
			senderPubkey: signerPubkey,
			recipientPubkey: params.recipientPubkey,
		})

		const senderRelays = relayTargets.sender
		const recipientRelays = relayTargets.recipient
		if (!senderRelays || !recipientRelays) {
			throw new Error('NIP-17 relay targets are not ready')
		}

		// The two gift wraps are the dm component's — the library's `sealRumor` + `wrapSeal` (fresh ephemeral author per wrap).
		phase = 'create_gift_wraps'
		const wraps = await wrapDm({
			rumor: params.rumor,
			signer: params.signer,
			recipientPubkey: params.recipientPubkey,
		})

		phase = 'publish_sender_wrap'
		await publishReadyGiftWrap({
			target: 'sender',
			relays: senderRelays,
			giftWrap: wraps.sender,
			publishGiftWrap,
		})

		phase = 'publish_recipient_wrap'
		await publishReadyGiftWrap({
			target: 'recipient',
			relays: recipientRelays,
			giftWrap: wraps.recipient,
			publishGiftWrap,
		})

		return {
			rumorId: wraps.rumor.id,
			recipientGiftWrapId: wraps.recipient.id,
			senderGiftWrapId: wraps.sender.id,
			relayTargets,
		}
	} catch (cause) {
		if (cause instanceof WorkflowError) throw cause
		throw createWorkflowError({
			workflow: 'nip17_order_publish',
			phase,
			status: phase.startsWith('publish_') ? 'uncertain' : 'failed',
			error: cause,
		})
	}
}

async function publishReadyGiftWrap(
	params: PublishNip17GiftWrapParams & {
		publishGiftWrap: (params: PublishNip17GiftWrapParams) => Promise<PublishNip17GiftWrapResult>
	},
): Promise<void> {
	const result = await params.publishGiftWrap({
		target: params.target,
		relays: params.relays,
		giftWrap: params.giftWrap,
	})

	if (publishResultHasRelayDetails(result) && !publishResultHasRelaySuccess(result)) {
		throw new Error(`NIP-17 ${params.target} gift wrap could not be published`)
	}
}

async function getSignerPubkey(signer: EncryptingSigner): Promise<string> {
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

function publishResultHasRelayDetails(result: unknown): boolean {
	return result instanceof Set || Array.isArray(result) || (typeof result === 'object' && result !== null && 'size' in result)
}

function publishResultHasRelaySuccess(result: unknown): boolean {
	if (result instanceof Set) return result.size > 0
	if (Array.isArray(result)) return result.length > 0
	if (typeof result === 'object' && result !== null && 'size' in result && typeof (result as { size?: unknown }).size === 'number') {
		return (result as { size: number }).size > 0
	}
	return true
}
