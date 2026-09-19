import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, type Event } from 'nostr-tools'
import {
	readOrderChatMessages,
	type Nip17ReadFailureCode,
	type OrderChatReadInputErrorCode,
	type ReadEncryptedOrderChat,
	type ReadOrderChatParams,
} from '../orders/nip17OrderChatReadOrchestration'
import type { ReadNip17OrderChatInboxErrorCode, ReadNip17OrderChatInboxResult } from '../orders/nip17OrderChatInbox'
import type { UnwrappedNip17OrderMessage } from '../orders/nip17OrderRead'
import type { LegacyOrderMessageEvent } from '../orders/nip17OrderReadIntegration'
import {
	createOrderChatRumor,
	createOrderCreationRumor,
	createPaymentReceiptRumor,
	type OrderMessageRumor,
} from '../orders/orderMessageRumor'

const CREATED_AT = 1_700_000_000
const ACTIVE_PRIVATE_KEY = generateSecretKey()
const COUNTERPARTY_PRIVATE_KEY = generateSecretKey()
const THIRD_PARTY_PRIVATE_KEY = generateSecretKey()
const WRAPPER_PRIVATE_KEY = generateSecretKey()
const ACTIVE_USER_PUBKEY = getPublicKey(ACTIVE_PRIVATE_KEY)
const COUNTERPARTY_PUBKEY = getPublicKey(COUNTERPARTY_PRIVATE_KEY)
const THIRD_PARTY_PUBKEY = getPublicKey(THIRD_PARTY_PRIVATE_KEY)
const ORDER_ID = 'order-123'
const PRIVATE_THROWN_TEXT = 'private thrown invoice preimage ciphertext'

type Deferred<T> = {
	promise: Promise<T>
	resolve: (value: T) => void
	reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})

	return { promise, resolve, reject }
}

function readyNip17(
	messages: UnwrappedNip17OrderMessage[] = [],
	relayUrls: string[] = ['wss://inbox.example'],
): ReadNip17OrderChatInboxResult {
	return {
		status: 'ready',
		relayUrls,
		messages,
	}
}

function baseParams(overrides: Partial<ReadOrderChatParams> = {}): ReadOrderChatParams {
	return {
		activeUserPubkey: ACTIVE_USER_PUBKEY,
		counterpartyPubkey: COUNTERPARTY_PUBKEY,
		signer: null,
		fetchLegacyMessages: async () => [],
		readEncryptedMessages: async () => readyNip17(),
		...overrides,
	}
}

function signedLegacyEvent(
	params: {
		privateKey?: Uint8Array
		createdAt?: number
		kind?: number
		tags?: string[][]
		content?: string
	} = {},
): LegacyOrderMessageEvent {
	return finalizeEvent(
		{
			kind: params.kind ?? 14,
			created_at: params.createdAt ?? CREATED_AT,
			tags: params.tags ?? [['p', COUNTERPARTY_PUBKEY]],
			content: params.content ?? 'Public order chat',
		},
		params.privateKey ?? ACTIVE_PRIVATE_KEY,
	)
}

function legacyEventFromRumor(rumor: OrderMessageRumor, privateKey: Uint8Array): LegacyOrderMessageEvent {
	return finalizeEvent(
		{
			kind: rumor.kind,
			created_at: rumor.created_at,
			tags: rumor.tags,
			content: rumor.content,
		},
		privateKey,
	)
}

function signedTransportEvent(content: string, createdAt = CREATED_AT + 100): Event {
	return finalizeEvent(
		{
			kind: 1059,
			created_at: createdAt,
			tags: [['p', ACTIVE_USER_PUBKEY]],
			content,
		},
		WRAPPER_PRIVATE_KEY,
	)
}

function unwrappedMessage(
	rumor: OrderMessageRumor,
	overrides: Partial<Omit<UnwrappedNip17OrderMessage, 'rumor'>> = {},
): UnwrappedNip17OrderMessage {
	const recipientPubkey = rumor.tags.find((tag) => tag[0] === 'p')?.[1] ?? COUNTERPARTY_PUBKEY
	const sent = rumor.pubkey === ACTIVE_USER_PUBKEY

	return {
		giftWrap: signedTransportEvent(`wrapper-${rumor.id}`),
		seal: signedTransportEvent(`seal-${rumor.id}`),
		rumor,
		direction: sent ? 'sent' : 'received',
		userPubkey: ACTIVE_USER_PUBKEY,
		counterpartyPubkey: sent ? recipientPubkey : rumor.pubkey,
		recipientPubkey,
		...overrides,
	}
}

function canonicalRumor(params: {
	pubkey: string
	tags: string[][]
	content?: string
	createdAt?: number
	kind?: number
}): OrderMessageRumor {
	const rumor = {
		pubkey: params.pubkey,
		created_at: params.createdAt ?? CREATED_AT,
		kind: params.kind ?? 14,
		tags: params.tags,
		content: params.content ?? 'Encrypted order chat',
	}

	return {
		...rumor,
		id: getEventHash(rumor),
	}
}

