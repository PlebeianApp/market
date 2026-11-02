import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { demoSignerV1LocalFixture, registerDemoSignerFixtureCleanup, json, H, type Domain } from './demo-signer-v1-local-fixture'
import { createDemoFipsAdmissionRpcClient, createDemoFipsAdmissionRpcHandler } from './demo-fips-admission-rpc'
import { createDemoFipsFundingAbortRpcClient, createDemoFipsFundingAbortRpcHandler } from './demo-fips-funding-abort-rpc'
import { DemoFipsAdmissionRpcSqliteJournal } from './demo-fips-admission-rpc-sqlite'
import { DemoFipsFundingAbortRpcSqliteJournal } from './demo-fips-funding-abort-rpc-sqlite'
import { createDemoSignerSerialization } from './demo-signer-serialization'
import { demoSignerRpcErrorResponse } from './demo-signer-rpc-server'
import { demoSignerObservationFetch, type DemoSignerPureContext } from './demo-signer-pure-policy'
import { DemoSignerTransientReadUnavailable } from './demo-signer-v1-local-attempt'
import { openDemoDispositionSignerAnchor } from './demo-disposition-signer-anchor'

const signal = () => new AbortController().signal
const coordinatorKey = new Uint8Array(32).fill(7), signerKey = new Uint8Array(32).fill(9)
const counters = () => ({ pure: 0, effects: 0, rust: 0, revalidation: 0 })

