#!/usr/bin/env bun
import { isSeparatedApplication } from './demo-friday-runtime-config'
import {
	SEPARATED_EXECUTOR_BINARY, SEPARATED_R10_EXECUTOR_BINARY, SEPARATED_R33_EXECUTOR_BINARY,
	SEPARATED_R34_EXECUTOR_BINARY, SEPARATED_R35_EXECUTOR_BINARY,
	SEPARATED_SUCCESSOR_EXECUTOR_BINARY,
} from './demo-friday-separated-constants'
import { loadSeparatedServiceBinding } from './demo-friday-separated-service'
/**
 * Persistent, non-networked Friday terminal worker.
 *
 * There is intentionally no public enqueue CLI. A separately authenticated
 * consensus/authority adapter owns insertion into DemoFridayCoordinatorSqlite.
 * This process only drains those durable identities through an exact child
 * protocol. It never accepts bearer proofs and never repeats a payment after
 * a child crash without exact recovery first.
 */
import { Database } from 'bun:sqlite'
import { mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DEMO_FRIDAY_R20_TERMINAL_EXECUTOR_BINARY } from './demo-friday-r20-path-contract'

import {
	createDemoFridayCoordinatorWorker, DemoFridayCoordinatorSqlite,
	type DemoFridayCoordinatorPorts, type DemoFridayCoordinatorRecordV2,
	type DemoFridayExecutionOutcome, type DemoFridayImportOutcome, type DemoFridayRecoveryOutcome,
} from './demo-friday-coordinator-runtime'
import { DemoFridayCoordinatorRollbackAnchorSqlite } from './demo-friday-coordinator-rollback-anchor'
import {
	exactDemoFridayApplication, exactDemoFridayApplicationInputPath,
	exactDemoFridayCoordinatorAnchorPath, exactDemoFridayStatePath,
} from './demo-friday-runtime-config'
import {
	demoFridayR20ServicePins, loadDemoFridayR20ServiceBinding,
	type DemoFridayR20ServicePins,
} from './demo-friday-r20-service-binding'

const MAX_OUTPUT_BYTES = 64 * 1024
const LOOP_DELAY_MS = 1_000
const HEX_32 = /^[0-9a-f]{64}$/
const PROCESS_LEASE = '/run/plebeian-friday-coordinator/active'

type ServeArgs = {
	mode: 'serve'; application: string; database: string; rollbackAnchorDatabase: string; executor: string
}
type InitAnchorArgs = {
	mode: 'init-anchor'; application: string; database: string; rollbackAnchorDatabase: string
}

export interface DemoFridayProcessLease {
	releaseExact(): Promise<void>
}