function sentRumor(overrides: { subject?: string; content?: string; createdAt?: number } = {}): OrderMessageRumor {
	return createOrderChatRumor({
		senderPubkey: ACTIVE_USER_PUBKEY,
		recipientPubkey: COUNTERPARTY_PUBKEY,
		...(overrides.subject !== undefined ? { subject: overrides.subject } : {}),
		content: overrides.content ?? 'Encrypted sent chat',
		createdAt: overrides.createdAt ?? CREATED_AT,
	})
}

function receivedRumor(overrides: { subject?: string; content?: string; createdAt?: number } = {}): OrderMessageRumor {
	return createOrderChatRumor({
		senderPubkey: COUNTERPARTY_PUBKEY,
		recipientPubkey: ACTIVE_USER_PUBKEY,
		...(overrides.subject !== undefined ? { subject: overrides.subject } : {}),
		content: overrides.content ?? 'Encrypted received chat',
		createdAt: overrides.createdAt ?? CREATED_AT,
	})
}

function malformedNip17Result(value: unknown): ReadEncryptedOrderChat {
	return async () => value as ReadNip17OrderChatInboxResult
}

async function expectInputFailure(
	params: ReadOrderChatParams,
	code: OrderChatReadInputErrorCode,
	counts: { legacy: number; nip17: number },
): Promise<void> {
	const result = await readOrderChatMessages(params)

	expect(result).toEqual({
		status: 'failed',
		error: { code },
		records: [],
	})
	expect(counts).toEqual({ legacy: 0, nip17: 0 })
	expect('legacy' in result).toBe(false)
	expect('nip17' in result).toBe(false)
}

function countedParams(overrides: Partial<ReadOrderChatParams> = {}): {
	params: ReadOrderChatParams
	counts: { legacy: number; nip17: number }
} {
	const counts = { legacy: 0, nip17: 0 }

	return {
		counts,
		params: baseParams({
			fetchLegacyMessages: async () => {
				counts.legacy += 1
				return []
			},
			readEncryptedMessages: async () => {
				counts.nip17 += 1
				return readyNip17()
			},
			...overrides,
		}),
	}
}

async function expectRuntimeInputFailure(value: unknown, code: OrderChatReadInputErrorCode): Promise<void> {
	const result = await readOrderChatMessages(value as ReadOrderChatParams)

	expect(result).toEqual({
		status: 'failed',
		error: { code },
		records: [],
	})
	expect('legacy' in result).toBe(false)
	expect('nip17' in result).toBe(false)
	expect(JSON.stringify(result)).not.toContain(PRIVATE_THROWN_TEXT)
}

