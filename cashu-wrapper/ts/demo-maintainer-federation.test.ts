import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	createDemoMaintainerFederationParticipantPort,
	createDemoThreeOfFourMaintainerFederationPort,
	type DemoMaintainerFederationParticipantPort,
	type DemoMaintainerFederationRequest,
} from './demo-maintainer-federation'

const scalar = (value: number): string => value.toString(16).padStart(64, '0')
const publicKey = (value: number): string => bytesToHex(secp256k1.getPublicKey(hexToBytes(scalar(value)), true))
const digest = (value: string): string => value.repeat(64)
const COMMITTEE_PRIVATE = scalar(90)
const COMMITTEE_PUBLIC = publicKey(90)

function request(sessionId = digest('1')): DemoMaintainerFederationRequest {
	return {
		schema: 'COCO_DEMO_FROST_REQUEST_V1',
		threshold: 3,
		sessionId,
		packageDigest: digest('2'),
		cashuSigAllDigest: digest('3'),
		committeePublicKey: COMMITTEE_PUBLIC,
		committeeKeysetId: 'candidate-3-of-4-keyset',
		committeeKeysetVersion: 'not-activated',
		participants: [1, 2, 3, 4].map((identifier) => ({
			identifier: identifier as 1 | 2 | 3 | 4,
			verifyingShare: publicKey(10 + identifier),
		})),
		policyPackageDigest: digest('4'),
		closureEvidenceDigest: digest('5'),
		signedBidEvidenceDigest: digest('6'),
		committeeLockedProofsDigest: digest('7'),
	}
}

function participant(
	identifier: 1 | 2 | 3 | 4,
	options: {
		withhold?: boolean
		hangRoundOne?: boolean
		wrongOutcome?: boolean
		roundTwoWithhold?: boolean
		hangRoundTwo?: boolean
	} = {},
): DemoMaintainerFederationParticipantPort {
	return {
		participantId: identifier,
		verifyingShare: publicKey(10 + identifier),
		async roundOneVerified(selected) {
			if (options.withhold) throw new Error(`maintainer ${identifier} unavailable`)
			if (options.hangRoundOne) return new Promise<never>(() => {})
			return {
				commitment: {
					participantId: identifier,
					sessionId: selected.sessionId,
					digest: selected.cashuSigAllDigest,
					hiding: publicKey(20 + identifier * 2),
					binding: publicKey(21 + identifier * 2),
				},
				policyEvidence: {
					schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_EVIDENCE_V1',
					policyPackageDigest: selected.policyPackageDigest,
					closureEvidenceDigest: options.wrongOutcome ? digest('f') : selected.closureEvidenceDigest,
					signedBidEvidenceDigest: selected.signedBidEvidenceDigest,
					committeeLockedProofsDigest: selected.committeeLockedProofsDigest,
					authenticatedPackageDigest: selected.packageDigest,
					derivedCashuSigAllDigest: selected.cashuSigAllDigest,
				},
			}
		},
		async roundTwo(selected) {
			if (options.roundTwoWithhold) throw new Error(`maintainer ${identifier} withheld round two`)
			if (options.hangRoundTwo) return new Promise<never>(() => {})
			return {
				participantId: identifier,
				sessionId: selected.sessionId,
				digest: selected.digest,
				transcriptHash: selected.transcriptHash,
				share: scalar(identifier),
			}
		},
	}
}

function aggregator(counter: { calls: number }) {
	return {
		async aggregate(selected: { digest: string; transcriptHash: string; commitments: unknown[]; shares: unknown[] }) {
			counter.calls += 1
			expect(selected.commitments).toHaveLength(3)
			expect(selected.shares).toHaveLength(3)
			return {
				transcriptHash: selected.transcriptHash,
				signature: bytesToHex(schnorr.sign(hexToBytes(selected.digest), hexToBytes(COMMITTEE_PRIVATE))),
			}
		},
	}
}