/** Atomic cross-process lease. A stale directory is never guessed or removed. */
export async function acquireDemoFridayProcessLease(path = PROCESS_LEASE): Promise<DemoFridayProcessLease> {
	if (!path.startsWith('/') || path === '/' || path.endsWith('/') || path.includes('//')) {
		throw new Error('DEMO_FRIDAY_COORDINATOR_LEASE: path is invalid')
	}
	const owner = JSON.stringify({ schema: 'PLEBEIAN_FRIDAY_COORDINATOR_PROCESS_LEASE_V1', pid: process.pid })
	try { await mkdir(path, { mode: 0o700 }) }
	catch { throw new Error('DEMO_FRIDAY_COORDINATOR_LEASE: another process owns or stranded the fixed lease') }
	try { await writeFile(`${path}/owner.json`, `${owner}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' }) }
	catch (error) {
		try { await rmdir(path) } catch { /* preserve anything not proven empty */ }
		throw error
	}
	let released = false
	return Object.freeze({
		async releaseExact() {
			if (released) return
			if ((await readFile(`${path}/owner.json`, 'utf8')) !== `${owner}\n`) {
				throw new Error('DEMO_FRIDAY_COORDINATOR_LEASE: owner identity changed; refusing cleanup')
			}
			await unlink(`${path}/owner.json`); await rmdir(path); released = true
		},
	})
}
export interface DemoFridayExecutorIdentityV2 {
	schema: 'PLEBEIAN_FRIDAY_EXECUTOR_IDENTITY_V2'
	deploymentId: string
	scope: string
	authorityOperationId: string
	paymentOperationId: string
	recipientActorId: string
	operationRoot: string
	frostOperationRoot: string
	bundleDigest: string
	branch: 'outbid_return' | 'rejected_return' | 'funding_abort_return' | 'winner_payout' | 'reserve_unmet_return'
	chainId: string
	executionBindingDigest: string
	preparedAuthorizationDigest: string
	selectionRoot: string
	outcomeHeight: number
}

function executable(value: string): string {
	const legacy = value.startsWith('/opt/plebeian-auctions-friday/bin/')
	const r20 = value === DEMO_FRIDAY_R20_TERMINAL_EXECUTOR_BINARY
	const separated = value === SEPARATED_EXECUTOR_BINARY || value === SEPARATED_SUCCESSOR_EXECUTOR_BINARY
		|| value === SEPARATED_R10_EXECUTOR_BINARY || value === SEPARATED_R33_EXECUTOR_BINARY
		|| value === SEPARATED_R34_EXECUTOR_BINARY || value === SEPARATED_R35_EXECUTOR_BINARY
	if ((!legacy && !r20 && !separated) || resolve(value) !== value || value.endsWith('/') || value.includes('//')) {
		throw new Error('DEMO_FRIDAY_COORDINATOR_CLI: executor must be a canonical Friday binary path')
	}
	return value
}

export function demoFridayCoordinatorArgs(argv = process.argv.slice(2)): ServeArgs | InitAnchorArgs {
	if (argv[0] === 'serve' && argv.length === 9 && argv[1] === '--application' && argv[3] === '--database'
		&& argv[5] === '--rollback-anchor-database' && argv[7] === '--executor-binary') {
		return {
			mode: 'serve', application: exactDemoFridayApplicationInputPath(argv[2]!), database: argv[4]!,
			rollbackAnchorDatabase: argv[6]!, executor: executable(argv[8]!),
		}
	}
	if (argv[0] === 'init-anchor' && argv.length === 7 && argv[1] === '--application' && argv[3] === '--database'
		&& argv[5] === '--rollback-anchor-database') {
		return {
			mode: 'init-anchor', application: exactDemoFridayApplicationInputPath(argv[2]!), database: argv[4]!,
			rollbackAnchorDatabase: argv[6]!,
		}
	}
	throw new Error('usage: plebeian-friday-coordinator serve|init-anchor --application PATH --database PATH --rollback-anchor-database PATH [--executor-binary PATH]')
}

function exactKeys(value: object, expected: string[]): void {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
		throw new Error('DEMO_FRIDAY_COORDINATOR_CHILD: response has missing or unexpected fields')
	}
}

export function demoFridayExecutorIdentity(record: Readonly<DemoFridayCoordinatorRecordV2>): DemoFridayExecutorIdentityV2 {
	return {
		schema: 'PLEBEIAN_FRIDAY_EXECUTOR_IDENTITY_V2', deploymentId: record.deploymentId,
		scope: record.scope, authorityOperationId: record.authorityOperationId,
		paymentOperationId: record.paymentOperationId, recipientActorId: record.recipientActorId,
		operationRoot: record.operationRoot,
		frostOperationRoot: record.frostOperationRoot,
		bundleDigest: record.bundleDigest, branch: record.branch, chainId: record.chainId,
		executionBindingDigest: record.executionBindingDigest,
		preparedAuthorizationDigest: record.preparedAuthorizationDigest,
		selectionRoot: record.selectionRoot, outcomeHeight: record.outcomeHeight,
	}
}

function exactIdentity(value: unknown, expected: DemoFridayExecutorIdentityV2): void {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('DEMO_FRIDAY_COORDINATOR_CHILD: identity is not an object')
	exactKeys(value, ['schema', 'deploymentId', 'scope', 'authorityOperationId', 'paymentOperationId', 'recipientActorId', 'operationRoot', 'frostOperationRoot', 'bundleDigest', 'branch', 'chainId', 'executionBindingDigest', 'preparedAuthorizationDigest', 'selectionRoot', 'outcomeHeight'])
	const actual = value as Record<string, unknown>
	if (Object.entries(expected).some(([key, expectedValue]) => actual[key] !== expectedValue)) {
		throw new Error('DEMO_FRIDAY_COORDINATOR_CHILD: executor identity differs from durable operation')
	}
}

function outcomeDigest(value: unknown, label: string): void {
	if (typeof value !== 'string' || !HEX_32.test(value)) throw new Error(`DEMO_FRIDAY_COORDINATOR_CHILD: ${label} is not a digest`)
}

export function exactDemoFridayExecutorResult(
	mode: 'execute' | 'recover' | 'import', value: unknown, expectedIdentity: DemoFridayExecutorIdentityV2,
): DemoFridayExecutionOutcome | DemoFridayRecoveryOutcome | DemoFridayImportOutcome {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('DEMO_FRIDAY_COORDINATOR_CHILD: response is not an object')
	const envelope = value as Record<string, unknown>
	exactKeys(envelope, ['schema', 'identity', 'outcome'])
	if (envelope.schema !== 'PLEBEIAN_FRIDAY_EXECUTOR_RESULT_V1') throw new Error('DEMO_FRIDAY_COORDINATOR_CHILD: response schema differs')
	exactIdentity(envelope.identity, expectedIdentity)
	if (envelope.outcome === null || typeof envelope.outcome !== 'object' || Array.isArray(envelope.outcome)) {
		throw new Error('DEMO_FRIDAY_COORDINATOR_CHILD: outcome is not an object')
	}
	const raw = envelope.outcome as Record<string, unknown>
	if (mode === 'execute') {
		if (raw.status === 'mint_unknown') exactKeys(raw, ['status', 'requestDigest'])
		else if (raw.status === 'recipient_pending') exactKeys(raw, ['status', 'requestDigest', 'terminalResponseDigest'])
		else if (raw.status === 'completed') exactKeys(raw, ['status', 'requestDigest', 'terminalResponseDigest', 'recipientImportDigest'])
		else throw new Error('DEMO_FRIDAY_COORDINATOR_CHILD: unsupported execution status')
		outcomeDigest(raw.requestDigest, 'requestDigest')
		if (raw.status !== 'mint_unknown') outcomeDigest(raw.terminalResponseDigest, 'terminalResponseDigest')
		if (raw.status === 'completed') outcomeDigest(raw.recipientImportDigest, 'recipientImportDigest')
		return structuredClone(raw) as DemoFridayExecutionOutcome
	}
	if (mode === 'recover') {
		if (raw.status === 'indeterminate' || raw.status === 'retry_ready') exactKeys(raw, ['status'])
		else if (raw.status === 'recipient_pending') {
			exactKeys(raw, ['status', 'terminalResponseDigest']); outcomeDigest(raw.terminalResponseDigest, 'terminalResponseDigest')
		} else throw new Error('DEMO_FRIDAY_COORDINATOR_CHILD: unsupported recovery status')
		return structuredClone(raw) as DemoFridayRecoveryOutcome
	}
	if (raw.status === 'recipient_pending') exactKeys(raw, ['status'])
	else if (raw.status === 'completed') {
		exactKeys(raw, ['status', 'recipientImportDigest']); outcomeDigest(raw.recipientImportDigest, 'recipientImportDigest')
	} else throw new Error('DEMO_FRIDAY_COORDINATOR_CHILD: unsupported import status')
	return structuredClone(raw) as DemoFridayImportOutcome
}

async function boundedBytes(stream: ReadableStream<Uint8Array>, stop: () => void): Promise<Uint8Array> {
	const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0
	try {
		for (;;) {
			const next = await reader.read(); if (next.done) break
			size += next.value.byteLength
			if (size > MAX_OUTPUT_BYTES) { stop(); throw new Error('DEMO_FRIDAY_COORDINATOR_CHILD: executor output exceeded bound') }
			chunks.push(next.value)
		}
	} finally { reader.releaseLock() }
	const output = new Uint8Array(size); let offset = 0
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
	return output
}

export function demoFridayManifestDigestPin(value: string | undefined): string {
	if (value === undefined || !/^[0-9a-f]{64}$/.test(value)) {
		throw new Error('DEMO_FRIDAY_COORDINATOR_CONFIG: FRIDAY_DKG_MANIFEST_DIGEST is not an exact pin')
	}
	return value
}

function createChildPorts(options: {
	application: string
	executor: string
	v2ManifestDigest?: string
	r20Pins?: DemoFridayR20ServicePins
 separated?: boolean
}): DemoFridayCoordinatorPorts {
	async function run(
		mode: 'execute' | 'recover' | 'import', record: Readonly<DemoFridayCoordinatorRecordV2>, signal?: AbortSignal,
	): Promise<ReturnType<typeof exactDemoFridayExecutorResult>> {
		const identity = demoFridayExecutorIdentity(record)
		const command = ['/usr/bin/timeout', '--signal=TERM', '--kill-after=5s', '30s', options.executor, mode,
			'--application', options.application, '--deployment-id', identity.deploymentId, '--scope', identity.scope,
			'--authority-operation-id', identity.authorityOperationId, '--payment-operation-id', identity.paymentOperationId,
			'--recipient-actor-id', identity.recipientActorId,
			'--operation-root', identity.operationRoot, '--frost-operation-root', identity.frostOperationRoot,
			'--bundle-digest', identity.bundleDigest, '--branch', identity.branch,
			'--chain-id', identity.chainId, '--execution-binding-digest', identity.executionBindingDigest,
			'--prepared-authorization-digest', identity.preparedAuthorizationDigest,
			'--selection-root', identity.selectionRoot,
			'--outcome-height', String(identity.outcomeHeight)]
		const env: Record<string, string> = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TZ: 'UTC' }
		if (options.v2ManifestDigest !== undefined) env.FRIDAY_DKG_MANIFEST_DIGEST = options.v2ManifestDigest
		if (options.r20Pins !== undefined) {
			env.FRIDAY_R20_MANIFEST_BINDING_DIGEST = options.r20Pins.manifestBindingDigest
			env.FRIDAY_R20_RUNTIME_BINDING_DIGEST = options.r20Pins.runtimeBindingDigest
		}
		if (options.separated) {
 for (const name of ['FRIDAY_SEPARATED_BOOTSTRAP_DIGEST','FRIDAY_SEPARATED_RUNTIME_DIGEST','FRIDAY_OWNER_APPROVAL_PUBLIC_KEY',
 'FRIDAY_DEPLOYMENT_ANCHOR_SHA256','FRIDAY_NETWORK_FACTS_SHA256','FRIDAY_OBSERVER_RECEIPT_SHA256','FRIDAY_OBSERVER_NODE_ID','POC_FRIDAY_HEALTH_PINS_SHA256']) {
 const value=process.env[name];if(!value)throw new Error('SEPARATED_EXECUTOR: missing inherited public pin');env[name]=value
 }
 }
		const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe', env })
		const stop = (): void => { try { child.kill() } catch { /* already exited */ } }
		const parentAbort = (): void => { stop() }
		if (signal?.aborted) parentAbort(); else signal?.addEventListener('abort', parentAbort, { once: true })
		try {
			const [exit, stdout] = await Promise.all([child.exited, boundedBytes(child.stdout, stop), boundedBytes(child.stderr, stop).then(() => undefined)])
			if (signal?.aborted) throw new Error('DEMO_FRIDAY_COORDINATOR_CHILD: coordinator stopping')
			if (exit !== 0) throw new Error(`DEMO_FRIDAY_COORDINATOR_CHILD: executor ${mode} exited ${exit}`)
			const text = new TextDecoder().decode(stdout)
			if (!text.endsWith('\n') || text.trim().split('\n').length !== 1) throw new Error('DEMO_FRIDAY_COORDINATOR_CHILD: executor did not emit one JSON record')
			return exactDemoFridayExecutorResult(mode, JSON.parse(text), identity)
		} finally { signal?.removeEventListener('abort', parentAbort) }
	}
	return {
		async executeExact(record) { return run('execute', record) as Promise<DemoFridayExecutionOutcome> },
		async recoverExact(record) { return run('recover', record) as Promise<DemoFridayRecoveryOutcome> },
		async importExact(record) { return run('import', record) as Promise<DemoFridayImportOutcome> },
	}
}

async function openRuntime(args: ServeArgs | InitAnchorArgs) {
	const application = exactDemoFridayApplication(JSON.parse(await readFile(args.application, 'utf8')) as unknown)
	if (application.schema !== 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2'
		&& application.schema !== 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3' && !isSeparatedApplication(application)) {
		throw new Error('DEMO_FRIDAY_COORDINATOR_CLI: persistent worker requires a live schema')
	}
	if (isSeparatedApplication(application)) {
	 if (application.role !== 'APPLICATION') throw new Error('SEPARATED_COORDINATOR: app role required')
	 await loadSeparatedServiceBinding({application})
 if(args.mode==='serve' && args.executor!==SEPARATED_EXECUTOR_BINARY
	&& args.executor!==SEPARATED_SUCCESSOR_EXECUTOR_BINARY
	&& args.executor!==SEPARATED_R10_EXECUTOR_BINARY
	&& args.executor!==SEPARATED_R33_EXECUTOR_BINARY
	&& args.executor!==SEPARATED_R34_EXECUTOR_BINARY
	&& args.executor!==SEPARATED_R35_EXECUTOR_BINARY) throw new Error('SEPARATED_COORDINATOR: exact approved executor required')
	}
	if (application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3') {
		await loadDemoFridayR20ServiceBinding({ application, pins: demoFridayR20ServicePins() })
	}
	const databasePath = exactDemoFridayStatePath(application, args.database, 'coordinator database')
	if (!databasePath.startsWith(`${application.coordinator_root}/`)) throw new Error('DEMO_FRIDAY_COORDINATOR_CLI: database is outside coordinator root')
	const anchorPath = exactDemoFridayCoordinatorAnchorPath(application, args.rollbackAnchorDatabase)
	// Serving never creates or silently enrolls state.  The reviewed authority
	// init-state command reserves the shared operations DB and independent
	// anchor before either process may start.  The legacy init-anchor mode is
	// retained only as an explicit create-once path for isolated diagnostics.
	const database = new Database(databasePath, { create: args.mode === 'init-anchor', strict: true })
	const anchorDatabase = new Database(anchorPath, { create: args.mode === 'init-anchor', strict: true })
	return {
		application, database, anchorDatabase,
		store: new DemoFridayCoordinatorSqlite(database, application.deployment_id),
		anchor: new DemoFridayCoordinatorRollbackAnchorSqlite(anchorDatabase, args.mode === 'init-anchor'),
	}
}

async function main(): Promise<void> {
	const args = demoFridayCoordinatorArgs()
 const leaseApp=exactDemoFridayApplication(JSON.parse(await readFile(args.application,'utf8')))
 if(isSeparatedApplication(leaseApp)&&leaseApp.role!=='APPLICATION')throw new Error('SEPARATED_COORDINATOR: app role required before lease')
 const lease = await acquireDemoFridayProcessLease(isSeparatedApplication(leaseApp)?'/run/plebeian-friday-coordinator-separated/active':PROCESS_LEASE)
	try {
		const runtime = await openRuntime(args)
		try {
			if (args.mode === 'init-anchor') {
				runtime.anchor.observeExact(runtime.store.anchorSnapshot())
				process.stdout.write(`${JSON.stringify({ schema: 'PLEBEIAN_FRIDAY_COORDINATOR_ANCHOR_INITIALIZED_V1', deploymentId: runtime.application.deployment_id, storeGeneration: runtime.store.storeGeneration })}\n`)
				return
			}
			runtime.anchor.observeExact(runtime.store.anchorSnapshot())
			const worker = createDemoFridayCoordinatorWorker(runtime.store, createChildPorts(isSeparatedApplication(runtime.application) ? { ...args, separated:true } : runtime.application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3'
				? { ...args, r20Pins: demoFridayR20ServicePins() }
				: { ...args, v2ManifestDigest: demoFridayManifestDigestPin(process.env.FRIDAY_DKG_MANIFEST_DIGEST) }), runtime.anchor)
			worker.recoverStartup()
			const stop = new AbortController()
			for (const name of ['SIGINT', 'SIGTERM'] as const) process.once(name, () => stop.abort())
			while (!stop.signal.aborted) {
				for (const record of runtime.store.listNonterminal()) {
					if (stop.signal.aborted) break
					if (record.phase === 'queued') await worker.runExact(record.scope)
					else if (record.phase === 'mint_unknown' || record.phase === 'recipient_pending') await worker.reconcileExact(record.scope)
				}
				if (!stop.signal.aborted) await Bun.sleep(LOOP_DELAY_MS)
			}
		} finally { runtime.anchorDatabase.close(false); runtime.database.close(false) }
	} finally { await lease.releaseExact() }
}

if (import.meta.main) await main()
