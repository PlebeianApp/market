import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { DemoFundingAbortSessionRollbackAnchorSqlite,
	DemoFundingAbortSqliteSessionStore, createDemoFipsFundingAbortCommittee } from './demo-fips-funding-abort-coordinator'
import { DemoFipsFundingAbortRpcUnavailableError, type DemoFipsFundingAbortRpcClient } from './demo-fips-funding-abort-rpc'
import { demoFridayFundingAbortActorUnsignedEvent } from './demo-friday-funding-pool-lifecycle'
import {
	demoFrostFundingAbortAuthorization, demoFrostFundingAbortAuthorizationDigest,
	demoFrostFundingAbortParticipantPolicyDigest, demoFrostFundingAbortTranscriptDigest,
} from './demo-frost-threshold3-funding-abort'
import type { DemoFrostFundingAbortCommitmentV1,
	DemoFrostFundingAbortShareV1, DemoFundingAbortParticipantEvidenceV1 } from './demo-frost-threshold3-funding-abort'

const VERSION = 'COCO_DEMO_FROST_FUNDING_ABORT_3OF4_V1' as const
const commitment = (participantId: 1 | 2 | 3 | 4, restartEpoch = 1): DemoFrostFundingAbortCommitmentV1 => ({
	version: VERSION, operation_id: 'operation-1', session_id: '', authorization_digest: '6'.repeat(64),
	participant_id: participantId, durable_binding: { version: VERSION, participant_id: participantId,
		dkg_run_id: 'dkg', public_key_package_sha256: '7'.repeat(64), signer_roster_digest: '8'.repeat(64),
		state_directory_identity: `${participantId}`.repeat(64), journal_generation: '9'.repeat(64),
		restart_epoch: restartEpoch }, hiding_hex: `02${participantId}`.padEnd(66, '0'),
	binding_hex: `03${participantId}`.padEnd(66, '0'),
})
const share = (participantId: 1 | 2 | 3 | 4): DemoFrostFundingAbortShareV1 => ({
	version: VERSION, operation_id: 'operation-1', session_id: '', authorization_digest: '6'.repeat(64),
	commitments_digest: 'a'.repeat(64), participant_id: participantId,
	durable_binding: commitment(participantId, 2).durable_binding, share_hex: `${participantId}`.repeat(64),
})
const participantEvidence = (participantId: 1 | 2 | 3 | 4): DemoFundingAbortParticipantEvidenceV1 => ({
	schema: 'COCO_DEMO_FUNDING_ABORT_PARTICIPANT_EVIDENCE_V1', participantId,
	operationId: 'operation-1', poolDigest: '1'.repeat(64), proofYsDigest: '2'.repeat(64),
	activeKeysetId: 'keyset', returnPackageDigest: '3'.repeat(64),
	returnCashuSigAllDigest: '4'.repeat(64), mintEvidenceDigest: `${participantId}`.repeat(64),
	consensusEvidenceDigest: '5'.repeat(64), evidenceDigest: `${participantId}`.repeat(64),
})
const evidence = ([1, 2, 3] as const).map(participantEvidence) as [DemoFundingAbortParticipantEvidenceV1, DemoFundingAbortParticipantEvidenceV1,
	DemoFundingAbortParticipantEvidenceV1]

