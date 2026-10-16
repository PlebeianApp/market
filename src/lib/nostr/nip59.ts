/** @deprecated Import the signer-independent NIP-59 logic from `@sdk/core`. */
import type { NDKSigner } from '@nostr-dev-kit/ndk'
import type { Event } from 'nostr-tools'
import {
	createNip59GiftWrapWithSigner as sdkCreateNip59GiftWrapWithSigner,
	unwrapNip59GiftWrapWithSigner as sdkUnwrapNip59GiftWrapWithSigner,
	signerSupportsNip44 as sdkSignerSupportsNip44,
	type UnsignedRumor,
	type Nip59GiftWrap,
	type UnwrappedNip59GiftWrap,
	type Nip44SignerOperation,
} from '@sdk/core'
import { toEncryptingSigner } from './ndkEncryptingSigner'

export { NIP59_SEAL_KIND, NIP59_GIFT_WRAP_KIND, createNip59GiftWrap, unwrapNip59GiftWrap, normalizeUnsignedRumorId } from '@sdk/core'
export type {
	UnsignedRumor,
	Nip59GiftWrap,
	UnwrappedNip59GiftWrap,
	Nip44SignerOperation,
	CreateNip59GiftWrapParams,
	UnwrapNip59GiftWrapParams,
} from '@sdk/core'

export type CreateNip59GiftWrapWithSignerParams = {
	rumor: UnsignedRumor
	signer: NDKSigner | null | undefined
	recipientPubkey: string
	wrapperPrivateKey?: Uint8Array
	createdAt?: number
}

export type UnwrapNip59GiftWrapWithSignerParams = {
	giftWrap: Event
	signer: NDKSigner | null | undefined
	expectedRecipientPubkey?: string
	expectedSenderPubkey?: string
}

export async function createNip59GiftWrapWithSigner(params: CreateNip59GiftWrapWithSignerParams): Promise<Nip59GiftWrap> {
	return sdkCreateNip59GiftWrapWithSigner({
		...params,
		signer: params.signer ? toEncryptingSigner(params.signer) : params.signer,
	})
}

export async function unwrapNip59GiftWrapWithSigner(params: UnwrapNip59GiftWrapWithSignerParams): Promise<UnwrappedNip59GiftWrap> {
	return sdkUnwrapNip59GiftWrapWithSigner({
		...params,
		signer: params.signer ? toEncryptingSigner(params.signer) : params.signer,
	})
}

export async function signerSupportsNip44(signer: NDKSigner | null | undefined, operation: Nip44SignerOperation): Promise<boolean> {
	return sdkSignerSupportsNip44(signer ? toEncryptingSigner(signer) : signer, operation)
}
