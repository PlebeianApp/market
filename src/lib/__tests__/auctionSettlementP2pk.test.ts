import { describe, expect, test } from 'bun:test'
import { HDKey } from '@scure/bip32'
import { getEncodedToken, type Proof } from '@cashu/cashu-ts'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '@/lib/auctionP2pk'
import { preflightAuctionSettlementP2pk, preflightAuctionSettlementP2pkChain } from '@/lib/auctionSettlementP2pk'
import { AUCTION_MIN_BID_LEG_SATS } from '@/lib/auction/constants'

const makeFixture = (derivationPath = '7/11/13/17/19') => {
	const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
	const account = HDKey.fromMasterSeed(seed).derive("m/30408'/0'/0'")
	const xpub = account.publicExtendedKey
	if (!xpub) throw new Error('Failed to derive test xpub')

	const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(xpub, derivationPath)

	return {
		xpub,
		derivationPath,
		childPubkey,
		childPubkeyXOnly: childPubkey.slice(2),
		mismatchedChildPubkey: deriveAuctionChildP2pkPubkeyFromXpub(xpub, '1/2/3/4/5'),
	}
}

const makeP2pkSecret = (lockPubkey: string): string =>
	JSON.stringify([
		'P2PK',
		{
			nonce: '00'.repeat(32),
			data: lockPubkey,
			tags: [['locktime', '2000000000']],
		},
	])

const makeToken = (secret: string, amount = 1, mint = 'https://mint.example'): string => {
	const proof: Proof = {
		id: '009a1f293253e41e',
		amount,
		secret,
		C: '02'.padEnd(66, '1'),
	}

	return getEncodedToken({
		mint,
		proofs: [proof],
	})
}

const makeEmptyToken = (): string =>
	getEncodedToken({
		mint: 'https://mint.example',
		proofs: [],
	})

describe('auction settlement P2PK preflight', () => {
	test('accepts compressed token lock pubkey matching derived child key', () => {
		const fixture = makeFixture()
		const result = preflightAuctionSettlementP2pk({
			auctionP2pkXpub: fixture.xpub,
			derivationPath: fixture.derivationPath,
			settlementPlanChildPubkey: fixture.childPubkey,
			token: makeToken(makeP2pkSecret(fixture.childPubkey)),
		})

		expect(result.derivedChildPubkey).toBe(fixture.childPubkey)
		expect(result.tokenLockPubkey).toBe(fixture.childPubkey)
	})

	test('accepts settlement-plan childPubkey in x-only form only as comparison metadata', () => {
		const fixture = makeFixture()
		const result = preflightAuctionSettlementP2pk({
			auctionP2pkXpub: fixture.xpub,
			derivationPath: fixture.derivationPath,
			settlementPlanChildPubkey: fixture.childPubkeyXOnly,
			token: makeToken(makeP2pkSecret(fixture.childPubkey)),
		})

		expect(result.settlementPlanChildPubkey).toBe(fixture.childPubkeyXOnly)
		expect(result.tokenLockPubkey).toBe(fixture.childPubkey)
	})

	test('rejects token lock pubkey that is x-only', () => {
		const fixture = makeFixture()

		expect(() =>
			preflightAuctionSettlementP2pk({
				auctionP2pkXpub: fixture.xpub,
				derivationPath: fixture.derivationPath,
				settlementPlanChildPubkey: fixture.childPubkey,
				token: makeToken(makeP2pkSecret(fixture.childPubkeyXOnly)),
			}),
		).toThrow('Winner token P2PK lock pubkey is not compressed; cannot settle this bid safely')
	})

	test('rejects malformed token P2PK secret', () => {
		const fixture = makeFixture()

		expect(() =>
			preflightAuctionSettlementP2pk({
				auctionP2pkXpub: fixture.xpub,
				derivationPath: fixture.derivationPath,
				settlementPlanChildPubkey: fixture.childPubkey,
				token: makeToken('not-json'),
			}),
		).toThrow('Winner token proof secret is not a valid P2PK secret')
	})

	test('rejects derived child key mismatch against token lock pubkey', () => {
		const fixture = makeFixture()

		expect(() =>
			preflightAuctionSettlementP2pk({
				auctionP2pkXpub: fixture.xpub,
				derivationPath: fixture.derivationPath,
				settlementPlanChildPubkey: fixture.childPubkey,
				token: makeToken(makeP2pkSecret(fixture.mismatchedChildPubkey)),
			}),
		).toThrow('Winner token P2PK lock pubkey does not match auction p2pk_xpub + derivation path')
	})

	test('rejects settlement-plan childPubkey mismatch', () => {
		const fixture = makeFixture()

		expect(() =>
			preflightAuctionSettlementP2pk({
				auctionP2pkXpub: fixture.xpub,
				derivationPath: fixture.derivationPath,
				settlementPlanChildPubkey: fixture.mismatchedChildPubkey,
				token: makeToken(makeP2pkSecret(fixture.childPubkey)),
			}),
		).toThrow('Settlement plan child pubkey does not match auction p2pk_xpub + derivation path')
	})

	test('rejects #824-shaped x-only settlement metadata and x-only token lock before redemption', () => {
		const fixture = makeFixture()

		expect(() =>
			preflightAuctionSettlementP2pk({
				auctionP2pkXpub: fixture.xpub,
				derivationPath: fixture.derivationPath,
				settlementPlanChildPubkey: fixture.childPubkeyXOnly,
				token: makeToken(makeP2pkSecret(fixture.childPubkeyXOnly)),
			}),
		).toThrow('Winner token P2PK lock pubkey is not compressed; cannot settle this bid safely')
	})
})

