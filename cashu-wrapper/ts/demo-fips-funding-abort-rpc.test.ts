import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { demoDispositionEnrollmentPermit, openDemoDispositionSignerAnchor } from './demo-disposition-signer-anchor'
import { DemoFipsFundingAbortRpcSqliteJournal } from './demo-fips-funding-abort-rpc-sqlite'
import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import {
	createDemoFipsFundingAbortRpcClient,
	createDemoFipsFundingAbortRpcHandler,
	type DemoFipsFundingAbortRpcJournal,
	type DemoFipsFundingAbortRpcResponseV1,
} from './demo-fips-funding-abort-rpc'
import type { DemoFundingAbortParticipantPolicyRequestV1 } from './demo-funding-abort-participant-policy'
import type { DemoFundingAbortParticipantEvidenceV1 } from './demo-frost-threshold3-funding-abort'

const coordinatorSecret = new Uint8Array(32).fill(7)
const signerSecret = new Uint8Array(32).fill(9)
const binding = {
	participantId: 2 as const, network: 'friday-fips-v1', chainId: 'friday-fips-v1',
	committeeKeysetId: 'committee-1', committeeKeysetVersion: '1', dkgRunId: 'dkg-1',
	publicKeyPackageSha256: '1'.repeat(64), signerRosterDigest: '2'.repeat(64),
	coordinatorIdentity: bytesToHex(schnorr.getPublicKey(coordinatorSecret)),
	signerIdentity: bytesToHex(schnorr.getPublicKey(signerSecret)),
}
const evidence: DemoFundingAbortParticipantEvidenceV1 = {
	schema: 'COCO_DEMO_FUNDING_ABORT_PARTICIPANT_EVIDENCE_V1', participantId: 2,
	operationId: 'op-1', poolDigest: '3'.repeat(64), proofYsDigest: '4'.repeat(64),
	activeKeysetId: 'keyset-1', returnPackageDigest: '5'.repeat(64),
	returnCashuSigAllDigest: '6'.repeat(64), mintEvidenceDigest: '7'.repeat(64),
	consensusEvidenceDigest: '8'.repeat(64), evidenceDigest: '9'.repeat(64),
}

function journal(): DemoFipsFundingAbortRpcJournal {
	const rows = new Map<string, { digest: string; response?: DemoFipsFundingAbortRpcResponseV1 }>()
	return {
		async assertReady() {},
		async claim(id, digest) {
			const found = rows.get(id)
			if (found === undefined) { rows.set(id, { digest }); return { status: 'created' } }
			if (found.digest !== digest) throw new Error('conflict')
			return found.response === undefined ? { status: 'pending' } : { status: 'replay', response: found.response }
		},
		async complete(id, digest, response) {
			const found = rows.get(id); if (found?.digest !== digest) throw new Error('absent')
			rows.set(id, { digest, response })
		},
	}
}

