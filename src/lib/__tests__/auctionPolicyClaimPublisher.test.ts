import { describe, expect, test } from 'bun:test'
import type { EventTemplate } from 'nostr-tools'
import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY } from '@/lib/auction/constants'
import { AUCTION_POLICY_INVALID_CLAIM } from '@/lib/auction/auctionValidatorPolicy'
import { createAuctionPolicyClaimPublisher } from '@/server/auction-validator/policyClaim'
import { parseAuctionPolicyVerdictEvent } from '@/lib/schemas/auction/validatorEvents'
import type { ParsedAuctionEvent } from '@/lib/auction/events'

const VALIDATOR_PK = 'a'.repeat(64)
const SELLER_PK = 'b'.repeat(64)
const AUDITOR_A = 'c'.repeat(64)
const AUDITOR_B = 'd'.repeat(64)
const ROOT_ID = 'e'.repeat(64)

/** A tracked auction, as the subscriber hands it to the claim publisher. */
const auctionFixture = (overrides: Partial<ParsedAuctionEvent> = {}): ParsedAuctionEvent =>
	({
		rootEventId: ROOT_ID,
		coordinate: `30408:${SELLER_PK}:listing-1`,
		auditors: [AUDITOR_A, AUDITOR_B],
		auditorQuorum: 2,
		settlementPolicy: AUCTION_MULTIPARTY_SETTLEMENT_POLICY,
		...overrides,
	}) as ParsedAuctionEvent

interface Harness {
	published: EventTemplate[]
	publisher: ReturnType<typeof createAuctionPolicyClaimPublisher>
	warnings: string[]
}

const harness = (): Harness => {
	const published: EventTemplate[] = []
	const warnings: string[] = []
	const publisher = createAuctionPolicyClaimPublisher({
		signer: {
			getPublicKey: async () => VALIDATOR_PK,
			signEvent: async (template: EventTemplate) =>
				({ ...template, id: '9'.repeat(64), pubkey: VALIDATOR_PK, sig: 'a'.repeat(128) }) as never,
		} as never,
		relayPool: {
			publish: async (event: EventTemplate) => {
				published.push(event)
			},
		} as never,
		now: () => 1_700_000_500,
		logger: {
			info: () => undefined,
			warn: (...args: unknown[]) => {
				warnings.push(String(args[0]))
			},
			error: () => undefined,
		},
	})
	return { published, publisher, warnings }
}

describe('auction policy claim publisher', () => {
	test('a broken policy is published once, against the auction root', async () => {
		const { published, publisher } = harness()
		const outcome = await publisher.consider(auctionFixture({ auditors: [AUDITOR_A], auditorQuorum: 1 }))

		expect(outcome.status).toBe('published')
		expect(published).toHaveLength(1)

		const event = published[0]
		expect(event.kind).toBe(30440)
		const tags = event.tags as string[][]
		expect(tags).toContainEqual(['claim', AUCTION_POLICY_INVALID_CLAIM])
		expect(tags).toContainEqual(['e', ROOT_ID])
		expect(tags.find((tag) => tag[0] === 'd')?.[1]).toBe(`auction_policy:${ROOT_ID}`)
		// An auction-level claim names no bidder and no bid.
		expect(tags.some((tag) => tag[0] === 'p')).toBe(false)
		expect(tags.some((tag) => tag[0] === 'bid')).toBe(false)

		// What went on the wire is re-derivable by a reader.
		const reparsed = parseAuctionPolicyVerdictEvent({
			id: '9'.repeat(64),
			pubkey: VALIDATOR_PK,
			kind: 30440,
			created_at: 1_700_000_500,
			tags,
			content: String(event.content),
			sig: 'a'.repeat(128),
		})
		expect(reparsed.ok).toBe(true)
	})

	test('a healthy policy publishes nothing', async () => {
		const { published, publisher } = harness()
		const outcome = await publisher.consider(auctionFixture())
		expect(outcome.status).toBe('not_broken')
		expect(published).toHaveLength(0)
	})

	test('the same finding is not republished on every poll', async () => {
		const { published, publisher } = harness()
		const broken = auctionFixture({ auditors: [AUDITOR_A], auditorQuorum: 1 })

		expect((await publisher.consider(broken)).status).toBe('published')
		expect((await publisher.consider(broken)).status).toBe('unchanged')
		expect((await publisher.consider(broken)).status).toBe('unchanged')
		expect(published).toHaveLength(1)
		expect(publisher.announcedCount()).toBe(1)
	})

	test('a changed finding is republished — the relay keeps the latest claim', async () => {
		const { published, publisher } = harness()
		await publisher.consider(auctionFixture({ auditors: [AUDITOR_A], auditorQuorum: 1 }))
		// Same auction, now with a declared quorum below the strict majority of four auditors.
		const outcome = await publisher.consider(
			auctionFixture({
				auditors: [AUDITOR_A, AUDITOR_B, 'f'.repeat(64), '0'.repeat(64)],
				auditorQuorum: 1,
			}),
		)
		expect(outcome.status).toBe('published')
		expect(published).toHaveLength(2)
	})

	test('two auctions are tracked independently', async () => {
		const { published, publisher } = harness()
		const broken = { auditors: [AUDITOR_A], auditorQuorum: 1 }
		await publisher.consider(auctionFixture(broken))
		await publisher.consider(auctionFixture({ ...broken, rootEventId: '1'.repeat(64) }))
		expect(published).toHaveLength(2)
		expect(publisher.announcedCount()).toBe(2)
	})

	test('a claim that does not verify is refused rather than published', async () => {
		// A signer that mangles the tags: the claim we send must equal the claim a reader
		// re-derives from the root, so this must never reach the relay.
		const published: EventTemplate[] = []
		const warnings: string[] = []
		const publisher = createAuctionPolicyClaimPublisher({
			signer: {
				getPublicKey: async () => VALIDATOR_PK,
				signEvent: async (template: EventTemplate) =>
					({
						...template,
						// Point the claim at a different auction root.
						tags: (template.tags as string[][]).map((tag) => (tag[0] === 'e' ? ['e', '7'.repeat(64)] : tag)),
						id: '9'.repeat(64),
						pubkey: VALIDATOR_PK,
						sig: 'a'.repeat(128),
					}) as never,
			} as never,
			relayPool: {
				publish: async (event: EventTemplate) => {
					published.push(event)
				},
			} as never,
			now: () => 1_700_000_500,
			logger: {
				info: () => undefined,
				warn: (...args: unknown[]) => {
					warnings.push(String(args[0]))
				},
				error: () => undefined,
			},
		})

		const outcome = await publisher.consider(auctionFixture({ auditors: [AUDITOR_A], auditorQuorum: 1 }))
		expect(outcome.status).toBe('refused')
		expect(published).toHaveLength(0)
		expect(warnings.length).toBeGreaterThan(0)
	})
})
