/**
 * Multiparty bid manifest construction.
 *
 * The invariants that matter here are the ones that make a bid *provable*: the rows are derived
 * from the root schedule and each payee's bound capability snapshot (never invented), the child
 * keys bind to the shared path (so a different path cannot unlock them), the amounts conserve the
 * locked total exactly, and every refusal is a refusal rather than a guess.
 *
 * Capabilities are built with real key material: the proof of possession is signed by the xpub's
 * own key, exactly as the verifier expects, so a fixture cannot accidentally pass a check that
 * production would fail.
 */
import { describe, expect, test } from 'bun:test'
import { HDKey } from '@scure/bip32'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { buildMultipartyBidManifest } from '@/lib/auction/multipartyBidManifest'
import { buildPayoutXpubPopMessage } from '@/lib/auction/multipartyAuthorizationCrypto'
import type { ParsedMultipartyPayoutCapability } from '@/lib/auction/multipartyAuthorization'
import { compileManifest } from '@/lib/auction/multipartyManifestWire'
import type { AuctionMultipartyCanonicalSchedule } from '@/lib/auction/multipartySchedule'

const NOW = 1_790_000_000

const identity = (label: string) => {
	const seed = sha256(new TextEncoder().encode(label))
	const master = HDKey.fromMasterSeed(seed)
	const pubkey = bytesToHex(schnorr.getPublicKey(master.privateKey as Uint8Array))
	return { master, pubkey, xpub: master.publicExtendedKey as string }
}

const SELLER = identity('manifest-test-seller')
const VALIDATOR = identity('manifest-test-validator')
const RECIPIENT = identity('manifest-test-recipient')

const capability = (
	owner: ReturnType<typeof identity>,
	id: string,
	overrides: { mints?: string[]; expires_at?: number; valid_from?: number; signWith?: Uint8Array } = {},
): ParsedMultipartyPayoutCapability => {
	const signerKey = overrides.signWith ?? (owner.master.privateKey as Uint8Array)
	const pop = bytesToHex(schnorr.sign(buildPayoutXpubPopMessage(owner.pubkey, owner.xpub), signerKey))
	return {
		id,
		recipient_pubkey: owner.pubkey,
		payout_xpub: owner.xpub,
		payout_xpub_pop: pop,
		mints: overrides.mints ?? ['https://mint.example.com'],
		valid_from: overrides.valid_from ?? NOW - 600,
		expires_at: overrides.expires_at ?? NOW + 86_400,
	}
}

const CAP_VALIDATOR = capability(VALIDATOR, 'cap-validator')
const CAP_RECIPIENT = capability(RECIPIENT, 'cap-recipient')

/** The shape `parseCanonicalSchedule` returns; the schedule's own wire rules are tested elsewhere. */
const schedule = (overrides: Partial<AuctionMultipartyCanonicalSchedule> = {}): AuctionMultipartyCanonicalSchedule =>
	({
		entries: [
			{
				schedule_index: 0,
				role: 'validator',
				recipient_pubkey: VALIDATOR.pubkey,
				payout_capability_event_id: 'cap-validator',
				allocation_bps: 200,
			},
			{
				schedule_index: 1,
				role: 'v4v',
				recipient_pubkey: RECIPIENT.pubkey,
				payout_capability_event_id: 'cap-recipient',
				allocation_bps: 1000,
			},
		],
		auxiliary_allocation_bps: 1200,
		seller_remainder_bps: 8800,
		canonical_bytes: new Uint8Array(),
		commitment_preimage: new Uint8Array(),
		schedule_commitment: 'a'.repeat(64),
		...overrides,
	}) as AuctionMultipartyCanonicalSchedule

const baseInput = (overrides: Record<string, unknown> = {}) => ({
	sellerPubkey: SELLER.pubkey,
	sellerPayoutXpub: SELLER.xpub,
	schedule: schedule(),
	sharedPath: 'm/0/7',
	totalSats: 10_000,
	capabilities: [CAP_VALIDATOR, CAP_RECIPIENT],
	nowUnixSeconds: NOW,
	...overrides,
})

