/** @deprecated Import private order message logic from `@sdk/commerce/messaging`. */
import type { NDKSigner } from '@nostr-dev-kit/ndk'
import type { Event } from 'nostr-tools'
import {
	createEncryptedPrivateOrderMessageWithSigner as sdkCreateEncryptedPrivateOrderMessageWithSigner,
	decryptPrivateOrderMessageWithSigner as sdkDecryptPrivateOrderMessageWithSigner,
	type CreatePrivateOrderDetailsRumorParams,
	type DecryptedPrivateOrderMessage,
} from '@sdk/commerce/messaging'
import { toEncryptingSigner } from '../nostr/ndkEncryptingSigner'

export {
	createPrivateOrderDetailsRumor,
	createEncryptedPrivateOrderMessage,
	decryptPrivateOrderMessage,
	parsePrivateOrderDetailsRumor,
	serializeBuyerAddress,
} from '@sdk/commerce/messaging'
export type {
	PrivateOrderAddress,
	PrivateOrderDeliveryDetails,
	CreatePrivateOrderDetailsRumorParams,
	CreateEncryptedPrivateOrderMessageParams,
	DecryptPrivateOrderMessageParams,
	DecryptedPrivateOrderMessage,
} from '@sdk/commerce/messaging'

export type CreateEncryptedPrivateOrderMessageWithSignerParams = CreatePrivateOrderDetailsRumorParams & {
	signer: NDKSigner | null | undefined
	wrapperPrivateKey?: Uint8Array
}

export type DecryptPrivateOrderMessageWithSignerParams = {
	giftWrap: Event
	signer: NDKSigner | null | undefined
	expectedSellerPubkey?: string
	expectedBuyerPubkey?: string
}

export async function createEncryptedPrivateOrderMessageWithSigner(
	params: CreateEncryptedPrivateOrderMessageWithSignerParams,
): Promise<DecryptedPrivateOrderMessage & { giftWrap: Event }> {
	return sdkCreateEncryptedPrivateOrderMessageWithSigner({
		...params,
		signer: params.signer ? toEncryptingSigner(params.signer) : params.signer,
	})
}

export async function decryptPrivateOrderMessageWithSigner(
	params: DecryptPrivateOrderMessageWithSignerParams,
): Promise<DecryptedPrivateOrderMessage> {
	return sdkDecryptPrivateOrderMessageWithSigner({
		...params,
		signer: params.signer ? toEncryptingSigner(params.signer) : params.signer,
	})
}