function committeeFixture() {
	const H = (value: string) => value.repeat(64)
	const actorSecret = Uint8Array.from(Buffer.from(H('1'), 'hex'))
	const paymentSecret = Uint8Array.from(Buffer.from(H('2'), 'hex'))
	const committeeSecret = Uint8Array.from(Buffer.from(H('4'), 'hex'))
	const compressed = (secret: Uint8Array) => `02${bytesToHex(schnorr.getPublicKey(secret))}`
	const actorTerms = {
		schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_V1' as const, authNetworkId: 'network', chainId: 'chain',
		genesisSha256: H('7'), auctionId: 'auction-1', operationId: 'operation-1',
		actor: bytesToHex(schnorr.getPublicKey(actorSecret)), mintUrl: 'https://mint.invalid',
		activeKeysetId: 'keyset', amount: 1_000, proofYs: [`02${H('8')}`], poolDigest: H('1'),
		nut11LockPublicKeys: [compressed(paymentSecret), compressed(committeeSecret)] as [string, string],
		locktime: 10_000, paymentPublicKey: compressed(paymentSecret), refundPublicKey: `02${H('5')}`,
		committeePublicKey: compressed(committeeSecret), returnPackageDigest: H('3'), returnCashuSigAllDigest: H('4'),
		bidderReturnSignature: bytesToHex(schnorr.sign(hexToBytes(H('4')), paymentSecret)),
		fundingAuthorizationEventId: H('9'), abortNotBefore: 1, abortExpiresAt: 4_201,
		abortReason: 'prebroadcast_service_failure' as const, committeeKeysetId: 'committee',
		committeeKeysetVersion: 'v1', dkgRunId: 'dkg', publicKeyPackageSha256: H('7'),
		signerRosterDigest: H('8'),
	}
	const unsigned = demoFridayFundingAbortActorUnsignedEvent(actorTerms, 2)
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	return { actorTerms, committeeSecret, input: { actorTerms,
		actorAbortEvent: { ...unsigned, id, sig: bytesToHex(schnorr.sign(hexToBytes(id), actorSecret)) },
		evidence: {} as never, abortReason: 'prebroadcast_service_failure' as const } }
}

let roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('FundingAbort coordinator durable sessions', () => {
	test('resumes each exact signer phase and rejects mutation or premature completion', async () => {
		const root = await mkdtemp(join(tmpdir(), 'funding-abort-session-')); roots.push(root)
		const path = join(root, 'sessions.sqlite3')
		let database = new Database(path, { create: true, strict: true })
		let store = new DemoFundingAbortSqliteSessionStore(database)
		const binding = { operationId: 'operation-1', operationRoot: '1'.repeat(64),
			committeeDigest: '2'.repeat(64), participantIds: [1, 2, 3] as [1, 2, 3] }
		const first = await store.claim(binding, evidence)
		expect(first.sessionId).toMatch(/^[0-9a-f]{64}$/)
		const commitments = [1, 2, 3].map((id) => ({ ...commitment(id as 1 | 2 | 3),
			session_id: first.sessionId }))
		const shares = [1, 2, 3].map((id) => ({ ...share(id as 1 | 2 | 3), session_id: first.sessionId }))
		const result = { participantPolicyDigest: '3'.repeat(64), committeeAbortSignature: '4'.repeat(128),
			participantIds: [1, 2, 3] as [1, 2, 3] }
		await expect(store.complete({ ...binding, sessionId: first.sessionId }, result)).rejects.toThrow(/RESULT/)
		await store.saveCommitments({ ...binding, sessionId: first.sessionId }, commitments.slice(0, 1))
		await expect(store.complete({ ...binding, sessionId: first.sessionId }, result)).rejects.toThrow(/RESULT/)
		database.close(false)
		database = new Database(path, { create: false, strict: true }); store = new DemoFundingAbortSqliteSessionStore(database)
		expect(await store.claim(binding, evidence)).toMatchObject({ sessionId: first.sessionId,
			participantEvidence: evidence, commitments: commitments.slice(0, 1) })
		await store.saveCommitments({ ...binding, sessionId: first.sessionId }, commitments.slice(0, 2))
		await expect(store.saveCommitments({ ...binding, sessionId: first.sessionId }, [commitments[0]!, {
			...commitments[1]!, hiding_hex: `02${'f'.repeat(64)}`,
		}])).rejects.toThrow(/prefix/)
		await store.saveCommitments({ ...binding, sessionId: first.sessionId }, commitments)
		await store.saveShares({ ...binding, sessionId: first.sessionId }, shares.slice(0, 1))
		database.close(false)
		database = new Database(path, { create: false, strict: true }); store = new DemoFundingAbortSqliteSessionStore(database)
		expect(await store.claim(binding, evidence)).toMatchObject({ sessionId: first.sessionId,
			participantEvidence: evidence, commitments, shares: shares.slice(0, 1) })
		await store.saveShares({ ...binding, sessionId: first.sessionId }, shares.slice(0, 2))
		await store.saveShares({ ...binding, sessionId: first.sessionId }, shares)
		await store.complete({ ...binding, sessionId: first.sessionId }, result)
		expect(await store.claim(binding, evidence)).toEqual({ sessionId: first.sessionId, attemptNumber: 1,
			participantEvidence: evidence, commitments, shares, completed: result })
		await expect(store.claim({ ...binding, operationRoot: '5'.repeat(64) }, evidence)).rejects.toThrow(/CONFLICT/)
		database.close(false)
	})

	test('pins participant generation and requires a strictly advancing epoch', async () => {
		const root = await mkdtemp(join(tmpdir(), 'funding-abort-anchor-')); roots.push(root)
		const database = new Database(join(root, 'sessions.sqlite3'), { create: true, strict: true })
		const store = new DemoFundingAbortSqliteSessionStore(database)
		const durable = { version: 'COCO_DEMO_FROST_FUNDING_ABORT_3OF4_V1' as const, participant_id: 1 as const,
			dkg_run_id: 'dkg', public_key_package_sha256: '1'.repeat(64), signer_roster_digest: '2'.repeat(64),
			state_directory_identity: '3'.repeat(64), journal_generation: '4'.repeat(64), restart_epoch: 1 }
		await store.observeParticipant(durable)
		await store.observeParticipant({ ...durable, restart_epoch: 2 })
		await expect(store.observeParticipant({ ...durable, restart_epoch: 2 })).rejects.toThrow(/REGRESSED/)
		await expect(store.observeParticipant({ ...durable, restart_epoch: 3,
			journal_generation: '5'.repeat(64) })).rejects.toThrow(/REPLACED/)
		database.close(false)
	})

	test('archives one failed subset and starts a fresh nonce session with the healthy fourth signer', async () => {
		const root = await mkdtemp(join(tmpdir(), 'funding-abort-rollover-')); roots.push(root)
		const database = new Database(join(root, 'sessions.sqlite3'), { create: true, strict: true })
		const store = new DemoFundingAbortSqliteSessionStore(database)
		const firstBinding = { operationId: 'operation-1', operationRoot: '1'.repeat(64),
			committeeDigest: '2'.repeat(64), participantIds: [1, 2, 3] as [1, 2, 3] }
		const first = await store.claim(firstBinding, evidence)
		await store.saveCommitments({ ...firstBinding, sessionId: first.sessionId }, [{ ...commitment(1),
			session_id: first.sessionId }])
		const fourth = { ...structuredClone(evidence[0]), participantId: 4 as const,
			mintEvidenceDigest: '4'.repeat(64), evidenceDigest: '4'.repeat(64) }
		const nextEvidence = [evidence[0], evidence[2], fourth] as [DemoFundingAbortParticipantEvidenceV1,
			DemoFundingAbortParticipantEvidenceV1, DemoFundingAbortParticipantEvidenceV1]
		const nextBinding = { operationId: 'operation-1', operationRoot: '3'.repeat(64),
			committeeDigest: '4'.repeat(64), participantIds: [1, 3, 4] as [1, 3, 4] }
		const next = await store.rollover({ ...firstBinding, sessionId: first.sessionId }, 2, nextBinding, nextEvidence)
		expect(next).toMatchObject({ attemptNumber: 2, participantEvidence: nextEvidence })
		expect(next.sessionId).not.toBe(first.sessionId)
		expect(await store.read('operation-1')).toMatchObject({ attemptNumber: 2,
			participantIds: [1, 3, 4], excludedParticipantIds: [2] })
		expect(database.query<{ count: number }, []>(
			'SELECT count(*) AS count FROM demo_funding_abort_abandoned_sessions',
		).get()!.count).toBe(1)
		await expect(store.saveCommitments({ ...firstBinding, sessionId: first.sessionId }, [{ ...commitment(1),
			session_id: first.sessionId }])).rejects.toThrow(/differs/)
		const impossibleEvidence = [evidence[0], evidence[1], fourth] as [DemoFundingAbortParticipantEvidenceV1,
			DemoFundingAbortParticipantEvidenceV1, DemoFundingAbortParticipantEvidenceV1]
		await expect(store.rollover({ ...nextBinding, sessionId: next.sessionId }, 3,
			{ ...nextBinding, participantIds: [1, 2, 4] }, impossibleEvidence)).rejects.toThrow(/one fresh/)
		database.close(false)
	})

	test('independent anchor rejects a same-generation session database rollback', async () => {
		const root = await mkdtemp(join(tmpdir(), 'funding-abort-session-rollback-')); roots.push(root)
		const path = join(root, 'sessions.sqlite3'), backup = join(root, 'sessions-revision-zero.sqlite3')
		const anchorDatabase = new Database(join(root, 'anchor.sqlite3'), { create: true, strict: true })
		const anchor = new DemoFundingAbortSessionRollbackAnchorSqlite(anchorDatabase, true)
		let database = new Database(path, { create: true, strict: true })
		let store = new DemoFundingAbortSqliteSessionStore(database, {
			deploymentId: 'deployment-1', anchor, initialize: true,
		})
		database.close(false); await copyFile(path, backup)
		database = new Database(path, { create: false, strict: true })
		store = new DemoFundingAbortSqliteSessionStore(database, { deploymentId: 'deployment-1', anchor })
		await store.claim({ operationId: 'operation-1', operationRoot: '1'.repeat(64),
			committeeDigest: '2'.repeat(64), participantIds: [1, 2, 3] }, evidence)
		database.close(false); await copyFile(backup, path)
		database = new Database(path, { create: false, strict: true })
		expect(() => new DemoFundingAbortSqliteSessionStore(database, {
			deploymentId: 'deployment-1', anchor,
		})).toThrow(/revision regressed/)
		database.close(false); anchorDatabase.close(false)
	})

	test('fails closed on the pre-phase session schema instead of guessing a migration', async () => {
		const root = await mkdtemp(join(tmpdir(), 'funding-abort-session-old-schema-')); roots.push(root)
		const database = new Database(join(root, 'sessions.sqlite3'), { create: true, strict: true })
		database.exec(`CREATE TABLE demo_funding_abort_sessions (
			operation_id TEXT PRIMARY KEY, operation_root TEXT NOT NULL, committee_digest TEXT NOT NULL,
			participant_ids TEXT NOT NULL, session_id TEXT NOT NULL UNIQUE, completed_json TEXT
		) STRICT`)
		expect(() => new DemoFundingAbortSqliteSessionStore(database)).toThrow(/SCHEMA_OLD/)
		database.close(false)
	})
})