describe('FundingAbortV1 FIPS RPC', () => {
	test('authenticates a separate policy domain and replays the exact durable response', async () => {
		let calls = 0
		const handler = createDemoFipsFundingAbortRpcHandler({
			binding, processInstanceId: 'process-1', signerIdentityPrivateKey: signerSecret, journal: journal(),
			async revalidate() {},
			async policy() { calls++; return evidence },
			async commit() { throw new Error('not requested') }, async share() { throw new Error('not requested') },
		})
		const fetchImpl = (async (_input, init) => {
			try {
				const body = JSON.parse(String(init?.body)) as unknown
				return Response.json(await handler(body, init?.signal ?? new AbortController().signal))
			} catch (error) { return Response.json({ error: String(error) }, { status: 422 }) }
		}) as typeof fetch
		const client = createDemoFipsFundingAbortRpcClient({
			endpoint: 'http://[fd00::2]:39101/v1/funding-abort', binding,
			coordinatorIdentityPrivateKey: coordinatorSecret, fetchImpl,
		})
		const payload = { schema: 'COCO_DEMO_FIPS_FUNDING_ABORT_POLICY_PAYLOAD_V1' as const,
			request: {} as DemoFundingAbortParticipantPolicyRequestV1 }
		expect(await client.call('policy', payload, new AbortController().signal)).toEqual(evidence)
		expect(await client.call('policy', payload, new AbortController().signal)).toEqual(evidence)
		expect(calls).toBe(1)
	})

	test('rejects a signer response authenticated by another key', () => {
		expect(() => createDemoFipsFundingAbortRpcHandler({
			binding, processInstanceId: 'process-1', signerIdentityPrivateKey: coordinatorSecret, journal: journal(),
			async revalidate() {},
			async policy() { return evidence }, async commit() { throw new Error('unused') },
			async share() { throw new Error('unused') },
		})).toThrow(/IDENTITY/)
	})

	test('revalidates current safety before replaying a cached same-second response', async () => {
		let spent = false, commits = 0, revalidations = 0
		const handler = createDemoFipsFundingAbortRpcHandler({
			binding, processInstanceId: 'process-1', signerIdentityPrivateKey: signerSecret, journal: journal(),
			async revalidate(method) {
				revalidations++
				if (method === 'commit' && spent) throw new Error('current mint state is SPENT')
			},
			async policy() { return evidence },
			async commit() { commits++; return {} as never },
			async share() { throw new Error('not requested') },
		})
		const fetchImpl = (async (_input, init) => {
			try { return Response.json(await handler(JSON.parse(String(init?.body)),
				init?.signal ?? new AbortController().signal)) }
			catch (error) { return Response.json({ error: String(error) }, { status: 422 }) }
		}) as typeof fetch
		const client = createDemoFipsFundingAbortRpcClient({ endpoint: 'http://[fd00::2]:39101/v1/funding-abort',
			binding, coordinatorIdentityPrivateKey: coordinatorSecret, fetchImpl })
		const payload = { schema: 'COCO_DEMO_FIPS_FUNDING_ABORT_COMMIT_PAYLOAD_V1' as const,
			request: {} as DemoFundingAbortParticipantPolicyRequestV1,
			participantEvidence: [evidence, evidence, evidence] as [typeof evidence, typeof evidence, typeof evidence],
			sessionId: 'a'.repeat(64) }
		// The fake result is intentionally shape-opaque to this transport test; the
		// first authenticated response is cached under the deterministic request ID.
		await client.call('commit', payload, new AbortController().signal)
		spent = true
		await expect(client.call('commit', payload, new AbortController().signal)).rejects.toThrow(/refused with 422/)
		expect(commits).toBe(1)
		expect(revalidations).toBe(1)
	})
})


