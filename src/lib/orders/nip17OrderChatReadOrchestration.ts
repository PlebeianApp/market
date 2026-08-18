import { ORDER_GENERAL_KIND } from '../schemas/order'
import type { ReadNip17OrderChatInboxErrorCode, ReadNip17OrderChatInboxResult } from './nip17OrderChatInbox'
import { mergeOrderMessageReads, type Nip17OrderMessageReadRecord, type OrderMessageReadRecord } from './nip17OrderReadIntegration'
import type { Nip17OrderTransportSigner } from './nip17OrderTransport'

const LOWERCASE_PUBKEY_RE = /^[0-9a-f]{64}$/
const LOWERCASE_EVENT_ID_RE = /^[0-9a-f]{64}$/

const NIP17_READ_FAILURE_CODES: ReadonlySet<ReadNip17OrderChatInboxErrorCode> = new Set<ReadNip17OrderChatInboxErrorCode>([
	'invalid_active_user',
	'invalid_counterparty',
	'invalid_limit',
	'invalid_timeout',
	'signer_unavailable',
	'signer_pubkey_mismatch',
	'nip44_decrypt_unavailable',
	'relay_list_fetch_failed',
	'relay_list_missing',
	'relay_list_empty',
	'gift_wrap_fetch_failed',
])

export type ReadEncryptedOrderChat = (params: {
	activeUserPubkey: string
	counterpartyPubkey: string
	signer: Nip17OrderTransportSigner | null | undefined
}) => Promise<ReadNip17OrderChatInboxResult>

export type ReadOrderChatParams = {
	activeUserPubkey: string
	counterpartyPubkey: string
	orderContext?: {
		orderId: string
		buyerPubkey: string
		sellerPubkey: string
	}
	signer: Nip17OrderTransportSigner | null | undefined
	fetchLegacyMessages: (params: { activeUserPubkey: string; counterpartyPubkey: string }) => Promise<unknown[]>
	readEncryptedMessages: ReadEncryptedOrderChat
}

export type OrderChatReadInputErrorCode =
	| 'invalid_active_user'
	| 'invalid_counterparty'
	| 'same_participant'
	| 'invalid_order_context'
	| 'invalid_order_id'
	| 'invalid_buyer'
	| 'invalid_seller'
	| 'same_order_participant'
	| 'order_participant_mismatch'

export type LegacyReadState = { status: 'ready' } | { status: 'failed'; code: 'legacy_read_failed' }

export type Nip17ReadFailureCode = ReadNip17OrderChatInboxErrorCode | 'nip17_read_failed'

export type Nip17ReadState =
	| {
			status: 'ready'
			relayUrls: string[]
	  }
	| {
			status: 'failed'
			code: Nip17ReadFailureCode
	  }

export type OrderChatCorrelation =
	| { status: 'subject_matches_order' }
	| { status: 'participant_pair' }
	| { status: 'other_subject' }
	| { status: 'ambiguous_subject' }

export type AuthorizedOrderChatRecord = {
	record: OrderMessageReadRecord
	correlation: OrderChatCorrelation
}

export type OrderChatReadResult =
	| {
			status: 'ready' | 'degraded'
			records: AuthorizedOrderChatRecord[]
			legacy: LegacyReadState
			nip17: Nip17ReadState
	  }
	| {
			status: 'failed'
			error: { code: OrderChatReadInputErrorCode }
			records: []
	  }
	| {
			status: 'failed'
			error: { code: 'all_sources_failed' }
			records: []
			legacy: { status: 'failed'; code: 'legacy_read_failed' }
			nip17: { status: 'failed'; code: Nip17ReadFailureCode }
	  }

type ValidOrderContext = {
	orderId: string
	buyerPubkey: string
	sellerPubkey: string
}

type ValidatedReadInput = {
	status: 'ready'
	activeUserPubkey: string
	counterpartyPubkey: string
	orderContext?: ValidOrderContext
	input: Record<string, unknown>
}

type InvalidReadInput = {
	status: 'failed'
	code: OrderChatReadInputErrorCode
}

