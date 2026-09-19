import { verifyEvent } from 'nostr-tools'
import type { FetchOptions, NostrEvent, NostrFilter, NostrIo } from '../nostr/io'
import {
	NIP17_DM_RELAY_LIST_KIND,
	buildNip17DmRelayListFilter,
	resolveNip17DmRelayListFromEvents,
	type Nip17DmRelayListEvent,
} from '../nostr/nip17Relays'
import { NIP59_GIFT_WRAP_KIND, signerSupportsNip44 } from '../nostr/nip59'
import { ORDER_GENERAL_KIND } from '../schemas/order'
import { unwrapNip17OrderMessages, type UnwrappedNip17OrderMessage } from './nip17OrderRead'
import type { Nip17OrderTransportSigner } from './nip17OrderTransport'

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/
const LOWERCASE_EVENT_ID_RE = /^[0-9a-f]{64}$/
const DEFAULT_GIFT_WRAP_LIMIT = 500
const MAX_GIFT_WRAP_LIMIT = 500

type IndexedGiftWrap = {
	event: NostrEvent
	index: number
	usable: boolean
}

type AvailableNip17OrderTransportSigner = NonNullable<Nip17OrderTransportSigner>

type SignerIdentityCheck = { status: 'ready'; pubkey: string } | { status: 'unavailable' } | { status: 'mismatch' }

type SignerIdentityFailure = Exclude<SignerIdentityCheck['status'], 'ready'>

type IdentityBoundSigner = {
	signer: AvailableNip17OrderTransportSigner
	getLatchedFailure: () => SignerIdentityFailure | undefined
}

type Nip17OrderChatInboxFilter = NostrFilter & {
	kinds: [typeof NIP59_GIFT_WRAP_KIND]
	'#p': [string]
	limit: number
}

export type ReadNip17OrderChatInboxErrorCode =
	| 'invalid_active_user'
	| 'invalid_counterparty'
	| 'invalid_limit'
	| 'invalid_timeout'
	| 'signer_unavailable'
	| 'signer_pubkey_mismatch'
	| 'nip44_decrypt_unavailable'
	| 'relay_list_fetch_failed'
	| 'relay_list_missing'
	| 'relay_list_empty'
	| 'gift_wrap_fetch_failed'

export type ReadNip17OrderChatInboxParams = {
	activeUserPubkey: string
	signer: Nip17OrderTransportSigner | null | undefined
	fetchEvents: NostrIo['fetchEvents']
	discoveryRelayUrls?: string[]
	counterpartyPubkey?: string
	giftWrapLimit?: number
	timeoutMs?: number
}

export type ReadNip17OrderChatInboxResult =
	| {
			status: 'ready'
			relayUrls: string[]
			messages: UnwrappedNip17OrderMessage[]
	  }
	| {
			status: 'failed'
			error: {
				code: ReadNip17OrderChatInboxErrorCode
			}
			messages: []
	  }

