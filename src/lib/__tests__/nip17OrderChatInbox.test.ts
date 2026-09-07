import { describe, expect, spyOn, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import type { FetchOptions, NostrFilter, NostrEvent, NostrIo } from '../nostr/io'
import { createNip17GiftWrapsWithSigner } from '../nostr/nip17'
import { NIP17_DM_RELAY_LIST_KIND } from '../nostr/nip17Relays'
import { NIP59_GIFT_WRAP_KIND } from '../nostr/nip59'
import {
	readNip17OrderChatInbox,
	type ReadNip17OrderChatInboxErrorCode,
	type ReadNip17OrderChatInboxParams,
	type ReadNip17OrderChatInboxResult,
} from '../orders/nip17OrderChatInbox'
import * as nip17OrderRead from '../orders/nip17OrderRead'
import type { Nip17OrderTransportSigner } from '../orders/nip17OrderTransport'
import {
	createOrderChatRumor,
	createOrderCreationRumor,
	createPaymentReceiptRumor,
	type OrderMessageRumor,
} from '../orders/orderMessageRumor'

type FetchCall = {
	filter: NostrFilter | NostrFilter[]
	options?: FetchOptions
}

type FetchHarnessOptions = {
	relayListEvents?: NostrEvent[]
	giftWraps?: NostrEvent[]
	rejectRelayList?: boolean
	rejectGiftWraps?: boolean
	beforeGiftWrapReturn?: () => void
}

type SignerOptions = {
	nip44?: boolean
	user?: 'ready' | 'missing' | 'reject'
	userLookup?: () => Promise<{ pubkey?: string }>
	decryptedCiphertexts?: string[]
	beforeDecrypt?: () => void
}

const DISCOVERY_RELAYS = ['wss://discovery.example']
const INBOX_RELAYS = ['wss://inbox.example']

function createSigner(privateKey: Uint8Array, options: SignerOptions = {}): Nip17OrderTransportSigner {
	const pubkey = getPublicKey(privateKey)

	return {
		user: async () => {
			if (options.userLookup) return options.userLookup()
			if (options.user === 'reject') throw new Error('private signer failure')
			if (options.user === 'missing') return {}
			return { pubkey }
		},
		encryptionEnabled: async () => (options.nip44 === false ? [] : ['nip44']),
		encrypt: async (recipient: { pubkey: string }, plaintext: string) => {
			const conversationKey = nip44.v2.utils.getConversationKey(privateKey, recipient.pubkey)
			return nip44.v2.encrypt(plaintext, conversationKey)
		},
		decrypt: async (sender: { pubkey: string }, ciphertext: string) => {
			options.beforeDecrypt?.()
			options.decryptedCiphertexts?.push(ciphertext)
			const conversationKey = nip44.v2.utils.getConversationKey(privateKey, sender.pubkey)
			return nip44.v2.decrypt(ciphertext, conversationKey)
		},
		sign: async (event: { kind: number; created_at: number; tags: string[][]; content: string }) => {
			return finalizeEvent(
				{
					kind: event.kind,
					created_at: event.created_at,
					tags: event.tags,
					content: event.content,
				},
				privateKey,
			).sig
		},
	} as unknown as Nip17OrderTransportSigner
}

function relayListEvent(privateKey: Uint8Array, relayUrls: string[], createdAt = 100): NostrEvent {
	return finalizeEvent(
		{
			kind: NIP17_DM_RELAY_LIST_KIND,
			created_at: createdAt,
			tags: relayUrls.map((relayUrl) => ['relay', relayUrl]),
			content: '',
		},
		privateKey,
	)
}

function signedEvent(privateKey: Uint8Array, kind: number, createdAt = 100): NostrEvent {
	return finalizeEvent(
		{
			kind,
			created_at: createdAt,
			tags: [],
			content: '',
		},
		privateKey,
	)
}

function malformedGiftWrap(recipientPubkey: string): NostrEvent {
	return finalizeEvent(
		{
			kind: NIP59_GIFT_WRAP_KIND,
			created_at: 999,
			tags: [['p', recipientPubkey]],
			content: 'private malformed ciphertext',
		},
		generateSecretKey(),
	)
}

function fetchHarness(options: FetchHarnessOptions = {}): {
	fetchEvents: NostrIo['fetchEvents']
	calls: FetchCall[]
} {
	const calls: FetchCall[] = []

	return {
		calls,
		fetchEvents: async (filter, fetchOptions) => {
			calls.push({
				filter,
				...(fetchOptions ? { options: fetchOptions } : {}),
			})

			const firstFilter = Array.isArray(filter) ? filter[0] : filter
			const kind = firstFilter?.kinds?.[0]

			if (kind === NIP17_DM_RELAY_LIST_KIND) {
				if (options.rejectRelayList) throw new Error('private relay-list failure')
				return options.relayListEvents ?? []
			}

			if (kind === NIP59_GIFT_WRAP_KIND) {
				if (options.rejectGiftWraps) throw new Error('private gift-wrap failure')
				options.beforeGiftWrapReturn?.()
				return options.giftWraps ?? []
			}

			throw new Error(`unexpected test fetch kind ${kind}`)
		},
	}
}

function baseParams(
	activeUserPrivateKey: Uint8Array,
	fetchEvents: NostrIo['fetchEvents'],
	overrides: Partial<ReadNip17OrderChatInboxParams> = {},
): ReadNip17OrderChatInboxParams {
	return {
		activeUserPubkey: getPublicKey(activeUserPrivateKey),
		signer: createSigner(activeUserPrivateKey),
		fetchEvents,
		...overrides,
	}
}

function expectFailure(result: ReadNip17OrderChatInboxResult, code: ReadNip17OrderChatInboxErrorCode): void {
	expect(result).toEqual({
		status: 'failed',
		error: { code },
		messages: [],
	})
}

async function giftWrapForRumor(
	rumor: OrderMessageRumor,
	senderPrivateKey: Uint8Array,
	recipientPubkey: string,
	recipient: 'recipient' | 'sender' = 'recipient',
	createdAt = 500,
): Promise<NostrEvent> {
	const wraps = await createNip17GiftWrapsWithSigner({
		rumor,
		signer: createSigner(senderPrivateKey),
		recipientPubkey,
		createdAt,
	})

	return wraps[recipient].giftWrap
}

describe('NIP-17 order chat inbox input boundary', () => {
	test('rejects an invalid active-user pubkey before signer or relay access', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const harness = fetchHarness()

		const result = await readNip17OrderChatInbox({
			...baseParams(activeUserPrivateKey, harness.fetchEvents),
			activeUserPubkey: 'not-a-pubkey',
			signer: null,
		})

		expectFailure(result, 'invalid_active_user')
		expect(harness.calls).toEqual([])
	})

	test('rejects uppercase active-user pubkey before signer or relay access', async () => {
		const activeUserPubkey = 'a'.repeat(64)
		const uppercaseActiveUserPubkey = activeUserPubkey.toUpperCase()
		const harness = fetchHarness()
		let signerUserCalls = 0
		const signer = {
			user: async () => {
				signerUserCalls += 1
				return { pubkey: activeUserPubkey }
			},
		} as unknown as Nip17OrderTransportSigner

		const result = await readNip17OrderChatInbox({
			activeUserPubkey: uppercaseActiveUserPubkey,
			signer,
			fetchEvents: harness.fetchEvents,
		})

		expectFailure(result, 'invalid_active_user')
		expect(signerUserCalls).toBe(0)
		expect(harness.calls).toEqual([])
	})

	test('rejects an invalid optional counterparty before relay access', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const harness = fetchHarness()

		const result = await readNip17OrderChatInbox({
			...baseParams(activeUserPrivateKey, harness.fetchEvents),
			counterpartyPubkey: 'not-a-pubkey',
		})

		expectFailure(result, 'invalid_counterparty')
		expect(harness.calls).toEqual([])
	})

	test('rejects uppercase counterparty pubkey before signer or relay access', async () => {
		const activeUserPubkey = 'a'.repeat(64)
		const uppercaseCounterpartyPubkey = 'b'.repeat(64).toUpperCase()
		const harness = fetchHarness()
		let signerUserCalls = 0
		const signer = {
			user: async () => {
				signerUserCalls += 1
				return { pubkey: activeUserPubkey }
			},
		} as unknown as Nip17OrderTransportSigner

		const result = await readNip17OrderChatInbox({
			activeUserPubkey,
			counterpartyPubkey: uppercaseCounterpartyPubkey,
			signer,
			fetchEvents: harness.fetchEvents,
		})

		expectFailure(result, 'invalid_counterparty')
		expect(signerUserCalls).toBe(0)
		expect(harness.calls).toEqual([])
	})

	for (const [label, giftWrapLimit] of [
		['zero', 0],
		['negative', -1],
		['fractional', 1.5],
		['over maximum', 501],
		['infinite', Number.POSITIVE_INFINITY],
		['NaN', Number.NaN],
	] as const) {
		test(`rejects ${label} gift-wrap limit before relay access`, async () => {
			const activeUserPrivateKey = generateSecretKey()
			const harness = fetchHarness()

			const result = await readNip17OrderChatInbox({
				...baseParams(activeUserPrivateKey, harness.fetchEvents),
				giftWrapLimit,
			})

			expectFailure(result, 'invalid_limit')
			expect(harness.calls).toEqual([])
		})
	}

	for (const [label, timeoutMs] of [
		['zero', 0],
		['negative', -1],
		['fractional', 1.5],
		['infinite', Number.POSITIVE_INFINITY],
		['NaN', Number.NaN],
	] as const) {
		test(`rejects ${label} timeout before relay access`, async () => {
			const activeUserPrivateKey = generateSecretKey()
			const harness = fetchHarness()

			const result = await readNip17OrderChatInbox({
				...baseParams(activeUserPrivateKey, harness.fetchEvents),
				timeoutMs,
			})

			expectFailure(result, 'invalid_timeout')
			expect(harness.calls).toEqual([])
		})
	}

	test('distinguishes unavailable signers, pubkey mismatch, and unavailable NIP-44 decrypt', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const harness = fetchHarness()

		for (const signer of [
			null,
			{} as Nip17OrderTransportSigner,
			createSigner(activeUserPrivateKey, { user: 'reject' }),
			createSigner(activeUserPrivateKey, { user: 'missing' }),
		]) {
			const result = await readNip17OrderChatInbox({
				activeUserPubkey,
				signer,
				fetchEvents: harness.fetchEvents,
			})
			expectFailure(result, 'signer_unavailable')
		}

		const mismatch = await readNip17OrderChatInbox({
			activeUserPubkey,
			signer: createSigner(generateSecretKey()),
			fetchEvents: harness.fetchEvents,
		})
		expectFailure(mismatch, 'signer_pubkey_mismatch')

		const nip44Unavailable = await readNip17OrderChatInbox({
			activeUserPubkey,
			signer: createSigner(activeUserPrivateKey, { nip44: false }),
			fetchEvents: harness.fetchEvents,
		})
		expectFailure(nip44Unavailable, 'nip44_decrypt_unavailable')
		expect(harness.calls).toEqual([])
	})
})