export async function service(domain: Domain, participantId: 1 | 2 | 3 | 4 = 1) {
	const f = await demoSignerV1LocalFixture(domain)
	let anchor = f.anchors()[participantId - 1]!
	const options = f.options[participantId - 1]!
	let db = new Database(options.admissionSafetyPath, { create: true, strict: true })
	let ready = () => {}
	let gate = createDemoSignerSerialization({ leasePath: join(f.root, 'service.lock'), quarantinePath: join(f.root, 'service.quarantine'), assertCurrent: () => { if (fault === 'entry-read') throw new TypeError('synthetic safety I/O'); anchor.captureNoEffectWitness(); if (fault === 'before-effect' && count.pure > 0) throw new Error('injected fence before effects') }, assertReady: () => ready() })
	const binding = { participantId, network: 'synthetic-f1', chainId: 'synthetic-f1', committeeKeysetId: 'synthetic-f1', committeeKeysetVersion: '1',
		dkgRunId: 'synthetic-f1', publicKeyPackageSha256: options.publicKeyPackageSha256, signerRosterDigest: options.signerRosterDigest,
		coordinatorIdentity: Buffer.from(schnorr.getPublicKey(coordinatorKey)).toString('hex'), signerIdentity: Buffer.from(schnorr.getPublicKey(signerKey)).toString('hex') }
	let mode: 'valid' | 'refuse' | 'outage' | 'unknown' | 'claim-throw' | 'rust-throw' | 'rust-consuming' | 'rust-consumed' | 'foreign-category' = 'valid'
	let pureHook: ((context: DemoSignerPureContext) => Promise<void>) | undefined
	let delay: Promise<void> | undefined
	let readTarget: 'mint' | 'comet' = 'comet'
	let replayMode: 'valid' | 'outage' | 'refuse' | 'unknown' = 'valid'
	let fault: 'none' | 'before-anchor' | 'complete-before-anchor' | 'entry-read' | 'before-effect' | 'revision-abort' = 'none'
	const count = counters(), responses: Response[] = []
	const build = () => {
		const safety = { assertAdmissionJournalCurrent: anchor.assertAdmissionJournalCurrent, assertNoEffectWitness: anchor.assertNoEffectWitness,
			captureNoEffectWitness: anchor.captureNoEffectWitness,
			recordRpcJournalAdvance(witness: string, table: string, id: string, prior: Record<string, unknown> | null, next: Record<string, unknown>) {
				if (fault === 'before-anchor' || (fault === 'complete-before-anchor' && count.effects > 0)) throw new Error('injected anchor I/O failure')
				anchor.recordRpcJournalAdvance(witness, table, id, prior, next)
			},
			recordAdmissionJournalAdvance() { if (fault === 'before-anchor' || (fault === 'complete-before-anchor' && count.effects > 0)) throw new Error('injected anchor I/O failure'); anchor.recordAdmissionJournalAdvance() } }
		const journal = domain === 'admission' ? new DemoFipsAdmissionRpcSqliteJournal(db, safety) : new DemoFipsFundingAbortRpcSqliteJournal(db, {
			assertFundingAbortJournalCurrent: anchor.assertAdmissionJournalCurrent, recordFundingAbortJournalAdvance: safety.recordAdmissionJournalAdvance,
			assertNoEffectWitness: anchor.assertNoEffectWitness,
			captureNoEffectWitness: safety.captureNoEffectWitness, recordRpcJournalAdvance: safety.recordRpcJournalAdvance,
		})
		ready = () => journal.assertReadyNow()
		const preflight = async (_method: unknown, _payload: unknown, context: DemoSignerPureContext) => {
			count.pure++
			if (pureHook) await pureHook(context)
			if (delay) await context.observe(async () => { await delay; return true })
			if (mode === 'refuse') context.refuse(domain === 'admission' ? 'ADMISSION_STALE' : 'ABORT_TIME')
			if (mode === 'outage') {
				const unavailableFetch: typeof fetch = Object.assign(async (_input: RequestInfo | URL): Promise<Response> => { throw new TypeError('synthetic read transport') }, { preconnect: fetch.preconnect })
				const fetchRead = demoSignerObservationFetch(context.signal, unavailableFetch)
				await context.observe(() => fetchRead(readTarget === 'mint' ? 'http://[fd00::1]:3338/v1/keysets' : 'http://127.0.0.1:26657/status'))
			}
			if (mode === 'unknown') throw new Error('503 NO_EFFECT invalid user supplied classification')
			return { checked: true }
		}
		const execute = async (method: 'policy' | 'commit' | 'share', payload: any) => {
			count.effects++
			if (mode === 'claim-throw' || mode === 'foreign-category') {
				anchor.claimAdmissionProofs([{ proofRef: `02${H(66)}`, network: 'synthetic-f1', chainId: 'synthetic-f1', auctionId: 'auction', operationId: 'operation' }])
				throw mode === 'foreign-category' ? new DemoSignerTransientReadUnavailable() : new TypeError('same transport failure after claim')
			}
			if (method === 'policy') return { synthetic: 'policy-evidence' } as never
			count.rust++
			const beforeRust = method === 'share' ? await json<Record<string, unknown>>(f.journalPath()) : undefined
			const result = await f.raw(method, f.auth, method === 'share' ? payload.commitments : undefined, participantId)
			if (result.code !== 0 || mode === 'rust-throw') throw new Error('opaque actual Rust outcome')
			if (method === 'share' && (mode === 'rust-consuming' || mode === 'rust-consumed')) {
				if (mode === 'rust-consuming') {
					const consumed = await json<Record<string, unknown>>(f.journalPath())
					await writeFile(f.journalPath(), JSON.stringify({ ...consumed, state: 'CONSUMING', nonces_hex: beforeRust!.nonces_hex, share_hex: null }), { mode: 0o600 })
				}
				throw new Error('synthetic Rust crash snapshot before external anchor')
			}
			anchor.recordRustStateAdvance()
			return json<any>(result.out)
		}
		const options = { binding, processInstanceId: 'process-one', signerIdentityPrivateKey: signerKey, journal,
			localAttempt: { gate, captureWitness: anchor.captureNoEffectWitness, assertWitness: anchor.assertNoEffectWitness }, preflight,
			policy: async (payload: any) => execute('policy', payload), commit: async (payload: any) => execute('commit', payload), share: async (payload: any) => execute('share', payload),
			async revalidate(_method: unknown, _payload: unknown, _cached: unknown, _signal: AbortSignal, context?: DemoSignerPureContext) {
				count.revalidation++
				if (replayMode === 'refuse') context!.refuse('ABORT_TIME')
				if (replayMode === 'unknown') throw new Error('untrusted revalidation failure')
				if (replayMode === 'outage') {
					const fail: typeof fetch = Object.assign(async (): Promise<Response> => { throw new TypeError('read outage') }, { preconnect: fetch.preconnect })
					await context!.observe(() => demoSignerObservationFetch(context!.signal, fail)('http://127.0.0.1:26657/status'))
				}
			},
		}
		return { journal, handler: domain === 'admission' ? createDemoFipsAdmissionRpcHandler({ ...options, journal: journal as DemoFipsAdmissionRpcSqliteJournal }) : createDemoFipsFundingAbortRpcHandler({ ...options, journal: journal as DemoFipsFundingAbortRpcSqliteJournal }) }
	}
	let composed = build()
	let mutateRequest: ((body: any) => void) | undefined
	let lose = false
	let substitute: Response | undefined
	let lastRequest: unknown
	const fetchImpl = (async (_url, init) => {
		if (substitute) return substitute.clone()
		const body = JSON.parse(String(init?.body)); mutateRequest?.(body); lastRequest = body
		let response: Response
		try { response = Response.json(await composed.handler(body, init?.signal ?? signal())) }
		catch (error) { response = demoSignerRpcErrorResponse(error) }
		responses.push(response.clone())
		if (lose) { lose = false; throw new TypeError('lost response') }
		return response
	}) as typeof fetch
	const client = domain === 'admission' ? createDemoFipsAdmissionRpcClient({ endpoint: 'http://[fd00::1]:39101/v1/admission', binding, coordinatorIdentityPrivateKey: coordinatorKey, fetchImpl })
		: createDemoFipsFundingAbortRpcClient({ endpoint: 'http://[fd00::1]:39101/v1/funding-abort', binding, coordinatorIdentityPrivateKey: coordinatorKey, fetchImpl })
	const payload = (method: string, tag = 'one', commitments?: unknown[]) => ({ schema: `COCO_DEMO_FIPS_${domain === 'admission' ? 'ADMISSION' : 'FUNDING_ABORT'}_${method.toUpperCase()}_PAYLOAD_V1`,
		request: { syntheticTag: tag }, participantEvidence: [], sessionId: f.auth.session_id, ...(commitments ? { commitments } : {}) })
	const call = (method: 'policy' | 'commit' | 'share', tag = 'one', commitments?: unknown[], requestSignal = signal()) => (client.call as any)(method, payload(method, tag, commitments), requestSignal) as Promise<any>
	const restart = async () => {
		await gate.close(); db.close(); f.restart(); anchor = f.anchors()[participantId - 1]!
		db = new Database(options.admissionSafetyPath, { create: true, strict: true })
		gate = createDemoSignerSerialization({ leasePath: join(f.root, 'service.lock'), quarantinePath: join(f.root, 'service.quarantine'), assertCurrent: () => { if (fault === 'entry-read') throw new TypeError('synthetic safety I/O'); anchor.captureNoEffectWitness(); if (fault === 'before-effect' && count.pure > 0) throw new Error('injected fence before effects') }, assertReady: () => ready() })
		composed = build()
	}
	registerDemoSignerFixtureCleanup(async () => { try { await gate.close() } finally { try { db.close() } catch {} } })
	return { ...f, options, count, call, responses, restart, binding, replayMode: (value: typeof replayMode) => { replayMode = value }, fault: (value: typeof fault) => { fault = value }, mode: (value: typeof mode) => { mode = value }, readTarget: (value: typeof readTarget) => { readTarget = value }, wait: (value?: Promise<void>) => { delay = value },
		pureHook: (hook?: typeof pureHook) => { pureHook = hook },
		db: () => db, gate: () => gate, journal: () => composed.journal, handler: () => composed.handler, anchor: () => anchor,
		substitute: (value?: Response) => { substitute = value }, tamper: (mutate?: typeof mutateRequest) => { mutateRequest = mutate }, lose: () => { lose = true }, request: () => lastRequest,
	}
}