describe('order chat read orchestration input boundary', () => {
	for (const [name, value] of [
		['null', null],
		['undefined', undefined],
		['array', []],
		['string', 'input'],
		['number', 123],
		['boolean', true],
	] as const) {
		test(`contains malformed top-level ${name} input`, async () => {
			await expectRuntimeInputFailure(value, 'invalid_active_user')
		})
	}

	test('contains unreadable top-level identity and order-context getters', async () => {
		const cases: Array<{
			code: OrderChatReadInputErrorCode
			input: unknown
			counts: { legacy: number; nip17: number }
		}> = []

		for (const property of ['activeUserPubkey', 'counterpartyPubkey', 'orderContext'] as const) {
			const counts = { legacy: 0, nip17: 0 }
			const input: Record<string, unknown> = {
				activeUserPubkey: ACTIVE_USER_PUBKEY,
				counterpartyPubkey: COUNTERPARTY_PUBKEY,
				fetchLegacyMessages: async () => {
					counts.legacy += 1
					return []
				},
				readEncryptedMessages: async () => {
					counts.nip17 += 1
					return readyNip17()
				},
				signer: null,
			}
			Object.defineProperty(input, property, {
				get: () => {
					throw new Error(PRIVATE_THROWN_TEXT)
				},
			})
			cases.push({
				code:
					property === 'activeUserPubkey'
						? 'invalid_active_user'
						: property === 'counterpartyPubkey'
							? 'invalid_counterparty'
							: 'invalid_order_context',
				input,
				counts,
			})
		}

		for (const testCase of cases) {
			await expectRuntimeInputFailure(testCase.input, testCase.code)
			expect(testCase.counts).toEqual({ legacy: 0, nip17: 0 })
		}
	})

	test('contains a revoked top-level proxy', async () => {
		const revocable = Proxy.revocable(baseParams(), {})
		revocable.revoke()

		await expectRuntimeInputFailure(revocable.proxy, 'invalid_active_user')
	})

	const invalidIdentityCases: Array<{
		name: string
		overrides: Partial<ReadOrderChatParams>
		code: OrderChatReadInputErrorCode
	}> = [
		{ name: 'invalid active user', overrides: { activeUserPubkey: 'invalid' }, code: 'invalid_active_user' },
		{
			name: 'uppercase active user',
			overrides: { activeUserPubkey: ACTIVE_USER_PUBKEY.toUpperCase() },
			code: 'invalid_active_user',
		},
		{ name: 'invalid counterparty', overrides: { counterpartyPubkey: 'invalid' }, code: 'invalid_counterparty' },
		{
			name: 'uppercase counterparty',
			overrides: { counterpartyPubkey: COUNTERPARTY_PUBKEY.toUpperCase() },
			code: 'invalid_counterparty',
		},
		{
			name: 'same participant',
			overrides: { counterpartyPubkey: ACTIVE_USER_PUBKEY },
			code: 'same_participant',
		},
	]

	for (const testCase of invalidIdentityCases) {
		test(`rejects ${testCase.name} before invoking either dependency`, async () => {
			const harness = countedParams(testCase.overrides)
			await expectInputFailure(harness.params, testCase.code, harness.counts)
		})
	}

	for (const malformedContext of [null, [], 'order', 42, true]) {
		test(`rejects malformed order context ${String(malformedContext)} before reads`, async () => {
			const harness = countedParams()
			const params = {
				...harness.params,
				orderContext: malformedContext,
			} as unknown as ReadOrderChatParams

			await expectInputFailure(params, 'invalid_order_context', harness.counts)
		})
	}

	const invalidOrderCases: Array<{
		name: string
		context: unknown
		code: OrderChatReadInputErrorCode
	}> = [
		{
			name: 'empty order id',
			context: { orderId: '', buyerPubkey: ACTIVE_USER_PUBKEY, sellerPubkey: COUNTERPARTY_PUBKEY },
			code: 'invalid_order_id',
		},
		{
			name: 'non-string order id',
			context: { orderId: 123, buyerPubkey: ACTIVE_USER_PUBKEY, sellerPubkey: COUNTERPARTY_PUBKEY },
			code: 'invalid_order_id',
		},
		{
			name: 'invalid buyer',
			context: { orderId: ORDER_ID, buyerPubkey: 'invalid', sellerPubkey: COUNTERPARTY_PUBKEY },
			code: 'invalid_buyer',
		},
		{
			name: 'invalid seller',
			context: { orderId: ORDER_ID, buyerPubkey: ACTIVE_USER_PUBKEY, sellerPubkey: 'invalid' },
			code: 'invalid_seller',
		},
		{
			name: 'same buyer and seller',
			context: { orderId: ORDER_ID, buyerPubkey: ACTIVE_USER_PUBKEY, sellerPubkey: ACTIVE_USER_PUBKEY },
			code: 'same_order_participant',
		},
		{
			name: 'order participant mismatch',
			context: { orderId: ORDER_ID, buyerPubkey: ACTIVE_USER_PUBKEY, sellerPubkey: THIRD_PARTY_PUBKEY },
			code: 'order_participant_mismatch',
		},
	]

	for (const testCase of invalidOrderCases) {
		test(`rejects ${testCase.name} before invoking either dependency`, async () => {
			const harness = countedParams()
			const params = {
				...harness.params,
				orderContext: testCase.context,
			} as unknown as ReadOrderChatParams

			await expectInputFailure(params, testCase.code, harness.counts)
		})
	}

	test('accepts buyer and seller roles in either orientation', async () => {
		for (const orderContext of [
			{ orderId: ORDER_ID, buyerPubkey: ACTIVE_USER_PUBKEY, sellerPubkey: COUNTERPARTY_PUBKEY },
			{ orderId: ORDER_ID, buyerPubkey: COUNTERPARTY_PUBKEY, sellerPubkey: ACTIVE_USER_PUBKEY },
		]) {
			const result = await readOrderChatMessages(baseParams({ orderContext }))
			expect(result.status).toBe('ready')
		}
	})
})

