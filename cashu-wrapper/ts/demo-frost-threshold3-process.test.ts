import { describe, expect, test } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'

import {
	createDemoThreshold3SeparatedProcessPorts,
} from './demo-frost-threshold3-process-boundary'
import { createDemoFrostStdioProcessTransport } from './demo-frost-stdio-transport'
import {
	demoFrostCommitteeLockedProofsDigest,
	demoFrostParticipantPolicyDigest,
	type DemoFrostParticipantPolicyPackage,
} from './demo-frost-participant-policy'
import type {
	DemoFrostObservedProcess,
	DemoFrostProcessParticipant,
	DemoFrostProcessRoundOneRequest,
	DemoFrostProcessRoundTwoRequest,
} from './demo-frost-process-boundary'
import {
	createDemoFrostThreshold3RustAggregatePort,
	demoFrostThreshold3AuthorizationDigest,
	demoFrostThreshold3CommitmentsDigest,
} from './demo-frost-threshold3-rust-aggregate'
import {
	DEMO_FROST_THRESHOLD3_VERSION,
	demoFrostThreshold3AuthorizationForRequest,
} from './demo-frost-threshold3-rust-participant-worker'
import { createDemoMaintainerThreshold3ProcessComposition } from './demo-maintainer-threshold3-process'
import type {
	DemoIntegratedAuthorityClaim,
	DemoIntegratedAuthorityStore,
	DemoIntegratedExecutionRootBindingV1,
	DemoIntegratedLifecycleRecord,
} from './demo-integrated-authority'
import {
	buildDemoSigAllSecret,
	demoCashuSigAllDigest,
	demoFrostTranscriptHash,
	demoOutputsDigest,
	type DemoParticipantId,
	type DemoRoundOneRequest,
} from './demo-sigall-settlement'