describe('buildMultipartyBidManifest — the happy path', () => {
	test('seller is row 0, then schedule order; amounts conserve the locked total', () => {
		const result = buildMultipartyBidManifest(baseInput())
		expect(result.ok).toBe(true)
		if (!result.ok) return

		const roles = result.manifest.rows.map((row) => row.role)
		expect(roles).toEqual(['seller', 'validator', 'v4v'])
		// Index space: seller is 0, schedule index i is i + 1.
		expect(result.manifest.rows.map((row) => row.manifest_index)).toEqual([0, 1, 2])
		expect(result.manifest.rows.map((row) => row.recipient_pubkey)).toEqual([SELLER.pubkey, VALIDATOR.pubkey, RECIPIENT.pubkey])

		const total = result.manifest.rows.reduce((sum, row) => sum + row.amount_sats, 0)
		expect(total).toBe(10_000)
		expect(result.manifest.total_amount_sats).toBe(10_000)
		// 2% and 10% of 10,000, with the seller taking the remainder.
		expect(result.manifest.rows.map((row) => row.amount_sats)).toEqual([8_800, 200, 1_000])
	})

	test('child keys all derive at the shared path from each payee’s own xpub', () => {
		const result = buildMultipartyBidManifest(baseInput())
		if (!result.ok) throw new Error('expected ok')

		// The manifest records x-only keys; the lock uses the compressed form. Compare x-only.
		const atSharedPath = (xpub: string) => bytesToHex(HDKey.fromExtendedKey(xpub).derive('m/0/7').publicKey as Uint8Array).slice(2)
		expect(result.manifest.rows[0].child_pubkey).toBe(atSharedPath(SELLER.xpub))
		expect(result.manifest.rows[1].child_pubkey).toBe(atSharedPath(VALIDATOR.xpub))
		expect(result.manifest.rows[2].child_pubkey).toBe(atSharedPath(RECIPIENT.xpub))
		// Distinct child keys — `compileManifest` refuses a reused one, and a reused key would mean
		// two payees could spend the same output.
		expect(new Set(result.manifest.rows.map((row) => row.child_pubkey)).size).toBe(3)
	})

	test('a different shared path produces different child keys — the path is load-bearing', () => {
		const a = buildMultipartyBidManifest(baseInput())
		const b = buildMultipartyBidManifest(baseInput({ sharedPath: 'm/0/8' }))
		if (!a.ok || !b.ok) throw new Error('expected ok')
		expect(a.manifest.rows[1].child_pubkey).not.toBe(b.manifest.rows[1].child_pubkey)
		expect(a.manifest.manifest_commitment).not.toBe(b.manifest.manifest_commitment)
	})

	test('the tags carry the commitments a release must bind to', () => {
		const result = buildMultipartyBidManifest(baseInput())
		if (!result.ok) throw new Error('expected ok')
		expect(result.tags.payout_schedule_commitment).toBe('a'.repeat(64))
		expect(result.tags.payout_manifest).toBe(result.manifest.tagValue)
		expect(result.tags.payout_manifest).toStartWith('b64u:')
		expect(result.tags.payout_manifest_commitment).toBe(result.manifest.manifest_commitment)
	})

	test('is deterministic: the same inputs produce the same bytes and commitment', () => {
		const a = buildMultipartyBidManifest(baseInput())
		const b = buildMultipartyBidManifest(baseInput())
		if (!a.ok || !b.ok) throw new Error('expected ok')
		expect(bytesToHex(a.manifest.canonical_bytes)).toBe(bytesToHex(b.manifest.canonical_bytes))
		expect(a.manifest.manifest_commitment).toBe(b.manifest.manifest_commitment)
	})

	test('the locks list matches the rows one-to-one — the wallet contract', () => {
		const result = buildMultipartyBidManifest(baseInput())
		if (!result.ok) throw new Error('expected ok')
		expect(result.locks).toHaveLength(result.manifest.rows.length)
		expect(result.locks.map((lock) => lock.childPubkey)).toEqual(result.manifest.rows.map((row) => row.child_pubkey))
		expect(result.locks.map((lock) => lock.amountSats)).toEqual(result.manifest.rows.map((row) => row.amount_sats))
	})

	test('the manifest is what the wire codec produces for those rows', () => {
		const result = buildMultipartyBidManifest(baseInput())
		if (!result.ok) throw new Error('expected ok')
		const recomputed = compileManifest(result.manifest.rows.map(({ manifest_index: _i, ...row }) => row))
		expect(recomputed.manifest_commitment).toBe(result.manifest.manifest_commitment)
	}, // The file runs in well under a second on an idle machine, but the first schnorr use pays
	// for curve precomputation — under load that has exceeded bun's 5s default here.
	30_000)
})

