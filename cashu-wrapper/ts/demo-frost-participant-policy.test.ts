import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	demoFrostCommitteeLockedProofsDigest,
	demoFrostParticipantPolicyDigest,
	validateDemoFrostParticipantPolicy,
	type DemoFrostParticipantPolicyPackage,
	type DemoFrostParticipantPolicyPorts,
	type DemoFrostParticipantProofUsePort,
} from './demo-frost-participant-policy'
import {
	buildDemoSigAllSecret,
	demoCashuSigAllDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
} from './demo-sigall-settlement'
import { demoFrostTranscriptHash } from './demo-sigall-settlement'
import {
	createDemoFrostRustParticipantWorker,
	demoFrostRustAuthorizationForRequest,
} from './demo-frost-rust-participant-worker'
import {
	createDemoFrostRustAggregatePort,
	demoFrostRustAuthorizationDigest,
	demoFrostRustCommitmentsDigest,
	type DemoFrostRustAggregateOptions,
} from './demo-frost-rust-aggregate'
import type { DemoFrostProcessRoundOneRequest, DemoFrostProcessRoundTwoRequest } from './demo-frost-process-boundary'
import { proofPoint } from './nut-client'

const point = (number: number, odd = false): string => `${odd ? '03' : '02'}${number.toString(16).padStart(64, '0')}`
const actorPrivate = '19'.padStart(64, '0')
const actorId = bytesToHex(schnorr.getPublicKey(hexToBytes(actorPrivate)))
const bidderPrivate = '1b'.padStart(64, '0')
const bidderPublic = bytesToHex(secp256k1.getPublicKey(hexToBytes(bidderPrivate), true))
const recipientPrivate = '1a'.padStart(64, '0')
const recipientPublic = bytesToHex(secp256k1.getPublicKey(hexToBytes(recipientPrivate), true))