export async function readNip17OrderChatInbox(params: ReadNip17OrderChatInboxParams): Promise<ReadNip17OrderChatInboxResult> {
	const activeUserPubkey = params.activeUserPubkey
	const counterpartyPubkey = params.counterpartyPubkey

	if (!isHexPubkey(activeUserPubkey)) return failed('invalid_active_user')
	if (counterpartyPubkey !== undefined && !isHexPubkey(counterpartyPubkey)) {
		return failed('invalid_counterparty')
	}

	const giftWrapLimit = params.giftWrapLimit ?? DEFAULT_GIFT_WRAP_LIMIT
	if (!isPositiveSafeInteger(giftWrapLimit) || giftWrapLimit > MAX_GIFT_WRAP_LIMIT) {
		return failed('invalid_limit')
	}
	if (params.timeoutMs !== undefined && !isPositiveSafeInteger(params.timeoutMs)) {
		return failed('invalid_timeout')
	}

	const initialSignerIdentity = await classifySignerIdentity(params.signer, activeUserPubkey)
	const initialSignerFailure = signerIdentityFailureResult(initialSignerIdentity)
	if (initialSignerFailure) return initialSignerFailure
	if (!(await signerSupportsNip44(params.signer, 'decrypt'))) {
		return failed('nip44_decrypt_unavailable')
	}

	const relayListFilter = buildNip17DmRelayListFilter(activeUserPubkey)
	let relayListCandidates: NostrEvent[]
	try {
		relayListCandidates = await params.fetchEvents(relayListFilter, fetchOptions(params.discoveryRelayUrls, params.timeoutMs))
	} catch {
		return failed('relay_list_fetch_failed')
	}

	const verifiedRelayListEvents: Nip17DmRelayListEvent[] = []
	for (const candidate of relayListCandidates) {
		const verifiedEvent = verifyAndNarrowRelayListEvent(candidate, activeUserPubkey)
		if (verifiedEvent) verifiedRelayListEvents.push(verifiedEvent)
	}
	const relayList = resolveNip17DmRelayListFromEvents(verifiedRelayListEvents, activeUserPubkey)

	if (relayList.status === 'missing') return failed('relay_list_missing')
	if (relayList.status === 'empty') return failed('relay_list_empty')

	const giftWrapFilter = buildNip17OrderChatInboxFilter(activeUserPubkey, giftWrapLimit)
	let giftWraps: NostrEvent[]
	try {
		giftWraps = await params.fetchEvents(giftWrapFilter, fetchOptions(relayList.relays, params.timeoutMs))
	} catch {
		return failed('gift_wrap_fetch_failed')
	}

	const preUnwrapSignerIdentity = await classifySignerIdentity(params.signer, activeUserPubkey)
	const preUnwrapSignerFailure = signerIdentityFailureResult(preUnwrapSignerIdentity)
	if (preUnwrapSignerFailure) return preUnwrapSignerFailure

	const identityBoundSigner = createIdentityBoundSigner(params.signer as AvailableNip17OrderTransportSigner, activeUserPubkey)
	const admittedGiftWraps = admitGiftWraps(giftWraps, giftWrapLimit)
	const unwrapped = await unwrapNip17OrderMessages({
		giftWraps: admittedGiftWraps,
		signer: identityBoundSigner.signer,
	})

	const latchedSignerFailure = identityBoundSigner.getLatchedFailure()
	if (latchedSignerFailure === 'unavailable') {
		return failed('signer_unavailable')
	}
	if (latchedSignerFailure === 'mismatch') {
		return failed('signer_pubkey_mismatch')
	}

	const postUnwrapSignerIdentity = await classifySignerIdentity(params.signer, activeUserPubkey)
	const postUnwrapSignerFailure = signerIdentityFailureResult(postUnwrapSignerIdentity)
	if (postUnwrapSignerFailure) return postUnwrapSignerFailure
	if (unwrapped.some((message) => message.userPubkey !== activeUserPubkey)) {
		return failed('signer_pubkey_mismatch')
	}

	const messages = unwrapped.filter((message) => {
		if (message.rumor.kind !== ORDER_GENERAL_KIND) return false
		return counterpartyPubkey === undefined || message.counterpartyPubkey === counterpartyPubkey
	})

	return {
		status: 'ready',
		relayUrls: [...relayList.relays],
		messages,
	}
}

function buildNip17OrderChatInboxFilter(activeUserPubkey: string, limit: number): Nip17OrderChatInboxFilter {
	return {
		kinds: [NIP59_GIFT_WRAP_KIND],
		'#p': [activeUserPubkey],
		limit,
	}
}

function failed(code: ReadNip17OrderChatInboxErrorCode): ReadNip17OrderChatInboxResult {
	return {
		status: 'failed',
		error: { code },
		messages: [],
	}
}

