import { describe, expect, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'

import {
	demoSigAllExactRequestDigest,
	demoSigAllResponseDigest,
	reconcileDemoSigAllSwap,
	restoreDemoSigAllTerminalResponse,
	submitDemoSigAllSwap,
	type DemoSigAllRecoveryMintStatePort,
	type DemoSigAllRecoveryRecord,
	type DemoSigAllRecoveryStore,
} from './demo-sigall-recovery'
import { proofPoint, type BlindedSignature } from './nut-client'
import { buildDemoSigAllSecret, type DemoSigAllMintPort, type DemoSigAllSwapRequest } from './demo-sigall-settlement'

const point = (prefix: '02' | '03', byte: string): string => `${prefix}${byte.repeat(64)}`
const digest = (byte: string): string => byte.repeat(64)

function request(root = digest('a')): DemoSigAllSwapRequest {
	const locktime = 2_000_000_000
	return {
		schema: 'COCO_DEMO_SIGALL_SWAP_V1',
		mintUrl: 'https://testnut.example',
		operationId: 'refund-bid-7',
		locktime,
		packageDigest: root,
		cashuSigAllDigest: digest('b'),
		recipientCapabilityDigest: digest('c'),
		mintSeal: {
			mintUrl: 'https://testnut.example',
			mintPublicKey: point('02', '1'),
			serverVersion: 'test/1',
			activeSatKeysetId: 'keyset-1',
			denominationKeyDigest: digest('d'),
			denominationAmounts: [1, 2, 4, 8],
			inputFeePpk: 0,
			nuts: [4, 7, 9, 10, 11],
		},
		inputs: [{
			amount: 8,
			id: 'keyset-1',
			secret: buildDemoSigAllSecret({
				nonce: digest('1'),
				bidderPublicKey: point('02', '2'),
				committeePublicKey: point('03', '6'),
				locktime,
				refundPublicKey: point('02', '7'),
			}),
			C: point('02', '2'),
			witness: 'committee-witness-must-not-persist',
		}],
		outputs: [{ amount: 8, id: 'keyset-1', B_: point('03', '3') }],
	}
}

const signatures = (): BlindedSignature[] => [{ amount: 8, id: 'keyset-1', C_: point('02', '4') }]
const proofY = (secret: string): string => bytesToHex(proofPoint({ secret }).toBytes(true))

function value(root = digest('a')) {
	const exactRequest = request(root)
	return { scope: 'demo\u0000auction-1\u0000refund-bid-7', operationRoot: root, request: exactRequest, proofStateRefs: [proofY(exactRequest.inputs[0]!.secret)] }
}

/** Shared rows model durable storage; reconstructing this wrapper models a new process. */
function durableStore(rows = new Map<string, DemoSigAllRecoveryRecord>()): DemoSigAllRecoveryStore & { rows: Map<string, DemoSigAllRecoveryRecord> } {
	const copy = (record: DemoSigAllRecoveryRecord): DemoSigAllRecoveryRecord => structuredClone(record)
	return {
		rows,
		async createOrGet(record) {
			const held = rows.get(record.scope)
			if (held !== undefined) return { record: copy(held), created: false }
			rows.set(record.scope, copy(record))
			return { record: copy(record), created: true }
		},
		async read(scope) {
			const held = rows.get(scope)
			return held === undefined ? null : copy(held)
		},
		async compareAndSwap(scope, expectedRevision, next) {
			const held = rows.get(scope)
			if (held === undefined || held.revision !== expectedRevision || next.revision !== expectedRevision + 1) return false
			rows.set(scope, copy(next))
			return true
		},
	}
}

describe('durable demo SIG_ALL recovery', () => {
	test('persists exact public recovery material before I/O, but no bearer material', async () => {
		const store = durableStore()
		let observedBeforeIo: DemoSigAllRecoveryRecord | null = null
		const result = await submitDemoSigAllSwap({
			store,
			value: value(),
			mint: {
				async swapExact() {
					observedBeforeIo = await store.read(value().scope)
					return { signatures: signatures() }
				},
			},
			now: () => 100,
		})
		expect(result.status).toBe('submitted')
		expect(observedBeforeIo).toMatchObject({ state: 'attempting', attemptNumber: 1, operationRoot: digest('a') })
		const saved = JSON.stringify(store.rows.get(value().scope))
		expect(saved).toContain(point('03', '3'))
		expect(saved).not.toContain(request().inputs[0]!.secret)
		expect(saved).not.toContain('committee-witness-must-not-persist')
		expect(saved).not.toContain(point('02', '2'))
		expect(saved).not.toContain(point('02', '4'))
		expect(store.rows.get(value().scope)?.terminal?.requestDigest).toBe(demoSigAllExactRequestDigest(request()))
	})

	test('snapshots the exact request and ports before durable-store awaits', async () => {
		const backing = durableStore()
		const mutableValue = value()
		const originalRequestDigest = demoSigAllExactRequestDigest(mutableValue.request)
		let originalMintCalls = 0
		let swappedMintCalls = 0
		let submittedOperation = ''
		let submission: Parameters<typeof submitDemoSigAllSwap>[0]
		submission = {
			value: mutableValue,
			store: {
				async createOrGet(record) {
					mutableValue.request.operationId = 'mutated-operation'
					mutableValue.request.inputs[0]!.secret = 'mutated-secret'
					submission.mint = { async swapExact() { swappedMintCalls += 1; return { signatures: signatures() } } }
					return backing.createOrGet(record)
				},
				read: backing.read.bind(backing),
				compareAndSwap: backing.compareAndSwap.bind(backing),
			},
			mint: {
				async swapExact(exact) {
					originalMintCalls += 1
					submittedOperation = exact.operationId
					expect(exact.inputs[0]!.secret).toBe(request().inputs[0]!.secret)
					return { signatures: signatures() }
				},
			},
		}
		await submitDemoSigAllSwap(submission)
		expect(submittedOperation).toBe('refund-bid-7')
		expect(originalMintCalls).toBe(1)
		expect(swappedMintCalls).toBe(0)
		expect(backing.rows.get(value().scope)?.terminal?.requestDigest).toBe(originalRequestDigest)
	})

	test('detaches a direct mint response before the terminal CAS yields', async () => {
		const backing = durableStore()
		let releaseTerminalCas!: () => void
		let terminalCasEntered!: () => void
		const terminalCasGate = new Promise<void>((resolve) => { releaseTerminalCas = resolve })
		const terminalCasStarted = new Promise<void>((resolve) => { terminalCasEntered = resolve })
		const store: DemoSigAllRecoveryStore = {
			createOrGet: backing.createOrGet.bind(backing),
			read: backing.read.bind(backing),
			async compareAndSwap(scope, expectedRevision, next) {
				if (next.state === 'succeeded') {
					terminalCasEntered()
					await terminalCasGate
				}
				return backing.compareAndSwap(scope, expectedRevision, next)
			},
		}
		const mintOwned: BlindedSignature[] = [{
			...signatures()[0]!,
			dleq: { e: digest('5'), s: digest('6'), r: digest('7') },
		}]
		const expected = structuredClone(mintOwned)
		const pending = submitDemoSigAllSwap({
			store,
			value: value(),
			mint: { async swapExact() { return { signatures: mintOwned } } },
		})
		await terminalCasStarted
		mintOwned[0]!.C_ = point('03', '8')
		mintOwned[0]!.dleq!.e = digest('9')
		mintOwned[0]!.dleq!.s = digest('0')
		mintOwned[0]!.dleq!.r = digest('1')
		releaseTerminalCas()
		const submitted = await pending
		expect(submitted.status).toBe('submitted')
		if (submitted.status !== 'submitted') throw new Error('expected submitted response')
		expect(submitted.signatures).toEqual(expected)
		expect(submitted.signatures).not.toBe(mintOwned)
		expect(submitted.signatures[0]!.dleq).not.toBe(mintOwned[0]!.dleq)
		expect(submitted.terminal.responseDigest).toBe(demoSigAllResponseDigest(submitted.signatures))
		expect(backing.rows.get(value().scope)?.terminal?.responseDigest).toBe(submitted.terminal.responseDigest)
	})

	test('reconstructs over the same durable rows, replays terminal metadata, and never calls mint twice', async () => {
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		let calls = 0
		const mint: DemoSigAllMintPort = { async swapExact() { calls += 1; return { signatures: signatures() } } }
		await submitDemoSigAllSwap({ store: durableStore(rows), mint, value: value() })
		const replay = await submitDemoSigAllSwap({ store: durableStore(rows), mint, value: value() })
		expect(replay.status).toBe('terminal_replay')
		expect(calls).toBe(1)
	})

	test('permanently refuses an alternate root for the same scope across reconstruction', async () => {
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		const failingMint: DemoSigAllMintPort = { async swapExact() { throw new Error('lost response') } }
		await expect(submitDemoSigAllSwap({ store: durableStore(rows), mint: failingMint, value: value() })).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_AMBIGUOUS' })
		await expect(submitDemoSigAllSwap({
			store: durableStore(rows),
			mint: { async swapExact() { return { signatures: signatures() } } },
			value: value(digest('f')),
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_ROOT_CONFLICT' })
	})

	test('the same root can reconcile with a fresh witness over the exact package after reconstruction', async () => {
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		await expect(submitDemoSigAllSwap({
			store: durableStore(rows), value: value(),
			mint: { async swapExact() { throw new Error('lost response') } },
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_AMBIGUOUS' })
		const changed = value()
		changed.request.inputs[0] = { ...changed.request.inputs[0], witness: 'different-witness' }
		expect(demoSigAllExactRequestDigest(changed.request)).toBe(demoSigAllExactRequestDigest(request()))
		const recovered = await reconcileDemoSigAllSwap({
			store: durableStore(rows),
			value: changed,
			recovery: { async reconcileExact() { return { status: 'completed', signatures: signatures() } } },
		})
		expect(recovered.status).toBe('recovered')
	})

	test('the same root cannot substitute different outputs after reconstruction', async () => {
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		await expect(submitDemoSigAllSwap({
			store: durableStore(rows), value: value(),
			mint: { async swapExact() { throw new Error('lost response') } },
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_AMBIGUOUS' })
		const changed = value()
		changed.request.outputs[0] = { ...changed.request.outputs[0], B_: point('02', '5') }
		expect(demoSigAllExactRequestDigest(changed.request)).not.toBe(demoSigAllExactRequestDigest(request()))
		await expect(reconcileDemoSigAllSwap({
			store: durableStore(rows), value: changed,
			recovery: { async reconcileExact() { return { status: 'completed', signatures: signatures() } } },
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_REQUEST_CONFLICT' })
	})

	test('an ambiguous attempt cannot resubmit before exact reconciliation', async () => {
		const store = durableStore()
		let calls = 0
		const mint: DemoSigAllMintPort = { async swapExact() { calls += 1; throw new Error('timeout') } }
		await expect(submitDemoSigAllSwap({ store, mint, value: value() })).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_AMBIGUOUS' })
		await expect(submitDemoSigAllSwap({ store, mint, value: value() })).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_AMBIGUOUS' })
		expect(calls).toBe(1)
	})

	test('crossing the settlement safety cutoff during durable attempt CAS emits zero mint I/O', async () => {
		const backing = durableStore()
		let nowSeconds = request().locktime - 61
		let mintCalls = 0
		const store: DemoSigAllRecoveryStore = {
			createOrGet: backing.createOrGet.bind(backing),
			read: backing.read.bind(backing),
			async compareAndSwap(scope, expectedRevision, next) {
				const changed = await backing.compareAndSwap(scope, expectedRevision, next)
				if (next.state === 'attempting') nowSeconds = request().locktime - 60
				return changed
			},
		}
		await expect(submitDemoSigAllSwap({
			store,
			value: value(),
			nowSeconds: () => nowSeconds,
			mint: { async swapExact() { mintCalls += 1; return { signatures: signatures() } } },
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_CUTOFF' })
		expect(mintCalls).toBe(0)
		expect(backing.rows.get(value().scope)?.state).toBe('retry_ready')
	})

	test('safe reconciliation is persisted separately, then permits exactly one explicit retry', async () => {
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		let calls = 0
		await expect(submitDemoSigAllSwap({
			store: durableStore(rows), value: value(),
			mint: { async swapExact() { calls += 1; throw new Error('timeout') } },
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_AMBIGUOUS' })
		const recovery: DemoSigAllRecoveryMintStatePort = {
			async reconcileExact(query) {
				expect(query.proofStateRefs).toEqual([proofY(request().inputs[0]!.secret)])
				expect(query.blindedOutputs).toEqual(request().outputs)
				return { status: 'safe_to_retry', reconciliationId: 'authoritative-fence-17' }
			},
		}
		const authorized = await reconcileDemoSigAllSwap({ store: durableStore(rows), recovery, value: value() })
		expect(authorized.status).toBe('retry_authorized')
		expect(calls).toBe(1)
		const retried = await submitDemoSigAllSwap({
			store: durableStore(rows), value: value(),
			mint: { async swapExact() { calls += 1; return { signatures: signatures() } } },
		})
		expect(retried.status).toBe('submitted')
		expect(calls).toBe(2)
		expect(rows.get(value().scope)?.attemptNumber).toBe(2)
	})

	test('exact recovery terminalizes the operation without a second spend request', async () => {
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		let calls = 0
		await expect(submitDemoSigAllSwap({
			store: durableStore(rows), value: value(),
			mint: { async swapExact() { calls += 1; throw new Error('response lost after acceptance') } },
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_AMBIGUOUS' })
		const recovered = await reconcileDemoSigAllSwap({
			store: durableStore(rows),
			value: value(),
			recovery: { async reconcileExact() { return { status: 'completed', signatures: signatures() } } },
		})
		expect(recovered.status).toBe('recovered')
		expect(rows.get(value().scope)?.terminal?.source).toBe('exact_recovery')
		const replay = await reconcileDemoSigAllSwap({
			store: durableStore(rows), value: value(),
			recovery: { async reconcileExact() { throw new Error('must not query after terminal') } },
		})
		expect(replay.status).toBe('terminal_replay')
		expect(calls).toBe(1)
	})

	test('rejects reordered proof-state references before persistence or mint I/O', async () => {
		const exact = value()
		exact.request.inputs = [
			{ ...exact.request.inputs[0]!, amount: 4, secret: buildDemoSigAllSecret({ nonce: digest('2'), bidderPublicKey: point('02', '2'), committeePublicKey: point('03', '6'), locktime: exact.request.locktime, refundPublicKey: point('02', '7') }) },
			{ ...exact.request.inputs[0]!, amount: 4, secret: buildDemoSigAllSecret({ nonce: digest('3'), bidderPublicKey: point('02', '2'), committeePublicKey: point('03', '6'), locktime: exact.request.locktime, refundPublicKey: point('02', '7') }), C: point('03', '5') },
		]
		const firstY = proofY(exact.request.inputs[0]!.secret)
		const secondY = proofY(exact.request.inputs[1]!.secret)
		exact.proofStateRefs = [secondY, firstY]
		let storeCalls = 0
		let mintCalls = 0
		const store: DemoSigAllRecoveryStore = {
			async createOrGet(record) { storeCalls += 1; return { record, created: true } },
			async read() { return null },
			async compareAndSwap() { return false },
		}
		await expect(submitDemoSigAllSwap({
			store,
			value: exact,
			mint: { async swapExact() { mintCalls += 1; return { signatures: signatures() } } },
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_STATE_REFS' })
		expect(storeCalls).toBe(0)
		expect(mintCalls).toBe(0)
	})

	test('detaches an exact-recovery response before the terminal CAS yields', async () => {
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		await expect(submitDemoSigAllSwap({
			store: durableStore(rows),
			value: value(),
			mint: { async swapExact() { throw new Error('response lost after acceptance') } },
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_AMBIGUOUS' })
		const backing = durableStore(rows)
		let releaseTerminalCas!: () => void
		let terminalCasEntered!: () => void
		const terminalCasGate = new Promise<void>((resolve) => { releaseTerminalCas = resolve })
		const terminalCasStarted = new Promise<void>((resolve) => { terminalCasEntered = resolve })
		const store: DemoSigAllRecoveryStore = {
			createOrGet: backing.createOrGet.bind(backing),
			read: backing.read.bind(backing),
			async compareAndSwap(scope, expectedRevision, next) {
				if (next.state === 'succeeded') {
					terminalCasEntered()
					await terminalCasGate
				}
				return backing.compareAndSwap(scope, expectedRevision, next)
			},
		}
		const recoveryOwned: BlindedSignature[] = [{
			...signatures()[0]!,
			dleq: { e: digest('5'), s: digest('6'), r: digest('7') },
		}]
		const expected = structuredClone(recoveryOwned)
		const pending = reconcileDemoSigAllSwap({
			store,
			value: value(),
			recovery: { async reconcileExact() { return { status: 'completed', signatures: recoveryOwned } } },
		})
		await terminalCasStarted
		recoveryOwned[0]!.C_ = point('03', '8')
		recoveryOwned[0]!.dleq!.e = digest('9')
		recoveryOwned[0]!.dleq!.s = digest('0')
		recoveryOwned[0]!.dleq!.r = digest('1')
		releaseTerminalCas()
		const recovered = await pending
		expect(recovered.status).toBe('recovered')
		if (recovered.status !== 'recovered') throw new Error('expected recovered response')
		expect(recovered.signatures).toEqual(expected)
		expect(recovered.signatures).not.toBe(recoveryOwned)
		expect(recovered.signatures[0]!.dleq).not.toBe(recoveryOwned[0]!.dleq)
		expect(recovered.terminal.responseDigest).toBe(demoSigAllResponseDigest(recovered.signatures))
		expect(rows.get(value().scope)?.terminal?.responseDigest).toBe(recovered.terminal.responseDigest)
	})

	test('restores an exact terminal response after a delivery crash without resubmitting', async () => {
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		let spendCalls = 0
		await submitDemoSigAllSwap({
			store: durableStore(rows), value: value(),
			mint: { async swapExact() { spendCalls += 1; return { signatures: signatures() } } },
		})
		let restoreCalls = 0
		const restored = await restoreDemoSigAllTerminalResponse({
			store: durableStore(rows), value: value(),
			recovery: {
				async restoreCompleted(query) {
					restoreCalls += 1
					expect(query.operationRoot).toBe(digest('a'))
					return { signatures: signatures() }
				},
			},
		})
		expect(restored).toEqual(signatures())
		expect(spendCalls).toBe(1)
		expect(restoreCalls).toBe(1)
	})

	test('refuses terminal response restoration when the restored response differs', async () => {
		const store = durableStore()
		await submitDemoSigAllSwap({
			store, value: value(), mint: { async swapExact() { return { signatures: signatures() } } },
		})
		await expect(restoreDemoSigAllTerminalResponse({
			store, value: value(),
			recovery: {
				async restoreCompleted() {
					return { signatures: [{ ...signatures()[0], C_: point('03', '5') }] }
				},
			},
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_TERMINAL_CONFLICT' })
	})
})