for (const domain of ['admission', 'funding-abort'] as const) {
	for (const method of ['policy', 'commit', 'share'] as const) {
		test(`G2/G3 ${domain}/${method}: durable refusal, exact opaque 422 replay, distinct valid request after restart`, async () => {
			const s = await service(domain), before = await s.safety()
			s.mode('refuse'); await expect(s.call(method)).rejects.toThrow(/422/)
			const first = await s.responses.at(-1)!.text()
			expect(s.responses.at(-1)!.status).toBe(422); expect(await s.safety()).toEqual(before)
			const rows = s.db().query<{ status: string; rejection_body: string }, []>(`SELECT status,rejection_body FROM demo_fips_${domain.replaceAll('-', '_')}_rpc_journal`).all()
			expect(rows).toEqual([{ status: 'rejected_no_effect', rejection_body: first }])
			const calls = { ...s.count }; s.mode('valid')
			await expect(s.call(method)).rejects.toThrow(/422/); expect(await s.responses.at(-1)!.text()).toBe(first); expect(s.count).toEqual(calls)
			await s.restart(); await expect(s.call(method)).rejects.toThrow(/422/)
			expect(await s.responses.at(-1)!.text()).toBe(first); expect(s.count).toEqual(calls)
			await expect(s.call('commit', 'new')).resolves.toHaveProperty('hiding_hex'); expect(s.count.rust).toBe(1)
		})
	}

	test(`G1 ${domain}: unauthenticated envelopes have no row/callback; changed digest conflicts before callbacks`, async () => {
		const s = await service(domain), before = s.anchor().captureNoEffectWitness()
		for (const field of ['signature', 'version', 'chainId']) {
			s.tamper((body) => { body[field] = 'wrong' }); await expect(s.call('policy')).rejects.toThrow()
			expect(s.count.pure).toBe(0); expect(s.anchor().captureNoEffectWitness()).toBe(before)
		}
		const otherDomainDigest = domain === 'admission'
			? (await import('./demo-fips-funding-abort-rpc')).demoFipsFundingAbortRequestDigest
			: (await import('./demo-fips-admission-rpc')).demoFipsAdmissionRequestDigest
		s.tamper((body) => { body.signature = Buffer.from(schnorr.sign(Buffer.from(otherDomainDigest(body), 'hex'), coordinatorKey)).toString('hex') })
		await expect(s.call('policy')).rejects.toThrow(); expect(s.count.pure).toBe(0)
		expect(s.anchor().captureNoEffectWitness()).toBe(before)
		s.tamper(); s.mode('refuse'); await expect(s.call('policy')).rejects.toThrow(/422/)
		const request = structuredClone(s.request()) as any
		// A different *validly signed* digest under the existing ID.
		request.payload.request.syntheticTag = 'changed'
		const { demoFipsAdmissionRequestDigest } = await import('./demo-fips-admission-rpc')
		const { demoFipsFundingAbortRequestDigest } = await import('./demo-fips-funding-abort-rpc')
		const { sha256 } = await import('@noble/hashes/sha2.js')
		// Both payload digest functions use canonical object-key sorting.
		const canonical = (v: any): string => v && typeof v === 'object' ? Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v)
		const payloadBytes = Buffer.from(canonical(request.payload)), size = Buffer.alloc(4); size.writeUInt32BE(payloadBytes.length)
		request.payloadDigest = Buffer.from(sha256(Buffer.concat([Buffer.from(domain === 'admission' ? 'COCO_DEMO_FIPS_ADMISSION_RPC_PAYLOAD_V1' : 'COCO_DEMO_FIPS_FUNDING_ABORT_RPC_PAYLOAD_V1'), size, payloadBytes]))).toString('hex')
		const digest = domain === 'admission' ? demoFipsAdmissionRequestDigest(request) : demoFipsFundingAbortRequestDigest(request)
		request.signature = Buffer.from(schnorr.sign(Buffer.from(digest, 'hex'), coordinatorKey)).toString('hex')
		const count = s.count.pure
		await expect(s.handler()(request, signal())).rejects.toThrow(/CONFLICT/); expect(s.count.pure).toBe(count)
	})

	test(`G4/C1 ${domain}: pure transport outage is 503, no row, retry can succeed; old V1 clients stay opaque`, async () => {
		const s = await service(domain), before = s.anchor().captureNoEffectWitness(); s.mode('outage')
		await expect(s.call('policy')).rejects.toThrow(); expect(s.responses.at(-1)!.status).toBe(503)
		expect(s.anchor().captureNoEffectWitness()).toBe(before)
		expect(s.db().query(`SELECT COUNT(*) AS n FROM demo_fips_${domain.replaceAll('-', '_')}_rpc_journal`).get()).toEqual({ n: 0 })
		s.mode('valid'); await expect(s.call('policy')).resolves.toEqual({ synthetic: 'policy-evidence' })
		await expect(s.call('commit', 'actual-commit')).resolves.toHaveProperty('hiding_hex')
	})
	for (const mode of ['unknown', 'claim-throw', 'rust-throw', 'foreign-category'] as const) {
		test(`G4/G5 ${domain}: ${mode} remains pending/quarantined, never transient 503`, async () => {
			const s = await service(domain); s.mode(mode)
			await expect(s.call('commit')).rejects.toThrow(); expect(s.responses.at(-1)!.status).not.toBe(503)
			expect(s.db().query(`SELECT status FROM demo_fips_${domain.replaceAll('-', '_')}_rpc_journal`).get()).toEqual({ status: 'pending' })
			const count = { ...s.count }; s.mode('valid'); await expect(s.call('commit', 'new')).rejects.toThrow(); expect(s.count).toEqual(count)
			await expect(s.restart()).rejects.toThrow(/QUARANTINED/)
		})
	}
	test(`G3 ${domain}: signed success replay and lost response use no additional Rust callback`, async () => {
		const s = await service(domain); s.lose(); await expect(s.call('commit')).rejects.toThrow()
		const first = await s.responses.at(-1)!.text(); const result = await s.call('commit')
		expect(result).toHaveProperty('hiding_hex'); expect(await s.responses.at(-1)!.text()).toBe(first); expect(s.count.rust).toBe(1)
		await s.restart(); await s.call('commit'); expect(await s.responses.at(-1)!.text()).toBe(first); expect(s.count.rust).toBe(1)
		expect(s.count.revalidation).toBe(domain === 'funding-abort' ? 2 : 0)
	})
}

