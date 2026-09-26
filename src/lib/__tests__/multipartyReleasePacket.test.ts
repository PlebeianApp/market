/**
 * Multiparty release packet.
 *
 * The two tests that carry the weight are the ones about a **partial release**: a release naming three
 * rows of a four-row leg is refused, not partially accepted, because a leg that settles from three rows
 * paid three of its four recipients. The second is the replay protection — the commitments are compared
 * against what the reader holds, never against what the release says about itself.
 */
import { describe, expect, test } from 'bun:test'
import {
	buildMultipartyReleaseTags,
	multipartyReleaseBindsLeg,
	parseMultipartyReleaseTags,
	type MultipartyReleasePacketInput,
} from '../auction/multipartyReleasePacket'

const BID = 'b'.repeat(64)
const COORDINATE = `30408:${'a'.repeat(64)}:lot-1`
const SELLER = 'a'.repeat(64)
const SCHEDULE_COMMITMENT = 'c'.repeat(64)
const MANIFEST_COMMITMENT = 'd'.repeat(64)
const PATH_COMMITMENT = 'e'.repeat(64)
const CHILDREN = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)]

const input = (overrides: Partial<MultipartyReleasePacketInput> = {}): MultipartyReleasePacketInput => ({
	bidEventId: BID,
	auctionCoordinate: COORDINATE,
	sellerPubkey: SELLER,
	releaseReason: 'settlement',
	derivationPath: 'm/0/71/0',
	scheduleCommitment: SCHEDULE_COMMITMENT,
	manifestCommitment: MANIFEST_COMMITMENT,
	rows: CHILDREN.map((childPubkey, index) => ({ childPubkey, cashuToken: `cashuA-token-${index}` })),
	...overrides,
})

const mustBuild = (overrides: Partial<MultipartyReleasePacketInput> = {}) => {
	const built = buildMultipartyReleaseTags(input(overrides))
	if (!built.ok) throw new Error(`expected tags, got ${built.code}: ${built.detail}`)
	return built.tags
}

const mustParse = (tags: readonly (readonly string[])[]) => {
	const parsed = parseMultipartyReleaseTags(tags)
	if (!parsed.ok) throw new Error(`expected a packet, got ${parsed.code}: ${parsed.detail}`)
	return parsed.packet
}

