import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'

import type { DemoFrostProcessRoundOneRequest } from './demo-frost-process-boundary'
import {
	createDemoSignerRpcHandler,
	createDemoSignerRpcTransport,
	demoSignerRpcRequestDigest,
	type DemoSignerRpcRequestV1,
	type DemoSignerRpcResponseV1,
	type DemoSignerDurableBindingV1,
} from './demo-signer-rpc'
import { DemoSignerRpcSqliteJournal } from './demo-signer-rpc-sqlite'
import { DemoSignerCoordinatorAnchorSqlite } from './demo-signer-coordinator-anchor-sqlite'
import type { DemoFrostThreshold3ParticipantWorker } from './demo-frost-threshold3-rust-participant-worker'

const roots: string[] = []
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function key(value: number): Uint8Array {
	const out = new Uint8Array(32)
	out[31] = value
	return out
}

const point = (value: number): string => `02${value.toString(16).padStart(64, '0')}`

function request(): DemoFrostProcessRoundOneRequest {
	return {
		schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_REQUEST_V1',
		binding: {
			schema: 'COCO_DEMO_FROST_PROCESS_BINDING_V1', participantId: 1,
			processIdentity: 'signer-1', committeeKeysetId: 'friday-keyset', committeeKeysetVersion: '1',
			rosterDigest: '11'.repeat(32), policyPackageDigest: '12'.repeat(32), sessionId: '13'.repeat(32),
			packageDigest: '14'.repeat(32), digest: '15'.repeat(32),
		},
		policy: { marker: 'fixture payload; worker validates the real shape elsewhere' } as never,
	}
}

async function fixture(worker?: DemoFrostThreshold3ParticipantWorker) {
	const root = await mkdtemp('/tmp/plebeian-signer-rpc-')
	roots.push(root)
	const database = new Database(join(root, 'journal.sqlite3'), { create: true, strict: true })
	let calls = 0
	const actualWorker: DemoFrostThreshold3ParticipantWorker = worker ?? {
		async roundOne(value) {
			calls += 1
			return {
				schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_RESPONSE_V1', binding: value.binding,
				policyEvidence: {
					schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_EVIDENCE_V1', policyPackageDigest: value.binding.policyPackageDigest,
					closureEvidenceDigest: '21'.repeat(32), signedBidEvidenceDigest: '22'.repeat(32),
					committeeLockedProofsDigest: '23'.repeat(32), authenticatedPackageDigest: value.binding.packageDigest,
					derivedCashuSigAllDigest: value.binding.digest,
				},
				commitment: { hiding: point(31), binding: point(32) },
			}
		},
		async roundTwo() { throw new Error('round two not used by this fixture') },
	}
	const coordinatorPrivate = key(7)
	const signerPrivate = key(8)
	const journal = new DemoSignerRpcSqliteJournal(database, {
		participantId: 1, keysetId: 'friday-keyset', keysetVersion: '1', dkgRunId: 'dkg-run-1',
		publicKeyPackageSha256: '31'.repeat(32), signerRosterDigest: '32'.repeat(32),
		processIdentity: 'signer-1', stateDirectory: root, verifyingShare: point(41),
	})
	const signerBinding = await journal.readBinding()
	const handler = createDemoSignerRpcHandler({
		processInstanceId: 'signer-1:boot-1', coordinatorIdentity: Buffer.from(schnorr.getPublicKey(coordinatorPrivate)).toString('hex'),
		signerIdentityPrivateKey: signerPrivate, worker: actualWorker, journal,
	})
	const anchor = {
		async assertCurrent(value: DemoSignerDurableBindingV1) { expect(value).toEqual(signerBinding) },
		async observeProcess(value: DemoSignerDurableBindingV1, processInstanceId: string) {
			expect(value).toEqual(signerBinding); expect(processInstanceId).toBe('signer-1:boot-1')
		},
	}
	const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		try {
			const body = JSON.parse(String(init?.body))
			return Response.json(await handler(body, init?.signal ?? new AbortController().signal))
		} catch (error) {
			return Response.json({ error: error instanceof Error ? error.message : 'refused' }, { status: 409 })
		}
	}) as unknown as typeof fetch
	const transport = createDemoSignerRpcTransport({
		endpoint: 'http://[fd00::1]:9191/v1/frost',
		enrollment: { participantId: 1, processIdentity: 'signer-1', stateDirectory: root, verifyingShare: point(41) },
		signerBinding, anchor,
		coordinatorIdentityPrivateKey: coordinatorPrivate,
		signerIdentity: Buffer.from(schnorr.getPublicKey(signerPrivate)).toString('hex'), fetchImpl,
	})
	return { root, database, journal, handler, transport, signerBinding, anchor, calls: () => calls }
}