describe('order chat read orchestration source health', () => {
	test('starts both reads before either dependency is released', async () => {
		const legacy = deferred<unknown[]>()
		const nip17 = deferred<ReadNip17OrderChatInboxResult>()
		const started: string[] = []
		const resultPromise = readOrderChatMessages(
			baseParams({
				fetchLegacyMessages: () => {
					started.push('legacy')
					return legacy.promise
				},
				readEncryptedMessages: () => {
					started.push('nip17')
					return nip17.promise
				},
			}),
		)

		await Promise.resolve()
		expect(started).toEqual(['legacy', 'nip17'])
		legacy.resolve([])
		nip17.resolve(readyNip17())
		expect((await resultPromise).status).toBe('ready')
	})

	test('does not share mutable participant arguments between source adapters', async () => {
		let encryptedParticipants: { activeUserPubkey: string; counterpartyPubkey: string } | undefined
		const result = await readOrderChatMessages(
			baseParams({
				fetchLegacyMessages: async (participants) => {
					participants.activeUserPubkey = THIRD_PARTY_PUBKEY
					participants.counterpartyPubkey = THIRD_PARTY_PUBKEY
					return []
				},
				readEncryptedMessages: async (participants) => {
					encryptedParticipants = {
						activeUserPubkey: participants.activeUserPubkey,
						counterpartyPubkey: participants.counterpartyPubkey,
					}
					return readyNip17()
				},
			}),
		)

		expect(result.status).toBe('ready')
		expect(encryptedParticipants).toEqual({
			activeUserPubkey: ACTIVE_USER_PUBKEY,
			counterpartyPubkey: COUNTERPARTY_PUBKEY,
		})
	})

	test('snapshots both readers and the signer before either source callback begins', async () => {
		const originalSigner = { identity: 'original' } as unknown as ReadOrderChatParams['signer']
		const replacementSigner = { identity: 'replacement' } as unknown as ReadOrderChatParams['signer']
		let selectedEncryptedReaderCalls = 0
		let replacementEncryptedReaderCalls = 0
		let receivedSigner: ReadOrderChatParams['signer']
		let fetchGetterCalls = 0
		let encryptedGetterCalls = 0
		let signerGetterCalls = 0
		let encryptedReader: ReadOrderChatParams['readEncryptedMessages'] = async ({ signer }) => {
			selectedEncryptedReaderCalls += 1
			receivedSigner = signer
			return readyNip17()
		}
		let selectedSigner = originalSigner
		const input: Record<string, unknown> = {
			activeUserPubkey: ACTIVE_USER_PUBKEY,
			counterpartyPubkey: COUNTERPARTY_PUBKEY,
		}

		Object.defineProperties(input, {
			fetchLegacyMessages: {
				get: () => {
					fetchGetterCalls += 1
					return async () => {
						encryptedReader = async () => {
							replacementEncryptedReaderCalls += 1
							return readyNip17()
						}
						selectedSigner = replacementSigner
						return []
					}
				},
			},
			readEncryptedMessages: {
				get: () => {
					encryptedGetterCalls += 1
					return encryptedReader
				},
			},
			signer: {
				get: () => {
					signerGetterCalls += 1
					return selectedSigner
				},
			},
		})

		const result = await readOrderChatMessages(input as ReadOrderChatParams)

		expect(result.status).toBe('ready')
		expect(selectedEncryptedReaderCalls).toBe(1)
		expect(replacementEncryptedReaderCalls).toBe(0)
		expect(receivedSigner).toBe(originalSigner)
		expect(fetchGetterCalls).toBe(1)
		expect(encryptedGetterCalls).toBe(1)
		expect(signerGetterCalls).toBe(1)
	})

	test('contains throwing dependency getters and preserves the unaffected source', async () => {
		for (const property of ['fetchLegacyMessages', 'readEncryptedMessages', 'signer'] as const) {
			let legacyCalls = 0
			let nip17Calls = 0
			const input: Record<string, unknown> = {
				activeUserPubkey: ACTIVE_USER_PUBKEY,
				counterpartyPubkey: COUNTERPARTY_PUBKEY,
				fetchLegacyMessages: async () => {
					legacyCalls += 1
					return []
				},
				readEncryptedMessages: async () => {
					nip17Calls += 1
					return readyNip17()
				},
				signer: null,
			}
			Object.defineProperty(input, property, {
				get: () => {
					throw new Error(PRIVATE_THROWN_TEXT)
				},
			})

			const result = await readOrderChatMessages(input as ReadOrderChatParams)
			expect(result.status).toBe('degraded')
			if (result.status !== 'degraded') throw new Error('expected degraded result')
			if (property === 'fetchLegacyMessages') {
				expect(result.legacy).toEqual({ status: 'failed', code: 'legacy_read_failed' })
				expect(result.nip17.status).toBe('ready')
				expect(legacyCalls).toBe(0)
				expect(nip17Calls).toBe(1)
			} else {
				expect(result.legacy.status).toBe('ready')
				expect(result.nip17).toEqual({ status: 'failed', code: 'nip17_read_failed' })
				expect(legacyCalls).toBe(1)
				expect(nip17Calls).toBe(0)
			}
			expect(JSON.stringify(result)).not.toContain(PRIVATE_THROWN_TEXT)
		}
	})

	for (const invalidDependency of [null, 'not-a-reader', { read: false }]) {
		test(`maps non-function legacy dependency ${String(invalidDependency)} independently`, async () => {
			let nip17Calls = 0
			const input = {
				...baseParams({
					readEncryptedMessages: async () => {
						nip17Calls += 1
						return readyNip17()
					},
				}),
				fetchLegacyMessages: invalidDependency,
			} as unknown as ReadOrderChatParams
			const result = await readOrderChatMessages(input)

			expect(result.status).toBe('degraded')
			if (result.status !== 'degraded') throw new Error('expected degraded result')
			expect(result.legacy).toEqual({ status: 'failed', code: 'legacy_read_failed' })
			expect(result.nip17.status).toBe('ready')
			expect(nip17Calls).toBe(1)
		})
	}

	for (const invalidDependency of [null, 'not-a-reader', { read: false }]) {
		test(`maps non-function encrypted dependency ${String(invalidDependency)} independently`, async () => {
			let legacyCalls = 0
			const input = {
				...baseParams({
					fetchLegacyMessages: async () => {
						legacyCalls += 1
						return []
					},
				}),
				readEncryptedMessages: invalidDependency,
			} as unknown as ReadOrderChatParams
			const result = await readOrderChatMessages(input)

			expect(result.status).toBe('degraded')
			if (result.status !== 'degraded') throw new Error('expected degraded result')
			expect(result.legacy.status).toBe('ready')
			expect(result.nip17).toEqual({ status: 'failed', code: 'nip17_read_failed' })
			expect(legacyCalls).toBe(1)
		})
	}

	test('keeps NIP-17 ready when legacy rejects', async () => {
		const result = await readOrderChatMessages(
			baseParams({
				fetchLegacyMessages: async () => {
					throw new Error(PRIVATE_THROWN_TEXT)
				},
			}),
		)

		expect(result).toEqual({
			status: 'degraded',
			records: [],
			legacy: { status: 'failed', code: 'legacy_read_failed' },
			nip17: { status: 'ready', relayUrls: ['wss://inbox.example'] },
		})
		expect(JSON.stringify(result)).not.toContain(PRIVATE_THROWN_TEXT)
	})

	test('keeps legacy ready when NIP-17 rejects', async () => {
		const result = await readOrderChatMessages(
			baseParams({
				readEncryptedMessages: async () => {
					throw new Error(PRIVATE_THROWN_TEXT)
				},
			}),
		)

		expect(result).toEqual({
			status: 'degraded',
			records: [],
			legacy: { status: 'ready' },
			nip17: { status: 'failed', code: 'nip17_read_failed' },
		})
		expect(JSON.stringify(result)).not.toContain(PRIVATE_THROWN_TEXT)
	})

	test('returns all_sources_failed when both dependencies reject', async () => {
		const result = await readOrderChatMessages(
			baseParams({
				fetchLegacyMessages: async () => {
					throw new Error(PRIVATE_THROWN_TEXT)
				},
				readEncryptedMessages: async () => {
					throw new Error(PRIVATE_THROWN_TEXT)
				},
			}),
		)

		expect(result).toEqual({
			status: 'failed',
			error: { code: 'all_sources_failed' },
			records: [],
			legacy: { status: 'failed', code: 'legacy_read_failed' },
			nip17: { status: 'failed', code: 'nip17_read_failed' },
		})
	})

	test('returns ready when both successful sources are empty', async () => {
		const result = await readOrderChatMessages(baseParams())

		expect(result).toEqual({
			status: 'ready',
			records: [],
			legacy: { status: 'ready' },
			nip17: { status: 'ready', relayUrls: ['wss://inbox.example'] },
		})
	})

	test('source health remains ready for malformed and unauthorized candidates', async () => {
		const unauthorized = signedLegacyEvent({ privateKey: THIRD_PARTY_PRIVATE_KEY })
		const malformedMessages = [{}] as unknown as UnwrappedNip17OrderMessage[]
		const result = await readOrderChatMessages(
			baseParams({
				fetchLegacyMessages: async () => [{ malformed: true }, unauthorized],
				readEncryptedMessages: async () => readyNip17(malformedMessages),
			}),
		)

		expect(result.status).toBe('ready')
		expect(result.records).toEqual([])
	})
})