type LegacyRead = {
	state: LegacyReadState
	candidates: unknown[]
}

type Nip17Read = {
	state: Nip17ReadState
	candidates: unknown[]
}

type LegacyDependencySnapshot =
	| {
			status: 'ready'
			fetchLegacyMessages: ReadOrderChatParams['fetchLegacyMessages']
	  }
	| { status: 'failed' }

type Nip17DependencySnapshot =
	| {
			status: 'ready'
			readEncryptedMessages: ReadEncryptedOrderChat
			signer: Nip17OrderTransportSigner | null | undefined
	  }
	| { status: 'failed' }

type DependencySnapshots = {
	legacy: LegacyDependencySnapshot
	nip17: Nip17DependencySnapshot
}

/**
 * Reads the pairwise public and encrypted order-chat sources independently.
 * A ready source means its configured bounded request completed; it does not
 * prove complete historical coverage. Layer 1 has a finite gift-wrap limit and
 * exposes no pagination or completeness signal.
 */
export async function readOrderChatMessages(params: ReadOrderChatParams): Promise<OrderChatReadResult> {
	const input = snapshotInput(params)
	if (input.status === 'failed') return inputFailure(input.code)
	const dependencies = snapshotDependencies(input.input)

	const [legacyRead, nip17Read] = await Promise.all([
		readLegacySafely({
			dependency: dependencies.legacy,
			activeUserPubkey: input.activeUserPubkey,
			counterpartyPubkey: input.counterpartyPubkey,
		}),
		readNip17Safely({
			dependency: dependencies.nip17,
			activeUserPubkey: input.activeUserPubkey,
			counterpartyPubkey: input.counterpartyPubkey,
		}),
	])

	if (legacyRead.state.status === 'failed' && nip17Read.state.status === 'failed') {
		return {
			status: 'failed',
			error: { code: 'all_sources_failed' },
			records: [],
			legacy: legacyRead.state,
			nip17: nip17Read.state,
		}
	}

	const records = mergeAuthorizedRecords({
		legacyCandidates: legacyRead.candidates,
		nip17Candidates: nip17Read.candidates,
		activeUserPubkey: input.activeUserPubkey,
		counterpartyPubkey: input.counterpartyPubkey,
		orderContext: input.orderContext,
	})

	return {
		status: legacyRead.state.status === 'ready' && nip17Read.state.status === 'ready' ? 'ready' : 'degraded',
		records,
		legacy: legacyRead.state,
		nip17: nip17Read.state,
	}
}

function snapshotInput(value: unknown): ValidatedReadInput | InvalidReadInput {
	try {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			return { status: 'failed', code: 'invalid_active_user' }
		}

		const input = value as Record<string, unknown>
		let activeUserPubkey: unknown
		try {
			activeUserPubkey = input.activeUserPubkey
		} catch {
			return { status: 'failed', code: 'invalid_active_user' }
		}
		if (!isCanonicalPubkey(activeUserPubkey)) return { status: 'failed', code: 'invalid_active_user' }

		let counterpartyPubkey: unknown
		try {
			counterpartyPubkey = input.counterpartyPubkey
		} catch {
			return { status: 'failed', code: 'invalid_counterparty' }
		}
		if (!isCanonicalPubkey(counterpartyPubkey)) return { status: 'failed', code: 'invalid_counterparty' }
		if (activeUserPubkey === counterpartyPubkey) return { status: 'failed', code: 'same_participant' }

		let rawOrderContext: unknown
		try {
			rawOrderContext = input.orderContext
		} catch {
			return { status: 'failed', code: 'invalid_order_context' }
		}

		if (rawOrderContext === undefined) {
			return { status: 'ready', activeUserPubkey, counterpartyPubkey, input }
		}
		if (!isNonArrayRecord(rawOrderContext)) return { status: 'failed', code: 'invalid_order_context' }

		let orderId: unknown
		let buyerPubkey: unknown
		let sellerPubkey: unknown
		try {
			orderId = rawOrderContext.orderId
			buyerPubkey = rawOrderContext.buyerPubkey
			sellerPubkey = rawOrderContext.sellerPubkey
		} catch {
			return { status: 'failed', code: 'invalid_order_context' }
		}

		if (typeof orderId !== 'string' || orderId.length === 0) {
			return { status: 'failed', code: 'invalid_order_id' }
		}
		if (!isCanonicalPubkey(buyerPubkey)) return { status: 'failed', code: 'invalid_buyer' }
		if (!isCanonicalPubkey(sellerPubkey)) return { status: 'failed', code: 'invalid_seller' }
		if (buyerPubkey === sellerPubkey) return { status: 'failed', code: 'same_order_participant' }
		if (!sameUnorderedPair(activeUserPubkey, counterpartyPubkey, buyerPubkey, sellerPubkey)) {
			return { status: 'failed', code: 'order_participant_mismatch' }
		}

		return {
			status: 'ready',
			activeUserPubkey,
			counterpartyPubkey,
			orderContext: { orderId, buyerPubkey, sellerPubkey },
			input,
		}
	} catch {
		return { status: 'failed', code: 'invalid_active_user' }
	}
}