describe('local-only 3-of-4 maintainer-federation candidate', () => {
	test('every valid three-member subset authorizes and two members never do', async () => {
		for (const excluded of [1, 2, 3, 4] as const) {
			const calls = { calls: 0 }
			const port = createDemoThreeOfFourMaintainerFederationPort([
				participant(1), participant(2), participant(3), participant(4),
			], aggregator(calls), { excludeParticipantId: excluded })
			const expected = ([1, 2, 3, 4] as const).filter((id) => id !== excluded)
			await expect(port.authorize(request(digest(String(excluded))))).resolves.toMatchObject({ participantIds: expected })
			expect(calls.calls).toBe(1)
		}
	})

	test('one withheld maintainer still permits an exact three-member authorization', async () => {
		const calls = { calls: 0 }
		const port = createDemoThreeOfFourMaintainerFederationPort([
			participant(1), participant(2), participant(3), participant(4, { withhold: true }),
		], aggregator(calls))
		await expect(port.authorize(request())).resolves.toMatchObject({
			threshold: 3,
			participantIds: [1, 2, 3],
			packageDigest: digest('2'),
			cashuSigAllDigest: digest('3'),
		})
		expect(calls.calls).toBe(1)
	})

	test('two withheld maintainers block before aggregation', async () => {
		const calls = { calls: 0 }
		const port = createDemoThreeOfFourMaintainerFederationPort([
			participant(1), participant(2), participant(3, { withhold: true }), participant(4, { withhold: true }),
		], aggregator(calls))
		await expect(port.authorize(request())).rejects.toMatchObject({ code: 'DEMO_MAINTAINER_THRESHOLD_UNAVAILABLE' })
		expect(calls.calls).toBe(0)
	})

	test('one silent round-one maintainer is bounded and the other three still authorize', async () => {
		const calls = { calls: 0 }
		const port = createDemoThreeOfFourMaintainerFederationPort([
			participant(1), participant(2), participant(3), participant(4, { hangRoundOne: true }),
		], aggregator(calls), { roundTimeoutMs: 10 })
		await expect(port.authorize(request())).resolves.toMatchObject({ participantIds: [1, 2, 3] })
		expect(calls.calls).toBe(1)
	})

	test('one faulty outcome receipt is excluded and the three matching maintainers authorize', async () => {
		const calls = { calls: 0 }
		const port = createDemoThreeOfFourMaintainerFederationPort([
			participant(1, { wrongOutcome: true }), participant(2), participant(3), participant(4),
		], aggregator(calls))
		await expect(port.authorize(request())).resolves.toMatchObject({ participantIds: [2, 3, 4] })
		expect(calls.calls).toBe(1)
	})

	test('two non-matching outcome receipts block the wrong branch', async () => {
		const calls = { calls: 0 }
		const port = createDemoThreeOfFourMaintainerFederationPort([
			participant(1, { wrongOutcome: true }), participant(2, { wrongOutcome: true }), participant(3), participant(4),
		], aggregator(calls))
		await expect(port.authorize(request())).rejects.toMatchObject({ code: 'DEMO_MAINTAINER_THRESHOLD_UNAVAILABLE' })
		expect(calls.calls).toBe(0)
	})

	test('duplicate nonce commitments are rejected before round two or aggregation', async () => {
		const calls = { calls: 0 }
		const duplicate = participant(2)
		const original = duplicate.roundOneVerified.bind(duplicate)
		duplicate.roundOneVerified = async (selected) => {
			const value = await original(selected)
			value.commitment.hiding = publicKey(22)
			return value
		}
		const port = createDemoThreeOfFourMaintainerFederationPort([
			participant(1), duplicate, participant(3), participant(4),
		], aggregator(calls))
		await expect(port.authorize(request())).rejects.toMatchObject({
			code: 'DEMO_MAINTAINER_FRESH_SESSION_REQUIRED',
			failedParticipantIds: [1, 2, 3],
		})
		expect(calls.calls).toBe(0)
	})

	test('duplicate signature shares are rejected before aggregation', async () => {
		const calls = { calls: 0 }
		const duplicate = participant(2)
		const original = duplicate.roundTwo.bind(duplicate)
		duplicate.roundTwo = async (selected) => ({ ...await original(selected), share: scalar(1) })
		const port = createDemoThreeOfFourMaintainerFederationPort([
			participant(1), duplicate, participant(3), participant(4),
		], aggregator(calls))
		await expect(port.authorize(request())).rejects.toMatchObject({
			code: 'DEMO_MAINTAINER_FRESH_SESSION_REQUIRED',
			failedParticipantIds: [1, 2, 3],
		})
		expect(calls.calls).toBe(0)
	})

	test('a syntactically valid bad share cannot block all fresh subsets', async () => {
		const aggregate = {
			async aggregate(selected: { digest: string; transcriptHash: string; commitments: Array<{ participantId: number }> }) {
				return {
					transcriptHash: selected.transcriptHash,
					signature: selected.commitments.some(({ participantId }) => participantId === 1)
						? '00'.repeat(64)
						: bytesToHex(schnorr.sign(hexToBytes(selected.digest), hexToBytes(COMMITTEE_PRIVATE))),
				}
			},
		}
		const port = createDemoThreeOfFourMaintainerFederationPort([
			participant(1), participant(2), participant(3), participant(4),
		], aggregate)
		await expect(port.authorize(request())).rejects.toMatchObject({
			code: 'DEMO_MAINTAINER_FRESH_SESSION_REQUIRED',
			failedParticipantIds: [1, 2, 3],
		})
		await expect(port.authorize(request(digest('9')), { excludeParticipantId: 1 })).resolves.toMatchObject({
			participantIds: [2, 3, 4],
		})
	})

	test('an aggregate command rejection burns the session and identifies every ambiguous selected signer', async () => {
		const port = createDemoThreeOfFourMaintainerFederationPort([
			participant(1), participant(2), participant(3), participant(4),
		], {
			async aggregate() { throw new Error('Rust rejected a cryptographically invalid share') },
		})
		await expect(port.authorize(request())).rejects.toMatchObject({
			code: 'DEMO_MAINTAINER_FRESH_SESSION_REQUIRED',
			failedParticipantIds: [1, 2, 3],
		})
	})

	test('a selected signer withholding round two burns the session; a fresh session can exclude it', async () => {
		const calls = { calls: 0 }
		const port = createDemoThreeOfFourMaintainerFederationPort([
			participant(1), participant(2, { hangRoundTwo: true }), participant(3), participant(4),
		], aggregator(calls), { roundTimeoutMs: 10 })
		await expect(port.authorize(request())).rejects.toMatchObject({ code: 'DEMO_MAINTAINER_FRESH_SESSION_REQUIRED' })
		expect(calls.calls).toBe(0)

		const retry = createDemoThreeOfFourMaintainerFederationPort([
			participant(1), participant(2), participant(3), participant(4),
		], aggregator(calls), { excludeParticipantId: 2 })
		await expect(retry.authorize(request(digest('8')))).resolves.toMatchObject({
			participantIds: [1, 3, 4],
			sessionId: digest('8'),
		})
		expect(calls.calls).toBe(1)
	})

	test('a faulty participant cannot mutate the private request seen by honest participants', async () => {
		const calls = { calls: 0 }
		const original = request()
		const mutator = participant(1)
		mutator.roundOneVerified = async (selected) => {
			selected.packageDigest = digest('a')
			selected.cashuSigAllDigest = digest('b')
			selected.policyPackageDigest = digest('c')
			throw new Error('faulty participant mutated its request clone')
		}
		const port = createDemoThreeOfFourMaintainerFederationPort([
			mutator, participant(2), participant(3), participant(4),
		], aggregator(calls))
		await expect(port.authorize(original)).resolves.toMatchObject({
			participantIds: [2, 3, 4],
			packageDigest: digest('2'),
			cashuSigAllDigest: digest('3'),
		})
		expect(original).toEqual(request())
		expect(calls.calls).toBe(1)
	})

	test('strips unexpected caller fields before any participant boundary', async () => {
		const calls = { calls: 0 }
		const participants = [participant(1), participant(2), participant(3), participant(4)]
		for (const selected of participants) {
			const roundOne = selected.roundOneVerified.bind(selected)
			selected.roundOneVerified = async (received) => {
				expect(Object.hasOwn(received, 'bearerProofs')).toBe(false)
				expect(Object.keys(received).sort()).toEqual([
					'cashuSigAllDigest',
					'closureEvidenceDigest',
					'committeeKeysetId',
					'committeeKeysetVersion',
					'committeeLockedProofsDigest',
					'committeePublicKey',
					'packageDigest',
					'participants',
					'policyPackageDigest',
					'schema',
					'sessionId',
					'signedBidEvidenceDigest',
					'threshold',
				])
				return roundOne(received)
			}
		}
		const smuggled = { ...request(), bearerProofs: [{ secret: 'must-not-cross' }] }
		const port = createDemoThreeOfFourMaintainerFederationPort(participants, aggregator(calls))
		await expect(port.authorize(smuggled)).resolves.toMatchObject({ participantIds: [1, 2, 3] })
		expect(calls.calls).toBe(1)
	})

	test('captures participant and aggregator methods before asynchronous authorization', async () => {
		const calls = { calls: 0 }
		const participants = [participant(1), participant(2), participant(3), participant(4)]
		const aggregate = aggregator(calls)
		const port = createDemoThreeOfFourMaintainerFederationPort(participants, aggregate)
		participants[0]!.roundOneVerified = async () => { throw new Error('substituted participant') }
		aggregate.aggregate = async () => { throw new Error('substituted aggregator') }
		await expect(port.authorize(request())).resolves.toMatchObject({ participantIds: [1, 2, 3] })
		expect(calls.calls).toBe(1)
	})

	test('participant adapter refuses missing local policy before creating a signer nonce', async () => {
		let roundOneCalls = 0
		const port = createDemoMaintainerFederationParticipantPort({
			signer: {
				participantId: 1,
				verifyingShare: publicKey(11),
				async roundOne() {
					roundOneCalls += 1
					throw new Error('must not create a nonce without participant-local policy')
				},
				async roundTwo() { throw new Error('unused') },
			},
			policySource: { async readExact() { return null } },
			policyPorts: {
				closureVerifier: { async verifyAndDerive() { throw new Error('unused') } },
				signedBidVerifier: { async verifyAndDerive() { throw new Error('unused') } },
				proofUse: { async assertExclusive() { throw new Error('unused') } },
			},
		})
		await expect(port.roundOneVerified(request())).rejects.toMatchObject({ code: 'DEMO_MAINTAINER_POLICY' })
		expect(roundOneCalls).toBe(0)
	})
})