for (const domain of ['admission', 'funding-abort'] as const) {
	test(`G1/G6 ${domain}: old pending is never converted by a newly failing preflight; unrelated pending blocks replay`, async () => {
		const s = await service(domain); s.mode('refuse'); await expect(s.call('policy', 'rejected')).rejects.toThrow(/422/)
		const calls = { ...s.count }
		await s.journal().claim(H(30), H(31))
		await expect(s.call('policy', 'rejected')).rejects.toThrow(); expect(s.count).toEqual(calls)
		await expect(s.restart()).rejects.toThrow(/QUARANTINED/); await expect(s.call('policy', 'new')).rejects.toThrow(); expect(s.count).toEqual(calls)
		expect(s.db().query(`SELECT status FROM demo_fips_${domain.replaceAll('-', '_')}_rpc_journal WHERE request_id=?`).get(H(30))).toEqual({ status: 'pending' })
	})
	test(`G6 ${domain}: rejection DB-before-anchor crash window never serves cached 422 or adopts new state`, async () => {
		const s = await service(domain); s.mode('refuse'); s.fault('before-anchor')
		await expect(s.call('policy')).rejects.toThrow(); expect(s.responses.at(-1)!.status).not.toBe(422)
		expect(s.db().query(`SELECT status FROM demo_fips_${domain.replaceAll('-', '_')}_rpc_journal`).get()).toEqual({ status: 'rejected_no_effect' })
		expect(() => s.anchor().assertAdmissionJournalCurrent()).toThrow(/QUARANTINED/)
		await expect(s.restart()).rejects.toThrow(/QUARANTINED/)
	})
	test(`G6 ${domain}: revision transaction failure rolls back tombstone and remains fenced`, async () => {
		const s = await service(domain), witness = s.anchor().captureNoEffectWitness()
		s.db().exec("CREATE TEMP TRIGGER fail_revision BEFORE UPDATE ON admission_safety_metadata BEGIN SELECT RAISE(ABORT,'synthetic I/O'); END")
		s.mode('refuse'); await expect(s.call('policy')).rejects.toThrow()
		expect(s.db().query(`SELECT COUNT(*) AS n FROM demo_fips_${domain.replaceAll('-', '_')}_rpc_journal`).get()).toEqual({ n: 0 })
		expect(s.anchor().captureNoEffectWitness()).toBe(witness)
		await expect(s.call('policy', 'new')).rejects.toThrow(); await expect(s.restart()).rejects.toThrow(/QUARANTINED/)
	})
	test(`G3/G6 ${domain}: anchored rejection survives lost 422 response and exact replay after restart`, async () => {
		const s = await service(domain); s.mode('refuse'); s.lose(); await expect(s.call('policy')).rejects.toThrow()
		const bytes = await s.responses[0]!.text(), calls = { ...s.count }
		s.mode('valid'); await s.restart(); await expect(s.call('policy')).rejects.toThrow(/422/)
		expect(await s.responses.at(-1)!.text()).toBe(bytes); expect(s.count).toEqual(calls)
	})
	test(`G5 ${domain}: idempotent proof claim then outage is still effectful even with unchanged business digest`, async () => {
		const s = await service(domain)
		s.anchor().claimAdmissionProofs([{ proofRef: `02${H(66)}`, network: 'synthetic-f1', chainId: 'synthetic-f1', auctionId: 'auction', operationId: 'operation' }])
		const rows = s.db().query('SELECT * FROM fips_admission_proof_claims').all()
		s.mode('claim-throw'); await expect(s.call('policy')).rejects.toThrow(); expect(s.responses.at(-1)!.status).not.toBe(503)
		expect(s.db().query('SELECT * FROM fips_admission_proof_claims').all()).toEqual(rows)
		expect(s.db().query(`SELECT status FROM demo_fips_${domain.replaceAll('-', '_')}_rpc_journal`).get()).toEqual({ status: 'pending' })
	})
}

