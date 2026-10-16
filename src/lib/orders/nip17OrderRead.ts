/** @deprecated Import NIP-17 order reading from `@sdk/commerce/messaging`. */
import type { NDKSigner } from '@nostr-dev-kit/ndk'
import type { Event } from 'nostr-tools'
import {
	unwrapNip17OrderMessage as sdkUnwrapNip17OrderMessage,
	unwrapNip17OrderMessages as sdkUnwrapNip17OrderMessages,
	type UnwrappedNip17OrderMessage,
} from '@sdk/commerce/messaging'
import { toEncryptingSigner } from '../nostr/ndkEncryptingSigner'

export type { Nip17OrderMessageDirection, UnwrappedNip17OrderMessage } from '@sdk/commerce/messaging'

export type UnwrapNip17OrderMessageParams = {
	giftWrap: Event
	signer: NDKSigner | null | undefined
}

export type UnwrapNip17OrderMessagesParams = {
	giftWraps: Event[]
	signer: NDKSigner | null | undefined
}

export async function unwrapNip17OrderMessage(params: UnwrapNip17OrderMessageParams): Promise<UnwrappedNip17OrderMessage> {
	return sdkUnwrapNip17OrderMessage({
		...params,
		signer: params.signer ? toEncryptingSigner(params.signer) : params.signer,
	})
}

export async function unwrapNip17OrderMessages(params: UnwrapNip17OrderMessagesParams): Promise<UnwrappedNip17OrderMessage[]> {
	return sdkUnwrapNip17OrderMessages({
		...params,
		signer: params.signer ? toEncryptingSigner(params.signer) : params.signer,
	})
}