async function classifySignerIdentity(
	signer: Nip17OrderTransportSigner | null | undefined,
	activeUserPubkey: string,
): Promise<SignerIdentityCheck> {
	if (!signer || typeof signer.user !== 'function') return { status: 'unavailable' }

	try {
		const user = await signer.user.call(signer)
		const pubkey = user?.pubkey
		if (typeof pubkey !== 'string' || !isHexPubkey(pubkey)) return { status: 'unavailable' }
		if (pubkey !== activeUserPubkey) return { status: 'mismatch' }

		return { status: 'ready', pubkey }
	} catch {
		return { status: 'unavailable' }
	}
}

function signerIdentityFailureResult(identity: SignerIdentityCheck): ReadNip17OrderChatInboxResult | undefined {
	if (identity.status === 'unavailable') return failed('signer_unavailable')
	if (identity.status === 'mismatch') return failed('signer_pubkey_mismatch')
	return undefined
}

function createIdentityBoundSigner(signer: AvailableNip17OrderTransportSigner, activeUserPubkey: string): IdentityBoundSigner {
	let latchedFailure: SignerIdentityFailure | undefined

	const latchFailure = (failure: SignerIdentityFailure): void => {
		latchedFailure ??= failure
	}

	const guardedSigner = {
		user: async () => {
			const identity = await classifySignerIdentity(signer, activeUserPubkey)
			if (identity.status !== 'ready') {
				latchFailure(identity.status)
				throw new Error('Signer identity unavailable')
			}

			return { pubkey: identity.pubkey }
		},
		encryptionEnabled: async (...args: Parameters<NonNullable<AvailableNip17OrderTransportSigner['encryptionEnabled']>>) => {
			const encryptionEnabled = signer.encryptionEnabled
			if (typeof encryptionEnabled !== 'function') return []
			return encryptionEnabled.apply(signer, args)
		},
		decrypt: async (...args: Parameters<AvailableNip17OrderTransportSigner['decrypt']>) => {
			const decrypt = signer.decrypt
			if (typeof decrypt !== 'function') throw new Error('Signer decrypt unavailable')
			return decrypt.apply(signer, args)
		},
	} as AvailableNip17OrderTransportSigner

	return {
		signer: guardedSigner,
		getLatchedFailure: () => latchedFailure,
	}
}

function verifyAndNarrowRelayListEvent(candidate: unknown, activeUserPubkey: string): Nip17DmRelayListEvent | undefined {
	try {
		if (typeof candidate !== 'object' || candidate === null) return undefined

		const rawCandidate = candidate as Record<string, unknown>
		const id = rawCandidate.id
		const sig = rawCandidate.sig
		const pubkey = rawCandidate.pubkey
		const kind = rawCandidate.kind
		const createdAt = rawCandidate.created_at
		const rawTags = rawCandidate.tags
		const content = rawCandidate.content
		const tags = snapshotStringTags(rawTags)

		if (typeof id !== 'string' || typeof sig !== 'string' || typeof pubkey !== 'string' || typeof content !== 'string') {
			return undefined
		}
		if (!Number.isSafeInteger(kind) || (kind as number) < 0 || (kind as number) > 65535) return undefined
		if (!Number.isSafeInteger(createdAt) || (createdAt as number) < 0) return undefined
		if (!tags) return undefined

		const snapshot: NostrEvent = {
			id,
			sig,
			pubkey,
			kind: kind as number,
			created_at: createdAt as number,
			tags,
			content,
		}

		if (snapshot.kind !== NIP17_DM_RELAY_LIST_KIND) return undefined
		if (snapshot.pubkey !== activeUserPubkey) return undefined
		if (!verifyEvent(snapshot)) return undefined

		return {
			id: snapshot.id,
			kind: snapshot.kind,
			pubkey: snapshot.pubkey,
			created_at: snapshot.created_at,
			tags: snapshot.tags,
			content: snapshot.content,
		}
	} catch {
		return undefined
	}
}

function fetchOptions(relayUrls: string[] | undefined, timeoutMs: number | undefined): FetchOptions | undefined {
	if (relayUrls === undefined && timeoutMs === undefined) return undefined

	return {
		...(relayUrls !== undefined ? { relayUrls: [...relayUrls] } : {}),
		...(timeoutMs !== undefined ? { timeoutMs } : {}),
	}
}