describe('FundingAbort 3-of-4 committee liveness', () => {
	test('selects three available policy workers before claiming one immutable signing root', async () => {
		const root = await mkdtemp(join(tmpdir(), 'funding-abort-committee-')); roots.push(root)
		const database = new Database(join(root, 'sessions.sqlite3'), { create: true, strict: true })
		const sessions = new DemoFundingAbortSqliteSessionStore(database)
		const fixture = committeeFixture(), epochs = new Map<number, number>(), calls: string[] = []
		const clients = ([1, 2, 3, 4] as const).map((participantId) => ({
			async call(method: 'policy' | 'commit' | 'share', payload: any, signal: AbortSignal): Promise<any> {
				calls.push(`${method}:${participantId}`)
				if (method === 'policy') {
					if (participantId === 4) {
						await new Promise<void>((_resolve, reject) => signal.addEventListener('abort',
							() => reject(new DemoFipsFundingAbortRpcUnavailableError('blackholed')), { once: true }))
					}
					return participantEvidence(participantId)
				}
				const committeeUnsigned = { ...structuredClone(payload.request.actorTerms),
					participantPolicyDigest: demoFrostFundingAbortParticipantPolicyDigest(payload.participantEvidence),
					actorAbortEvent: structuredClone(payload.request.actorAbortEvent) }
				const authorization = demoFrostFundingAbortAuthorization({ committeeUnsigned,
					participantEvidence: payload.participantEvidence, sessionId: payload.sessionId })
				const authorizationDigest = demoFrostFundingAbortAuthorizationDigest(authorization)
				const restartEpoch = (epochs.get(participantId) ?? 0) + 1; epochs.set(participantId, restartEpoch)
				const durable = { version: VERSION, participant_id: participantId, dkg_run_id: 'dkg',
					public_key_package_sha256: '7'.repeat(64), signer_roster_digest: '8'.repeat(64),
					state_directory_identity: `${participantId}`.repeat(64), journal_generation: '9'.repeat(64),
					restart_epoch: restartEpoch }
				if (method === 'commit') return { version: VERSION, operation_id: authorization.operation_id,
					session_id: authorization.session_id, authorization_digest: authorizationDigest,
					participant_id: participantId, durable_binding: durable,
					hiding_hex: `02${participantId}`.padEnd(66, '0'), binding_hex: `03${participantId}`.padEnd(66, '0') }
				return { version: VERSION, operation_id: authorization.operation_id,
					session_id: authorization.session_id, authorization_digest: authorizationDigest,
					commitments_digest: demoFrostFundingAbortTranscriptDigest(authorizationDigest, payload.commitments),
					participant_id: participantId, durable_binding: durable, share_hex: `${participantId}`.repeat(64) }
			},
		})) as unknown as [DemoFipsFundingAbortRpcClient, DemoFipsFundingAbortRpcClient,
			DemoFipsFundingAbortRpcClient, DemoFipsFundingAbortRpcClient]
		const committee = createDemoFipsFundingAbortCommittee({ clients, sessions,
			capsules: { async readByOperationExact() { return { refund: { operationId: 'operation-1',
				templateDigest: '3'.repeat(64), cashuSigAllDigest: '4'.repeat(64) },
				capsuleDigest: '9'.repeat(64) } as never }, async persistExact(value) { return value } },
			binaryPath: '/unused/aggregate', publicKeyPackagePath: '/unused/public.json', scratchParent: root,
			committeePublicKey: fixture.actorTerms.committeePublicKey, rpcTimeoutMs: 20,
			async runCommand(argv) {
				const authorization = JSON.parse(await readFile(argv[2]!, 'utf8'))
				const inputs = JSON.parse(await readFile(argv[4]!, 'utf8'))
				await writeFile(argv[5]!, JSON.stringify({ version: VERSION,
					operation_id: authorization.operation_id, operation_root: authorization.operation_root,
					session_id: authorization.session_id, authorization_digest: demoFrostFundingAbortAuthorizationDigest(authorization),
					commitments_digest: demoFrostFundingAbortTranscriptDigest(
						demoFrostFundingAbortAuthorizationDigest(authorization), inputs.commitments),
					committee_digest: authorization.committee_digest,
					participant_policy_digest: authorization.participant_policy_digest,
					signer_roster_digest: authorization.signer_roster_digest,
					participant_ids: inputs.commitments.map((entry: any) => entry.participant_id),
					signature_hex: bytesToHex(schnorr.sign(hexToBytes(authorization.committee_digest), fixture.committeeSecret)),
				}))
			},
		})
		const result = await committee.authorizeExact(fixture.input)
		expect(result.participantIds).toEqual([1, 2, 3])
		expect(await sessions.read('operation-1')).toMatchObject({ attemptNumber: 1,
			participantIds: [1, 2, 3], excludedParticipantIds: [] })
		expect(calls).not.toContain('commit:4')
		database.close(false)
	})

	test('fails closed rather than changing the durable operation root after a selected signer disappears', async () => {
		const root = await mkdtemp(join(tmpdir(), 'funding-abort-selected-failure-')); roots.push(root)
		const database = new Database(join(root, 'sessions.sqlite3'), { create: true, strict: true })
		const sessions = new DemoFundingAbortSqliteSessionStore(database)
		const fixture = committeeFixture(), calls: string[] = []
		const clients = ([1, 2, 3, 4] as const).map((participantId) => ({
			async call(method: 'policy' | 'commit' | 'share', payload: any): Promise<any> {
				calls.push(`${method}:${participantId}`)
				if (method === 'policy') return participantEvidence(participantId)
				if (participantId === 2) throw new DemoFipsFundingAbortRpcUnavailableError('selected signer stopped')
				if (method === 'commit' && participantId === 1) {
					const committeeUnsigned = { ...structuredClone(payload.request.actorTerms),
						participantPolicyDigest: demoFrostFundingAbortParticipantPolicyDigest(payload.participantEvidence),
						actorAbortEvent: structuredClone(payload.request.actorAbortEvent) }
					const authorization = demoFrostFundingAbortAuthorization({ committeeUnsigned,
						participantEvidence: payload.participantEvidence, sessionId: payload.sessionId })
					return { version: VERSION, operation_id: authorization.operation_id,
						session_id: authorization.session_id,
						authorization_digest: demoFrostFundingAbortAuthorizationDigest(authorization),
						participant_id: participantId, durable_binding: { version: VERSION,
							participant_id: participantId, dkg_run_id: 'dkg', public_key_package_sha256: '7'.repeat(64),
							signer_roster_digest: '8'.repeat(64), state_directory_identity: '1'.repeat(64),
							journal_generation: '9'.repeat(64), restart_epoch: 1 },
						hiding_hex: '021'.padEnd(66, '0'), binding_hex: '031'.padEnd(66, '0') }
				}
				throw new Error(`unexpected ${method} call to participant ${participantId}`)
			},
		})) as unknown as [DemoFipsFundingAbortRpcClient, DemoFipsFundingAbortRpcClient,
			DemoFipsFundingAbortRpcClient, DemoFipsFundingAbortRpcClient]
		const committee = createDemoFipsFundingAbortCommittee({ clients, sessions,
			capsules: { async readByOperationExact() { return { refund: { operationId: 'operation-1',
				templateDigest: '3'.repeat(64), cashuSigAllDigest: '4'.repeat(64) },
				capsuleDigest: '9'.repeat(64) } as never }, async persistExact(value) { return value } },
			binaryPath: '/unused/aggregate', publicKeyPackagePath: '/unused/public.json', scratchParent: root,
			committeePublicKey: fixture.actorTerms.committeePublicKey, rpcTimeoutMs: 20,
		})
		await expect(committee.authorizeExact(fixture.input)).rejects.toThrow(/participant 2 transport failed/)
		const persisted = await sessions.read('operation-1')
		expect(persisted).toMatchObject({ attemptNumber: 1, participantIds: [1, 2, 3] })
		expect(calls).not.toContain('commit:4')
		database.close(false)
	})

	test('treats an explicit signer-local policy refusal as fatal instead of missing availability', async () => {
		const root = await mkdtemp(join(tmpdir(), 'funding-abort-policy-refusal-')); roots.push(root)
		const database = new Database(join(root, 'sessions.sqlite3'), { create: true, strict: true })
		const sessions = new DemoFundingAbortSqliteSessionStore(database)
		const fixture = committeeFixture()
		const clients = ([1, 2, 3, 4] as const).map((participantId) => ({
			async call(method: 'policy' | 'commit' | 'share'): Promise<any> {
				if (method !== 'policy') throw new Error('signing must not start after policy refusal')
				if (participantId === 2) throw new Error('signer-local proof state is unsafe')
				return participantEvidence(participantId)
			},
		})) as unknown as [DemoFipsFundingAbortRpcClient, DemoFipsFundingAbortRpcClient,
			DemoFipsFundingAbortRpcClient, DemoFipsFundingAbortRpcClient]
		const committee = createDemoFipsFundingAbortCommittee({ clients, sessions,
			capsules: { async readByOperationExact() { return { refund: { operationId: 'operation-1',
				templateDigest: '3'.repeat(64), cashuSigAllDigest: '4'.repeat(64) },
				capsuleDigest: '9'.repeat(64) } as never }, async persistExact(value) { return value } },
			binaryPath: '/unused/aggregate', publicKeyPackagePath: '/unused/public.json', scratchParent: root,
			committeePublicKey: fixture.actorTerms.committeePublicKey, rpcTimeoutMs: 20,
		})
		await expect(committee.authorizeExact(fixture.input)).rejects.toThrow(/proof state is unsafe/)
		expect(await sessions.read('operation-1')).toBeNull()
		database.close(false)
	})
})
