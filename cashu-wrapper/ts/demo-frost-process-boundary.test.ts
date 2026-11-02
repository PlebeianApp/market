import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	createFourSeparatedFrostProcessPorts,
	demoFrostProcessRosterDigest,
	type DemoFrostObservedProcess,
	type DemoFrostProcessBinding,
	type DemoFrostProcessParticipant,
	type DemoFrostProcessRoundOneRequest,
	type DemoFrostProcessRoundOneResponse,
	type DemoFrostProcessRoundTwoRequest,
	type DemoFrostProcessRoundTwoResponse,
	type DemoFrostProcessTransport,
} from './demo-frost-process-boundary'
import {
	demoFrostCommitteeLockedProofsDigest,
	demoFrostParticipantPolicyDigest,
	validateDemoFrostParticipantPolicy,
	type DemoFrostParticipantPolicyEvidence,
	type DemoFrostParticipantPolicyPackage,
} from './demo-frost-participant-policy'
import type {
	DemoParticipantId,
	DemoRoundOneCommitment,
	DemoRoundOneRequest,
	DemoRoundTwoRequest,
} from './demo-sigall-settlement'
import { demoFrostTranscriptHash } from './index'
import {
	buildDemoSigAllSecret,
	demoCashuSigAllDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
} from './demo-sigall-settlement'
import { proofPoint } from './nut-client'

const point = (participantId: number, offset = 0): string =>
	`${participantId % 2 === 0 ? '03' : '02'}${(participantId + offset).toString(16).padStart(64, '0')}`
const oppositeParity = (compressed: string): string => `${compressed.startsWith('02') ? '03' : '02'}${compressed.slice(2)}`
const actorPrivate = '09'.padStart(64, '0')
const actorId = bytesToHex(schnorr.getPublicKey(hexToBytes(actorPrivate)))
const recipientPrivate = '0a'.padStart(64, '0')
const recipientPublic = bytesToHex(secp256k1.getPublicKey(hexToBytes(recipientPrivate), true))
const bidderPublicKey = point(1, 100)
const committeePublicKey = point(2, 100)
const refundPublicKey = point(3, 100)
const fixtureProofEntries = [4, 8].map((amount, index) => {
	const proof = {
		amount,
		id: 'keyset-1',
		secret: buildDemoSigAllSecret({
			nonce: `${index + 1}`.padStart(64, '0'),
			bidderPublicKey,
			committeePublicKey,
			locktime: 2_000_000_000,
			refundPublicKey,
		}),
		C: point(index + 1, 200),
	}
	return { proof, proofStateRef: bytesToHex(proofPoint(proof).toBytes(true)) }
}).sort((left, right) => left.proofStateRef.localeCompare(right.proofStateRef))
const fixtureDeposits = fixtureProofEntries.map(({ proof, proofStateRef }) => ({
	proofStateRef,
	amount: proof.amount,
	keysetId: proof.id,
}))
const fixtureProofs = fixtureProofEntries.map(({ proof }) => proof)
const fixtureOutputs = [
	{ amount: 4, id: 'keyset-1', B_: point(1, 300) },
	{ amount: 8, id: 'keyset-1', B_: point(2, 300) },
]

const roundOneRequest: DemoRoundOneRequest = {
	sessionId: '11'.repeat(32),
	digest: demoCashuSigAllDigest(fixtureProofs, fixtureOutputs),
	packageDigest: '33'.repeat(32),
	committeeKeysetId: 'demo-frost-keyset',
	committeeKeysetVersion: '7',
}