describe('NIP-17 order chat inbox relay-list discovery', () => {
	test('uses the strict existing kind-10050 filter and caller discovery options', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const harness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
		})

		const result = await readNip17OrderChatInbox({
			...baseParams(activeUserPrivateKey, harness.fetchEvents),
			discoveryRelayUrls: DISCOVERY_RELAYS,
			timeoutMs: 3210,
		})

		expect(result.status).toBe('ready')
		expect(harness.calls[0]).toEqual({
			filter: {
				kinds: [NIP17_DM_RELAY_LIST_KIND],
				authors: [activeUserPubkey],
				limit: 1,
			},
			options: {
				relayUrls: DISCOVERY_RELAYS,
				timeoutMs: 3210,
			},
		})
		expect(harness.calls[0]?.filter).not.toHaveProperty('kinds', [14, 16, 17])
	})

	test('maps relay-list fetch rejection without leaking the thrown value', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const harness = fetchHarness({ rejectRelayList: true })

		const result = await readNip17OrderChatInbox(baseParams(activeUserPrivateKey, harness.fetchEvents))

		expectFailure(result, 'relay_list_fetch_failed')
		expect(JSON.stringify(result)).not.toContain('private relay-list failure')
		expect(harness.calls).toHaveLength(1)
	})

	test('verifies complete raw events before deterministic replacement selection and relay normalization', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const wrongAuthorPrivateKey = generateSecretKey()
		const older = relayListEvent(activeUserPrivateKey, ['wss://older.example'], 100)
		const newer = relayListEvent(
			activeUserPrivateKey,
			[' wss://Inbox.Example/ ', 'wss://inbox.example', 'https://not-a-relay.example'],
			200,
		)
		const forgedSignature = { ...relayListEvent(activeUserPrivateKey, ['wss://forged.example'], 500), sig: '0'.repeat(128) }
		const nonCanonicalId = { ...relayListEvent(activeUserPrivateKey, ['wss://wrong-id.example'], 600), id: '0'.repeat(64) }
		const wrongKind = signedEvent(activeUserPrivateKey, 10002, 700)
		const wrongAuthor = relayListEvent(wrongAuthorPrivateKey, ['wss://wrong-author.example'], 800)
		const candidates: NostrEvent[] = [forgedSignature, nonCanonicalId, wrongKind, wrongAuthor, older, newer]
		const harness = fetchHarness({ relayListEvents: candidates })

		const result = await readNip17OrderChatInbox(baseParams(activeUserPrivateKey, harness.fetchEvents))

		expect(candidates.every((event) => Boolean(event.id && event.sig && event.pubkey && event.tags))).toBe(true)
		expect(result).toEqual({
			status: 'ready',
			relayUrls: ['wss://inbox.example'],
			messages: [],
		})
		expect(harness.calls).toHaveLength(2)
		expect(harness.calls[1]?.options?.relayUrls).toEqual(['wss://inbox.example'])
		expect(harness.calls[0]?.filter).toEqual({
			kinds: [NIP17_DM_RELAY_LIST_KIND],
			authors: [activeUserPubkey],
			limit: 1,
		})
	})

	test('authenticates and narrows a stateful relay-list candidate from one tags snapshot', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const authenticatedRelay = 'wss://authenticated.example'
		const substitutedRelay = 'wss://substituted.example'
		const signed = relayListEvent(activeUserPrivateKey, [authenticatedRelay], 200)
		let tagsReads = 0
		const statefulCandidate = Object.defineProperty({ ...signed }, 'tags', {
			enumerable: true,
			get: () => {
				tagsReads += 1
				return tagsReads === 1 ? signed.tags : [['relay', substitutedRelay]]
			},
		}) as NostrEvent
		const harness = fetchHarness({ relayListEvents: [statefulCandidate] })

		const result = await readNip17OrderChatInbox(baseParams(activeUserPrivateKey, harness.fetchEvents))

		expect(result).toEqual({
			status: 'ready',
			relayUrls: [authenticatedRelay],
			messages: [],
		})
		expect(tagsReads).toBe(1)
		expect(harness.calls[1]?.options?.relayUrls).toEqual([authenticatedRelay])
		expect(harness.calls.some((call) => call.options?.relayUrls?.includes(substitutedRelay))).toBe(false)
	})

	test('ignores throwing, sparse, and non-string relay-list snapshots without exposing private failures', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const privateFailure = 'private relay accessor failure'
		const signed = relayListEvent(activeUserPrivateKey, ['wss://must-not-query.example'], 200)
		const throwingTopLevel = Object.defineProperty({ ...signed }, 'tags', {
			enumerable: true,
			get: () => {
				throw new Error(privateFailure)
			},
		})
		const throwingInnerTag = ['relay', 'wss://nested-must-not-query.example']
		Object.defineProperty(throwingInnerTag, 1, {
			enumerable: true,
			get: () => {
				throw new Error(privateFailure)
			},
		})
		const sparseOuter: string[][] = []
		sparseOuter.length = 1
		const sparseInner: string[] = []
		sparseInner.length = 2
		sparseInner[0] = 'relay'
		const malformedCandidates = [
			throwingTopLevel,
			{ ...signed, tags: [throwingInnerTag] },
			{ ...signed, tags: sparseOuter },
			{ ...signed, tags: [sparseInner] },
			{ ...signed, tags: [['relay', 123]] },
		] as unknown as NostrEvent[]
		const harness = fetchHarness({ relayListEvents: malformedCandidates })

		const result = await readNip17OrderChatInbox(baseParams(activeUserPrivateKey, harness.fetchEvents))

		expectFailure(result, 'relay_list_missing')
		expect(harness.calls).toHaveLength(1)
		expect(JSON.stringify(result)).not.toContain(privateFailure)
		expect(JSON.stringify(result)).not.toContain('must-not-query')
	})

	test('uses the lower signed event id when verified kind-10050 replacements have equal timestamps', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const first = relayListEvent(activeUserPrivateKey, ['wss://first.example'], 200)
		const second = relayListEvent(activeUserPrivateKey, ['wss://second.example'], 200)
		const expected = [first, second].sort((a, b) => a.id.localeCompare(b.id))[0]
		const harness = fetchHarness({
			relayListEvents: expected === first ? [second, first] : [first, second],
		})

		const result = await readNip17OrderChatInbox(baseParams(activeUserPrivateKey, harness.fetchEvents))

		expect(result.status).toBe('ready')
		if (result.status !== 'ready') throw new Error('expected ready inbox')
		expect(result.relayUrls).toEqual(expected.tags.map((tag) => tag[1]))
		expect(harness.calls[1]?.options?.relayUrls).toEqual(result.relayUrls)
	})

	test('preserves missing and empty relay-list states and never falls back to an inbox read', async () => {
		const activeUserPrivateKey = generateSecretKey()

		const missingHarness = fetchHarness()
		const missing = await readNip17OrderChatInbox(baseParams(activeUserPrivateKey, missingHarness.fetchEvents))
		expectFailure(missing, 'relay_list_missing')
		expect(missingHarness.calls).toHaveLength(1)

		const emptyHarness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, ['https://not-a-relay.example'])],
		})
		const empty = await readNip17OrderChatInbox(baseParams(activeUserPrivateKey, emptyHarness.fetchEvents))
		expectFailure(empty, 'relay_list_empty')
		expect(emptyHarness.calls).toHaveLength(1)
	})
})