function snapshotDependencies(input: Record<string, unknown>): DependencySnapshots {
	let rawFetchLegacyMessages: unknown
	let fetchLegacyMessagesReadable = true
	try {
		rawFetchLegacyMessages = input.fetchLegacyMessages
	} catch {
		fetchLegacyMessagesReadable = false
	}

	let rawReadEncryptedMessages: unknown
	let readEncryptedMessagesReadable = true
	try {
		rawReadEncryptedMessages = input.readEncryptedMessages
	} catch {
		readEncryptedMessagesReadable = false
	}

	let rawSigner: unknown
	let signerReadable = true
	try {
		rawSigner = input.signer
	} catch {
		signerReadable = false
	}

	const legacy: LegacyDependencySnapshot =
		fetchLegacyMessagesReadable && typeof rawFetchLegacyMessages === 'function'
			? {
					status: 'ready',
					fetchLegacyMessages: rawFetchLegacyMessages as ReadOrderChatParams['fetchLegacyMessages'],
				}
			: { status: 'failed' }

	const nip17: Nip17DependencySnapshot =
		readEncryptedMessagesReadable && signerReadable && typeof rawReadEncryptedMessages === 'function'
			? {
					status: 'ready',
					readEncryptedMessages: rawReadEncryptedMessages as ReadEncryptedOrderChat,
					signer: rawSigner as Nip17OrderTransportSigner | null | undefined,
				}
			: { status: 'failed' }

	return { legacy, nip17 }
}

async function readLegacySafely(params: {
	dependency: LegacyDependencySnapshot
	activeUserPubkey: string
	counterpartyPubkey: string
}): Promise<LegacyRead> {
	if (params.dependency.status === 'failed') return legacyReadFailed()

	try {
		const value: unknown = await params.dependency.fetchLegacyMessages({
			activeUserPubkey: params.activeUserPubkey,
			counterpartyPubkey: params.counterpartyPubkey,
		})
		const candidates = snapshotArray(value)
		if (!candidates) return legacyReadFailed()

		return { state: { status: 'ready' }, candidates }
	} catch {
		return legacyReadFailed()
	}
}

async function readNip17Safely(params: {
	dependency: Nip17DependencySnapshot
	activeUserPubkey: string
	counterpartyPubkey: string
}): Promise<Nip17Read> {
	if (params.dependency.status === 'failed') return nip17ReadFailed()

	try {
		const value: unknown = await params.dependency.readEncryptedMessages({
			activeUserPubkey: params.activeUserPubkey,
			counterpartyPubkey: params.counterpartyPubkey,
			signer: params.dependency.signer,
		})
		return narrowNip17Read(value)
	} catch {
		return nip17ReadFailed()
	}
}