test('G7 shared gate serializes admission, FundingAbort, terminal and health observations; queue/cancellation bounded', async () => {
	const s = await service('admission'), order: string[] = []
	let release!: () => void
	const held = new Promise<void>((resolve) => { release = resolve })
	const first = s.gate().run(signal(), async () => { order.push('admission-start'); await held; order.push('admission-end') })
	await new Promise((resolve) => setTimeout(resolve, 1))
	const abort = new AbortController()
	const canceled = s.gate().run(abort.signal, async () => { order.push('canceled-effect') }); const canceledAssertion = expect(canceled).rejects.toThrow(/QUEUE/); abort.abort()
	const other = s.gate().run(signal(), async () => { order.push('funding-abort') })
	const terminal = s.gate().run(signal(), async () => { order.push('terminal') })
	const health = s.gate().run(signal(), async () => { s.anchor().captureNoEffectWitness(); order.push('health') })
	const waiting = Array.from({ length: 11 }, () => s.gate().run(signal(), async () => {}))
	await expect(s.gate().run(signal(), async () => { order.push('overflow') })).rejects.toThrow(/QUEUE/)
	release(); await first; await canceledAssertion; await Promise.all([other, terminal, health, ...waiting])
	expect(order).toEqual(['admission-start', 'admission-end', 'funding-abort', 'terminal', 'health'])
	await expect(s.call('commit')).resolves.toHaveProperty('hiding_hex')
})