// Real durable SQLite/anchor and authenticated in-memory transport, with the Rust
// subprocess replaced by a counted callback. No network or live signing state.
for (const boundary of ['complete-response-lost', 'before-rust', 'rust-before-anchor', 'anchor-before-complete'] as const) {
	test(`FundingAbort share RPC durable boundary: ${boundary}`, async () => {
		const root = await mkdtemp(join(tmpdir(), 'abort-rpc-boundary-'))
		const stateDirectory = join(root, 'state'); await mkdir(stateDirectory)
		await writeFile(join(stateDirectory, 'dkg-final.state'), '{"synthetic":"dkg"}', { mode: 0o600 })
		const options = {
			participantId: binding.participantId, dkgRunId: binding.dkgRunId,
			publicKeyPackageSha256: binding.publicKeyPackageSha256, signerRosterDigest: binding.signerRosterDigest,
			stateDirectory, signerMetadataPath: join(stateDirectory, 'metadata.sqlite3'),
			proofUsePath: join(root, 'proof.sqlite3'), coordinatorAnchorPath: join(root, 'anchor.sqlite3'),
			initialEnrollmentPermitPath: join(root, 'permit.json'), admissionSafetyPath: join(root, 'admission.sqlite3'),
		}
		await writeFile(options.initialEnrollmentPermitPath, JSON.stringify(demoDispositionEnrollmentPermit(options)), { mode: 0o600 })
		let anchor = openDemoDispositionSignerAnchor(options)
		let db = new Database(options.admissionSafetyPath, { create: true, strict: true })
		let rustCalls = 0, revalidations = 0, denyReplay = false
		let returned: DemoFipsFundingAbortRpcResponseV1 | undefined
		const rustJournal = join(stateDirectory, `funding-abort-sign-${'aa'.repeat(32)}.journal`)
		const buildHandler = (instance: string) => createDemoFipsFundingAbortRpcHandler({
			binding, processInstanceId: instance, signerIdentityPrivateKey: signerSecret,
			journal: new DemoFipsFundingAbortRpcSqliteJournal(db, {
				assertFundingAbortJournalCurrent: anchor.assertAdmissionJournalCurrent,
				recordFundingAbortJournalAdvance: anchor.recordAdmissionJournalAdvance,
			}),
			async revalidate() { revalidations++; if (denyReplay) throw new Error('current safety policy refused') },
			async policy() { throw new Error('unused') }, async commit() { throw new Error('unused') },
			async share() {
				if (boundary === 'before-rust') throw new Error('simulated interruption before Rust')
				anchor.assertRustStateCurrent(); rustCalls++
				await writeFile(rustJournal, '{"synthetic":"consumed-T1"}', { mode: 0o600 })
				if (boundary === 'rust-before-anchor') throw new Error('simulated interruption before anchor')
				anchor.recordRustStateAdvance()
				if (boundary === 'anchor-before-complete') throw new Error('simulated interruption before RPC completion')
				return { syntheticShare: 'T1' } as never
			},
		})
		let handler = buildHandler('first-process')
		let loseResponse = boundary === 'complete-response-lost'
		const client = createDemoFipsFundingAbortRpcClient({
			endpoint: 'http://[fd00::2]:39101/v1/funding-abort', binding,
			coordinatorIdentityPrivateKey: coordinatorSecret,
			fetchImpl: (async (_input, init) => {
				let result: DemoFipsFundingAbortRpcResponseV1
				try { result = await handler(JSON.parse(String(init?.body)), new AbortController().signal) }
				catch (error) { return Response.json({ error: String(error) }, { status: 422 }) }
				if (loseResponse) { loseResponse = false; returned = result; throw new Error('simulated lost response') }
				if (returned !== undefined) expect(JSON.stringify(result)).toBe(JSON.stringify(returned))
				return Response.json(result)
			}) as typeof fetch,
		})
		const payload = {
			schema: 'COCO_DEMO_FIPS_FUNDING_ABORT_SHARE_PAYLOAD_V1' as const,
			request: {} as DemoFundingAbortParticipantPolicyRequestV1,
			participantEvidence: [evidence, evidence, evidence] as [typeof evidence, typeof evidence, typeof evidence],
			sessionId: 'a'.repeat(64), commitments: [] as never,
		}
		const call = () => client.call('share', payload, new AbortController().signal)
		try {
			await expect(call()).rejects.toThrow()
			if (boundary === 'complete-response-lost') {
				await call(); expect(rustCalls).toBe(1)
			} else {
				await expect(call()).rejects.toThrow(/refused with 422/)
				const pending = db.query<{ status: string }, []>('SELECT status FROM demo_fips_funding_abort_rpc_journal').get()
				expect(pending?.status).toBe('pending')
			}
			const bytes = boundary === 'before-rust' ? undefined : await readFile(rustJournal)
			const callsBeforeRestart = rustCalls
			db.close(); anchor.close()
			if (boundary === 'rust-before-anchor') {
				expect(() => openDemoDispositionSignerAnchor(options)).toThrow(/restored or replaced/)
			} else {
				anchor = openDemoDispositionSignerAnchor(options)
				db = new Database(options.admissionSafetyPath, { create: true, strict: true })
				handler = buildHandler('restarted-process')
				if (boundary === 'complete-response-lost') {
					await call(); expect(revalidations).toBe(2)
					denyReplay = true
					await expect(call()).rejects.toThrow(/refused with 422/)
				} else await expect(call()).rejects.toThrow(/refused with 422/)
			}
			expect(rustCalls).toBe(callsBeforeRestart)
			if (bytes !== undefined) expect(await readFile(rustJournal)).toEqual(bytes)
		} finally {
			try { db.close() } catch {}
			try { anchor.close() } catch {}
			await rm(root, { recursive: true, force: true })
		}
	})
}