function narrowNip17Read(value: unknown): Nip17Read {
	try {
		if (!isNonArrayRecord(value)) return nip17ReadFailed()

		const status = value.status
		const messages = snapshotArray(value.messages)
		if (!messages) return nip17ReadFailed()

		if (status === 'ready') {
			const relayUrls = snapshotArray(value.relayUrls)
			if (!relayUrls || !relayUrls.every((relayUrl): relayUrl is string => typeof relayUrl === 'string')) {
				return nip17ReadFailed()
			}

			return {
				state: { status: 'ready', relayUrls },
				candidates: messages,
			}
		}

		if (status !== 'failed' || messages.length !== 0 || !isNonArrayRecord(value.error)) {
			return nip17ReadFailed()
		}

		const code = recognizedNip17FailureCode(value.error.code)
		if (!code) return nip17ReadFailed()

		return {
			state: { status: 'failed', code },
			candidates: [],
		}
	} catch {
		return nip17ReadFailed()
	}
}

function mergeAuthorizedRecords(params: {
	legacyCandidates: unknown[]
	nip17Candidates: unknown[]
	activeUserPubkey: string
	counterpartyPubkey: string
	orderContext?: ValidOrderContext
}): AuthorizedOrderChatRecord[] {
	const authorizedLegacy = normalizeCandidates(params.legacyCandidates, 'legacy').filter((record) =>
		isAuthorizedRecord(record, params.activeUserPubkey, params.counterpartyPubkey),
	)
	const authorizedNip17 = normalizeCandidates(params.nip17Candidates, 'nip17').filter(
		(record): record is Nip17OrderMessageReadRecord =>
			record.source === 'nip17' &&
			isAuthorizedRecord(record, params.activeUserPubkey, params.counterpartyPubkey) &&
			isAuthorizedNip17Context(record, params.activeUserPubkey, params.counterpartyPubkey),
	)

	const legacyById = new Map<string, OrderMessageReadRecord>()
	for (const record of authorizedLegacy) {
		if (!legacyById.has(record.id)) legacyById.set(record.id, record)
	}

	const nip17ById = new Map<string, Nip17OrderMessageReadRecord>()
	for (const record of authorizedNip17) {
		const existing = nip17ById.get(record.id)
		if (!existing || compareNip17Representatives(record, existing) < 0) {
			nip17ById.set(record.id, record)
		}
	}

	const mergedById = new Map(legacyById)
	nip17ById.forEach((record, id) => mergedById.set(id, record))

	return Array.from(mergedById.values())
		.sort(compareRecords)
		.map((record) => ({
			record,
			correlation: classifyCorrelation(record, params.orderContext),
		}))
}

function normalizeCandidates(candidates: unknown[], source: 'legacy' | 'nip17'): OrderMessageReadRecord[] {
	const records: OrderMessageReadRecord[] = []

	for (const candidate of candidates) {
		try {
			const normalized = mergeOrderMessageReads(
				source === 'legacy' ? { legacyEvents: [candidate] } : { nip17Messages: [candidate] },
			).records
			for (const record of normalized) records.push(record)
		} catch {
			// Malformed candidates are omitted without changing completed source health.
		}
	}

	return records
}

function isAuthorizedRecord(record: OrderMessageReadRecord, activeUserPubkey: string, counterpartyPubkey: string): boolean {
	if (record.kind !== ORDER_GENERAL_KIND) return false

	const recipientPubkey = authorizedRecipient(record)
	if (!recipientPubkey) return false

	if (record.pubkey === activeUserPubkey) {
		return recipientPubkey === counterpartyPubkey
	}
	if (record.pubkey === counterpartyPubkey) {
		return recipientPubkey === activeUserPubkey
	}

	return false
}

function authorizedRecipient(record: OrderMessageReadRecord): string | undefined {
	const recipientTags = record.tags.filter((tag) => tag[0] === 'p')
	if (recipientTags.length !== 1) return undefined

	const tag = recipientTags[0]
	if (!tag || tag.length !== 2 || tag[0] !== 'p') return undefined

	const recipientPubkey = tag[1]
	if (!isCanonicalPubkey(recipientPubkey)) return undefined
	if (recipientPubkey === record.pubkey) return undefined

	return recipientPubkey
}