test('G7 immutable preflight witness rejects another writer advance even when latest anchor is current', async () => {
	const s = await service('admission'); let release!: () => void
	s.wait(new Promise<void>((resolve) => { release = resolve }))
	s.mode('refuse'); const pending = s.call('policy')
	while (s.count.pure === 0) await new Promise((resolve) => setTimeout(resolve, 1))
	s.anchor().claimAdmissionProofs([{ proofRef: `02${H(65)}`, network: 'synthetic-f1', chainId: 'synthetic-f1', auctionId: 'auction', operationId: 'foreign' }])
	s.anchor().assertAdmissionJournalCurrent(); release()
	await expect(pending).rejects.toThrow(); expect(s.db().query('SELECT COUNT(*) AS n FROM demo_fips_admission_rpc_journal').get()).toEqual({ n: 0 })
	await expect(s.call('policy', 'new')).rejects.toThrow()
})

test('G7 exclusive process lease and stale process fencing survive replacement', async () => {
	const s = await service('admission'), old = s.gate()
	expect(() => createDemoSignerSerialization({ leasePath: join(s.root, 'service.lock'), quarantinePath: join(s.root, 'service.quarantine'), assertCurrent() {} })).toThrow(/another signer/)
	const modulePath = new URL('./demo-signer-serialization.ts', import.meta.url).pathname
	const childCode = `import { createDemoSignerSerialization } from ${JSON.stringify(modulePath)}; try { createDemoSignerSerialization({ leasePath:${JSON.stringify(join(s.root, 'service.lock'))}, quarantinePath:${JSON.stringify(join(s.root, 'service.quarantine'))}, assertCurrent(){} }); process.exit(0) } catch { process.exit(17) }`
	const child = Bun.spawn([process.execPath, '-e', childCode], { stdout: 'ignore', stderr: 'ignore' })
	expect(await child.exited).toBe(17)

	await s.restart()
	await expect(old.run(signal(), async () => true)).rejects.toThrow()
	await expect(s.call('commit')).resolves.toHaveProperty('hiding_hex')
})

test('G8 old store is rejected header-only before mutation; new tombstone fields are independently anchored', async () => {
	const s = await service('admission'); s.mode('refuse'); await expect(s.call('policy')).rejects.toThrow(/422/)
	const row = s.db().query<{ request_id: string }, []>('SELECT request_id FROM demo_fips_admission_rpc_journal').get()!
	s.db().query('UPDATE demo_fips_admission_rpc_journal SET rejection_body=? WHERE request_id=?').run('{"error":"forged"}', row.request_id)
	expect(() => s.anchor().assertAdmissionJournalCurrent()).toThrow(/QUARANTINED/)
	// Separate standalone legacy SQLite file: rejection must not change its bytes.
	const legacyPath = join(s.state, 'legacy.sqlite3'), legacy = new Database(legacyPath, { create: true })
	legacy.exec("CREATE TABLE old_pending(status TEXT); INSERT INTO old_pending VALUES('pending')"); legacy.close()
	const bytes = await readFile(legacyPath)
	const { assertDemoSignerStoreHeader } = await import('./demo-signer-rpc-journal-v2')
	expect(() => assertDemoSignerStoreHeader(legacyPath)).toThrow(/no migration/)
	expect(() => openDemoDispositionSignerAnchor({ ...s.options, signerMetadataPath: legacyPath })).toThrow(/no migration/)
	expect(await readFile(legacyPath)).toEqual(bytes)
})

test('G8 every rejection reason/status/body/witness byte participates in the safety anchor', async () => {
	for (const field of ['rejection_reason', 'rejection_status', 'rejection_body', 'safety_witness']) {
		const s = await service('admission'); s.mode('refuse'); await expect(s.call('policy')).rejects.toThrow(/422/)
		// CHECK constraints protect status. Disable checks only in this disposable tamper test.
		s.db().exec('PRAGMA ignore_check_constraints=ON')
		s.db().query(`UPDATE demo_fips_admission_rpc_journal SET ${field}=?`).run(field === 'rejection_status' ? 421 : 'mutated')
		expect(() => s.anchor().assertAdmissionJournalCurrent()).toThrow(/QUARANTINED/)
	}
})