describe('order chat read orchestration runtime result narrowing', () => {
	test('treats a non-array legacy resolution as legacy_read_failed', async () => {
		const fetchLegacyMessages = (async () => ({ secret: PRIVATE_THROWN_TEXT })) as unknown as ReadOrderChatParams['fetchLegacyMessages']
		const result = await readOrderChatMessages(baseParams({ fetchLegacyMessages }))

		expect(result.status).toBe('degraded')
		if (result.status !== 'degraded') throw new Error('expected degraded result')
		expect(result.legacy).toEqual({ status: 'failed', code: 'legacy_read_failed' })
		expect(JSON.stringify(result)).not.toContain(PRIVATE_THROWN_TEXT)
	})

	const malformedReadyResults: Array<{ name: string; value: unknown }> = [
		{ name: 'non-object output', value: 'ready' },
		{ name: 'missing relay URLs', value: { status: 'ready', messages: [] } },
		{ name: 'malformed relay URL', value: { status: 'ready', relayUrls: ['wss://ok', 42], messages: [] } },
		{ name: 'malformed messages', value: { status: 'ready', relayUrls: [], messages: {} } },
	]

	for (const testCase of malformedReadyResults) {
		test(`maps ${testCase.name} to nip17_read_failed`, async () => {
			const result = await readOrderChatMessages(baseParams({ readEncryptedMessages: malformedNip17Result(testCase.value) }))

			expect(result.status).toBe('degraded')
			if (result.status !== 'degraded') throw new Error('expected degraded result')
			expect(result.nip17).toEqual({ status: 'failed', code: 'nip17_read_failed' })
		})
	}

	test('rejects unknown NIP-17 failure codes and nonempty failed messages', async () => {
		for (const value of [
			{ status: 'failed', error: { code: 'private_unknown_code' }, messages: [] },
			{ status: 'failed', error: { code: 'relay_list_missing' }, messages: [{ secret: PRIVATE_THROWN_TEXT }] },
		]) {
			const result = await readOrderChatMessages(baseParams({ readEncryptedMessages: malformedNip17Result(value) }))
			expect(result.status).toBe('degraded')
			if (result.status !== 'degraded') throw new Error('expected degraded result')
			expect(result.nip17).toEqual({ status: 'failed', code: 'nip17_read_failed' })
			expect(JSON.stringify(result)).not.toContain(PRIVATE_THROWN_TEXT)
		}
	})

	const recognizedCodes: ReadNip17OrderChatInboxErrorCode[] = [
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
	]

	for (const code of recognizedCodes) {
		test(`preserves recognized Layer 1 failure ${code}`, async () => {
			const result = await readOrderChatMessages(
				baseParams({
					readEncryptedMessages: async () => ({ status: 'failed', error: { code }, messages: [] }),
				}),
			)

			expect(result.status).toBe('degraded')
			if (result.status !== 'degraded') throw new Error('expected degraded result')
			expect(result.nip17).toEqual({ status: 'failed', code })
		})
	}

	test('does not expose unknown dependency fields in failures', async () => {
		const malformed = {
			status: 'failed',
			error: { code: 'unknown', private: PRIVATE_THROWN_TEXT },
			messages: [],
			plaintext: PRIVATE_THROWN_TEXT,
		}
		const result = await readOrderChatMessages(baseParams({ readEncryptedMessages: malformedNip17Result(malformed) }))
		const serialized = JSON.stringify(result)

		expect(serialized).not.toContain(PRIVATE_THROWN_TEXT)
		expect(serialized).not.toContain('plaintext')
	})
})

