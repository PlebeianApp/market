/** @deprecated Import NIP-17 order transport from `@sdk/commerce/messaging`. */
import type { NDKSigner } from '@nostr-dev-kit/ndk'
import type { Event } from 'nostr-tools'
import {
	publishNip17OrderTransportMessage as sdkPublishNip17OrderTransportMessage,
	readNip17OrderTransportMessages as sdkReadNip17OrderTransportMessages,
	type FetchNip17RelayListEventsParams,
	type OrderMessageRumor,
	type PublishNip17OrderTransportGiftWrapParams,
	type PublishNip17OrderTransportResult,
	type Nip17OrderGiftWrapFilter,
	type ReadNip17OrderTransportMessagesResult,
} from '@sdk/commerce/messaging'
import { toEncryptingSigner } from '../nostr/ndkEncryptingSigner'

export {
	buildNip17OrderGiftWrapFilter,
	type Nip17OrderTransportTarget,
	type FetchNip17RelayListEventsParams,
	type PublishNip17OrderTransportGiftWrapParams,
	type Nip17OrderGiftWrapFilter,
	type Nip17OrderTransportError,
	type Nip17OrderTransportGiftWrapAttempt,
	type PublishNip17OrderTransportResult,
	type ReadNip17OrderTransportMessagesResult,
} from '@sdk/commerce/messaging'

export type Nip17OrderTransportSigner = NDKSigner

export type PublishNip17OrderTransportMessageParams = {
	rumor: OrderMessageRumor
	signer: Nip17OrderTransportSigner
	fetchRelayListEvents: (params: FetchNip17RelayListEventsParams) => Promise<import('@sdk/core').Nip17DmRelayListEvent[]>
	publishGiftWrap: (params: PublishNip17OrderTransportGiftWrapParams) => Promise<unknown>
	createdAt?: number
}

export type ReadNip17OrderTransportMessagesParams = {
	activeUserPubkey: string
	signer: Nip17OrderTransportSigner | null | undefined
	fetchGiftWraps: (filter: Nip17OrderGiftWrapFilter) => Promise<Event[]>
}

export async function publishNip17OrderTransportMessage(
	params: PublishNip17OrderTransportMessageParams,
): Promise<PublishNip17OrderTransportResult> {
	return sdkPublishNip17OrderTransportMessage({
		...params,
		signer: toEncryptingSigner(params.signer),
	})
}

export async function readNip17OrderTransportMessages(
	params: ReadNip17OrderTransportMessagesParams,
): Promise<ReadNip17OrderTransportMessagesResult> {
	return sdkReadNip17OrderTransportMessages({
		...params,
		signer: params.signer ? toEncryptingSigner(params.signer) : params.signer,
	})
}