function policyFixture(): DemoFrostParticipantPolicyPackage {
	const packageDigest = roundOneRequest.packageDigest
	const outputs = fixtureOutputs.map((output) => ({ ...output }))
	const capabilityBase = {
		schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1' as const,
		network: 'aa'.repeat(32),
		chainId: 'demo-chain',
		auctionId: 'auction-1',
		operationId: 'operation-1',
		role: 'winner_settlement' as const,
		mintUrl: 'https://testnut.example',
		unit: 'sat',
		recipientPublicKey: recipientPublic,
		outputsDigest: demoOutputsDigest(outputs),
		signature: '00'.repeat(64),
	}
	const recipientCapability = {
		...capabilityBase,
		signature: bytesToHex(schnorr.sign(hexToBytes(demoRecipientCapabilityDigest(capabilityBase)), hexToBytes(recipientPrivate))),
	}
	return {
		schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_V1',
		network: 'aa'.repeat(32),
		chainId: 'demo-chain',
		auctionId: 'auction-1',
		operationId: 'operation-1',
		bidId: 'bid-1',
		bidEventId: 'bb'.repeat(32),
		bidderActorId: actorId,
		role: 'winner_settlement',
		outcomeHeight: 42,
		appStateHash: 'cc'.repeat(32),
		amount: 12,
		inputFee: 0,
		inputFeePpk: 0,
		mintUrl: 'https://testnut.example',
		unit: 'sat',
		activeKeysetId: 'keyset-1',
		locktime: 2_000_000_000,
		bidderPublicKey,
		committeePublicKey,
		sellerRecipientPublicKey: recipientPublic,
		recipientPublicKey: recipientPublic,
		deposits: fixtureDeposits.map((deposit) => ({ ...deposit })),
		committeeLockedProofs: fixtureProofs.map((proof) => ({ ...proof })),
		outputs,
		recipientCapability,
		packageDigest,
		cashuSigAllDigest: roundOneRequest.digest,
		actorPackageAuthorization: {
			actorId,
			packageDigest,
			signature: bytesToHex(schnorr.sign(hexToBytes(packageDigest), hexToBytes(actorPrivate))),
		},
		certifiedClosure: { evidenceDigest: 'dd'.repeat(32), evidence: { schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V1', source: 'participant-local' } },
		signedBid: { evidenceDigest: 'ee'.repeat(32), evidence: { schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_SIGNED_BID_EVIDENCE_V1', source: 'participant-local' } },
	}
}

function policyEvidence(policy: DemoFrostParticipantPolicyPackage): DemoFrostParticipantPolicyEvidence {
	return {
		schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_EVIDENCE_V1',
		policyPackageDigest: demoFrostParticipantPolicyDigest(policy),
		closureEvidenceDigest: policy.certifiedClosure.evidenceDigest,
		signedBidEvidenceDigest: policy.signedBid.evidenceDigest,
		committeeLockedProofsDigest: demoFrostCommitteeLockedProofsDigest(policy.committeeLockedProofs),
		authenticatedPackageDigest: policy.packageDigest,
		derivedCashuSigAllDigest: policy.cashuSigAllDigest,
	}
}

function peer(participantId: DemoParticipantId, overrides: Partial<DemoFrostObservedProcess> = {}): DemoFrostObservedProcess {
	return {
		participantId,
		processIdentity: `frost-participant-${participantId}`,
		processInstanceId: `boot-instance-${participantId}`,
		restartCounter: 3,
		stateDirectory: `/var/lib/coco-demo/frost-${participantId}`,
		verifyingShare: point(participantId),
		...overrides,
	}
}

function responseOne(request: DemoFrostProcessRoundOneRequest): DemoFrostProcessRoundOneResponse {
	return {
		schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_RESPONSE_V1',
		binding: { ...request.binding },
		policyEvidence: policyEvidence(request.policy),
		commitment: {
			hiding: point(request.binding.participantId, 10),
			binding: point(request.binding.participantId, 20),
		},
	}
}

function responseTwo(request: DemoFrostProcessRoundTwoRequest): DemoFrostProcessRoundTwoResponse {
	return {
		schema: 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_RESPONSE_V1',
		binding: { ...request.binding },
		transcriptHash: request.transcriptHash,
		signatureShare: request.binding.participantId.toString(16).padStart(64, '0'),
	}
}

function scriptedParticipants(options: {
	mutateRoundOne?: (participantId: DemoParticipantId, response: DemoFrostProcessRoundOneResponse) => void
	mutateRoundTwoPeer?: (participantId: DemoParticipantId, value: DemoFrostObservedProcess) => DemoFrostObservedProcess
	withholdRoundOne?: DemoParticipantId
	failRoundTwo?: DemoParticipantId
	capturedRoundOne?: DemoFrostProcessRoundOneRequest[]
	capturedRoundTwo?: DemoFrostProcessRoundTwoRequest[]
} = {}): [DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant] {
	return [1, 2, 3, 4].map((numericId): DemoFrostProcessParticipant => {
		const participantId = numericId as DemoParticipantId
		const transport: DemoFrostProcessTransport = {
			async roundOne(request) {
				options.capturedRoundOne?.push(request)
				if (options.withholdRoundOne === participantId) return new Promise(() => {})
				const message = responseOne(request)
				options.mutateRoundOne?.(participantId, message)
				return { peer: peer(participantId), message }
			},
			async roundTwo(request) {
				options.capturedRoundTwo?.push(request)
				if (options.failRoundTwo === participantId) throw new Error('round two failed')
				const observed = options.mutateRoundTwoPeer?.(participantId, peer(participantId)) ?? peer(participantId)
				return { peer: observed, message: responseTwo(request) }
			},
		}
		return {
			enrollment: {
				participantId,
				processIdentity: `frost-participant-${participantId}`,
				stateDirectory: `/var/lib/coco-demo/frost-${participantId}`,
				verifyingShare: point(participantId),
			},
			transport,
		}
	}) as [DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant]
}

function ports(participants = scriptedParticipants(), timeout = 100, policy = policyFixture()) {
	return createFourSeparatedFrostProcessPorts({
		committeeKeysetId: roundOneRequest.committeeKeysetId,
		committeeKeysetVersion: roundOneRequest.committeeKeysetVersion,
		requestTimeoutMs: timeout,
		policy,
		participants,
	})
}

async function openAll(value = ports()): Promise<DemoRoundOneCommitment[]> {
	return Promise.all(value.map((participant) => participant.roundOne(roundOneRequest)))
}

function roundTwo(commitments: DemoRoundOneCommitment[]): DemoRoundTwoRequest {
	return {
		...roundOneRequest,
		commitments,
		transcriptHash: demoFrostTranscriptHash(roundOneRequest, commitments),
	}
}

describe('four-process FROST boundary (protocol shape and isolation only; not DKG/signature correctness)', () => {
	test('binds both rounds to four distinct processes, directories, public shares, roster, keyset, session, and digest', async () => {
		const capturedRoundOne: DemoFrostProcessRoundOneRequest[] = []
		const capturedRoundTwo: DemoFrostProcessRoundTwoRequest[] = []
		const participants = scriptedParticipants({ capturedRoundOne, capturedRoundTwo })
		const policy = policyFixture()
		const processPorts = ports(participants, 100, policy)
		const commitments = await openAll(processPorts)
		const shares = await Promise.all(processPorts.map((participant) => participant.roundTwo(roundTwo(commitments))))

		expect(commitments.map((commitment) => commitment.participantId)).toEqual([1, 2, 3, 4])
		expect(shares.map((share) => share.participantId)).toEqual([1, 2, 3, 4])
		expect(new Set(capturedRoundOne.map((request) => request.binding.processIdentity)).size).toBe(4)
		expect(capturedRoundOne).toHaveLength(4)
		expect(capturedRoundOne.every((request) => JSON.stringify(request.policy.committeeLockedProofs)
			=== JSON.stringify(policy.committeeLockedProofs))).toBe(true)
		expect(new Set(participants.map((participant) => participant.enrollment.stateDirectory)).size).toBe(4)
		expect(new Set(participants.map((participant) => participant.enrollment.verifyingShare)).size).toBe(4)
		const expectedRoster = demoFrostProcessRosterDigest(participants.map((participant) => participant.enrollment))
		for (const request of [...capturedRoundOne, ...capturedRoundTwo]) {
			expect(request.binding.rosterDigest).toBe(expectedRoster)
			expect(request.binding.policyPackageDigest).toBe(demoFrostParticipantPolicyDigest(policy))
			expect(request.binding.committeeKeysetId).toBe(roundOneRequest.committeeKeysetId)
			expect(request.binding.committeeKeysetVersion).toBe(roundOneRequest.committeeKeysetVersion)
			expect(request.binding.sessionId).toBe(roundOneRequest.sessionId)
			expect(request.binding.packageDigest).toBe(roundOneRequest.packageDigest)
			expect(request.binding.digest).toBe(roundOneRequest.digest)
			const serialized = JSON.stringify(request)
			expect(serialized).not.toContain('secretShare')
			expect(serialized).not.toContain('aggregateSecret')
			expect(serialized).not.toContain('privateKey')
			expect(serialized).not.toContain('witness')
			expect(serialized).not.toContain('recipientOpening')
		}
		expect(capturedRoundOne.every((request) => !('inputs' in request.policy))).toBe(true)
		expect(capturedRoundOne.every((request) => Object.isFrozen(request.policy)
			&& Object.isFrozen(request.policy.outputs)
			&& Object.isFrozen(request.policy.certifiedClosure.evidence))).toBe(true)
	})

	test('refuses duplicate process identities, state directories, and public verifying shares', () => {
		for (const field of ['processIdentity', 'stateDirectory', 'verifyingShare'] as const) {
			const participants = scriptedParticipants()
			participants[1].enrollment[field] = participants[0].enrollment[field]
			expect(() => ports(participants)).toThrow()
		}
		const oppositeParityShares = scriptedParticipants()
		oppositeParityShares[1].enrollment.verifyingShare = oppositeParity(oppositeParityShares[0].enrollment.verifyingShare)
		expect(() => ports(oppositeParityShares)).toThrow(/DEMO_FROST_PROCESS_ROSTER/)
	})

	test('refuses nested participant state directories', () => {
		const participants = scriptedParticipants()
		participants[1].enrollment.stateDirectory = `${participants[0].enrollment.stateDirectory}/nested`
		expect(() => ports(participants)).toThrow(/DEMO_FROST_PROCESS_ISOLATION/)
	})

	test('refuses every mismatched response binding field before accepting a commitment', async () => {
		const mutations: Array<(binding: DemoFrostProcessBinding) => void> = [
			(binding) => { binding.committeeKeysetId = 'other-keyset' },
			(binding) => { binding.committeeKeysetVersion = '8' },
			(binding) => { binding.rosterDigest = '99'.repeat(32) },
			(binding) => { binding.policyPackageDigest = '99'.repeat(32) },
			(binding) => { binding.sessionId = '99'.repeat(32) },
			(binding) => { binding.packageDigest = '99'.repeat(32) },
			(binding) => { binding.digest = '99'.repeat(32) },
		]
		for (const mutate of mutations) {
			const participants = scriptedParticipants({
				mutateRoundOne(participantId, response) {
					if (participantId === 1) mutate(response.binding)
				},
			})
			await expect(ports(participants)[0].roundOne(roundOneRequest)).rejects.toMatchObject({
				code: 'DEMO_FROST_PROCESS_BINDING',
			})
		}
	})

	test('refuses a malicious coordinator digest before contacting any participant process', async () => {
		let transportCalled = false
		const participants = scriptedParticipants()
		const original = participants[0].transport.roundOne.bind(participants[0].transport)
		participants[0].transport.roundOne = async (request, options) => {
			transportCalled = true
			return original(request, options)
		}
		await expect(ports(participants)[0].roundOne({
			...roundOneRequest,
			digest: 'ab'.repeat(32),
		})).rejects.toMatchObject({ code: 'DEMO_FROST_PROCESS_POLICY' })
		expect(transportCalled).toBe(false)
	})

	test('refuses secret key-share material smuggled as an unexpected process response field', async () => {
		const participants = scriptedParticipants({
			mutateRoundOne(participantId, response) {
				if (participantId === 1) {
					;(response as DemoFrostProcessRoundOneResponse & { secretShare: string }).secretShare = 'do-not-export'
				}
			},
		})
		await expect(ports(participants)[0].roundOne(roundOneRequest)).rejects.toMatchObject({
			code: 'DEMO_FROST_PROCESS_SECRET_MATERIAL',
		})
	})

	test('refuses forged participant policy evidence before accepting a commitment', async () => {
		const participants = scriptedParticipants({
			mutateRoundOne(participantId, response) {
				if (participantId === 1) response.policyEvidence.policyPackageDigest = '00'.repeat(32)
			},
		})
		await expect(ports(participants)[0].roundOne(roundOneRequest)).rejects.toMatchObject({
			code: 'DEMO_FROST_PROCESS_POLICY',
		})
	})

	test('participant-side validation refuses a changed recipient capability before commitment creation', async () => {
		const policy = policyFixture()
		policy.recipientCapability.recipientPublicKey = policy.bidderPublicKey
		let commitmentCreated = false
		const participants = scriptedParticipants()
		participants[0].transport.roundOne = async (request) => {
			const unavailable = async (): Promise<never> => { throw new Error('verifier should not be reached') }
			const evidence = await validateDemoFrostParticipantPolicy({
				policy: request.policy,
				expectedPackageDigest: request.binding.packageDigest,
				expectedCashuSigAllDigest: request.binding.digest,
				ports: {
					closureVerifier: { verifyAndDerive: unavailable },
					signedBidVerifier: { verifyAndDerive: unavailable },
					proofUse: { assertExclusive: unavailable },
				},
			})
			commitmentCreated = true
			return { peer: peer(1), message: { ...responseOne(request), policyEvidence: evidence } }
		}
		await expect(ports(participants, 100, policy)[0].roundOne(roundOneRequest)).rejects.toMatchObject({
			code: 'DEMO_FROST_PROCESS_UNAVAILABLE',
		})
		expect(commitmentCreated).toBe(false)
	})

	test('refuses a restart or process-instance change between rounds', async () => {
		const processPorts = ports(scriptedParticipants({
			mutateRoundTwoPeer(participantId, observed) {
				return participantId === 1
					? { ...observed, processInstanceId: 'replacement-boot', restartCounter: observed.restartCounter + 1 }
					: observed
			},
		}))
		const commitments = await openAll(processPorts)
		await expect(processPorts[0].roundTwo(roundTwo(commitments))).rejects.toMatchObject({
			code: 'DEMO_FROST_PROCESS_RESTARTED',
		})
	})

	test('refuses duplicate public nonce commitments before any participant signs round two', async () => {
		const processPorts = ports()
		const commitments = await openAll(processPorts)
		commitments[1] = { ...commitments[1], hiding: oppositeParity(commitments[0]!.hiding) }
		await expect(processPorts[0].roundTwo(roundTwo(commitments))).rejects.toMatchObject({
			code: 'DEMO_FROST_PROCESS_TRANSCRIPT',
		})
	})

	test('burns a round after a failed round-two transport and refuses nonce reuse', async () => {
		const processPorts = ports(scriptedParticipants({ failRoundTwo: 1 }))
		const commitments = await openAll(processPorts)
		const request = roundTwo(commitments)
		await expect(processPorts[0].roundTwo(request)).rejects.toMatchObject({
			code: 'DEMO_FROST_PROCESS_UNAVAILABLE',
		})
		await expect(processPorts[0].roundTwo(request)).rejects.toMatchObject({
			code: 'DEMO_FROST_PROCESS_ROUND_ORDER',
		})
	})

	test('refuses a participant that withholds round-one evidence within the configured bound', async () => {
		const processPorts = ports(scriptedParticipants({ withholdRoundOne: 4 }), 10)
		const results = await Promise.allSettled(processPorts.map((participant) => participant.roundOne(roundOneRequest)))
		expect(results.slice(0, 3).every((result) => result.status === 'fulfilled')).toBe(true)
		expect(results[3]).toMatchObject({
			status: 'rejected',
			reason: { code: 'DEMO_FROST_PROCESS_WITHHELD' },
		})
	})

	test('refuses changed transport-attested process identity', async () => {
		const participants = scriptedParticipants()
		const original = participants[2].transport.roundOne.bind(participants[2].transport)
		participants[2].transport.roundOne = async (request, options) => {
			const exchange = await original(request, options)
			return { ...exchange, peer: { ...exchange.peer, processIdentity: 'unexpected-process' } }
		}
		await expect(ports(participants)[2].roundOne(roundOneRequest)).rejects.toMatchObject({
			code: 'DEMO_FROST_PROCESS_IDENTITY',
		})
	})
})
