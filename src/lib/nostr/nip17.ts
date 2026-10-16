/** @deprecated Import the signer-independent NIP-17 logic from `@sdk/core`. */
import type { NDKSigner } from '@nostr-dev-kit/ndk'
import {
	createNip17GiftWrapsWithSigner as sdkCreateNip17GiftWrapsWithSigner,
	type UnsignedRumor,
	type Nip17GiftWrapsWithSignerResult,
} from '@sdk/core'
import { toEncryptingSigner } from './ndkEncryptingSigner'

export { randomizeNip17CreatedAt } from '@sdk/core'
export type { Nip17GiftWrapsWithSignerResult } from '@sdk/core'

export type CreateNip17GiftWrapsWithSignerParams = {
	rumor: UnsignedRumor
	signer: NDKSigner
	recipientPubkey: string
	recipientWrapperPrivateKey?: Uint8Array
	senderWrapperPrivateKey?: Uint8Array
	createdAt?: number
}

export async function createNip17GiftWrapsWithSigner(
	params: CreateNip17GiftWrapsWithSignerParams,
): Promise<Nip17GiftWrapsWithSignerResult> {
	return sdkCreateNip17GiftWrapsWithSigner({
		...params,
		signer: toEncryptingSigner(params.signer),
	})
}