describe('buildMultipartyBidManifest — refusals', () => {
	test('an empty schedule has nothing to split', () => {
		const result = buildMultipartyBidManifest(baseInput({ schedule: schedule({ entries: [] }) }))
		expect(result).toMatchObject({ ok: false, code: 'manifest_schedule_empty' })
	})

	test('a zero-bps entry is refused rather than given a zero row or skipped', () => {
		// A zero-bps validator is permitted by the schedule but cannot have a positive manifest row,
		// and the index mapping is positional. Refusing is the honest option; see the module comment.
		const zeroed = schedule({
			entries: [
				{
					schedule_index: 0,
					role: 'validator',
					recipient_pubkey: VALIDATOR.pubkey,
					payout_capability_event_id: 'cap-validator',
					allocation_bps: 0,
				},
				{
					schedule_index: 1,
					role: 'v4v',
					recipient_pubkey: RECIPIENT.pubkey,
					payout_capability_event_id: 'cap-recipient',
					allocation_bps: 1000,
				},
			],
		})
		const result = buildMultipartyBidManifest(baseInput({ schedule: zeroed }))
		expect(result).toMatchObject({ ok: false, code: 'manifest_zero_allocation_unsupported' })
	})

	test('invalid amounts to lock are refused', () => {
		for (const totalSats of [0, -1, 1.5, Number.NaN]) {
			expect(buildMultipartyBidManifest(baseInput({ totalSats }))).toMatchObject({ ok: false, code: 'manifest_total_invalid' })
		}
	})

	test('a missing xpub or shared path is refused', () => {
		expect(buildMultipartyBidManifest(baseInput({ sellerPayoutXpub: '' }))).toMatchObject({
			ok: false,
			code: 'manifest_seller_xpub_missing',
		})
		expect(buildMultipartyBidManifest(baseInput({ sharedPath: '' }))).toMatchObject({ ok: false, code: 'manifest_shared_path_missing' })
	})

	test('the exact capability snapshot is required, not just any capability for that payee', () => {
		// D4: the schedule names the capability event it bound to.
		const result = buildMultipartyBidManifest(baseInput({ capabilities: [CAP_RECIPIENT] }))
		expect(result).toMatchObject({ ok: false, code: 'manifest_capability_missing' })
	})

	test('a capability belonging to someone else is refused', () => {
		const swapped = { ...CAP_VALIDATOR, recipient_pubkey: RECIPIENT.pubkey }
		const result = buildMultipartyBidManifest(baseInput({ capabilities: [swapped, CAP_RECIPIENT] }))
		expect(result).toMatchObject({ ok: false, code: 'manifest_capability_recipient_mismatch' })
	})

	test('expired and not-yet-valid capabilities are refused', () => {
		expect(
			buildMultipartyBidManifest(baseInput({ capabilities: [capability(VALIDATOR, 'cap-validator', { expires_at: NOW }), CAP_RECIPIENT] })),
		).toMatchObject({ ok: false, code: 'manifest_capability_expired' })
		expect(
			buildMultipartyBidManifest(
				baseInput({ capabilities: [capability(VALIDATOR, 'cap-validator', { valid_from: NOW + 60 }), CAP_RECIPIENT] }),
			),
		).toMatchObject({ ok: false, code: 'manifest_capability_not_yet_valid' })
	})

	test('a capability whose proof of possession does not verify is refused', () => {
		// Signed by the wrong key: the xpub's own key must sign, so funds are locked to a key the
		// payee provably controls.
		const forged = capability(VALIDATOR, 'cap-validator', { signWith: RECIPIENT.master.privateKey as Uint8Array })
		const result = buildMultipartyBidManifest(baseInput({ capabilities: [forged, CAP_RECIPIENT] }))
		expect(result).toMatchObject({ ok: false, code: 'manifest_capability_pop_invalid' })
	})

	test('a payee that accepts none of the bid’s mints is refused', () => {
		const result = buildMultipartyBidManifest(
			baseInput({ acceptedMints: ['https://mint.other.example'], capabilities: [CAP_VALIDATOR, CAP_RECIPIENT] }),
		)
		expect(result).toMatchObject({ ok: false, code: 'manifest_capability_mint_mismatch' })
	})

	test('a mint both sides accept is allowed', () => {
		const result = buildMultipartyBidManifest(baseInput({ acceptedMints: ['https://mint.example.com'] }))
		expect(result.ok).toBe(true)
	})
})