const point = (value: number): string => `${value % 2 === 0 ? '02' : '03'}${value.toString(16).padStart(64, '0')}`
const packageDigest = '11'.repeat(32)
const bidderPublicKey = point(700)
const committeePublicKey = point(701)
const refundPublicKey = point(702)
const recipientPublicKey = point(703)
const lockedProof = {
	amount: 1,
	id: 'keyset-1',
	secret: buildDemoSigAllSecret({ nonce: '01'.repeat(32), bidderPublicKey, committeePublicKey, refundPublicKey, locktime: 2_000_000_000 }),
	C: point(704),
}
const outputs = [{ amount: 1, id: 'keyset-1', B_: point(705) }]
const cashuDigest = demoCashuSigAllDigest([lockedProof], outputs)
const policy = {
	schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_V1',
	network: 'aa'.repeat(32),
	chainId: 'demo-chain',
	auctionId: 'auction-1',
	operationId: 'auction-1:bid-1',
	bidId: 'bid-1',
	bidEventId: 'bb'.repeat(32),
	bidderActorId: 'cc'.repeat(32),
	role: 'winner_settlement',
	outcomeHeight: 42,
	appStateHash: 'dd'.repeat(32),
	amount: 1,
	inputFee: 0,
	inputFeePpk: 0,
	mintUrl: 'https://mint.example',
	unit: 'sat',
	activeKeysetId: 'keyset-1',
	locktime: 2_000_000_000,
	bidderPublicKey,
	committeePublicKey,
	sellerRecipientPublicKey: recipientPublicKey,
	recipientPublicKey,
	deposits: [{ proofStateRef: point(706), amount: 1, keysetId: 'keyset-1' }],
	committeeLockedProofs: [lockedProof],
	outputs,
	packageDigest,
	cashuSigAllDigest: cashuDigest,
	actorPackageAuthorization: { actorId: 'cc'.repeat(32), packageDigest, signature: '11'.repeat(64) },
	recipientCapability: {
		schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1', network: 'aa'.repeat(32), chainId: 'demo-chain', auctionId: 'auction-1',
		operationId: 'auction-1:bid-1', role: 'winner_settlement', mintUrl: 'https://mint.example', unit: 'sat',
		recipientPublicKey, outputsDigest: demoOutputsDigest(outputs), signature: '22'.repeat(64),
	},
	certifiedClosure: { evidenceDigest: '33'.repeat(32), evidence: { schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V1', source: 'participant-local' } },
	signedBid: { evidenceDigest: '44'.repeat(32), evidence: { schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_SIGNED_BID_EVIDENCE_V1', source: 'participant-local' } },
} as unknown as DemoFrostParticipantPolicyPackage

const policyEvidence = {
	schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_EVIDENCE_V1' as const,
	policyPackageDigest: demoFrostParticipantPolicyDigest(policy),
	closureEvidenceDigest: policy.certifiedClosure.evidenceDigest,
	signedBidEvidenceDigest: policy.signedBid.evidenceDigest,
	committeeLockedProofsDigest: demoFrostCommitteeLockedProofsDigest(policy.committeeLockedProofs),
	authenticatedPackageDigest: packageDigest,
	derivedCashuSigAllDigest: cashuDigest,
}

function peer(id: DemoParticipantId): DemoFrostObservedProcess {
	return {
		participantId: id,
		processIdentity: `participant-${id}`,
		processInstanceId: `participant-${id}:pid:${100 + id}`,
		restartCounter: 0,
		stateDirectory: `/var/lib/coco-demo/t3-${id}`,
		verifyingShare: point(id + 100),
	}
}

function participants(counters: { roundTwo: number }): [DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant] {
	return [1, 2, 3, 4].map((numericId): DemoFrostProcessParticipant => {
		const id = numericId as DemoParticipantId
		return {
			enrollment: {
				participantId: id,
				processIdentity: `participant-${id}`,
				stateDirectory: `/var/lib/coco-demo/t3-${id}`,
				verifyingShare: point(id + 100),
			},
			transport: {
				async roundOne(request: DemoFrostProcessRoundOneRequest) {
					return {
						peer: peer(id),
						message: {
							schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_RESPONSE_V1' as const,
							binding: { ...request.binding },
							policyEvidence,
							commitment: { hiding: point(id + 200), binding: point(id + 300) },
						},
					}
				},
				async roundTwo(request: DemoFrostProcessRoundTwoRequest) {
					counters.roundTwo += 1
					return {
						peer: peer(id),
						message: {
							schema: 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_RESPONSE_V1' as const,
							binding: { ...request.binding },
							transcriptHash: request.transcriptHash,
							signatureShare: id.toString(16).padStart(64, '0'),
						},
					}
				},
			},
		}
	}) as [DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant]
}

function request(sessionByte: number): DemoRoundOneRequest {
	return {
		sessionId: sessionByte.toString(16).padStart(2, '0').repeat(32),
		digest: cashuDigest,
		packageDigest,
		committeeKeysetId: 'threshold-three-keyset',
		committeeKeysetVersion: '1',
	}
}

describe('concrete threshold-three process adapters', () => {
	test('uses signed directory identities to isolate equal host-local absolute paths', () => {
		const configured = participants({ roundTwo: 0 })
		for (const [index, participant] of configured.entries()) {
			const stateDirectoryIdentity = String(index + 1).padStart(64, '0')
			participant.enrollment = { ...participant.enrollment,
				stateDirectory: '/var/lib/plebeian-auctions-friday/frost-v3/keyset-v3/state', stateDirectoryIdentity }
			const roundOne = participant.transport.roundOne.bind(participant.transport)
			const roundTwo = participant.transport.roundTwo.bind(participant.transport)
			participant.transport.roundOne = async (value, options) => {
				const exchange = await roundOne(value, options)
				return { ...exchange, peer: { ...exchange.peer,
					stateDirectory: participant.enrollment.stateDirectory, stateDirectoryIdentity } }
			}
			participant.transport.roundTwo = async (value, options) => {
				const exchange = await roundTwo(value, options)
				return { ...exchange, peer: { ...exchange.peer,
					stateDirectory: participant.enrollment.stateDirectory, stateDirectoryIdentity } }
			}
		}
		expect(() => createDemoThreshold3SeparatedProcessPorts({
			committeeKeysetId: 'threshold-three-keyset', committeeKeysetVersion: '1', requestTimeoutMs: 100,
			policy, participants: configured,
		})).not.toThrow()
		configured[1].enrollment.stateDirectoryIdentity = configured[0].enrollment.stateDirectoryIdentity
		expect(() => createDemoThreshold3SeparatedProcessPorts({
			committeeKeysetId: 'threshold-three-keyset', committeeKeysetVersion: '1', requestTimeoutMs: 100,
			policy, participants: configured,
		})).toThrow(/four distinct process identities, directories, and verifying shares/)
	})

	test('durably maps authority recovery root to the concrete Rust authorization root before exposing federation', async () => {
		const configuredParticipants = participants({ roundTwo: 0 })
		const outbidPolicy = {
			...structuredClone(policy), role: 'refund' as const, recipientPublicKey: refundPublicKey,
			recipientCapability: {
				...structuredClone(policy.recipientCapability), role: 'refund' as const,
				recipientPublicKey: refundPublicKey,
			},
		} satisfies DemoFrostParticipantPolicyPackage
		const federationRequest = {
			schema: 'COCO_DEMO_FROST_REQUEST_V1' as const, threshold: 3 as const,
			sessionId: request(40).sessionId, packageDigest, cashuSigAllDigest: cashuDigest,
			committeeKeysetId: 'threshold-three-keyset', committeeKeysetVersion: '1',
			committeePublicKey, participants: configuredParticipants.map((value, index) => ({
				identifier: (index + 1) as DemoParticipantId, verifyingShare: value.enrollment.verifyingShare,
			})),
			policyPackageDigest: demoFrostParticipantPolicyDigest(outbidPolicy),
			closureEvidenceDigest: outbidPolicy.certifiedClosure.evidenceDigest,
			signedBidEvidenceDigest: outbidPolicy.signedBid.evidenceDigest,
			committeeLockedProofsDigest: demoFrostCommitteeLockedProofsDigest(outbidPolicy.committeeLockedProofs),
		}
		const signerRosterDigest = '77'.repeat(32)
		const authorityClaim: DemoIntegratedAuthorityClaim = {
			schema: 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1', operationId: policy.operationId,
			operationRoot: packageDigest, network: policy.network, chainId: policy.chainId, auctionId: policy.auctionId,
			displacedBidId: policy.bidId, replacementBidId: 'replacement-bid', displacementHeight: 40,
			templateDigest: packageDigest, cashuSigAllDigest: cashuDigest, outputsDigest: demoOutputsDigest(outputs),
			proofStateRefs: policy.deposits.map((value) => value.proofStateRef), poolAmount: policy.amount,
			admissionOperationId: policy.operationId, admissionReceiptDigest: '88'.repeat(32),
			committeeKeysetId: federationRequest.committeeKeysetId,
			committeeKeysetVersion: federationRequest.committeeKeysetVersion,
			dkgRunId: 'dkg-approved-later', publicKeyPackageSha256: '66'.repeat(32), signerRosterDigest,
			status: 'outbid_return_pending',
		}
		let durableBinding: DemoIntegratedExecutionRootBindingV1 | null = null
		const authorityStore: DemoIntegratedAuthorityStore = {
			async claimOutbidReturn() { throw new Error('not used') },
			async bindExecutionRoot(binding) {
				if (durableBinding !== null) return { binding: structuredClone(durableBinding), created: false }
				durableBinding = structuredClone(binding)
				return { binding: structuredClone(binding), created: true }
			},
			async readExecutionRoot() { return structuredClone(durableBinding) },
			async readLifecycle() { return null },
			async transitionLifecycle(): Promise<DemoIntegratedLifecycleRecord> { throw new Error('not used') },
		}
		const composition = await createDemoMaintainerThreshold3ProcessComposition({
			request: federationRequest, policy: outbidPolicy, authorityClaim, authorityStore,
			participants: configuredParticipants,
			dkgRunId: authorityClaim.dkgRunId, publicKeyPackageSha256: authorityClaim.publicKeyPackageSha256,
			signerRosterDigest, binaryPath: '/tmp/frost-participant', publicKeyPackagePath: '/tmp/public-package',
			scratchParent: '/tmp', processTimeoutMs: 1_000,
			async aggregateRunCommand() { throw new Error('not invoked while constructing') },
		})
		expect(composition.executionBinding).toMatchObject({
			operationId: authorityClaim.operationId, authorityOperationRoot: packageDigest,
			templateDigest: packageDigest, cashuSigAllDigest: cashuDigest,
			dkgRunId: authorityClaim.dkgRunId, publicKeyPackageSha256: authorityClaim.publicKeyPackageSha256,
			signerRosterDigest,
		})
		expect(composition.executionBinding.frostOperationRoot).toMatch(/^[0-9a-f]{64}$/)
		expect(composition.executionBinding.frostOperationRoot).not.toBe(composition.executionBinding.authorityOperationRoot)
		expect(composition.executionBinding.bindingDigest).toMatch(/^[0-9a-f]{64}$/)
		expect(await authorityStore.readExecutionRoot(authorityClaim.operationId)).toEqual(composition.executionBinding)
		expect(composition.federation).toBeDefined()
	})

	test('all four three-member process subsets cross round two; two members block before transport', async () => {
		const subsets: DemoParticipantId[][] = [[1, 2, 3], [1, 2, 4], [1, 3, 4], [2, 3, 4]]
		for (const [index, subset] of subsets.entries()) {
			const counters = { roundTwo: 0 }
			const ports = createDemoThreshold3SeparatedProcessPorts({
				committeeKeysetId: 'threshold-three-keyset', committeeKeysetVersion: '1', requestTimeoutMs: 100,
				policy, participants: participants(counters),
			})
			const roundOne = request(index + 1)
			const all = await Promise.all(ports.map((port) => port.roundOne(roundOne)))
			const commitments = all.filter((value) => subset.includes(value.participantId))
			const roundTwo = { ...roundOne, commitments, transcriptHash: demoFrostTranscriptHash(roundOne, commitments) }
			const shares = await Promise.all(subset.map((id) => ports[id - 1]!.roundTwo(roundTwo)))
			expect(shares.map((value) => value.participantId)).toEqual(subset)
			expect(counters.roundTwo).toBe(3)
		}
		const counters = { roundTwo: 0 }
		const ports = createDemoThreshold3SeparatedProcessPorts({
			committeeKeysetId: 'threshold-three-keyset', committeeKeysetVersion: '1', requestTimeoutMs: 100,
			policy, participants: participants(counters),
		})
		const roundOne = request(9)
		const commitments = (await Promise.all(ports.map((port) => port.roundOne(roundOne)))).slice(0, 2)
		await expect(ports[0].roundTwo({ ...roundOne, commitments, transcriptHash: demoFrostTranscriptHash(roundOne, commitments) })).rejects.toMatchObject({
			code: 'PAYMENT_BLOCKED_MISSING_PARTICIPANT',
		})
		expect(counters.roundTwo).toBe(0)
	})

	test('rejects unexpected process response fields instead of accepting an open message shape', async () => {
		const configured = participants({ roundTwo: 0 })
		const honestRoundOne = configured[0].transport.roundOne.bind(configured[0].transport)
		configured[0].transport.roundOne = async (roundOneRequest, options) => {
			const exchange = await honestRoundOne(roundOneRequest, options)
			return { ...exchange, message: { ...exchange.message, unexpected: 'smuggled' } } as typeof exchange
		}
		const ports = createDemoThreshold3SeparatedProcessPorts({
			committeeKeysetId: 'threshold-three-keyset', committeeKeysetVersion: '1', requestTimeoutMs: 100,
			policy, participants: configured,
		})
		await expect(ports[0].roundOne(request(10))).rejects.toMatchObject({
			code: 'DEMO_FROST_T3_PROCESS_RESPONSE',
		})
	})

	test('routes an exact three-member subset across four distinct OS child processes', async () => {
		const transports = ([1, 2, 3, 4] as DemoParticipantId[]).map((id) => createDemoFrostStdioProcessTransport({
			command: [process.execPath, `${import.meta.dir}/demo-frost-threshold3-stdio.fixture.ts`, String(id)],
			enrollment: {
				participantId: id, processIdentity: `participant-${id}`,
				stateDirectory: `/var/lib/coco-demo/t3-${id}`, verifyingShare: point(id + 100),
			},
			restartCounter: 0,
		}))
		try {
			const configured = transports.map((transport, index) => ({
				enrollment: {
					participantId: (index + 1) as DemoParticipantId,
					processIdentity: `participant-${index + 1}`,
					stateDirectory: `/var/lib/coco-demo/t3-${index + 1}`,
					verifyingShare: point(index + 101),
				},
				transport,
			})) as unknown as [DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant]
			const ports = createDemoThreshold3SeparatedProcessPorts({
				committeeKeysetId: 'threshold-three-keyset', committeeKeysetVersion: '1', requestTimeoutMs: 2_000,
				policy, participants: configured,
			})
			const roundOne = request(11)
			const all = await Promise.all(ports.map((port) => port.roundOne(roundOne)))
			const commitments = all.filter((value) => [1, 3, 4].includes(value.participantId))
			const roundTwo = { ...roundOne, commitments, transcriptHash: demoFrostTranscriptHash(roundOne, commitments) }
			await expect(Promise.all([ports[0].roundTwo(roundTwo), ports[2].roundTwo(roundTwo), ports[3].roundTwo(roundTwo)]))
				.resolves.toEqual(expect.arrayContaining([
					expect.objectContaining({ participantId: 1 }),
					expect.objectContaining({ participantId: 3 }),
					expect.objectContaining({ participantId: 4 }),
				]))
		} finally {
			for (const transport of transports) transport.close()
		}
	})

	test('stable operation root survives a fresh session while the Rust authorization digest changes', () => {
		const processRequest = (sessionByte: number): DemoFrostProcessRoundOneRequest => ({
			schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_REQUEST_V1',
			binding: {
				schema: 'COCO_DEMO_FROST_PROCESS_BINDING_V1', participantId: 1, processIdentity: 'participant-1',
				committeeKeysetId: 'threshold-three-keyset', committeeKeysetVersion: '1', rosterDigest: '55'.repeat(32),
				policyPackageDigest: demoFrostParticipantPolicyDigest(policy), sessionId: request(sessionByte).sessionId,
				packageDigest, digest: cashuDigest,
			},
			policy,
		})
		const first = demoFrostThreshold3AuthorizationForRequest({ dkgRunId: 'dkg-approved-later', publicKeyPackageSha256: '66'.repeat(32) }, processRequest(1))
		const second = demoFrostThreshold3AuthorizationForRequest({ dkgRunId: 'dkg-approved-later', publicKeyPackageSha256: '66'.repeat(32) }, processRequest(2))
		expect(first.operation_id).toBe(second.operation_id)
		expect(first.operation_root).toBe(second.operation_root)
		expect(first.session_id).not.toBe(second.session_id)
		expect(demoFrostThreshold3AuthorizationDigest(first)).not.toBe(demoFrostThreshold3AuthorizationDigest(second))
	})

	test('Rust aggregate adapter accepts every ordered subset and rejects mismatched share membership', async () => {
		for (const [index, ids] of ([[1, 2, 3], [1, 2, 4], [1, 3, 4], [2, 3, 4]] as DemoParticipantId[][]).entries()) {
			const processRequest: DemoFrostProcessRoundOneRequest = {
				schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_REQUEST_V1',
				binding: {
					schema: 'COCO_DEMO_FROST_PROCESS_BINDING_V1', participantId: 1, processIdentity: 'participant-1',
					committeeKeysetId: 'threshold-three-keyset', committeeKeysetVersion: '1', rosterDigest: '55'.repeat(32),
					policyPackageDigest: demoFrostParticipantPolicyDigest(policy), sessionId: request(index + 20).sessionId,
					packageDigest, digest: cashuDigest,
				}, policy,
			}
			const authorization = demoFrostThreshold3AuthorizationForRequest({ dkgRunId: 'dkg-approved-later', publicKeyPackageSha256: '66'.repeat(32) }, processRequest)
			const commitments = ids.map((id) => ({ participantId: id, sessionId: authorization.session_id, digest: cashuDigest, hiding: point(id + 400), binding: point(id + 500) }))
			const transcriptHash = demoFrostTranscriptHash(request(index + 20), commitments)
			const shares = ids.map((id) => ({ participantId: id, sessionId: authorization.session_id, digest: cashuDigest, transcriptHash, share: id.toString(16).padStart(64, '0') }))
			const aggregate = createDemoFrostThreshold3RustAggregatePort({
				binaryPath: '/tmp/coco-demo-frost-participant-3of4', publicKeyPackagePath: '/tmp/public-key-package.json', scratchParent: '/tmp', authorization,
				async runCommand(command) {
					const requestPath = command[4]!
					const outputPath = command[5]!
					const wire = JSON.parse(await readFile(requestPath, 'utf8')) as { commitments: unknown[]; shares: unknown[] }
					expect(wire.commitments).toHaveLength(3)
					expect(wire.shares).toHaveLength(3)
					await writeFile(outputPath, `${JSON.stringify({
						version: DEMO_FROST_THRESHOLD3_VERSION, operation_id: authorization.operation_id, session_id: authorization.session_id,
						authorization_digest: demoFrostThreshold3AuthorizationDigest(authorization), cashu_sigall_digest: cashuDigest,
						commitments_digest: demoFrostThreshold3CommitmentsDigest(authorization, commitments), signature_hex: 'aa'.repeat(64),
					})}\n`)
				},
			})
			await expect(aggregate.aggregate({ sessionId: authorization.session_id, digest: cashuDigest, packageDigest, transcriptHash, commitments, shares, committeePublicKey: point(900) })).resolves.toMatchObject({ transcriptHash })
			await expect(aggregate.aggregate({ sessionId: authorization.session_id, digest: cashuDigest, packageDigest, transcriptHash, commitments, shares: shares.map((share, shareIndex) => shareIndex === 2 ? { ...share, participantId: ids[0]! } : share), committeePublicKey: point(900) })).rejects.toThrow(/shares must match/)
		}
	})
})