function fixture(): DemoFrostParticipantPolicyPackage {
	const packageDigest = '31'.repeat(32)
	const bidderPublicKey = bidderPublic
	const committeePublicKey = point(11)
	const refundPublicKey = point(12)
	const proofEntries = [4, 8].map((amount, index) => {
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
		C: point(20 + index, index === 1),
		}
		return { proof, proofStateRef: bytesToHex(proofPoint(proof).toBytes(true)) }
	}).sort((left, right) => left.proofStateRef.localeCompare(right.proofStateRef))
	const deposits = proofEntries.map(({ proof, proofStateRef }) => ({ proofStateRef, amount: proof.amount, keysetId: proof.id }))
	const committeeLockedProofs = proofEntries.map(({ proof }) => proof)
	const outputs = [
		{ amount: 4, id: 'keyset-1', B_: point(30) },
		{ amount: 8, id: 'keyset-1', B_: point(31, true) },
	]
	const capabilityBase = {
		schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1' as const,
		network: '41'.repeat(32),
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
		network: '41'.repeat(32),
		chainId: 'demo-chain',
		auctionId: 'auction-1',
		operationId: 'operation-1',
		bidId: 'bid-1',
		bidEventId: '51'.repeat(32),
		bidderActorId: actorId,
		role: 'winner_settlement',
		outcomeHeight: 48,
		appStateHash: '61'.repeat(32),
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
		deposits,
		committeeLockedProofs,
		outputs,
		recipientCapability,
		packageDigest,
		cashuSigAllDigest: demoCashuSigAllDigest(committeeLockedProofs, outputs),
		actorPackageAuthorization: {
			actorId,
			packageDigest,
			signature: bytesToHex(schnorr.sign(hexToBytes(packageDigest), hexToBytes(actorPrivate))),
		},
		certifiedClosure: {
			evidenceDigest: '81'.repeat(32),
			evidence: { schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V1', source: 'participant-local' },
		},
		signedBid: {
			evidenceDigest: '91'.repeat(32),
			evidence: { schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_SIGNED_BID_EVIDENCE_V1', source: 'participant-local' },
		},
	}
}

class MemoryProofUse implements DemoFrostParticipantProofUsePort {
	private readonly owners = new Map<string, string>()

	async assertExclusive(request: Parameters<DemoFrostParticipantProofUsePort['assertExclusive']>[0]): Promise<void> {
		const owner = JSON.stringify([request.network, request.chainId, request.auctionId, request.bidId, request.operationId])
		for (const proof of request.proofStateRefs) {
			const existing = this.owners.get(proof)
			if (existing !== undefined && existing !== owner) throw new Error('cross-bid proof reuse')
			this.owners.set(proof, owner)
		}
	}
}

function portsFor(expected: DemoFrostParticipantPolicyPackage, proofUse = new MemoryProofUse()): DemoFrostParticipantPolicyPorts {
	return {
		closureVerifier: {
			async verifyAndDerive() {
				return {
					evidenceDigest: expected.certifiedClosure.evidenceDigest,
					network: expected.network,
					chainId: expected.chainId,
					auctionId: expected.auctionId,
					operationId: expected.operationId,
					bidId: expected.bidId,
					bidEventId: expected.bidEventId,
					bidderActorId: expected.bidderActorId,
					role: expected.role,
					outcomeHeight: expected.outcomeHeight,
					appStateHash: expected.appStateHash,
					amount: expected.amount,
					locktime: expected.locktime,
					proofStateRefs: expected.deposits.map((deposit) => deposit.proofStateRef),
					recipientPublicKey: expected.recipientPublicKey,
				}
			},
		},
		signedBidVerifier: {
			async verifyAndDerive() {
				return {
					evidenceDigest: expected.signedBid.evidenceDigest,
					network: expected.network,
					chainId: expected.chainId,
					auctionId: expected.auctionId,
					operationId: expected.operationId,
					bidId: expected.bidId,
					bidEventId: expected.bidEventId,
					bidderActorId: expected.bidderActorId,
					amount: expected.amount,
					locktime: expected.locktime,
					bidderPublicKey: expected.bidderPublicKey,
					sellerRecipientPublicKey: expected.sellerRecipientPublicKey,
					deposits: expected.deposits.map((deposit) => ({ ...deposit })),
				}
			},
		},
		proofUse,
	}
}

async function validate(policy: DemoFrostParticipantPolicyPackage, ports = portsFor(policy)) {
	return validateDemoFrostParticipantPolicy({
		policy,
		expectedPackageDigest: policy.packageDigest,
		expectedCashuSigAllDigest: policy.cashuSigAllDigest,
		ports,
	})
}

describe('participant-local FROST policy (committee-only fake-Testnut proof disclosure)', () => {
	test('derives the exact SIG_ALL digest without bidder witness or recipient openings', async () => {
		const policy = fixture()
		const evidence = await validate(policy)
		expect(evidence.policyPackageDigest).toBe(demoFrostParticipantPolicyDigest(policy))
		expect(evidence.derivedCashuSigAllDigest).toBe(policy.cashuSigAllDigest)
		expect(evidence.authenticatedPackageDigest).toBe(policy.packageDigest)
		expect(evidence.committeeLockedProofsDigest).toBe(demoFrostCommitteeLockedProofsDigest(policy.committeeLockedProofs))
		const serialized = JSON.stringify(policy)
		expect(serialized).toContain('committeeLockedProofs')
		expect(serialized).not.toContain('witness')
		expect(serialized).not.toContain('recipientOpening')
		expect(serialized).not.toContain('privateKey')
	})

	test('accepts a V2 exact-package authorization from the browser-held payment key, not NIP-07', async () => {
		const policy = fixture()
		policy.actorPackageAuthorization = {
			schema: 'COCO_DEMO_PAYMENT_KEY_PACKAGE_AUTHORIZATION_V1',
			paymentPublicKey: policy.bidderPublicKey,
			packageDigest: policy.packageDigest,
			signature: bytesToHex(schnorr.sign(hexToBytes(policy.packageDigest), hexToBytes(bidderPrivate))),
		}
		await expect(validate(policy)).resolves.toMatchObject({ authenticatedPackageDigest: policy.packageDigest })
		const changed = structuredClone(policy)
		changed.actorPackageAuthorization.signature = '00'.repeat(64)
		await expect(validate(changed, portsFor(changed))).rejects.toMatchObject({ code: 'DEMO_FROST_POLICY_ACTOR' })
	})

	test('refuses a malicious coordinator-supplied Cashu digest instead of treating it as derivation evidence', async () => {
		const policy = fixture()
		await expect(validateDemoFrostParticipantPolicy({
			policy,
			expectedPackageDigest: policy.packageDigest,
			expectedCashuSigAllDigest: 'f1'.repeat(32),
			ports: portsFor(policy),
		})).rejects.toMatchObject({ code: 'DEMO_FROST_POLICY_CALLER_DIGEST' })
	})

	test('refuses any changed disclosed proof tuple before a signing commitment', async () => {
		const policy = fixture()
		policy.committeeLockedProofs[0].amount += 1
		await expect(validate(policy)).rejects.toMatchObject({ code: 'DEMO_FROST_POLICY_PROOF' })
	})

	test('refuses changed blinded outputs even when amounts balance and the recipient re-signs them', async () => {
		const expected = fixture()
		const malicious = structuredClone(expected)
		malicious.outputs[0].B_ = point(99)
		await expect(validate(malicious, portsFor(expected))).rejects.toMatchObject({ code: 'DEMO_FROST_POLICY_RECIPIENT_CAPABILITY' })
		malicious.recipientCapability.outputsDigest = demoOutputsDigest(malicious.outputs)
		malicious.recipientCapability.signature = bytesToHex(schnorr.sign(
			hexToBytes(demoRecipientCapabilityDigest(malicious.recipientCapability)),
			hexToBytes(recipientPrivate),
		))
		await expect(validate(malicious, portsFor(expected))).rejects.toMatchObject({ code: 'DEMO_FROST_POLICY_DERIVED_DIGEST' })
	})

	test('refuses changed fee and recipient policy before any round-one commitment can be created', async () => {
		const expected = fixture()
		let commitmentCreated = false
		const badFee = structuredClone(expected)
		badFee.inputFee = 1
		await expect((async () => {
			await validate(badFee, portsFor(expected))
			commitmentCreated = true
		})()).rejects.toMatchObject({ code: 'DEMO_FROST_POLICY_BALANCE' })
		expect(commitmentCreated).toBe(false)

		const badRecipient = structuredClone(expected)
		badRecipient.recipientPublicKey = expected.bidderPublicKey
		commitmentCreated = false
		await expect((async () => {
			await validate(badRecipient, portsFor(expected))
			commitmentCreated = true
		})()).rejects.toMatchObject({ code: 'DEMO_FROST_POLICY_RECIPIENT' })
		expect(commitmentCreated).toBe(false)
	})

	test('refuses changed signed deposit or actor authorization', async () => {
		const expected = fixture()
		const changedDeposit = structuredClone(expected)
		changedDeposit.committeeLockedProofs[0].secret = buildDemoSigAllSecret({
			nonce: '99'.repeat(32),
			bidderPublicKey: changedDeposit.bidderPublicKey,
			committeePublicKey: changedDeposit.committeePublicKey,
			locktime: changedDeposit.locktime,
			refundPublicKey: point(12),
		})
		changedDeposit.deposits[0].proofStateRef = bytesToHex(proofPoint(changedDeposit.committeeLockedProofs[0]).toBytes(true))
		const changedPairs = changedDeposit.deposits.map((deposit, index) => ({
			deposit,
			proof: changedDeposit.committeeLockedProofs[index],
		})).sort((left, right) => left.deposit.proofStateRef.localeCompare(right.deposit.proofStateRef))
		changedDeposit.deposits = changedPairs.map(({ deposit }) => deposit)
		changedDeposit.committeeLockedProofs = changedPairs.map(({ proof }) => proof)
		changedDeposit.cashuSigAllDigest = demoCashuSigAllDigest(changedDeposit.committeeLockedProofs, changedDeposit.outputs)
		await expect(validate(changedDeposit, portsFor(expected))).rejects.toMatchObject({
			code: 'DEMO_FROST_POLICY_CLOSURE',
		})

		const changedActor = structuredClone(expected)
		changedActor.actorPackageAuthorization.signature = '00'.repeat(64)
		await expect(validate(changedActor, portsFor(changedActor))).rejects.toMatchObject({ code: 'DEMO_FROST_POLICY_ACTOR' })
	})

	test('participant-local durable proof-use policy refuses cross-bid deposit reuse', async () => {
		const proofUse = new MemoryProofUse()
		const first = fixture()
		await validate(first, portsFor(first, proofUse))

		const second = structuredClone(first)
		second.bidId = 'bid-2'
		await expect(validate(second, portsFor(second, proofUse))).rejects.toMatchObject({
			code: 'DEMO_FROST_POLICY_PROOF_REUSE',
		})
	})

	test('refuses bidder witness or any extra field smuggled into a disclosed proof tuple', async () => {
		const policy = fixture()
		const smuggled = structuredClone(policy) as unknown as { committeeLockedProofs: Array<Record<string, unknown>> }
		smuggled.committeeLockedProofs[0].witness = { signatures: ['00'.repeat(64)] }
		await expect(validateDemoFrostParticipantPolicy({
			policy: smuggled as unknown as DemoFrostParticipantPolicyPackage,
			expectedPackageDigest: policy.packageDigest,
			expectedCashuSigAllDigest: policy.cashuSigAllDigest,
			ports: portsFor(policy),
		})).rejects.toThrow('DEMO_FROST_POLICY_SHAPE')
	})

	test('canonically binds an exact public DLEQ tuple and refuses malformed DLEQ', async () => {
		const policy = fixture()
		const withoutDleq = demoFrostParticipantPolicyDigest(policy)
		policy.committeeLockedProofs[0]!.dleq = {
			e: '71'.repeat(32), s: '72'.repeat(32), r: '73'.repeat(32),
		}
		expect(demoFrostParticipantPolicyDigest(policy)).not.toBe(withoutDleq)
		await expect(validate(policy, portsFor(policy))).resolves.toMatchObject({
			schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_EVIDENCE_V1',
		})

		const malformed = structuredClone(policy)
		malformed.committeeLockedProofs[0]!.dleq!.e = 'not-hex'
		await expect(validate(malformed, portsFor(malformed))).rejects.toMatchObject({
			code: 'DEMO_FROST_POLICY_DIGEST',
		})
	})

	test('refuses arbitrary closure and signed-bid payload bytes under neutral field names', async () => {
		for (const field of ['certifiedClosure', 'signedBid'] as const) {
			const policy = fixture()
			const smuggled = structuredClone(policy) as unknown as Record<typeof field, { evidence: Record<string, unknown> }>
			smuggled[field].evidence.payload = '00'.repeat(32)
			await expect(validateDemoFrostParticipantPolicy({
				policy: smuggled as unknown as DemoFrostParticipantPolicyPackage,
				expectedPackageDigest: policy.packageDigest,
				expectedCashuSigAllDigest: policy.cashuSigAllDigest,
				ports: portsFor(policy),
			})).rejects.toThrow('DEMO_FROST_POLICY_SHAPE')
		}
	})

	test('participant-local worker verifies policy before wiring both signing rounds to the Rust journal CLI', async () => {
		const policy = fixture()
		const root = await mkdtemp(join(tmpdir(), 'coco-frost-worker-test-'))
		const commands: string[][] = []
		try {
			const worker = createDemoFrostRustParticipantWorker({
				participantId: 1,
				dkgRunId: 'dkg-demo-1',
				publicKeyPackageSha256: 'b1'.repeat(32),
				configPath: join(root, 'config.json'),
				stateDirectory: join(root, 'participant-1'),
				binaryPath: join(root, 'coco-demo-frost-participant'),
				scratchParent: root,
				policyPorts: portsFor(policy),
				async runCommand(command) {
					commands.push(command)
					const output = command.at(-1)
					if (output === undefined) throw new Error('missing output')
					if (command[1] === 'sign-commit') {
						await writeFile(output, JSON.stringify({
							version: 'COCO_DEMO_FROST_PARTICIPANT_V1',
							operation_id: policy.operationId,
							authorization_digest: 'c1'.repeat(32),
							participant_id: 1,
							hiding_hex: point(101),
							binding_hex: point(102, true),
						}))
						return
					}
					const commitmentBundle = JSON.parse(await readFile(command[5], 'utf8')) as {
						entries: Array<{
							version: string
							operation_id: string
							authorization_digest: string
							participant_id: number
							hiding_hex: string
							binding_hex: string
						}>
					}
					expect(commitmentBundle.entries).toHaveLength(4)
					expect(commitmentBundle.entries[0]).toEqual({
						version: 'COCO_DEMO_FROST_PARTICIPANT_V1',
						operation_id: policy.operationId,
						authorization_digest: 'c1'.repeat(32),
						participant_id: 1,
						hiding_hex: point(101),
						binding_hex: point(102, true),
					})
					await writeFile(output, JSON.stringify({
						version: 'COCO_DEMO_FROST_PARTICIPANT_V1',
						operation_id: policy.operationId,
						authorization_digest: 'c1'.repeat(32),
						commitments_digest: 'd1'.repeat(32),
						participant_id: 1,
						share_hex: 'e1'.repeat(32),
					}))
				},
			})
			const binding = {
				schema: 'COCO_DEMO_FROST_PROCESS_BINDING_V1' as const,
				participantId: 1 as const,
				processIdentity: 'participant-1',
				committeeKeysetId: 'committee-demo',
				committeeKeysetVersion: '1',
				rosterDigest: 'f1'.repeat(32),
				policyPackageDigest: demoFrostParticipantPolicyDigest(policy),
				sessionId: 'f2'.repeat(32),
				packageDigest: policy.packageDigest,
				digest: policy.cashuSigAllDigest,
			}
			const roundOneRequest: DemoFrostProcessRoundOneRequest = {
				schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_REQUEST_V1',
				binding,
				policy: structuredClone(policy),
			}
			const signal = new AbortController().signal
			const mutableRoundOne = structuredClone(roundOneRequest)
			const firstPending = worker.roundOne(mutableRoundOne, signal)
			mutableRoundOne.binding.sessionId = '00'.repeat(32)
			mutableRoundOne.policy.operationId = 'mutated-after-dispatch'
			const first = await firstPending
			expect(first.binding.sessionId).toBe(binding.sessionId)
			const commitments = [
				{ participantId: 1 as const, sessionId: binding.sessionId, digest: binding.digest, hiding: first.commitment.hiding, binding: first.commitment.binding },
				{ participantId: 2 as const, sessionId: binding.sessionId, digest: binding.digest, hiding: point(103), binding: point(104, true) },
				{ participantId: 3 as const, sessionId: binding.sessionId, digest: binding.digest, hiding: point(105), binding: point(106, true) },
				{ participantId: 4 as const, sessionId: binding.sessionId, digest: binding.digest, hiding: point(107), binding: point(108, true) },
			]
			const transcriptHash = demoFrostTranscriptHash(binding, commitments)
			await expect(worker.roundTwo({
				schema: 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_REQUEST_V1',
				binding,
				transcriptHash,
				commitments: commitments.map((entry, index) => index === 1
					? { ...entry, sessionId: '00'.repeat(32) }
					: entry),
			}, signal)).rejects.toThrow('DEMO_FROST_WORKER_TRANSCRIPT')
			expect(commands.map((command) => command[1])).toEqual(['sign-commit'])
			const mutableRoundTwo: DemoFrostProcessRoundTwoRequest = {
				schema: 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_REQUEST_V1',
				binding,
				transcriptHash,
				commitments: structuredClone(commitments),
			}
			const secondPending = worker.roundTwo(mutableRoundTwo, signal)
			mutableRoundTwo.commitments[0].hiding = point(999)
			const second = await secondPending
			expect(commands.map((command) => command[1])).toEqual(['sign-commit', 'sign-share'])
			expect(first.policyEvidence.derivedCashuSigAllDigest).toBe(policy.cashuSigAllDigest)
			expect(second.signatureShare).toBe('e1'.repeat(32))

			const authorization = demoFrostRustAuthorizationForRequest({
				dkgRunId: 'dkg-demo-1',
				publicKeyPackageSha256: 'b1'.repeat(32),
			}, roundOneRequest)
			let aggregateRuns = 0
			const aggregateOptions: DemoFrostRustAggregateOptions = {
				binaryPath: join(root, 'coco-demo-frost-participant'),
				publicKeyPackagePath: join(root, 'public-key.json'),
				scratchParent: root,
				authorization,
				async runCommand(command) {
					aggregateRuns += 1
					expect(command[0]).toBe(join(root, 'coco-demo-frost-participant'))
					const request = JSON.parse(await readFile(command[4], 'utf8')) as {
						commitments: Array<{ hiding_hex: string }>
						shares: Array<{ share_hex: string }>
					}
					expect(request.commitments).toHaveLength(4)
					expect(request.shares).toHaveLength(4)
					expect(request.commitments[0]?.hiding_hex).toBe(point(101))
					expect(request.shares[0]?.share_hex).toBe('1'.padStart(64, '0'))
					await writeFile(command[5], JSON.stringify({
						version: 'COCO_DEMO_FROST_PARTICIPANT_V1',
						operation_id: policy.operationId,
						authorization_digest: demoFrostRustAuthorizationDigest(authorization),
						commitments_digest: demoFrostRustCommitmentsDigest(authorization, commitments),
						cashu_sigall_digest: policy.cashuSigAllDigest,
						signature_hex: 'f1'.repeat(64),
					}))
				},
			}
			const aggregator = createDemoFrostRustAggregatePort(aggregateOptions)
			aggregateOptions.binaryPath = join(root, 'mutated-binary')
			aggregateOptions.authorization = {
				...aggregateOptions.authorization,
				full_package_digest: 'ff'.repeat(32),
			}
			const aggregateRequest = {
				sessionId: binding.sessionId,
				digest: policy.cashuSigAllDigest,
				packageDigest: policy.packageDigest,
				transcriptHash,
				commitments,
				shares: commitments.map((entry) => ({
					participantId: entry.participantId,
					sessionId: binding.sessionId,
					digest: policy.cashuSigAllDigest,
					transcriptHash,
					share: `${entry.participantId}`.padStart(64, '0'),
				})),
				committeePublicKey: point(109),
			}
			const aggregate = await aggregator.aggregate(aggregateRequest)
			expect(aggregate).toEqual({ signature: 'f1'.repeat(64), transcriptHash })
			const mutableAggregateRequest = structuredClone(aggregateRequest)
			const aggregatePending = aggregator.aggregate(mutableAggregateRequest)
			mutableAggregateRequest.digest = '00'.repeat(32)
			mutableAggregateRequest.commitments[0].hiding = point(999)
			mutableAggregateRequest.shares[0].share = 'aa'.repeat(32)
			await expect(aggregatePending).resolves.toEqual({ signature: 'f1'.repeat(64), transcriptHash })
			await expect(aggregator.aggregate({
				...aggregateRequest,
				transcriptHash: '00'.repeat(32),
			})).rejects.toThrow('DEMO_FROST_AGGREGATE_TRANSCRIPT')
			await expect(aggregator.aggregate({
				...aggregateRequest,
				shares: aggregateRequest.shares.map((share, index) => index === 2
					? { ...share, sessionId: '00'.repeat(32) }
					: share),
			})).rejects.toThrow('DEMO_FROST_AGGREGATE_TRANSCRIPT')
			await expect(aggregator.aggregate({
				...aggregateRequest,
				shares: aggregateRequest.shares.slice(0, 3),
			})).rejects.toThrow('PAYMENT_BLOCKED_MISSING_PARTICIPANT')
			expect(aggregateRuns).toBe(2)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
})