describe('multiparty release packet', () => {
	test('carries the leg commitments a multiparty release must add to the single-party tags', () => {
		const tags = mustBuild()

		expect(tags).toContainEqual(['payout_schedule_commitment', SCHEDULE_COMMITMENT])
		expect(tags).toContainEqual(['payout_manifest_commitment', MANIFEST_COMMITMENT])
		expect(tags).toContainEqual(['derivation_path', 'm/0/71/0'])
		expect(tags).toContainEqual(['release_reason', 'settlement'])
	})

	test('emits one child key per row, in manifest index order, with the tokens in the same order', () => {
		const tags = mustBuild()
		const keys = tags.filter((tag) => tag[0] === 'child_pubkey').map((tag) => tag[1])
		const tokens = tags.filter((tag) => tag[0] === 'cashu_token').map((tag) => tag[1])

		expect(keys).toEqual(CHILDREN)
		expect(tokens).toEqual(['cashuA-token-0', 'cashuA-token-1', 'cashuA-token-2'])
	})

	test('omits every token when the release is not redeemable, rather than emitting some', () => {
		const tags = mustBuild({ rows: CHILDREN.map((childPubkey) => ({ childPubkey })) })

		expect(tags.filter((tag) => tag[0] === 'cashu_token')).toHaveLength(0)
		expect(tags.filter((tag) => tag[0] === 'child_pubkey')).toHaveLength(3)
	})

	test('carries the path commitment only when the bid made one', () => {
		expect(mustBuild({ pathCommitment: PATH_COMMITMENT })).toContainEqual(['path_commitment', PATH_COMMITMENT])
		expect(mustBuild().some((tag) => tag[0] === 'path_commitment')).toBe(false)
	})

	test('refuses a release that redeems only some rows', () => {
		const built = buildMultipartyReleaseTags(
			input({ rows: [{ childPubkey: CHILDREN[0], cashuToken: 'cashuA-0' }, { childPubkey: CHILDREN[1] }] }),
		)

		expect(built.ok).toBe(false)
		if (built.ok) return
		expect(built.code).toBe('release_tokens_partial')
	})

	test('round-trips: what the builder emits is what the reader parses', () => {
		const packet = mustParse(mustBuild({ pathCommitment: PATH_COMMITMENT, fallbackOfferId: 'f'.repeat(64) }))

		expect(packet.bidEventId).toBe(BID)
		expect(packet.auctionCoordinate).toBe(COORDINATE)
		expect(packet.sellerPubkey).toBe(SELLER)
		expect(packet.releaseReason).toBe('settlement')
		expect(packet.derivationPath).toBe('m/0/71/0')
		expect(packet.scheduleCommitment).toBe(SCHEDULE_COMMITMENT)
		expect(packet.manifestCommitment).toBe(MANIFEST_COMMITMENT)
		expect(packet.pathCommitment).toBe(PATH_COMMITMENT)
		expect(packet.fallbackOfferId).toBe('f'.repeat(64))
		expect(packet.rows.map((row) => row.childPubkey)).toEqual(CHILDREN)
		expect(packet.rows.map((row) => row.cashuToken)).toEqual(['cashuA-token-0', 'cashuA-token-1', 'cashuA-token-2'])
	})

	test('refuses a tag set with no commitments at all — a single-party release read as multiparty', () => {
		const singleParty = [
			['e', BID],
			['a', COORDINATE],
			['p', SELLER],
			['derivation_path', 'm/0/71/0'],
			['child_pubkey', CHILDREN[0]],
			['release_reason', 'settlement'],
		]
		const parsed = parseMultipartyReleaseTags(singleParty)

		expect(parsed.ok).toBe(false)
		if (parsed.ok) return
		expect(parsed.code).toBe('release_schedule_commitment_invalid')
	})

	test('refuses a duplicated commitment — two commitments on one release means one is decoration', () => {
		const tags = [...mustBuild(), ['payout_manifest_commitment', MANIFEST_COMMITMENT]]
		const parsed = parseMultipartyReleaseTags(tags)

		expect(parsed.ok).toBe(false)
		if (parsed.ok) return
		expect(parsed.code).toBe('release_manifest_commitment_invalid')
	})

	test('refuses a malformed commitment, path or reason', () => {
		const badSchedule = parseMultipartyReleaseTags(
			mustBuild().map((tag) => (tag[0] === 'payout_schedule_commitment' ? ['payout_schedule_commitment', 'nope'] : tag)),
		)
		const badPath = parseMultipartyReleaseTags(
			mustBuild().map((tag) => (tag[0] === 'derivation_path' ? ['derivation_path', 'not-a-path'] : tag)),
		)
		const badReason = parseMultipartyReleaseTags(
			mustBuild().map((tag) => (tag[0] === 'release_reason' ? ['release_reason', 'because'] : tag)),
		)

		expect(badSchedule.ok).toBe(false)
		expect(badPath.ok).toBe(false)
		expect(badReason.ok).toBe(false)
		if (badSchedule.ok || badPath.ok || badReason.ok) return
		expect(badSchedule.code).toBe('release_schedule_commitment_invalid')
		expect(badPath.code).toBe('release_path_invalid')
		expect(badReason.code).toBe('release_reason_invalid')
	})

	test('refuses a tag set with no rows, or with a key that is not x-only', () => {
		const noRows = parseMultipartyReleaseTags(mustBuild().filter((tag) => !['child_pubkey', 'cashu_token'].includes(tag[0])))
		const compressedKey = parseMultipartyReleaseTags(
			mustBuild().map((tag) => (tag[0] === 'child_pubkey' ? ['child_pubkey', `02${CHILDREN[0]}`] : tag)),
		)

		expect(noRows.ok).toBe(false)
		expect(compressedKey.ok).toBe(false)
		if (noRows.ok || compressedKey.ok) return
		expect(noRows.code).toBe('release_rows_empty')
		expect(compressedKey.code).toBe('release_row_key_invalid')
	})

	test('refuses a reader-side token count that does not match the row count', () => {
		const tags = mustBuild().filter((tag) => !(tag[0] === 'cashu_token' && tag[1] === 'cashuA-token-2'))
		const parsed = parseMultipartyReleaseTags(tags)

		expect(parsed.ok).toBe(false)
		if (parsed.ok) return
		expect(parsed.code).toBe('release_tokens_partial')
	})

	test('binds the leg it claims to release, compared against what the reader holds', () => {
		const packet = mustParse(mustBuild())

		const bound = multipartyReleaseBindsLeg(packet, {
			bidEventId: BID,
			scheduleCommitment: SCHEDULE_COMMITMENT,
			manifestCommitment: MANIFEST_COMMITMENT,
			rowCount: 3,
		})

		expect(bound.ok).toBe(true)
	})

	test('refuses a release for another bid, schedule, manifest, or a different row count', () => {
		const packet = mustParse(mustBuild())
		const expectation = { bidEventId: BID, scheduleCommitment: SCHEDULE_COMMITMENT, manifestCommitment: MANIFEST_COMMITMENT, rowCount: 3 }

		const otherBid = multipartyReleaseBindsLeg(packet, { ...expectation, bidEventId: '9'.repeat(64) })
		const otherSchedule = multipartyReleaseBindsLeg(packet, { ...expectation, scheduleCommitment: '9'.repeat(64) })
		const otherManifest = multipartyReleaseBindsLeg(packet, { ...expectation, manifestCommitment: '9'.repeat(64) })
		const fewerRows = multipartyReleaseBindsLeg(packet, { ...expectation, rowCount: 4 })

		for (const result of [otherBid, otherSchedule, otherManifest, fewerRows]) expect(result.ok).toBe(false)
		if (otherBid.ok || otherSchedule.ok || otherManifest.ok || fewerRows.ok) return
		expect(otherBid.code).toBe('release_bid_mismatch')
		expect(otherSchedule.code).toBe('release_schedule_commitment_mismatch')
		expect(otherManifest.code).toBe('release_manifest_commitment_mismatch')
		expect(fewerRows.code).toBe('release_row_count_mismatch')
	})

	test('refuses a release that omits a path commitment the bid made, or invents one it did not', () => {
		const withoutCommitment = mustParse(mustBuild())
		const withCommitment = mustParse(mustBuild({ pathCommitment: PATH_COMMITMENT }))
		const expectation = { bidEventId: BID, scheduleCommitment: SCHEDULE_COMMITMENT, manifestCommitment: MANIFEST_COMMITMENT, rowCount: 3 }

		const omitted = multipartyReleaseBindsLeg(withoutCommitment, { ...expectation, expectedPathCommitment: PATH_COMMITMENT })
		const invented = multipartyReleaseBindsLeg(withCommitment, expectation)

		expect(omitted.ok).toBe(false)
		expect(invented.ok).toBe(false)
		if (omitted.ok || invented.ok) return
		expect(omitted.code).toBe('release_path_commitment_mismatch')
		expect(invented.code).toBe('release_path_commitment_unexpected')
	})
})
