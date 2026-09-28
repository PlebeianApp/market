import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { buildZapRequestDraft, ZAP_REQUEST_KIND } from '../v4v/zapRequestEvent'
import { verifyZapReceipt } from '../v4v/zapReceipt'

const auctionAnchor = { kind: 'a' as const, value: '30408:' + 'a'.repeat(64) + ':auction-1' }
const relays = ['wss://relay.example.com', 'wss://relay2.example.com']

const draft = (overrides: Partial<Parameters<typeof buildZapRequestDraft>[0]> = {}) =>
	buildZapRequestDraft({ amountSats: 250, recipientPubkey: 'b'.repeat(64), relays, auctionAnchor, createdAt: 1_700_000_000, ...overrides })

const tag = (tags: readonly (readonly string[])[], name: string) => tags.find((candidate) => candidate[0] === name)

describe('the request carries what the receipt will have to repeat', () => {
	test('the amount is in millisats, because that is what the endpoint and the receipt speak', () => {
		const result = draft({ amountSats: 250 })
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(tag(result.draft.tags, 'amount')?.[1]).toBe('250000')
	})

	test('one relays tag holding every relay', () => {
		const result = draft()
		if (!result.ok) return
		const relayTags = result.draft.tags.filter((candidate) => candidate[0] === 'relays')
		expect(relayTags).toHaveLength(1)
		expect(relayTags[0]).toEqual(['relays', ...relays])
		// nothing invents a per-relay tag: NIP-57 has one, and an unspec'd second form would just be ignored
		expect(result.draft.tags.filter((candidate) => candidate[0] === 'relay')).toHaveLength(0)
	})

	test('the recipient is a p tag and the auction is the anchor', () => {
		const result = draft()
		if (!result.ok) return
		expect(tag(result.draft.tags, 'p')?.[1]).toBe('b'.repeat(64))
		expect(tag(result.draft.tags, 'a')?.[1]).toBe(auctionAnchor.value)
	})

	test('an event-id anchor works as well as a coordinate', () => {
		const result = draft({ auctionAnchor: { kind: 'e', value: 'c'.repeat(64) } })
		if (!result.ok) return
		expect(tag(result.draft.tags, 'e')?.[1]).toBe('c'.repeat(64))
		expect(tag(result.draft.tags, 'a')).toBeUndefined()
	})

	test('a comment is the content, and its absence is an empty string rather than absent', () => {
		const withComment = draft({ comment: 'v4v share' })
		if (!withComment.ok) return
		expect(withComment.draft.content).toBe('v4v share')
		const without = draft()
		if (!without.ok) return
		expect(without.draft.content).toBe('')
	})

	test("the created_at is the caller's, not a clock read here", () => {
		const result = draft({ createdAt: 1_234_567 })
		if (!result.ok) return
		expect(result.draft.created_at).toBe(1_234_567)
		expect(result.draft.kind).toBe(ZAP_REQUEST_KIND)
	})

	test('the same inputs build byte-identical tags, so a replay describes the same intent', () => {
		const first = draft()
		const second = draft()
		if (!first.ok || !second.ok) return
		expect(JSON.stringify(first.draft.tags)).toBe(JSON.stringify(second.draft.tags))
	})
})

describe('what the builder refuses, and why each refusal is worth having', () => {
	test('a non-positive or fractional amount', () => {
		for (const amountSats of [0, -1, 1.5]) {
			expect(draft({ amountSats })).toMatchObject({ ok: false, code: 'amount_must_be_positive' })
		}
	})

	test('no relays at all: the receipt would have nowhere to be published', () => {
		// which makes the payment unverifiable, so refusing is the honest answer rather than sending it
		expect(draft({ relays: [] })).toMatchObject({ ok: false, code: 'relays_missing' })
	})

	test('a relay that is not a websocket URL', () => {
		expect(draft({ relays: ['https://relay.example.com'] })).toMatchObject({ ok: false, code: 'relay_not_a_url' })
		expect(draft({ relays: ['nonsense'] })).toMatchObject({ ok: false, code: 'relay_not_a_url' })
	})

	test('an empty auction anchor is named as such', () => {
		expect(draft({ auctionAnchor: { kind: 'a', value: '' } })).toMatchObject({ ok: false, code: 'anchor_empty' })
	})

	test('a recipient is not required: a plain lightning address has no pubkey to name', () => {
		const result = draft({ recipientPubkey: undefined })
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(tag(result.draft.tags, 'p')).toBeUndefined()
	})
})

describe('the request it builds is one a receipt can actually answer', () => {
	test('a signed draft verifies as the zap request inside a receipt for the same recipient and amount', async () => {
		const result = draft({ amountSats: 100 })
		expect(result.ok).toBe(true)
		if (!result.ok) return

		const zapRequest = finalizeEvent(
			{
				kind: result.draft.kind,
				created_at: result.draft.created_at,
				tags: result.draft.tags.map((candidate) => [...candidate]),
				content: result.draft.content,
			},
			generateSecretKey(),
		)
		const description = JSON.stringify(zapRequest)

		// the recipient's server puts this description in the receipt, and the verifier accepts it
		const receipt = finalizeEvent(
			{
				kind: 9735,
				created_at: 1_700_000_100,
				tags: [
					['p', 'b'.repeat(64)],
					['a', auctionAnchor.value],
					['bolt11', 'lnbc1u1' + 'q'.repeat(20)],
					['description', description],
				],
				content: '',
			},
			generateSecretKey(),
		)

		const verification = verifyZapReceipt({
			event: receipt,
			expected: { recipientPubkey: 'b'.repeat(64), auctionAnchor, plannedSats: 100 },
		})
		expect(verification).toMatchObject({ ok: true, amountSats: 100 })
	})
})