describe('order chat read orchestration authorization boundary', () => {
	test('accepts signed pairwise legacy chat in both directions', async () => {
		const sent = signedLegacyEvent()
		const received = signedLegacyEvent({
			privateKey: COUNTERPARTY_PRIVATE_KEY,
			createdAt: CREATED_AT + 1,
			tags: [['p', ACTIVE_USER_PUBKEY]],
		})
		const result = await readOrderChatMessages(baseParams({ fetchLegacyMessages: async () => [received, sent] }))

		expect(result.records.map(({ record }) => record.id)).toEqual([sent.id, received.id])
		expect(result.records.every(({ record }) => record.source === 'legacy')).toBe(true)
	})

	test('excludes non-chat kinds and malformed or unauthorized participant tags', async () => {
		const order = createOrderCreationRumor({
			buyerPubkey: ACTIVE_USER_PUBKEY,
			merchantPubkey: COUNTERPARTY_PUBKEY,
			orderId: ORDER_ID,
			amountSats: 100,
			items: [{ productRef: `30402:${COUNTERPARTY_PUBKEY}:product`, quantity: 1 }],
			createdAt: CREATED_AT,
		})
		const receipt = createPaymentReceiptRumor({
			buyerPubkey: ACTIVE_USER_PUBKEY,
			merchantPubkey: COUNTERPARTY_PUBKEY,
			orderId: ORDER_ID,
			payment: { medium: 'lightning', reference: 'invoice', proof: 'proof' },
			amountSats: 100,
			createdAt: CREATED_AT + 1,
		})
		const rejected: unknown[] = [
			legacyEventFromRumor(order, ACTIVE_PRIVATE_KEY),
			legacyEventFromRumor(receipt, ACTIVE_PRIVATE_KEY),
			signedLegacyEvent({ tags: [] }),
			signedLegacyEvent({
				tags: [
					['p', COUNTERPARTY_PUBKEY],
					['p', COUNTERPARTY_PUBKEY],
				],
			}),
			signedLegacyEvent({ tags: [['p', COUNTERPARTY_PUBKEY, 'extra']] }),
			signedLegacyEvent({ tags: [['p', COUNTERPARTY_PUBKEY.toUpperCase()]] }),
			signedLegacyEvent({ tags: [['p', 'invalid']] }),
			signedLegacyEvent({ privateKey: THIRD_PARTY_PRIVATE_KEY }),
			signedLegacyEvent({ tags: [['p', THIRD_PARTY_PUBKEY]] }),
			signedLegacyEvent({ tags: [['p', ACTIVE_USER_PUBKEY]] }),
		]
		const result = await readOrderChatMessages(baseParams({ fetchLegacyMessages: async () => rejected }))

		expect(result.status).toBe('ready')
		expect(result.records).toEqual([])
	})

	test('accepts valid sent and received NIP-17 perspectives', async () => {
		const sent = unwrappedMessage(sentRumor())
		const received = unwrappedMessage(receivedRumor({ createdAt: CREATED_AT + 1 }))
		const result = await readOrderChatMessages(baseParams({ readEncryptedMessages: async () => readyNip17([received, sent]) }))

		expect(result.records.map(({ record }) => record.id)).toEqual([sent.rumor.id, received.rumor.id])
		expect(result.records.every(({ record }) => record.source === 'nip17')).toBe(true)
	})

	test('excludes NIP-17 transport and direction mismatches without changing source health', async () => {
		const sent = sentRumor()
		const received = receivedRumor()
		const rejected = [
			unwrappedMessage(sent, { userPubkey: THIRD_PARTY_PUBKEY }),
			unwrappedMessage(sent, { counterpartyPubkey: THIRD_PARTY_PUBKEY }),
			unwrappedMessage(sent, { recipientPubkey: THIRD_PARTY_PUBKEY }),
			unwrappedMessage(sent, { direction: 'received' }),
			unwrappedMessage(received, { direction: 'sent' }),
		]
		const result = await readOrderChatMessages(baseParams({ readEncryptedMessages: async () => readyNip17(rejected) }))

		expect(result.status).toBe('ready')
		expect(result.records).toEqual([])
	})

	test('requires the PR #1136 reconstructed rumor identity', async () => {
		const rumor = sentRumor()
		const result = await readOrderChatMessages(baseParams({ readEncryptedMessages: async () => readyNip17([unwrappedMessage(rumor)]) }))

		expect(result.records).toHaveLength(1)
		const record = result.records[0]?.record
		expect(record?.source).toBe('nip17')
		if (record?.source !== 'nip17') throw new Error('expected NIP-17 record')
		expect(record.transport.rumorId).toBe(record.id)
	})
})