describe('auction settlement P2PK chain preflight', () => {
	test('rejects chain leg token with no proofs', () => {
		const fixture = makeFixture()

		expect(() =>
			preflightAuctionSettlementP2pkChain({
				auctionP2pkXpub: fixture.xpub,
				legs: [
					{
						bidEventId: 'a'.repeat(64),
						mintUrl: 'https://mint.example',
						token: makeEmptyToken(),
						derivationPath: fixture.derivationPath,
						bidChildPubkey: fixture.childPubkey,
						releaseChildPubkey: fixture.childPubkey,
						expectedAmount: 10,
					},
				],
			}),
		).toThrow('Winner token contains no proofs')
	})

	test('rejects chain leg token whose proof sum does not equal expected legAmount', () => {
		const fixture = makeFixture()

		expect(() =>
			preflightAuctionSettlementP2pkChain({
				auctionP2pkXpub: fixture.xpub,
				legs: [
					{
						bidEventId: 'b'.repeat(64),
						mintUrl: 'https://mint.example',
						token: makeToken(makeP2pkSecret(fixture.childPubkey), 9),
						derivationPath: fixture.derivationPath,
						bidChildPubkey: fixture.childPubkey,
						releaseChildPubkey: fixture.childPubkey,
						expectedAmount: 10,
					},
				],
			}),
		).toThrow('token proof sum 9 sats does not equal expected leg amount 10 sats')
	})

	test('rejects chain leg below AUCTION_MIN_BID_LEG_SATS even when token sum matches', () => {
		const fixture = makeFixture()
		const tinyAmount = AUCTION_MIN_BID_LEG_SATS - 1

		expect(() =>
			preflightAuctionSettlementP2pkChain({
				auctionP2pkXpub: fixture.xpub,
				legs: [
					{
						bidEventId: '9'.repeat(64),
						mintUrl: 'https://mint.example',
						token: makeToken(makeP2pkSecret(fixture.childPubkey), tinyAmount),
						derivationPath: fixture.derivationPath,
						bidChildPubkey: fixture.childPubkey,
						releaseChildPubkey: fixture.childPubkey,
						expectedAmount: tinyAmount,
					},
				],
			}),
		).toThrow(`expected leg amount must be at least ${AUCTION_MIN_BID_LEG_SATS} sats`)
	})

	test('rejects chain leg token whose decoded mint does not match bid mint', () => {
		const fixture = makeFixture()

		expect(() =>
			preflightAuctionSettlementP2pkChain({
				auctionP2pkXpub: fixture.xpub,
				legs: [
					{
						bidEventId: '3'.repeat(64),
						mintUrl: 'https://mint.example',
						token: makeToken(makeP2pkSecret(fixture.childPubkey), AUCTION_MIN_BID_LEG_SATS, 'https://other-mint.example'),
						derivationPath: fixture.derivationPath,
						bidChildPubkey: fixture.childPubkey,
						releaseChildPubkey: fixture.childPubkey,
						expectedAmount: AUCTION_MIN_BID_LEG_SATS,
					},
				],
			}),
		).toThrow('token mint URL https://other-mint.example does not match expected mint URL https://mint.example')
	})

	test('rejects chain if any leg has a mismatched P2PK lock pubkey', () => {
		const first = makeFixture('7/11/13/17/19')
		const second = makeFixture('2/3/5/7/11')

		expect(() =>
			preflightAuctionSettlementP2pkChain({
				auctionP2pkXpub: first.xpub,
				legs: [
					{
						bidEventId: 'c'.repeat(64),
						mintUrl: 'https://mint.example',
						token: makeToken(makeP2pkSecret(first.childPubkey), 10),
						derivationPath: first.derivationPath,
						bidChildPubkey: first.childPubkey,
						releaseChildPubkey: first.childPubkey,
						expectedAmount: 10,
					},
					{
						bidEventId: 'd'.repeat(64),
						mintUrl: 'https://mint.example',
						token: makeToken(makeP2pkSecret(first.childPubkey), 15),
						derivationPath: second.derivationPath,
						bidChildPubkey: second.childPubkey,
						releaseChildPubkey: second.childPubkey,
						expectedAmount: 15,
					},
				],
			}),
		).toThrow('Winner token P2PK lock pubkey does not match auction p2pk_xpub + derivation path')
	})

	test('accepts a multi-leg chain when all structural checks pass', () => {
		const first = makeFixture('7/11/13/17/19')
		const second = makeFixture('2/3/5/7/11')

		const result = preflightAuctionSettlementP2pkChain({
			auctionP2pkXpub: first.xpub,
			legs: [
				{
					bidEventId: 'e'.repeat(64),
					mintUrl: 'https://mint.example',
					token: makeToken(makeP2pkSecret(first.childPubkey), 10),
					derivationPath: first.derivationPath,
					bidChildPubkey: first.childPubkey,
					releaseChildPubkey: first.childPubkey,
					expectedAmount: 10,
				},
				{
					bidEventId: 'f'.repeat(64),
					mintUrl: 'https://mint.example',
					token: makeToken(makeP2pkSecret(second.childPubkey), 15),
					derivationPath: second.derivationPath,
					bidChildPubkey: second.childPubkey,
					releaseChildPubkey: second.childPubkey,
					expectedAmount: 15,
				},
			],
		})

		expect(result.totalAmount).toBe(25)
		expect(result.legs).toHaveLength(2)
		expect(result.legs.map((leg) => leg.tokenAmount)).toEqual([10, 15])
	})

	test('preflight failure happens before a caller would redeem any leg', () => {
		const first = makeFixture('7/11/13/17/19')
		const second = makeFixture('2/3/5/7/11')
		let wouldRedeem = false

		expect(() => {
			preflightAuctionSettlementP2pkChain({
				auctionP2pkXpub: first.xpub,
				legs: [
					{
						bidEventId: '1'.repeat(64),
						mintUrl: 'https://mint.example',
						token: makeToken(makeP2pkSecret(first.childPubkey), 10),
						derivationPath: first.derivationPath,
						bidChildPubkey: first.childPubkey,
						releaseChildPubkey: first.childPubkey,
						expectedAmount: 10,
					},
					{
						bidEventId: '2'.repeat(64),
						mintUrl: 'https://mint.example',
						token: makeToken(makeP2pkSecret(second.childPubkey), 9),
						derivationPath: second.derivationPath,
						bidChildPubkey: second.childPubkey,
						releaseChildPubkey: second.childPubkey,
						expectedAmount: 10,
					},
				],
			})
			wouldRedeem = true
		}).toThrow('token proof sum 9 sats does not equal expected leg amount 10 sats')

		expect(wouldRedeem).toBe(false)
	})
})