describe('NIP-17 order chat inbox targeting and mapping', () => {
	test('targets only resolved inbox relays with bounded kind-1059 recipient filter and timeout', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const harness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
		})

		const result = await readNip17OrderChatInbox({
			...baseParams(activeUserPrivateKey, harness.fetchEvents),
			discoveryRelayUrls: DISCOVERY_RELAYS,
			giftWrapLimit: 25,
			timeoutMs: 4567,
		})

		expect(result).toEqual({
			status: 'ready',
			relayUrls: INBOX_RELAYS,
			messages: [],
		})
		expect(harness.calls).toEqual([
			{
				filter: {
					kinds: [NIP17_DM_RELAY_LIST_KIND],
					authors: [activeUserPubkey],
					limit: 1,
				},
				options: {
					relayUrls: DISCOVERY_RELAYS,
					timeoutMs: 4567,
				},
			},
			{
				filter: {
					kinds: [NIP59_GIFT_WRAP_KIND],
					'#p': [activeUserPubkey],
					limit: 25,
				},
				options: {
					relayUrls: INBOX_RELAYS,
					timeoutMs: 4567,
				},
			},
		])
		expect(
			harness.calls
				.flatMap((call) => (Array.isArray(call.filter) ? call.filter : [call.filter]))
				.some((filter) => {
					return filter.kinds?.some((kind) => [14, 16, 17].includes(kind))
				}),
		).toBe(false)
	})

	test('uses the repo-local default gift-wrap limit of 500', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const harness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
		})

		await readNip17OrderChatInbox(baseParams(activeUserPrivateKey, harness.fetchEvents))

		expect(harness.calls[1]?.filter).toMatchObject({ limit: 500 })
	})

	test('maps gift-wrap fetch rejection without leaking relay payloads', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const harness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
			rejectGiftWraps: true,
		})

		const result = await readNip17OrderChatInbox(baseParams(activeUserPrivateKey, harness.fetchEvents))

		expectFailure(result, 'gift_wrap_fetch_failed')
		expect(JSON.stringify(result)).not.toContain('private gift-wrap failure')
		expect(harness.calls).toHaveLength(2)
	})

	test('fails before unwrap when the signer becomes mismatched or unavailable after relay reads', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const counterpartyPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const counterpartyPubkey = getPublicKey(counterpartyPrivateKey)
		const rumor = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'private pre-unwrap identity',
			createdAt: 100,
		})
		const giftWrap = await giftWrapForRumor(rumor, counterpartyPrivateKey, activeUserPubkey)

		for (const scenario of [
			{
				code: 'signer_pubkey_mismatch' as const,
				nextIdentity: getPublicKey(generateSecretKey()),
			},
			{
				code: 'signer_unavailable' as const,
				nextIdentity: undefined,
			},
		]) {
			let signerIdentity: string | undefined = activeUserPubkey
			const decryptedCiphertexts: string[] = []
			const harness = fetchHarness({
				relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
				giftWraps: [giftWrap],
				beforeGiftWrapReturn: () => {
					signerIdentity = scenario.nextIdentity
				},
			})

			const result = await readNip17OrderChatInbox({
				...baseParams(activeUserPrivateKey, harness.fetchEvents),
				signer: createSigner(activeUserPrivateKey, {
					userLookup: async () => (signerIdentity ? { pubkey: signerIdentity } : {}),
					decryptedCiphertexts,
				}),
			})

			expectFailure(result, scenario.code)
			expect(decryptedCiphertexts).toEqual([])
			expect(JSON.stringify(result)).not.toContain(rumor.content)
			expect(JSON.stringify(result)).not.toContain(giftWrap.content)
		}
	})

	test('latches transient signer mismatch or unavailability observed by unwrap-time user lookups', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const counterpartyPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const counterpartyPubkey = getPublicKey(counterpartyPrivateKey)
		const rumor = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'private transient identity',
			createdAt: 100,
		})
		const giftWrap = await giftWrapForRumor(rumor, counterpartyPrivateKey, activeUserPubkey)

		for (const scenario of [
			{
				code: 'signer_pubkey_mismatch' as const,
				transientIdentity: getPublicKey(generateSecretKey()),
			},
			{
				code: 'signer_unavailable' as const,
				transientIdentity: undefined,
			},
		]) {
			let phase: 'initial' | 'pre_unwrap' | 'unwrap' | 'restored' = 'initial'
			const decryptedCiphertexts: string[] = []
			const harness = fetchHarness({
				relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
				giftWraps: [giftWrap],
				beforeGiftWrapReturn: () => {
					phase = 'pre_unwrap'
				},
			})
			const signer = createSigner(activeUserPrivateKey, {
				userLookup: async () => {
					if (phase === 'pre_unwrap') {
						phase = 'unwrap'
						return { pubkey: activeUserPubkey }
					}
					if (phase === 'unwrap') {
						phase = 'restored'
						return scenario.transientIdentity ? { pubkey: scenario.transientIdentity } : {}
					}
					return { pubkey: activeUserPubkey }
				},
				decryptedCiphertexts,
			})

			const result = await readNip17OrderChatInbox({
				...baseParams(activeUserPrivateKey, harness.fetchEvents),
				signer,
			})

			expectFailure(result, scenario.code)
			expect<'initial' | 'pre_unwrap' | 'unwrap' | 'restored'>(phase).toBe('restored')
			expect(JSON.stringify(result)).not.toContain(rumor.content)
			expect(JSON.stringify(result)).not.toContain(giftWrap.content)
		}
	})

	test('rechecks signer identity after unwrap decryptions complete', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const counterpartyPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const counterpartyPubkey = getPublicKey(counterpartyPrivateKey)
		const rumor = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'private post-unwrap identity',
			createdAt: 100,
		})
		const giftWrap = await giftWrapForRumor(rumor, counterpartyPrivateKey, activeUserPubkey)
		let signerIdentity = activeUserPubkey
		const harness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
			giftWraps: [giftWrap],
		})

		const result = await readNip17OrderChatInbox({
			...baseParams(activeUserPrivateKey, harness.fetchEvents),
			signer: createSigner(activeUserPrivateKey, {
				userLookup: async () => ({ pubkey: signerIdentity }),
				beforeDecrypt: () => {
					signerIdentity = getPublicKey(generateSecretKey())
				},
			}),
		})

		expectFailure(result, 'signer_pubkey_mismatch')
		expect(JSON.stringify(result)).not.toContain(rumor.content)
		expect(JSON.stringify(result)).not.toContain(giftWrap.content)
	})

	test('fails the entire read when an unwrap result reports a different user identity', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const counterpartyPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const counterpartyPubkey = getPublicKey(counterpartyPrivateKey)
		const rumor = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'private mismatched message identity',
			createdAt: 100,
		})
		const giftWrap = await giftWrapForRumor(rumor, counterpartyPrivateKey, activeUserPubkey)
		const signer = createSigner(activeUserPrivateKey)
		const [message] = await nip17OrderRead.unwrapNip17OrderMessages({
			giftWraps: [giftWrap],
			signer,
		})
		if (!message) throw new Error('expected real unwrapped fixture')
		const unwrapSpy = spyOn(nip17OrderRead, 'unwrapNip17OrderMessages').mockResolvedValue([
			{
				...message,
				userPubkey: counterpartyPubkey,
			},
		])
		const harness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
			giftWraps: [giftWrap],
		})

		try {
			const result = await readNip17OrderChatInbox({
				activeUserPubkey,
				signer,
				fetchEvents: harness.fetchEvents,
			})

			expectFailure(result, 'signer_pubkey_mismatch')
			expect(JSON.stringify(result)).not.toContain(rumor.content)
			expect(JSON.stringify(result)).not.toContain(giftWrap.content)
		} finally {
			unwrapSpy.mockRestore()
		}
	})

	test('does not let caller-controlled outer or inner tag toJSON values collide during fingerprinting', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const counterpartyPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const counterpartyPubkey = getPublicKey(counterpartyPrivateKey)
		const unrelatedPubkey = getPublicKey(generateSecretKey())
		const rumor = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'plain tag snapshot message',
			createdAt: 100,
		})
		const sentinelRumor = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'excluded custom toJSON sentinel',
			createdAt: 200,
		})
		const wrap = await giftWrapForRumor(rumor, counterpartyPrivateKey, activeUserPubkey, 'recipient', 700)
		const sentinelWrap = await giftWrapForRumor(sentinelRumor, counterpartyPrivateKey, activeUserPubkey, 'recipient', 600)
		const serializedTags = wrap.tags.map((tag) => [...tag])

		for (const toJsonTarget of ['outer', 'inner'] as const) {
			const tagsWithToJson = (recipientPubkey: string): string[][] => {
				const tag = ['p', recipientPubkey]
				const tags = [tag]

				if (toJsonTarget === 'outer') {
					Object.defineProperty(tags, 'toJSON', {
						value: () => serializedTags,
					})
				} else {
					Object.defineProperty(tag, 'toJSON', {
						value: () => serializedTags[0],
					})
				}

				return tags
			}

			const invalidFirst = {
				...wrap,
				tags: tagsWithToJson(unrelatedPubkey),
			}
			const validSecond = {
				...wrap,
				tags: tagsWithToJson(activeUserPubkey),
			}
			const decryptedCiphertexts: string[] = []
			const harness = fetchHarness({
				relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
				giftWraps: [invalidFirst, validSecond, sentinelWrap],
			})

			const result = await readNip17OrderChatInbox({
				...baseParams(activeUserPrivateKey, harness.fetchEvents),
				signer: createSigner(activeUserPrivateKey, { decryptedCiphertexts }),
				giftWrapLimit: 2,
			})

			expect(result.status).toBe('ready')
			if (result.status !== 'ready') throw new Error('expected ready inbox')
			expect(result.messages.map((message) => message.rumor.id)).toEqual([rumor.id])
			expect(result.messages.map((message) => message.rumor.id)).not.toContain(sentinelRumor.id)
			expect(decryptedCiphertexts.filter((ciphertext) => ciphertext === wrap.content)).toHaveLength(1)
			expect(decryptedCiphertexts).not.toContain(sentinelWrap.content)
		}
	})

	test('fingerprints stateful nested tag values from their first observed plain snapshot', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const counterpartyPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const counterpartyPubkey = getPublicKey(counterpartyPrivateKey)
		const rumor = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'stateful nested tag snapshot',
			createdAt: 100,
		})
		const wrap = await giftWrapForRumor(rumor, counterpartyPrivateKey, activeUserPubkey, 'recipient', 700)
		const statefulTags = (firstRecipient: string): string[][] => {
			const tag = ['p', activeUserPubkey]
			let recipientReads = 0
			Object.defineProperty(tag, 1, {
				enumerable: true,
				get: () => {
					recipientReads += 1
					return recipientReads === 1 ? firstRecipient : activeUserPubkey
				},
			})
			return [tag]
		}
		const first = {
			...wrap,
			tags: statefulTags(getPublicKey(generateSecretKey())),
		}
		const second = {
			...wrap,
			tags: statefulTags(getPublicKey(generateSecretKey())),
		}
		const decryptedCiphertexts: string[] = []
		const harness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
			giftWraps: [first, second],
		})

		const result = await readNip17OrderChatInbox({
			...baseParams(activeUserPrivateKey, harness.fetchEvents),
			signer: createSigner(activeUserPrivateKey, { decryptedCiphertexts }),
			giftWrapLimit: 2,
		})

		expect(result.status).toBe('ready')
		if (result.status !== 'ready') throw new Error('expected ready inbox')
		expect(decryptedCiphertexts.filter((ciphertext) => ciphertext === wrap.content)).toHaveLength(2)
		expect(result.messages.map((message) => message.rumor.id)).toEqual([rumor.id])
	})

	test('collapses exact complete mirrored wrappers before admission without mutating the fetched array', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const counterpartyPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const counterpartyPubkey = getPublicKey(counterpartyPrivateKey)
		const rumorA = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'exact mirror a',
			createdAt: 100,
		})
		const rumorB = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'distinct wrapper b',
			createdAt: 200,
		})
		const wrapA = await giftWrapForRumor(rumorA, counterpartyPrivateKey, activeUserPubkey, 'recipient', 700)
		const exactCloneA = {
			...wrapA,
			tags: wrapA.tags.map((tag) => [...tag]),
		}
		const wrapB = await giftWrapForRumor(rumorB, counterpartyPrivateKey, activeUserPubkey, 'recipient', 600)
		const fetchedGiftWraps = [wrapA, exactCloneA, wrapB]
		const originalFetchedGiftWraps = [...fetchedGiftWraps]
		const decryptedCiphertexts: string[] = []
		const harness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
			giftWraps: fetchedGiftWraps,
		})

		const result = await readNip17OrderChatInbox({
			...baseParams(activeUserPrivateKey, harness.fetchEvents),
			signer: createSigner(activeUserPrivateKey, { decryptedCiphertexts }),
			giftWrapLimit: 2,
		})

		expect(result.status).toBe('ready')
		if (result.status !== 'ready') throw new Error('expected ready inbox')
		expect(result.messages.map((message) => message.rumor.id)).toEqual([rumorA.id, rumorB.id])
		expect(decryptedCiphertexts.filter((ciphertext) => ciphertext === wrapA.content)).toHaveLength(1)
		expect(decryptedCiphertexts).toContain(wrapB.content)
		expect(fetchedGiftWraps).toEqual(originalFetchedGiftWraps)
		expect(fetchedGiftWraps[0]).toBe(wrapA)
		expect(fetchedGiftWraps[1]).toBe(exactCloneA)
		expect(fetchedGiftWraps[2]).toBe(wrapB)
	})

	test('keeps different wrappers for one rumor through transport processing before inner dedupe', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const counterpartyPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const counterpartyPubkey = getPublicKey(counterpartyPrivateKey)
		const rumor = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'same inner rumor',
			createdAt: 100,
		})
		const firstWrap = await giftWrapForRumor(rumor, counterpartyPrivateKey, activeUserPubkey, 'recipient', 700)
		const secondWrap = await giftWrapForRumor(rumor, counterpartyPrivateKey, activeUserPubkey, 'recipient', 600)
		const decryptedCiphertexts: string[] = []
		const harness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
			giftWraps: [firstWrap, secondWrap],
		})

		const result = await readNip17OrderChatInbox({
			...baseParams(activeUserPrivateKey, harness.fetchEvents),
			signer: createSigner(activeUserPrivateKey, { decryptedCiphertexts }),
			giftWrapLimit: 2,
		})

		expect(result.status).toBe('ready')
		if (result.status !== 'ready') throw new Error('expected ready inbox')
		expect(firstWrap.id).not.toBe(secondWrap.id)
		expect(decryptedCiphertexts).toContain(firstWrap.content)
		expect(decryptedCiphertexts).toContain(secondWrap.content)
		expect(result.messages.map((message) => message.rumor.id)).toEqual([rumor.id])
	})

	test('keeps unfingerprintable candidates distinct and collapses exact invalid clones without authenticating them', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const counterpartyPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const counterpartyPubkey = getPublicKey(counterpartyPrivateKey)
		const transientRumor = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'transient fingerprint failure',
			createdAt: 100,
		})
		const transientWrap = await giftWrapForRumor(transientRumor, counterpartyPrivateKey, activeUserPubkey, 'recipient', 800)
		const makeUnfingerprintable = (): NostrEvent => {
			let signatureReads = 0
			return Object.defineProperty({ ...transientWrap }, 'sig', {
				enumerable: true,
				get: () => {
					signatureReads += 1
					if (signatureReads === 1) throw new Error('private fingerprint accessor failure')
					return transientWrap.sig
				},
			})
		}
		const unfingerprintableA = makeUnfingerprintable()
		const unfingerprintableB = makeUnfingerprintable()
		const decryptedCiphertexts: string[] = []
		const unfingerprintableHarness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
			giftWraps: [unfingerprintableA, unfingerprintableB],
		})

		const unfingerprintableResult = await readNip17OrderChatInbox({
			...baseParams(activeUserPrivateKey, unfingerprintableHarness.fetchEvents),
			signer: createSigner(activeUserPrivateKey, { decryptedCiphertexts }),
			giftWrapLimit: 2,
		})

		expect(unfingerprintableResult.status).toBe('ready')
		if (unfingerprintableResult.status !== 'ready') throw new Error('expected ready inbox')
		expect(decryptedCiphertexts.filter((ciphertext) => ciphertext === transientWrap.content)).toHaveLength(2)
		expect(unfingerprintableResult.messages.map((message) => message.rumor.id)).toEqual([transientRumor.id])

		const validRumor = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'valid after invalid clone',
			createdAt: 200,
		})
		const validWrap = await giftWrapForRumor(validRumor, counterpartyPrivateKey, activeUserPubkey, 'recipient', 600)
		const invalid = {
			...malformedGiftWrap(activeUserPubkey),
			created_at: 700,
			sig: '0'.repeat(128),
		}
		const invalidClone = {
			...invalid,
			tags: invalid.tags.map((tag) => [...tag]),
		}
		const invalidHarness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
			giftWraps: [invalid, invalidClone, validWrap],
		})

		const invalidResult = await readNip17OrderChatInbox({
			...baseParams(activeUserPrivateKey, invalidHarness.fetchEvents),
			giftWrapLimit: 2,
		})

		expect(invalidResult.status).toBe('ready')
		if (invalidResult.status !== 'ready') throw new Error('expected ready inbox')
		expect(invalidResult.messages.map((message) => message.rumor.id)).toEqual([validRumor.id])
		expect(JSON.stringify(invalidResult)).not.toContain(invalid.content)
	})

	test('bounds unwrap admission by outer timestamp and generated event id without changing final inner ordering', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const counterpartyPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const counterpartyPubkey = getPublicKey(counterpartyPrivateKey)
		const newestOuterRumor = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'newest outer wrapper',
			createdAt: 300,
		})
		const tieRumorA = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'equal outer timestamp a',
			createdAt: 100,
		})
		const tieRumorB = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'equal outer timestamp b',
			createdAt: 200,
		})
		const excludedRumor = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'excluded sentinel wrapper',
			createdAt: 50,
		})
		const newestOuterWrap = await giftWrapForRumor(newestOuterRumor, counterpartyPrivateKey, activeUserPubkey, 'recipient', 900)
		const tieWrapA = await giftWrapForRumor(tieRumorA, counterpartyPrivateKey, activeUserPubkey, 'recipient', 800)
		const tieWrapB = await giftWrapForRumor(tieRumorB, counterpartyPrivateKey, activeUserPubkey, 'recipient', 800)
		const excludedWrap = await giftWrapForRumor(excludedRumor, counterpartyPrivateKey, activeUserPubkey, 'recipient', 700)
		const tiesByOuterId = [
			{ rumor: tieRumorA, wrap: tieWrapA },
			{ rumor: tieRumorB, wrap: tieWrapB },
		].sort((a, b) => a.wrap.id.localeCompare(b.wrap.id))
		const expectedAdmission = [{ rumor: newestOuterRumor, wrap: newestOuterWrap }, ...tiesByOuterId]
		const fetchedGiftWraps = [excludedWrap, ...[...tiesByOuterId].reverse().map(({ wrap }) => wrap), newestOuterWrap]
		const originalFetchedIds = fetchedGiftWraps.map((wrap) => wrap.id)
		const decryptedCiphertexts: string[] = []
		const harness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
			giftWraps: fetchedGiftWraps,
		})

		const result = await readNip17OrderChatInbox({
			...baseParams(activeUserPrivateKey, harness.fetchEvents),
			signer: createSigner(activeUserPrivateKey, { decryptedCiphertexts }),
			giftWrapLimit: 3,
		})

		expect(result.status).toBe('ready')
		if (result.status !== 'ready') throw new Error('expected ready inbox')

		const allOuterCiphertexts = new Set(fetchedGiftWraps.map((wrap) => wrap.content))
		const observedOuterCiphertexts = decryptedCiphertexts.filter((ciphertext) => allOuterCiphertexts.has(ciphertext))
		expect(observedOuterCiphertexts).toEqual(expectedAdmission.map(({ wrap }) => wrap.content))
		expect(observedOuterCiphertexts).toHaveLength(3)
		expect(decryptedCiphertexts).not.toContain(excludedWrap.content)
		expect(fetchedGiftWraps.map((wrap) => wrap.id)).toEqual(originalFetchedIds)

		const expectedInnerOrder = expectedAdmission
			.map(({ rumor }) => rumor)
			.sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
			.map((rumor) => rumor.id)
		expect(result.messages.map((message) => message.rumor.id)).toEqual(expectedInnerOrder)
		expect(result.messages.map((message) => message.rumor.id)).not.toContain(excludedRumor.id)
	})

	test('admits well-formed wrappers ahead of runtime-malformed outer metadata without leaking rejected details', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const counterpartyPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const counterpartyPubkey = getPublicKey(counterpartyPrivateKey)
		const validRumorA = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'valid admission a',
			createdAt: 100,
		})
		const validRumorB = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'valid admission b',
			createdAt: 200,
		})
		const validWrapA = await giftWrapForRumor(validRumorA, counterpartyPrivateKey, activeUserPubkey, 'recipient', 500)
		const validWrapB = await giftWrapForRumor(validRumorB, counterpartyPrivateKey, activeUserPubkey, 'recipient', 600)
		const malformedBase = malformedGiftWrap(activeUserPubkey)
		const malformedCandidates = [
			{ ...malformedBase, created_at: Number.POSITIVE_INFINITY, content: 'private non-finite timestamp' },
			{ ...malformedBase, created_at: -1, content: 'private negative timestamp' },
			{ ...malformedBase, created_at: 1.5, content: 'private fractional timestamp' },
			{ ...malformedBase, created_at: '700', content: 'private non-number timestamp' },
			{ ...malformedBase, id: 123, content: 'private non-string id' },
			{ ...malformedBase, id: 'A'.repeat(64), content: 'private uppercase id' },
			{ ...malformedBase, id: 'runtime-short-id', content: 'private short id' },
			{ ...malformedBase, id: 'g'.repeat(64), content: 'private noncanonical id' },
		] as unknown as NostrEvent[]
		const fetchedGiftWraps = [...malformedCandidates, validWrapA, validWrapB]
		const decryptedCiphertexts: string[] = []
		const harness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
			giftWraps: fetchedGiftWraps,
		})

		const result = await readNip17OrderChatInbox({
			...baseParams(activeUserPrivateKey, harness.fetchEvents),
			signer: createSigner(activeUserPrivateKey, { decryptedCiphertexts }),
			giftWrapLimit: 2,
		})

		expect(result.status).toBe('ready')
		if (result.status !== 'ready') throw new Error('expected ready inbox')
		expect(result.messages.map((message) => message.rumor.id)).toEqual([validRumorA.id, validRumorB.id])
		expect(decryptedCiphertexts).toContain(validWrapA.content)
		expect(decryptedCiphertexts).toContain(validWrapB.content)

		const serializedResult = JSON.stringify(result)
		for (const malformed of malformedCandidates) {
			expect(decryptedCiphertexts).not.toContain(malformed.content)
			expect(serializedResult).not.toContain(malformed.content)
			if (typeof malformed.id === 'string') {
				expect(serializedResult).not.toContain(malformed.id)
			}
		}
	})

	test('returns representative received and sender self-wrap kind-14 messages', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const counterpartyPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const counterpartyPubkey = getPublicKey(counterpartyPrivateKey)
		const receivedRumor = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'received private chat',
			createdAt: 100,
		})
		const sentRumor = createOrderChatRumor({
			senderPubkey: activeUserPubkey,
			recipientPubkey: counterpartyPubkey,
			subject: 'optional subject',
			content: 'sent private chat',
			createdAt: 200,
		})
		const receivedWrap = await giftWrapForRumor(receivedRumor, counterpartyPrivateKey, activeUserPubkey)
		const senderSelfWrap = await giftWrapForRumor(sentRumor, activeUserPrivateKey, counterpartyPubkey, 'sender')
		const harness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
			giftWraps: [senderSelfWrap, receivedWrap],
		})

		const result = await readNip17OrderChatInbox(baseParams(activeUserPrivateKey, harness.fetchEvents))

		expect(result.status).toBe('ready')
		if (result.status !== 'ready') throw new Error('expected ready inbox')
		expect(result.messages.map((message) => message.rumor.id)).toEqual([receivedRumor.id, sentRumor.id])
		expect(result.messages.map((message) => message.direction)).toEqual(['received', 'sent'])
		expect(result.messages.every((message) => message.rumor.kind === 14)).toBe(true)
	})

	test('ignores malformed wrappers and valid inner kinds 16 and 17 while accepting kind 14 without subject', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const counterpartyPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const counterpartyPubkey = getPublicKey(counterpartyPrivateKey)
		const chat = createOrderChatRumor({
			senderPubkey: counterpartyPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'chat without subject',
			createdAt: 100,
		})
		const order = createOrderCreationRumor({
			buyerPubkey: counterpartyPubkey,
			merchantPubkey: activeUserPubkey,
			orderId: 'private-order',
			amountSats: 2100,
			items: [{ productRef: `30402:${activeUserPubkey}:coffee`, quantity: 1 }],
			createdAt: 200,
		})
		const receipt = createPaymentReceiptRumor({
			buyerPubkey: counterpartyPubkey,
			merchantPubkey: activeUserPubkey,
			orderId: 'private-order',
			payment: { medium: 'lightning', reference: 'private invoice', proof: 'private proof' },
			amountSats: 2100,
			createdAt: 300,
		})
		const harness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
			giftWraps: [
				malformedGiftWrap(activeUserPubkey),
				await giftWrapForRumor(order, counterpartyPrivateKey, activeUserPubkey),
				await giftWrapForRumor(receipt, counterpartyPrivateKey, activeUserPubkey),
				await giftWrapForRumor(chat, counterpartyPrivateKey, activeUserPubkey),
			],
		})

		const result = await readNip17OrderChatInbox(baseParams(activeUserPrivateKey, harness.fetchEvents))

		expect(result.status).toBe('ready')
		if (result.status !== 'ready') throw new Error('expected ready inbox')
		expect(result.messages.map((message) => message.rumor.id)).toEqual([chat.id])
		expect(result.messages[0]?.rumor.tags).toEqual([['p', activeUserPubkey]])
	})

	test('dedupes and sorts by inner identity, then filters by validated inner counterparty', async () => {
		const activeUserPrivateKey = generateSecretKey()
		const wantedPrivateKey = generateSecretKey()
		const otherPrivateKey = generateSecretKey()
		const activeUserPubkey = getPublicKey(activeUserPrivateKey)
		const wantedPubkey = getPublicKey(wantedPrivateKey)
		const otherPubkey = getPublicKey(otherPrivateKey)
		const sameTimestampA = createOrderChatRumor({
			senderPubkey: wantedPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'same timestamp a',
			createdAt: 100,
		})
		const sameTimestampB = createOrderChatRumor({
			senderPubkey: activeUserPubkey,
			recipientPubkey: wantedPubkey,
			content: 'same timestamp b',
			createdAt: 100,
		})
		const other = createOrderChatRumor({
			senderPubkey: otherPubkey,
			recipientPubkey: activeUserPubkey,
			content: 'other counterparty',
			createdAt: 50,
		})
		const duplicateA = await giftWrapForRumor(sameTimestampA, wantedPrivateKey, activeUserPubkey, 'recipient', 600)
		const wrapA = await giftWrapForRumor(sameTimestampA, wantedPrivateKey, activeUserPubkey, 'recipient', 500)
		const wrapB = await giftWrapForRumor(sameTimestampB, activeUserPrivateKey, wantedPubkey, 'sender', 700)
		const otherWrap = await giftWrapForRumor(other, otherPrivateKey, activeUserPubkey)
		const harness = fetchHarness({
			relayListEvents: [relayListEvent(activeUserPrivateKey, INBOX_RELAYS)],
			giftWraps: [wrapB, otherWrap, duplicateA, wrapA],
		})

		const result = await readNip17OrderChatInbox({
			...baseParams(activeUserPrivateKey, harness.fetchEvents),
			counterpartyPubkey: wantedPubkey,
		})

		expect(result.status).toBe('ready')
		if (result.status !== 'ready') throw new Error('expected ready inbox')
		expect(result.messages.map((message) => message.rumor.id)).toEqual(
			[sameTimestampA.id, sameTimestampB.id].sort((a, b) => a.localeCompare(b)),
		)
		expect(result.messages.every((message) => message.counterpartyPubkey === wantedPubkey)).toBe(true)
		expect(result.messages.every((message) => message.rumor.id !== other.id)).toBe(true)
	})
})