function isAuthorizedNip17Context(record: Nip17OrderMessageReadRecord, activeUserPubkey: string, counterpartyPubkey: string): boolean {
	const recipientPubkey = authorizedRecipient(record)
	if (!recipientPubkey) return false

	const transport = record.transport
	if (transport.userPubkey !== activeUserPubkey) return false
	if (transport.counterpartyPubkey !== counterpartyPubkey) return false
	if (transport.recipientPubkey !== recipientPubkey) return false
	if (transport.rumorId !== record.id) return false
	if (transport.giftWrapId !== undefined && !LOWERCASE_EVENT_ID_RE.test(transport.giftWrapId)) return false

	if (transport.direction === 'sent') {
		return record.pubkey === activeUserPubkey && recipientPubkey === counterpartyPubkey
	}

	return record.pubkey === counterpartyPubkey && recipientPubkey === activeUserPubkey
}

/**
 * Selects only a deterministic representative for equivalent authenticated
 * inner records. Wrapper identity does not establish freshness, delivery
 * success, relay quality, recipient visibility, or semantic authority.
 */
function compareNip17Representatives(a: Nip17OrderMessageReadRecord, b: Nip17OrderMessageReadRecord): number {
	const aGiftWrapId = a.transport.giftWrapId
	const bGiftWrapId = b.transport.giftWrapId

	if (aGiftWrapId === undefined) return bGiftWrapId === undefined ? 0 : 1
	if (bGiftWrapId === undefined) return -1
	return aGiftWrapId.localeCompare(bGiftWrapId)
}

/**
 * subject_matches_order means exactly one subject structurally equals the
 * caller-supplied order ID. It is a correlation signal, not independent proof
 * that the order exists or that the message semantically belongs to it.
 */
function classifyCorrelation(record: OrderMessageReadRecord, orderContext?: ValidOrderContext): OrderChatCorrelation {
	if (!orderContext) return { status: 'participant_pair' }

	const subjectTags = record.tags.filter((tag) => tag[0] === 'subject')
	if (subjectTags.length > 1) return { status: 'ambiguous_subject' }
	if (subjectTags.length === 0) return { status: 'participant_pair' }

	const subject = subjectTags[0]?.[1]
	if (subject === undefined || subject.length === 0) return { status: 'participant_pair' }
	if (subject === orderContext.orderId) return { status: 'subject_matches_order' }
	return { status: 'other_subject' }
}

function compareRecords(a: OrderMessageReadRecord, b: OrderMessageReadRecord): number {
	if (a.created_at !== b.created_at) return a.created_at - b.created_at
	return a.id.localeCompare(b.id)
}

function sameUnorderedPair(a: string, b: string, first: string, second: string): boolean {
	return (a === first && b === second) || (a === second && b === first)
}

function isCanonicalPubkey(value: unknown): value is string {
	return typeof value === 'string' && LOWERCASE_PUBKEY_RE.test(value)
}

function isNonArrayRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function snapshotArray(value: unknown): unknown[] | undefined {
	if (!Array.isArray(value)) return undefined
	return [...value]
}

function recognizedNip17FailureCode(value: unknown): ReadNip17OrderChatInboxErrorCode | undefined {
	if (typeof value !== 'string') return undefined
	return NIP17_READ_FAILURE_CODES.has(value as ReadNip17OrderChatInboxErrorCode) ? (value as ReadNip17OrderChatInboxErrorCode) : undefined
}

function legacyReadFailed(): LegacyRead {
	return {
		state: { status: 'failed', code: 'legacy_read_failed' },
		candidates: [],
	}
}

function nip17ReadFailed(): Nip17Read {
	return {
		state: { status: 'failed', code: 'nip17_read_failed' },
		candidates: [],
	}
}

function inputFailure(code: OrderChatReadInputErrorCode): OrderChatReadResult {
	return {
		status: 'failed',
		error: { code },
		records: [],
	}
}
