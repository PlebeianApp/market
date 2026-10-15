import type { Event } from 'nostr-tools'
import { unwrapDm } from '../../core/dm/ts/index.ts'
import type { EncryptingSigner } from '../../core/ports/encryptingSigner'
import { assertOrderMessageRumor, type OrderMessageRumor } from './orderMessageRumor'

export type Nip17OrderMessageDirection = 'sent' | 'received'

export type UnwrapNip17OrderMessageParams = {
	giftWrap: Event
	signer: EncryptingSigner | null | undefined
}

export type UnwrappedNip17OrderMessage = {
	giftWrap: Event
	seal: Event
	rumor: OrderMessageRumor
	direction: Nip17OrderMessageDirection
	userPubkey: string
	counterpartyPubkey: string
	recipientPubkey: string
}

export type UnwrapNip17OrderMessagesParams = {
	giftWraps: Event[]
	signer: EncryptingSigner | null | undefined
}

export async function unwrapNip17OrderMessage(params: UnwrapNip17OrderMessageParams): Promise<UnwrappedNip17OrderMessage> {
	const userPubkey = await getSignerPubkey(params.signer)

	// The NIP-59 unwrap is the dm component's — the library's `unlockGiftWrap`, through the seal, to the rumor.
	const { seal, rumor: rumorValue } = await unwrapDm({ giftWrap: params.giftWrap, signer: params.signer as EncryptingSigner })
	assertOrderMessageRumor(rumorValue)

	const rumor = rumorValue
	const recipientPubkey = getOrderRumorRecipientPubkey(rumor)
	const senderPubkey = rumor.pubkey

	const userIsSender = userPubkey === senderPubkey
	const userIsRecipient = userPubkey === recipientPubkey

	if (userIsSender === userIsRecipient) {
		throw new Error('NIP-17 order message must include the active user as exactly one side')
	}

	return {
		giftWrap: params.giftWrap,
		seal,
		rumor,
		direction: userIsSender ? 'sent' : 'received',
		userPubkey,
		counterpartyPubkey: userIsSender ? recipientPubkey : senderPubkey,
		recipientPubkey,
	}
}

export async function unwrapNip17OrderMessages(params: UnwrapNip17OrderMessagesParams): Promise<UnwrappedNip17OrderMessage[]> {
	const messagesByRumorId = new Map<string, UnwrappedNip17OrderMessage>()

	for (const giftWrap of params.giftWraps) {
		try {
			const message = await unwrapNip17OrderMessage({
				giftWrap,
				signer: params.signer,
			})

			if (!messagesByRumorId.has(message.rumor.id)) {
				messagesByRumorId.set(message.rumor.id, message)
			}
		} catch {
			// Relays can return malformed, unrelated, or undecryptable gift wraps.
			// Keep order reads best-effort and avoid leaking decrypted/ciphertext details.
		}
	}

	return Array.from(messagesByRumorId.values()).sort(compareUnwrappedNip17OrderMessages)
}

async function getSignerPubkey(signer: EncryptingSigner | null | undefined): Promise<string> {
	if (!signer) throw new Error('Signer pubkey unavailable')

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

function compareUnwrappedNip17OrderMessages(a: UnwrappedNip17OrderMessage, b: UnwrappedNip17OrderMessage): number {
	const createdAtDiff = a.rumor.created_at - b.rumor.created_at
	if (createdAtDiff !== 0) return createdAtDiff

	return a.rumor.id.localeCompare(b.rumor.id)
}