test('G8 rejection growth is measured; duplicates do not grow state; fixed retention ceiling fails closed', async () => {
	const s = await service('admission'); s.mode('refuse')
	const page = () => Number((s.db().query('PRAGMA page_count').get() as { page_count: number }).page_count) * Number((s.db().query('PRAGMA page_size').get() as { page_size: number }).page_size)
	const before = page()
	for (let i = 0; i < 40; i++) await expect(s.call('policy', `reject-${i}`)).rejects.toThrow(/422/)
	const after = page(), count = s.count.pure
	for (let i = 0; i < 40; i++) await expect(s.call('policy', `reject-${i}`)).rejects.toThrow(/422/)
	expect(s.count.pure).toBe(count); expect(page()).toBe(after)
	expect(s.db().query('SELECT COUNT(*) AS n FROM demo_fips_admission_rpc_journal').get()).toEqual({ n: 40 })
	// Witness storage is bounded at 8192 bytes; this is an empirical fixture measure.
	expect(after - before).toBeLessThan(400000)
	console.log(JSON.stringify({ resourceFixture: '40-terminal-refusals', beforeBytes: before, afterBytes: after, growthBytes: after - before, duplicateGrowthBytes: page() - after }))
	const { DEMO_SIGNER_MAX_JOURNAL_ROWS } = await import('./demo-signer-rpc-journal-v2')
	expect(DEMO_SIGNER_MAX_JOURNAL_ROWS).toBe(10000)
	// Seed a bounded full-store fixture, then anchor it explicitly. This is test
	// setup, never a production reconciliation/cleanup mechanism.
	s.db().transaction(() => {
		const insert = s.db().query("INSERT INTO demo_fips_admission_rpc_journal(request_id,request_digest,status,response_json) VALUES(?,?,'complete','{}')")
		for (let i = 40; i < DEMO_SIGNER_MAX_JOURNAL_ROWS; i++) insert.run(i.toString(16).padStart(64, '0'), H(71))
		s.db().exec('UPDATE admission_safety_metadata SET revision=revision+1 WHERE id=1')
	}).immediate()
	s.anchor().recordAdmissionJournalAdvance()
	await expect(s.call('policy', 'reject-0')).rejects.toThrow(/422/) // existing replay still works at capacity
	await expect(s.call('policy', 'one-more')).rejects.toThrow()
	expect(s.db().query('SELECT COUNT(*) AS n FROM demo_fips_admission_rpc_journal').get()).toEqual({ n: 10000 })
	await expect(s.call('commit', 'new')).rejects.toThrow()

})


test('G8 old signer anchor code cannot silently accept new V2 metadata; no automatic downgrade', async () => {
	const s = await service('admission')
	const legacyPath = process.env.COCO_SIGNER_LEGACY_ANCHOR
	if (!legacyPath) throw new Error('explicit COCO_SIGNER_LEGACY_ANCHOR required for downgrade test')
	const legacy = await import(legacyPath)
	const metadata = new Database(s.options.signerMetadataPath, { readonly: true })
	const before = metadata.query('SELECT * FROM disposition_signer_metadata').all()
	expect(() => legacy.openDemoDispositionSignerAnchor(s.options)).toThrow(/identity changed/)
	expect(metadata.query('SELECT * FROM disposition_signer_metadata').all()).toEqual(before)
	metadata.close()
	s.anchor().captureNoEffectWitness()
})


for (const domain of ['admission', 'funding-abort'] as const) {
	test(`G8 ${domain}: forged unsigned error remains opaque; exact signed success recovery does not repeat Rust`, async () => {
		const s = await service(domain), before = s.anchor().captureNoEffectWitness()
		s.substitute(new Response('{"error":"NO_EFFECT release allowed"}', { status: 422 }))
		await expect(s.call('commit')).rejects.toThrow(/422/)
		expect(s.count.rust).toBe(0); expect(s.count.pure).toBe(0); expect(s.anchor().captureNoEffectWitness()).toBe(before)
		s.substitute(); const success = await s.call('commit'); expect(s.count.rust).toBe(1)
		s.substitute(new Response('{"error":"cached rejection"}', { status: 422 })); await expect(s.call('commit')).rejects.toThrow(/422/)
		s.substitute(); expect(await s.call('commit')).toEqual(success); expect(s.count.rust).toBe(1)
	})
}


for (const domain of ['admission', 'funding-abort'] as const) {
	for (const fault of ['before-anchor', 'before-effect', 'complete-before-anchor'] as const) {
		test(`G6 ${domain}: ${fault} pending/success durable boundary remains uncertain`, async () => {
			const s = await service(domain); s.fault(fault)
			await expect(s.call('commit')).rejects.toThrow(); expect(s.responses.at(-1)!.status).not.toBe(503)
			const rows = s.db().query<{ status: string }, []>(`SELECT status FROM demo_fips_${domain.replaceAll('-', '_')}_rpc_journal`).all()
			expect(rows).toEqual([{ status: fault === 'complete-before-anchor' ? 'complete' : 'pending' }])
			if (fault === 'before-anchor' || fault === 'before-effect') expect(s.count.rust).toBe(0)
			const count = { ...s.count }; await expect(s.call('commit', 'new')).rejects.toThrow(); expect(s.count).toEqual(count)
			await expect(s.restart()).rejects.toThrow(/QUARANTINED/)
		})
	}
	for (const mode of ['rust-consuming', 'rust-consumed'] as const) {
		test(`G6 ${domain}: actual share plus ${mode} crash snapshot leaves RPC pending and T2 blocked`, async () => {
			const s = await service(domain), local = await s.call('commit')
			const commitments = [local, await s.commit(2), await s.commit(3)]
			s.mode(mode); await expect(s.call('share', 'first-share', commitments)).rejects.toThrow()
			expect(s.responses.at(-1)!.status).not.toBe(503)
			expect(s.db().query(`SELECT status FROM demo_fips_${domain.replaceAll('-', '_')}_rpc_journal WHERE status='pending'`).get()).toEqual({ status: 'pending' })
			expect(() => s.anchor().assertRustStateCurrent()).toThrow(/QUARANTINED/)
			const bytes = await readFile(s.journalPath()), count = s.count.rust
			const t2 = structuredClone(commitments); t2[2].binding_hex = t2[1].binding_hex
			await expect(s.call('share', 'changed-T2', t2)).rejects.toThrow(); expect(s.count.rust).toBe(count)
			expect(await readFile(s.journalPath())).toEqual(bytes); await expect(s.restart()).rejects.toThrow(/QUARANTINED/)
		})
	}
}


