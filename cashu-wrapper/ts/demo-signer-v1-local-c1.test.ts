import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { DemoFundingAbortSqliteSessionStore, createDemoFipsFundingAbortCommittee } from './demo-fips-funding-abort-coordinator'
import { type DemoFipsFundingAbortRpcClient } from './demo-fips-funding-abort-rpc'
import { demoFridayFundingAbortActorUnsignedEvent } from './demo-friday-funding-pool-lifecycle'
import {
	demoFrostFundingAbortAuthorization, demoFrostFundingAbortAuthorizationDigest,
	demoFrostFundingAbortParticipantPolicyDigest, demoFrostFundingAbortTranscriptDigest,
} from './demo-frost-threshold3-funding-abort'
import type { DemoFundingAbortParticipantEvidenceV1 } from './demo-frost-threshold3-funding-abort'

const VERSION = 'COCO_DEMO_FROST_FUNDING_ABORT_3OF4_V1' as const
const participantEvidence = (participantId: 1 | 2 | 3 | 4): DemoFundingAbortParticipantEvidenceV1 => ({
	schema: 'COCO_DEMO_FUNDING_ABORT_PARTICIPANT_EVIDENCE_V1', participantId,
	operationId: 'operation-1', poolDigest: '1'.repeat(64), proofYsDigest: '2'.repeat(64),
	activeKeysetId: 'keyset', returnPackageDigest: '3'.repeat(64),
	returnCashuSigAllDigest: '4'.repeat(64), mintEvidenceDigest: `${participantId}`.repeat(64),
	consensusEvidenceDigest: '5'.repeat(64), evidenceDigest: `${participantId}`.repeat(64),
})
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


import { service } from './demo-signer-v1-local.test'

for (const outage of ['mint', 'comet'] as const) {
	test(`C1 ${outage}: typed pre-effect 503 permits the other three coordinator participants`, async () => {
		const root = await mkdtemp(join(tmpdir(), 'funding-abort-committee-')); roots.push(root)
		const database = new Database(join(root, 'sessions.sqlite3'), { create: true, strict: true })
		const sessions = new DemoFundingAbortSqliteSessionStore(database)
		const fixture = committeeFixture(), epochs = new Map<number, number>(), calls: string[] = []
		const unavailable = await service('funding-abort', 4); unavailable.mode('outage'); unavailable.readTarget(outage)
		const clients = ([1, 2, 3, 4] as const).map((participantId) => ({
			async call(method: 'policy' | 'commit' | 'share', payload: any, _signal: AbortSignal): Promise<any> {
				calls.push(`${method}:${participantId}`)
				if (method === 'policy') {
					if (participantId === 4) return unavailable.call('policy', `C1-${outage}`)
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
			committeePublicKey: fixture.actorTerms.committeePublicKey, rpcTimeoutMs: 2000,
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
		expect(unavailable.responses[0]!.status).toBe(503)
		expect(unavailable.count.effects).toBe(0)
		database.close(false)
	})

}
