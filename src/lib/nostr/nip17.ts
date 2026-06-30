import type { NDKSigner } from '@nostr-dev-kit/ndk'
import { createNip59GiftWrapWithSigner, type UnsignedRumor } from './nip59'

const NIP17_MAX_TIMESTAMP_RANDOMIZATION_SECONDS = 2 * 24 * 60 * 60

type Nip59SignerWrapResult = Awaited<ReturnType<typeof createNip59GiftWrapWithSigner>>

export type CreateNip17GiftWrapsWithSignerParams = {
	rumor: UnsignedRumor
	signer: NDKSigner
	recipientPubkey: string
	recipientWrapperPrivateKey?: Uint8Array
	senderWrapperPrivateKey?: Uint8Array
	createdAt?: number
}

export type Nip17GiftWrapsWithSignerResult = {
	rumor: Nip59SignerWrapResult['rumor']
	recipient: Nip59SignerWrapResult
	sender: Nip59SignerWrapResult
}

export function randomizeNip17CreatedAt(now = Math.floor(Date.now() / 1000), random = Math.random): number {
	const offset = Math.floor(random() * (NIP17_MAX_TIMESTAMP_RANDOMIZATION_SECONDS + 1))
	return now - offset
}

async function signerPubkey(signer: NDKSigner): Promise<string> {
	const user = await signer.user()
	if (!user?.pubkey) throw new Error('Signer pubkey unavailable')
	return user.pubkey
}

export async function createNip17GiftWrapsWithSigner(
	params: CreateNip17GiftWrapsWithSignerParams,
): Promise<Nip17GiftWrapsWithSignerResult> {
	const senderPubkey = await signerPubkey(params.signer)
	const createdAt = params.createdAt ?? randomizeNip17CreatedAt()

	const recipient = await createNip59GiftWrapWithSigner({
		rumor: params.rumor,
		signer: params.signer,
		recipientPubkey: params.recipientPubkey,
		wrapperPrivateKey: params.recipientWrapperPrivateKey,
		createdAt,
	})

	const sender = await createNip59GiftWrapWithSigner({
		rumor: recipient.rumor,
		signer: params.signer,
		recipientPubkey: senderPubkey,
		wrapperPrivateKey: params.senderWrapperPrivateKey,
		createdAt,
	})

	if (recipient.rumor.id !== sender.rumor.id) {
		throw new Error('NIP-17 gift wraps produced different rumor ids')
	}

	return {
		rumor: recipient.rumor,
		recipient,
		sender,
	}
}