describe('order chat read orchestration authorization-before-deduplication', () => {
	test('does not let invalid NIP-17 wrapper context suppress authorized legacy', async () => {
		const rumor = sentRumor()
		const legacy = legacyEventFromRumor(rumor, ACTIVE_PRIVATE_KEY)
		const invalidWrap = {
			...signedTransportEvent('invalid-wrapper'),
			id: 'A'.repeat(64),
		}
		const result = await readOrderChatMessages(
			baseParams({
				fetchLegacyMessages: async () => [legacy],
				readEncryptedMessages: async () => readyNip17([unwrappedMessage(rumor, { giftWrap: invalidWrap })]),
			}),
		)

		expect(result.records).toHaveLength(1)
		expect(result.records[0]?.record.source).toBe('legacy')
	})

	test('does not let an invalid NIP-17 duplicate suppress a later authorized duplicate', async () => {
		const rumor = sentRumor()
		const invalidWrap = {
			...signedTransportEvent('invalid-first'),
			id: 'A'.repeat(64),
		}
		const valid = unwrappedMessage(rumor, { giftWrap: signedTransportEvent('valid-second') })
		const result = await readOrderChatMessages(
			baseParams({
				readEncryptedMessages: async () => readyNip17([unwrappedMessage(rumor, { giftWrap: invalidWrap }), valid]),
			}),
		)

		expect(result.records).toHaveLength(1)
		expect(result.records[0]?.record.source).toBe('nip17')
		if (result.records[0]?.record.source !== 'nip17') throw new Error('expected NIP-17 record')
		expect(result.records[0].record.transport.giftWrapId).toBe(valid.giftWrap.id)
	})

	test('overlays authorized NIP-17 over authorized legacy for the same canonical ID', async () => {
		const rumor = sentRumor()
		const result = await readOrderChatMessages(
			baseParams({
				fetchLegacyMessages: async () => [legacyEventFromRumor(rumor, ACTIVE_PRIVATE_KEY)],
				readEncryptedMessages: async () => readyNip17([unwrappedMessage(rumor)]),
			}),
		)

		expect(result.records).toHaveLength(1)
		expect(result.records[0]?.record.source).toBe('nip17')
		expect(result.records[0]?.record.id).toBe(rumor.id)
	})
})

describe('order chat read orchestration wrapper representative selection', () => {
	test('accepts a missing wrapper ID and rejects only a malformed present wrapper ID', async () => {
		const missingRumor = sentRumor({ content: 'missing wrapper' })
		const invalidRumor = sentRumor({ content: 'invalid wrapper', createdAt: CREATED_AT + 1 })
		const missingIdWrap = { ...signedTransportEvent('missing-id'), id: '' }
		const invalidIdWrap = { ...signedTransportEvent('invalid-id'), id: 'not-canonical' }
		const result = await readOrderChatMessages(
			baseParams({
				readEncryptedMessages: async () =>
					readyNip17([
						unwrappedMessage(missingRumor, { giftWrap: missingIdWrap }),
						unwrappedMessage(invalidRumor, { giftWrap: invalidIdWrap }),
					]),
			}),
		)

		expect(result.records).toHaveLength(1)
		expect(result.records[0]?.record.id).toBe(missingRumor.id)
		if (result.records[0]?.record.source !== 'nip17') throw new Error('expected NIP-17 record')
		expect(result.records[0].record.transport.giftWrapId).toBeUndefined()
	})

	test('prefers a canonical wrapper ID over missing and the lower canonical ID regardless of input order', async () => {
		const rumor = sentRumor()
		const firstWrap = signedTransportEvent('wrapper-a')
		const secondWrap = signedTransportEvent('wrapper-b')
		const [lowerWrap, higherWrap] = [firstWrap, secondWrap].sort((a, b) => a.id.localeCompare(b.id))
		const missingIdWrap = { ...signedTransportEvent('missing-wrapper-id'), id: '' }
		const candidates = [
			unwrappedMessage(rumor, { giftWrap: higherWrap }),
			unwrappedMessage(rumor, { giftWrap: missingIdWrap }),
			unwrappedMessage(rumor, { giftWrap: lowerWrap }),
		]

		for (const messages of [candidates, [...candidates].reverse()]) {
			const result = await readOrderChatMessages(baseParams({ readEncryptedMessages: async () => readyNip17(messages) }))
			const record = result.records[0]?.record
			expect(record?.source).toBe('nip17')
			if (record?.source !== 'nip17') throw new Error('expected NIP-17 record')
			expect(record.id).toBe(rumor.id)
			expect(record.transport.giftWrapId).toBe(lowerWrap.id)
		}
	})

	test('sorts final records by inner timestamp and ID rather than wrapper identity', async () => {
		const earlyA = sentRumor({ content: 'early-a', createdAt: CREATED_AT })
		const earlyB = sentRumor({ content: 'early-b', createdAt: CREATED_AT })
		const late = sentRumor({ content: 'late', createdAt: CREATED_AT + 1 })
		const sameTimeIds = [earlyA.id, earlyB.id].sort((a, b) => a.localeCompare(b))
		const result = await readOrderChatMessages(
			baseParams({
				readEncryptedMessages: async () =>
					readyNip17([
						unwrappedMessage(late, { giftWrap: signedTransportEvent('a') }),
						unwrappedMessage(earlyB, { giftWrap: signedTransportEvent('b') }),
						unwrappedMessage(earlyA, { giftWrap: signedTransportEvent('c') }),
					]),
			}),
		)

		expect(result.records.map(({ record }) => record.id)).toEqual([...sameTimeIds, late.id])
	})
})

