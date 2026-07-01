import type { NDKSigner } from '@nostr-dev-kit/ndk'
import type { Event } from 'nostr-tools'
import { createNip17GiftWrapsWithSigner } from '../nostr/nip17'
import { resolveNip17RelayTargetsFromEvents, type Nip17DmRelayListEvent, type Nip17RelayTargetsResult } from '../nostr/nip17Relays'
import { assertOrderMessageRumor, type OrderMessageRumor } from './orderMessageRumor'

export type Nip17OrderPublishTarget = 'recipient' | 'sender'

export type PublishNip17GiftWrapParams = {
	target: Nip17OrderPublishTarget
	relays: string[]
	giftWrap: Event
}

export type PublishNip17GiftWrapResult = unknown

export type PublishNip17OrderMessageParams = {
	rumor: OrderMessageRumor
	signer: NDKSigner
	recipientPubkey: string
	recipientRelayEvents: Nip17DmRelayListEvent[]
	senderRelayEvents: Nip17DmRelayListEvent[]
	publishGiftWrap: (params: PublishNip17GiftWrapParams) => Promise<PublishNip17GiftWrapResult>
}

export type PublishNip17OrderMessageResult = {
	rumorId: string
	recipientGiftWrapId: string
	senderGiftWrapId: string
	relayTargets: Nip17RelayTargetsResult
}

export async function publishNip17OrderMessage(params: PublishNip17OrderMessageParams): Promise<PublishNip17OrderMessageResult> {
	assertOrderMessageRumor(params.rumor)

	const signerPubkey = await getSignerPubkey(params.signer)
	if (signerPubkey !== params.rumor.pubkey) {
		throw new Error('NIP-17 order rumor pubkey does not match signer pubkey')
	}

	const relayTargets = resolveNip17RelayTargetsFromEvents({
		recipientPubkey: params.recipientPubkey,
		senderPubkey: signerPubkey,
		recipientEvents: params.recipientRelayEvents,
		senderEvents: params.senderRelayEvents,
	})

	if (!relayTargets.ready || relayTargets.recipient.status !== 'ready' || relayTargets.sender.status !== 'ready') {
		throw new Error('NIP-17 relay targets are not ready')
	}

	const wraps = await createNip17GiftWrapsWithSigner({
		rumor: params.rumor,
		signer: params.signer,
		recipientPubkey: params.recipientPubkey,
	})

	await publishReadyGiftWrap({
		target: 'recipient',
		relays: relayTargets.recipient.relays,
		giftWrap: wraps.recipient.giftWrap,
		publishGiftWrap: params.publishGiftWrap,
	})

	await publishReadyGiftWrap({
		target: 'sender',
		relays: relayTargets.sender.relays,
		giftWrap: wraps.sender.giftWrap,
		publishGiftWrap: params.publishGiftWrap,
	})

	return {
		rumorId: wraps.rumor.id,
		recipientGiftWrapId: wraps.recipient.giftWrap.id,
		senderGiftWrapId: wraps.sender.giftWrap.id,
		relayTargets,
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

async function getSignerPubkey(signer: NDKSigner): Promise<string> {
	const user = await signer.user()
	if (!user?.pubkey) throw new Error('Signer pubkey unavailable')
	return user.pubkey
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