function isHexPubkey(value: string): boolean {
	return HEX_PUBKEY_RE.test(value)
}

function isPositiveSafeInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0
}

function admitGiftWraps(giftWraps: NostrEvent[], limit: number): NostrEvent[] {
	return collapseExactGiftWrapDuplicates(giftWraps)
		.map(
			(event, index): IndexedGiftWrap => ({
				event,
				index,
				usable: hasUsableAdmissionMetadata(event),
			}),
		)
		.sort(compareForAdmission)
		.slice(0, limit)
		.map(({ event }) => event)
}

function collapseExactGiftWrapDuplicates(giftWraps: NostrEvent[]): NostrEvent[] {
	const seenFingerprints = new Set<string>()
	const uniqueGiftWraps: NostrEvent[] = []

	for (const giftWrap of giftWraps) {
		const fingerprint = fingerprintCompleteRawEvent(giftWrap)
		if (fingerprint !== undefined) {
			if (seenFingerprints.has(fingerprint)) continue
			seenFingerprints.add(fingerprint)
		}

		uniqueGiftWraps.push(giftWrap)
	}

	return uniqueGiftWraps
}

function fingerprintCompleteRawEvent(event: NostrEvent): string | undefined {
	try {
		const id = event.id
		const sig = event.sig
		const pubkey = event.pubkey
		const kind = event.kind
		const createdAt = event.created_at
		const rawTags = event.tags
		const content = event.content
		const tags = snapshotStringTags(rawTags)

		if (typeof id !== 'string' || typeof sig !== 'string' || typeof pubkey !== 'string' || typeof content !== 'string') {
			return undefined
		}
		if (!Number.isSafeInteger(kind) || kind < 0 || kind > 65535) return undefined
		if (!Number.isSafeInteger(createdAt) || createdAt < 0) return undefined
		if (!tags) return undefined

		return JSON.stringify([id, sig, pubkey, kind, createdAt, tags, content])
	} catch {
		return undefined
	}
}

function snapshotStringTags(value: unknown): string[][] | undefined {
	try {
		if (!Array.isArray(value)) return undefined

		const outerLength = value.length
		if (!Number.isSafeInteger(outerLength) || outerLength < 0) return undefined

		const tags: string[][] = []
		for (let i = 0; i < outerLength; i += 1) {
			if (!hasOwnIndex(value, i)) return undefined

			const tag = value[i]
			if (!Array.isArray(tag)) return undefined

			const innerLength = tag.length
			if (!Number.isSafeInteger(innerLength) || innerLength < 0) return undefined

			const tagSnapshot: string[] = []
			for (let j = 0; j < innerLength; j += 1) {
				if (!hasOwnIndex(tag, j)) return undefined

				const entry = tag[j]
				if (typeof entry !== 'string') return undefined
				tagSnapshot.push(entry)
			}
			tags.push(tagSnapshot)
		}

		return tags
	} catch {
		return undefined
	}
}

function hasOwnIndex(target: object, index: number): boolean {
	return Object.prototype.hasOwnProperty.call(target, index)
}

function hasUsableAdmissionMetadata(event: NostrEvent): boolean {
	try {
		return (
			Number.isSafeInteger(event.created_at) &&
			event.created_at >= 0 &&
			typeof event.id === 'string' &&
			LOWERCASE_EVENT_ID_RE.test(event.id)
		)
	} catch {
		return false
	}
}

function compareForAdmission(a: IndexedGiftWrap, b: IndexedGiftWrap): number {
	try {
		if (a.usable !== b.usable) return a.usable ? -1 : 1

		if (a.usable && b.usable) {
			if (a.event.created_at !== b.event.created_at) {
				return a.event.created_at > b.event.created_at ? -1 : 1
			}

			if (a.event.id !== b.event.id) {
				return a.event.id < b.event.id ? -1 : 1
			}
		}
	} catch {
		// Runtime relay values remain untrusted despite the injected NostrEvent[] type.
	}

	return a.index - b.index
}