describe('order chat read orchestration correlation metadata', () => {
	async function correlationFor(tags: string[][], withOrderContext = true): Promise<string | undefined> {
		const event = signedLegacyEvent({ tags })
		const result = await readOrderChatMessages(
			baseParams({
				...(withOrderContext
					? {
							orderContext: {
								orderId: ORDER_ID,
								buyerPubkey: ACTIVE_USER_PUBKEY,
								sellerPubkey: COUNTERPARTY_PUBKEY,
							},
						}
					: {}),
				fetchLegacyMessages: async () => [event],
			}),
		)

		return result.records[0]?.correlation.status
	}

	test('uses participant_pair without order context or a subject', async () => {
		expect(await correlationFor([['p', COUNTERPARTY_PUBKEY]], false)).toBe('participant_pair')
		expect(await correlationFor([['p', COUNTERPARTY_PUBKEY]])).toBe('participant_pair')
	})

	test('treats one empty subject as participant_pair', async () => {
		expect(
			await correlationFor([
				['p', COUNTERPARTY_PUBKEY],
				['subject', ''],
			]),
		).toBe('participant_pair')
	})

	test('classifies one matching subject as structural order correlation', async () => {
		expect(
			await correlationFor([
				['p', COUNTERPARTY_PUBKEY],
				['subject', ORDER_ID],
			]),
		).toBe('subject_matches_order')
	})

	test('classifies one nonempty nonmatching subject without exposing it', async () => {
		const privateSubject = 'private-other-order'
		const event = signedLegacyEvent({
			tags: [
				['p', COUNTERPARTY_PUBKEY],
				['subject', privateSubject],
			],
		})
		const result = await readOrderChatMessages(
			baseParams({
				orderContext: {
					orderId: ORDER_ID,
					buyerPubkey: ACTIVE_USER_PUBKEY,
					sellerPubkey: COUNTERPARTY_PUBKEY,
				},
				fetchLegacyMessages: async () => [event],
			}),
		)

		expect(result.records[0]?.correlation).toEqual({ status: 'other_subject' })
		expect(JSON.stringify(result.records[0]?.correlation)).not.toContain(privateSubject)
	})

	test('treats duplicate or conflicting subjects as ambiguous', async () => {
		expect(
			await correlationFor([
				['p', COUNTERPARTY_PUBKEY],
				['subject', ORDER_ID],
				['subject', ORDER_ID],
			]),
		).toBe('ambiguous_subject')
		expect(
			await correlationFor([
				['p', COUNTERPARTY_PUBKEY],
				['subject', ORDER_ID],
				['subject', 'conflicting-private-order'],
			]),
		).toBe('ambiguous_subject')
	})
})

describe('order chat read orchestration public failure shape', () => {
	test('keeps all-source failure codes bounded and private', async () => {
		const nip17Code: Nip17ReadFailureCode = 'gift_wrap_fetch_failed'
		const result = await readOrderChatMessages(
			baseParams({
				fetchLegacyMessages: async () => {
					throw new Error(PRIVATE_THROWN_TEXT)
				},
				readEncryptedMessages: async () => ({
					status: 'failed',
					error: { code: nip17Code },
					messages: [],
				}),
			}),
		)

		expect(result).toEqual({
			status: 'failed',
			error: { code: 'all_sources_failed' },
			records: [],
			legacy: { status: 'failed', code: 'legacy_read_failed' },
			nip17: { status: 'failed', code: nip17Code },
		})
		expect(JSON.stringify(result)).not.toContain(PRIVATE_THROWN_TEXT)
	})
})