describe('FIPS-routed authenticated signer RPC', () => {
	test('authenticates both directions and replays an exact terminal response without a second nonce request', async () => {
		const held = await fixture()
		const signal = new AbortController().signal
		const first = await held.transport.roundOne(request(), { signal })
		const second = await held.transport.roundOne(request(), { signal })
		expect(first).toEqual(second)
		expect(first.peer).toMatchObject({ processIdentity: 'signer-1', processInstanceId: 'signer-1:boot-1', restartCounter: 1 })
		expect(held.calls()).toBe(1)
		held.database.close()
	})

	test('quarantines the signer when a request is left pending instead of asking the worker for a fresh nonce', async () => {
		const held = await fixture()
		let captured: DemoSignerRpcRequestV1 | undefined
		const capturingFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
			captured = JSON.parse(String(init?.body)) as DemoSignerRpcRequestV1
			return new Response('{}', { status: 503 })
		}) as unknown as typeof fetch
		const probe = createDemoSignerRpcTransport({
			endpoint: 'http://[fd00::1]:9191/v1/frost',
			enrollment: { participantId: 1, processIdentity: 'signer-1', stateDirectory: held.root, verifyingShare: point(41) },
			signerBinding: held.signerBinding, anchor: held.anchor, coordinatorIdentityPrivateKey: key(7),
			signerIdentity: Buffer.from(schnorr.getPublicKey(key(8))).toString('hex'), fetchImpl: capturingFetch,
		})
		await expect(probe.roundOne(request(), { signal: new AbortController().signal })).rejects.toThrow(/503/)
		expect(captured).toBeDefined()
		await held.journal.claim(captured!.requestId, demoSignerRpcRequestDigest(captured!))
		await expect(held.handler(captured!, new AbortController().signal)).rejects.toThrow(/QUARANTINED/)
		expect(held.calls()).toBe(0)
		held.database.close()
	})

	test('rejects a signed response from the wrong restart epoch', async () => {
		const held = await fixture()
		const honestHandler = held.handler
		const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body))
			const response = await honestHandler(body, init?.signal ?? new AbortController().signal)
			return Response.json({ ...response, restartEpoch: 3 } satisfies DemoSignerRpcResponseV1)
		}) as unknown as typeof fetch
		const transport = createDemoSignerRpcTransport({
			endpoint: 'http://[fd00::1]:9191/v1/frost',
			enrollment: { participantId: 1, processIdentity: 'signer-1', stateDirectory: held.root, verifyingShare: point(41) },
			signerBinding: held.signerBinding, anchor: held.anchor, coordinatorIdentityPrivateKey: key(7),
			signerIdentity: Buffer.from(schnorr.getPublicKey(key(8))).toString('hex'), fetchImpl,
		})
		await expect(transport.roundOne(request(), { signal: new AbortController().signal })).rejects.toThrow(/response differs|signature is invalid/)
		held.database.close()
	})

	test('coordinator anchor rejects a replacement journal and a restored process reusing an observed epoch', async () => {
		const root = await mkdtemp('/tmp/plebeian-signer-anchor-')
		roots.push(root)
		const identity = {
			participantId: 1 as const, keysetId: 'friday-keyset', keysetVersion: '1', dkgRunId: 'dkg-run-1',
			publicKeyPackageSha256: '31'.repeat(32), signerRosterDigest: '32'.repeat(32),
			processIdentity: 'signer-1', stateDirectory: root, verifyingShare: point(41),
		}
		const anchorDatabase = new Database(join(root, 'anchor.sqlite3'), { create: true, strict: true })
		const anchor = new DemoSignerCoordinatorAnchorSqlite(anchorDatabase)
		const journalPath = join(root, 'journal.sqlite3')
		const snapshotPath = join(root, 'journal-snapshot.sqlite3')
		let signerDatabase = new Database(journalPath, { create: true, strict: true })
		let journal = new DemoSignerRpcSqliteJournal(signerDatabase, identity)
		const first = await journal.readBinding()
		await anchor.assertCurrent(first); await anchor.observeProcess(first, 'boot-1')
		signerDatabase.exec('PRAGMA wal_checkpoint(TRUNCATE)')
		await copyFile(journalPath, snapshotPath)
		signerDatabase.close()

		signerDatabase = new Database(journalPath, { create: false, strict: true })
		journal = new DemoSignerRpcSqliteJournal(signerDatabase, identity)
		const second = await journal.readBinding()
		await anchor.assertCurrent(second); await anchor.observeProcess(second, 'boot-2')
		signerDatabase.close()

		const restoredDatabase = new Database(snapshotPath, { create: false, strict: true })
		const restored = new DemoSignerRpcSqliteJournal(restoredDatabase, identity)
		const restoredBinding = await restored.readBinding()
		await anchor.assertCurrent(restoredBinding)
		await expect(anchor.observeProcess(restoredBinding, 'boot-restored')).rejects.toThrow(/ROLLBACK/)
		restoredDatabase.close()

		const replacementDatabase = new Database(join(root, 'replacement.sqlite3'), { create: true, strict: true })
		const replacement = new DemoSignerRpcSqliteJournal(replacementDatabase, identity)
		await expect(anchor.assertCurrent(await replacement.readBinding())).rejects.toThrow(/REPLACED/)
		replacementDatabase.close(); anchorDatabase.close()
	})
})
