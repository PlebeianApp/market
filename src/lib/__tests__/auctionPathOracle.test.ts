import { describe, expect, test } from 'bun:test'
import { HDKey } from '@scure/bip32'
import {
	allocateAuctionPath,
	buildAuctionPathRegistry,
	buildAuctionPathRegistryDTag,
	findAuctionPathEntryByBidEventId,
	findAuctionPathEntryByChildPubkey,
	generateAuctionDerivationPath,
	parseAuctionPathRegistry,
	upsertAuctionPathEntry,
	verifyAuctionPathGrantEnvelope,
	type AuctionPathRegistryEntry,
} from '@/lib/auctionPathOracle'
import { AUCTION_PATH_GRANT_TOPIC, type AuctionPathGrantEnvelope } from '@/lib/auctionTransfers'

const buildTestXpub = (): string => {
	const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 42)
	const account = HDKey.fromMasterSeed(seed).derive("m/30408'/0'/0'")
	if (!account.publicExtendedKey) {
		throw new Error('Failed to derive test xpub')
	}
	return account.publicExtendedKey
}

describe('auctionPathOracle', () => {
	test('generateAuctionDerivationPath produces 5-level non-hardened paths', () => {
		for (let attempt = 0; attempt < 10; attempt++) {
			const path = generateAuctionDerivationPath()
			expect(path.startsWith('m/')).toBe(true)
			const segments = path.slice(2).split('/')
			expect(segments).toHaveLength(5)
			for (const segment of segments) {
				expect(segment.includes("'")).toBe(false)
				const index = Number(segment)
				expect(Number.isInteger(index)).toBe(true)
				expect(index).toBeGreaterThanOrEqual(0)
				expect(index).toBeLessThanOrEqual(0x7fffffff)
			}
		}
	})

	test('allocateAuctionPath avoids collisions with existing entries', () => {
		const xpub = buildTestXpub()
		const existing: AuctionPathRegistryEntry[] = [
			{
				bidderPubkey: 'alice',
				derivationPath: 'm/1/2/3/4/5',
				childPubkey: 'deadbeef'.repeat(8),
				grantId: 'g-existing',
				grantedAt: 1,
				status: 'issued',
			},
		]
		const allocated = allocateAuctionPath({
			auctionEventId: 'auction-1',
			auctionCoordinates: '30408:seller:auction-1',
			xpub,
			bidderPubkey: 'bob',
			existingEntries: existing,
		})
		expect(allocated.derivationPath).not.toBe(existing[0].derivationPath)
		expect(allocated.childPubkey).toHaveLength(66)
		expect(allocated.grantId.length).toBeGreaterThan(0)
	})

	test('buildAuctionPathRegistry + parse roundtrip preserves entries', () => {
		const xpub = buildTestXpub()
		const entry: AuctionPathRegistryEntry = {
			bidderPubkey: 'alice',
			derivationPath: 'm/10/20/30/40/50',
			childPubkey: 'cafebabe'.repeat(8).padStart(66, '0').slice(0, 66),
			grantId: 'grant-1',
			grantedAt: 1_700_000_000,
			bidEventId: 'bid-xyz',
			status: 'locked',
		}
		const registry = buildAuctionPathRegistry({
			auctionEventId: 'auction-1',
			auctionCoordinates: '30408:seller:auction-1',
			xpub,
			entries: [entry],
		})

		const serialized = JSON.stringify(registry)
		const parsed = parseAuctionPathRegistry(serialized)
		expect(parsed).not.toBeNull()
		expect(parsed?.auctionEventId).toBe('auction-1')
		expect(parsed?.xpub).toBe(xpub)
		expect(parsed?.entries).toHaveLength(1)
		expect(parsed?.entries[0].grantId).toBe('grant-1')
		expect(parsed?.entries[0].status).toBe('locked')
		expect(parsed?.entries[0].bidEventId).toBe('bid-xyz')
	})

	test('upsertAuctionPathEntry replaces existing entries by grantId', () => {
		const initial: AuctionPathRegistryEntry[] = [
			{
				bidderPubkey: 'alice',
				derivationPath: 'm/1/2/3/4/5',
				childPubkey: 'a'.repeat(66),
				grantId: 'g1',
				grantedAt: 1,
				status: 'issued',
			},
		]
		const replaced = upsertAuctionPathEntry(initial, {
			bidderPubkey: 'alice',
			derivationPath: 'm/1/2/3/4/5',
			childPubkey: 'a'.repeat(66),
			grantId: 'g1',
			grantedAt: 1,
			status: 'locked',
			bidEventId: 'bid-1',
		})
		expect(replaced).toHaveLength(1)
		expect(replaced[0].status).toBe('locked')
		expect(replaced[0].bidEventId).toBe('bid-1')

		const added = upsertAuctionPathEntry(replaced, {
			bidderPubkey: 'bob',
			derivationPath: 'm/9/8/7/6/5',
			childPubkey: 'b'.repeat(66),
			grantId: 'g2',
			grantedAt: 2,
			status: 'issued',
		})
		expect(added).toHaveLength(2)
	})

	test('findAuctionPathEntryByChildPubkey and ByBidEventId match on canonical keys', () => {
		const registry = buildAuctionPathRegistry({
			auctionEventId: 'auction-1',
			auctionCoordinates: '30408:seller:auction-1',
			xpub: buildTestXpub(),
			entries: [
				{
					bidderPubkey: 'alice',
					derivationPath: 'm/1/2/3/4/5',
					childPubkey: 'abcdef' + '0'.repeat(60),
					grantId: 'g1',
					grantedAt: 1,
					status: 'locked',
					bidEventId: 'bid-alice',
				},
			],
		})
		expect(findAuctionPathEntryByChildPubkey(registry, 'ABCDEF' + '0'.repeat(60))?.grantId).toBe('g1')
		expect(findAuctionPathEntryByBidEventId(registry, 'bid-alice')?.grantId).toBe('g1')
		expect(findAuctionPathEntryByBidEventId(registry, 'unknown')).toBeUndefined()
	})

	test('verifyAuctionPathGrantEnvelope enforces the §5.6 invariants', () => {
		const xpub = buildTestXpub()
		const path = 'm/7/11/13/17/19'
		const account = HDKey.fromExtendedKey(xpub).derive(path)
		const child = account.publicKey
		if (!child) throw new Error('failed to derive child pubkey for test')
		const childPubkey = Array.from(child)
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('')

		const goodGrant: AuctionPathGrantEnvelope = {
			type: AUCTION_PATH_GRANT_TOPIC,
			grantId: 'g1',
			requestId: 'r1',
			auctionEventId: 'auction-1',
			auctionCoordinates: '30408:seller:auction-1',
			bidderPubkey: 'bidder-pubkey',
			pathIssuerPubkey: 'issuer-pubkey',
			xpub,
			derivationPath: path,
			childPubkey,
			issuedAt: 1000,
			expiresAt: 1000 + 600,
		}

		expect(() =>
			verifyAuctionPathGrantEnvelope({
				grant: goodGrant,
				expectedAuctionEventId: 'auction-1',
				expectedBidderPubkey: 'bidder-pubkey',
				expectedPathIssuer: 'issuer-pubkey',
				expectedXpub: xpub,
				nowSeconds: 1500,
			}),
		).not.toThrow()

		expect(() =>
			verifyAuctionPathGrantEnvelope({
				grant: { ...goodGrant, pathIssuerPubkey: 'not-issuer' },
				expectedAuctionEventId: 'auction-1',
				expectedBidderPubkey: 'bidder-pubkey',
				expectedPathIssuer: 'issuer-pubkey',
				expectedXpub: xpub,
				nowSeconds: 1500,
			}),
		).toThrow('Path grant issuer')

		// Use a different valid compressed pubkey (derived from a different path)
		const mismatchedChild = Array.from(HDKey.fromExtendedKey(xpub).derive('m/0/0/0/0/0').publicKey!)
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('')
		expect(() =>
			verifyAuctionPathGrantEnvelope({
				grant: { ...goodGrant, childPubkey: mismatchedChild },
				expectedAuctionEventId: 'auction-1',
				expectedBidderPubkey: 'bidder-pubkey',
				expectedPathIssuer: 'issuer-pubkey',
				expectedXpub: xpub,
				nowSeconds: 1500,
			}),
		).toThrow('child_pubkey')

		expect(() =>
			verifyAuctionPathGrantEnvelope({
				grant: goodGrant,
				expectedAuctionEventId: 'auction-1',
				expectedBidderPubkey: 'bidder-pubkey',
				expectedPathIssuer: 'issuer-pubkey',
				expectedXpub: xpub,
				nowSeconds: 2000,
			}),
		).toThrow('expired')
	})

	test('buildAuctionPathRegistryDTag follows the documented prefix', () => {
		expect(buildAuctionPathRegistryDTag('abc123')).toBe('path_oracle:abc123')
	})
})