test('G3/G4 FundingAbort success revalidation remains read-only; outages/refusals do not rewrite terminal success', async () => {
	const s = await service('funding-abort'), result = await s.call('commit')
	const saved = await s.responses.at(-1)!.text()
	for (const mode of ['outage', 'refuse'] as const) {
		s.replayMode(mode); await expect(s.call('commit')).rejects.toThrow()
		expect(s.responses.at(-1)!.status).toBe(mode === 'outage' ? 503 : 422)
		expect(s.db().query('SELECT status FROM demo_fips_funding_abort_rpc_journal').get()).toEqual({ status: 'complete' })
		expect(s.count.rust).toBe(1)
	}
	s.replayMode('valid'); expect(await s.call('commit')).toEqual(result); expect(await s.responses.at(-1)!.text()).toBe(saved)
	s.replayMode('unknown'); await expect(s.call('commit')).rejects.toThrow(); await expect(s.restart()).rejects.toThrow(/QUARANTINED/)
})


for (const domain of ['admission', 'funding-abort'] as const) {
	test(`G3 ${domain}: actual Rust share success and exact lost-response/restart replay preserve nonce erasure`, async () => {
		const s = await service(domain), local = await s.call('commit')
		const commitments = [local, await s.commit(2), await s.commit(3)]
		s.lose(); await expect(s.call('share', 'exact-share', commitments)).rejects.toThrow()
		const bytes = await s.responses.at(-1)!.text(), share = await s.call('share', 'exact-share', commitments)
		expect(await s.responses.at(-1)!.text()).toBe(bytes); expect(share.share_hex).toMatch(/^[0-9a-f]{64}$/)
		expect(s.count.rust).toBe(2)
		const journal = await json<{ state: string; nonces_hex: unknown; share_hex: string }>(s.journalPath())
		expect(journal.state).toBe('CONSUMED'); expect(journal.nonces_hex).toBeNull(); expect(journal.share_hex).toBe(share.share_hex)
		await s.restart(); expect(await s.call('share', 'exact-share', commitments)).toEqual(share)
		expect(await s.responses.at(-1)!.text()).toBe(bytes); expect(s.count.rust).toBe(2)
	})
}


test('G6/G7 exact transition proof refuses a foreign row or extra revision instead of adopting it', async () => {
	for (const mutation of ['foreign-row', 'extra-revision']) {
		const s = await service('admission'); s.mode('refuse')
		// TEMP trigger models an unexpected writer during the owned transaction;
		// it is not part of production schema or a reconciliation path.
		s.db().exec(mutation === 'foreign-row'
			? `CREATE TEMP TRIGGER foreign_insert AFTER INSERT ON demo_fips_admission_rpc_journal BEGIN INSERT INTO demo_fips_funding_abort_rpc_journal(request_id,request_digest,status,response_json) VALUES('${H(93)}','${H(94)}','complete','{}'); END`
			: 'CREATE TEMP TRIGGER extra_revision AFTER INSERT ON demo_fips_admission_rpc_journal BEGIN UPDATE admission_safety_metadata SET revision=revision+1 WHERE id=1; END')
		await expect(s.call('policy')).rejects.toThrow(); expect(s.responses.at(-1)!.status).not.toBe(503)
		expect(() => s.anchor().assertAdmissionJournalCurrent()).toThrow(/QUARANTINED/)
		await expect(s.restart()).rejects.toThrow(/QUARANTINED/)
	}
})


test('G4/G6 safety-store read error before any row is persistently fenced, never a transient 503', async () => {
	const s = await service('admission'); s.fault('entry-read')
	await expect(s.call('commit')).rejects.toThrow(); expect(s.responses.at(-1)!.status).not.toBe(503)
	expect(s.count.pure).toBe(0); expect(s.count.rust).toBe(0)
	expect(s.db().query('SELECT COUNT(*) AS n FROM demo_fips_admission_rpc_journal').get()).toEqual({ n: 0 })
	s.fault('none'); await expect(s.call('commit')).rejects.toThrow(); await expect(s.restart()).rejects.toThrow(/QUARANTINED/)
})
