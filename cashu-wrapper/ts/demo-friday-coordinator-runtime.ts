/**
 * Durable process-level coordinator journal for the Friday threshold route.
 *
 * This deliberately stores no bearer proofs or recipient openings. Those stay
 * in DemoMaintainerEncryptedSqliteStore and recipient-private journals. The
 * purpose of this journal is to make operation ownership, branch exclusion and
 * uncertain-outcome recovery survive a coordinator restart without ever
 * turning "worker idle" into "paid".
 */
import { Database } from 'bun:sqlite'
import { randomBytes, createHash } from 'node:crypto'

const HEX_32 = /^[0-9a-f]{64}$/
export type DemoFridayTerminalBranch = 'outbid_return' | 'rejected_return' | 'funding_abort_return' | 'winner_payout' | 'reserve_unmet_return'
export type DemoFridayCoordinatorPhase = 'queued' | 'executing' | 'mint_unknown' | 'recipient_pending' | 'completed' | 'quarantined'

/**
 * Historical fake-sats deliveries explicitly preserved outside the fresh MVP
 * acceptance run.  Each digest binds every persisted record field in a fixed
 * order.  A missing or changed record fails closed; only exact matches are
 * removed from the actionable coordinator view.
 */
export const DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_20261108: ReadonlyMap<string, string> = new Map([
	['41b42d475bd2ac9bfb48b18995e58c6a4e8eb9ddcbed1b0795301b9fe59fc887', 'eb41b1fae208ea544751814a4da8c2744a788881a542c5b16b356dc6c70faa2b'],
	['428d439715270d5a15b070b8c9084a4d7cdc8c44b90e28668dc26d7aa80a46cc', 'dabf645756c89e8a480872c00f32d19d1aedd2e5ed2aacdbfbc22b1160d4be7f'],
	['914b84ce2f72f6cbb8c973bb0e8e9a77b68b549228f708b67323b2d087bfdae0', '1efe94faff1c0c98f82de7269812b84b423aa5f078f532c954a752007f104a6b'],
	['ac58122c85c5120c0227f20737183b1602103dde9f901f5411e19502976e0f6b', 'f8390e09c3fcc3a96bcb78edc4fbcc6ea2481e19da89ba1415b2d763b3f88d79'],
	['cea0bac2bbd5f69ce9b42952d9dca1a9c4b6bdb9991af3f56776c85277cd443e', 'd486a5b772e980c23d3ab5dc694860c9328d9b6cf94c475f18159261edda1be9'],
	['e3b0e7b37d3ab34c9f744ae1f5a51d787228c15f5f94e1444977767a293c73bd', '376478e6976d8ca4e99b2d7e78876d4113303484d9585b45ec73095cf8e79b85'],
	['fa7f60db5bd8b13b29190429318ab1400344a96bfb78cfc52cec3b1f429656f4', '25ac3b47f589551ae354a91937079a5ba8f5b82eb5de169d7c511530acc1be2a'],
])

/**
 * Forward-only R48 runtime isolation contract. R47 proved that the eighth
 * record must be excluded by the compiled coordinator and authority, not only
 * by their prestart verifier.
 */
export const DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R48_20261109: ReadonlyMap<string, string> = new Map([
	...DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_20261108,
	['f37f14a3c1e4a529d2915678de3ceab3d3ac1aa246f53ac96023400883c44c6d', 'd055dc91b36891184691bb7cbd1087d8d67080caadf3a7e4b0cdccda09643136'],
])

/** Forward-only R49 contract: identical eight inert records, explicitly versioned. */
export const DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R49_20261109: ReadonlyMap<string, string> = new Map(
	DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R48_20261109,
)

/** Forward-only R50 contract: identical eight inert records, explicitly versioned. */
export const DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R50_20261109: ReadonlyMap<string, string> = new Map(
	DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R49_20261109,
)

/** Forward-only R51 contract: identical eight inert records, explicitly versioned. */
export const DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R51_20261109: ReadonlyMap<string, string> = new Map(
	DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R50_20261109,
)

/**
 * Forward-only R79 isolation contract.  Three later fake-sats deliveries have
 * durable terminal responses but no recipient acknowledgement.  An import
 * attempt for the first record exited before producing a result and stopped
 * the coordinator on 2026-11-13.  Keep all three exact records inert until
 * their original recipient sessions can reconcile them; a missing or changed
 * record still fails closed before any new operation is served.
 */
export const DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R79_20261113: ReadonlyMap<string, string> = new Map([
	...DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R51_20261109,
	['2446fbe5e179a35b2052c009d11d21afe6dd306a6965f49a0ffcc94076ec016b', '1ded66021330161e8d2540c4021557b11932ca14999d1f045933b7070d6adbed'],
	['2c6bd6e0b60622b664a8eea689f3deb770552ea2fe2096b444df615448d263d4', '93745719d6b2c8482abfd653ecac7bb5423e1e4ef6a7156c0c2a89f7f0f15773'],
	['e676e0d6661710807c2a2a8e3f0294092edb7426d900c22fa2c49594970b7dc1', '870f399d035c59110f96902ec90581c014034a0e428ba46e40a999d1d79e25e9'],
])

/**
 * Forward-only R82 contract. R81 acceptance exposed one later exact
 * recipient-pending return whose unavailable original browser made the
 * import child exit before returning a typed outcome. Preserve that exact
 * immutable record alongside the R79 backlog so it cannot terminate the
 * coordinator or block unrelated fresh fake-sats operations. Any field,
 * phase or revision change still fails closed before new work is served.
 */
export const DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R82_20261113: ReadonlyMap<string, string> = new Map([
	...DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_R79_20261113,
	['23d3a1c1f0a62861da4489b98723d110548010739630a0eba826b4c389054ce8', '0ca44c8af4c6a4f051bb02020913ffadb60147cee3df4ced140360c630d2577e'],
])

export interface DemoFridayCoordinatorRecordV2 {
	schema: 'PLEBEIAN_FRIDAY_COORDINATOR_RECORD_V2'
	deploymentId: string
	scope: string
	authorityOperationId: string
	paymentOperationId: string
	recipientActorId: string
	operationRoot: string
	frostOperationRoot: string
	bundleDigest: string
	chainId: string
	executionBindingDigest: string
	preparedAuthorizationDigest: string
	selectionRoot: string
	outcomeHeight: number
	branch: DemoFridayTerminalBranch
	phase: DemoFridayCoordinatorPhase
	revision: number
	attempts: number
	requestDigest?: string
	terminalResponseDigest?: string
	recipientImportDigest?: string
	reasonCode?: string
}

export function demoFridayCoordinatorRecordIdentityDigest(record: Readonly<DemoFridayCoordinatorRecordV2>): string {
	return createHash('sha256').update(JSON.stringify([
		record.schema, record.deploymentId, record.scope, record.authorityOperationId,
		record.paymentOperationId, record.recipientActorId, record.operationRoot,
		record.frostOperationRoot, record.bundleDigest, record.chainId,
		record.executionBindingDigest, record.preparedAuthorizationDigest,
		record.selectionRoot, record.outcomeHeight, record.branch, record.phase,
		record.revision, record.attempts, record.requestDigest ?? null,
		record.terminalResponseDigest ?? null, record.recipientImportDigest ?? null,
		record.reasonCode ?? null,
	])).digest('hex')
}

export function demoFridayActionableNonterminal(
	records: readonly DemoFridayCoordinatorRecordV2[],
	preserved: ReadonlyMap<string, string> = DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING_20261108,
): DemoFridayCoordinatorRecordV2[] {
	const byScope = new Map(records.map((record) => [record.scope, record] as const))
	for (const [scope, expectedDigest] of preserved) {
		const record = byScope.get(scope)
		if (record === undefined || record.phase !== 'recipient_pending'
			|| demoFridayCoordinatorRecordIdentityDigest(record) !== expectedDigest) {
			throw new Error('DEMO_FRIDAY_PRESERVED_RECIPIENT_PENDING: exact historical record differs')
		}
	}
	return records.filter((record) => !preserved.has(record.scope)).map((record) => structuredClone(record))
}

export type DemoFridayExecutionOutcome =
	| { status: 'mint_unknown'; requestDigest: string }
	| { status: 'recipient_pending'; requestDigest: string; terminalResponseDigest: string }
	| { status: 'completed'; requestDigest: string; terminalResponseDigest: string; recipientImportDigest: string }

export type DemoFridayRecoveryOutcome =
	| { status: 'indeterminate' }
	| { status: 'retry_ready' }
	| { status: 'recipient_pending'; terminalResponseDigest: string }

export type DemoFridayImportOutcome =
	| { status: 'recipient_pending' }
	| { status: 'completed'; recipientImportDigest: string }

export interface DemoFridayCoordinatorPorts {
	executeExact(record: Readonly<DemoFridayCoordinatorRecordV2>): Promise<DemoFridayExecutionOutcome>
	recoverExact(record: Readonly<DemoFridayCoordinatorRecordV2>): Promise<DemoFridayRecoveryOutcome>
	importExact(record: Readonly<DemoFridayCoordinatorRecordV2>): Promise<DemoFridayImportOutcome>
}

export interface DemoFridayCoordinatorAnchorSnapshotV1 {
	schema: 'PLEBEIAN_FRIDAY_COORDINATOR_ANCHOR_SNAPSHOT_V1'
	deploymentId: string
	storeGeneration: string
	globalRevision: number
	stateDigest: string
}

export interface DemoFridayCoordinatorRollbackAnchorPort {
	/**
	 * Fail closed on a replaced/regressed store, or durably advance the
	 * independent observation. The anchor must not share a backup boundary
	 * with the coordinator database.
	 */
	observeExact(snapshot: DemoFridayCoordinatorAnchorSnapshotV1): void
}

function exactText(value: string, label: string): void {
	if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value.trim() !== value
		|| /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`DEMO_FRIDAY_COORDINATOR: ${label} is invalid`)
}

function digest(value: string, label: string): void {
	if (!HEX_32.test(value)) throw new Error(`DEMO_FRIDAY_COORDINATOR: ${label} is not a lowercase SHA-256 digest`)
}

function clone<T>(value: T): T { return structuredClone(value) }

function exactRecord(value: unknown, deploymentId: string): DemoFridayCoordinatorRecordV2 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('DEMO_FRIDAY_COORDINATOR_STATE: stored record is not an object')
	const record = value as DemoFridayCoordinatorRecordV2
	const required = ['schema', 'deploymentId', 'scope', 'authorityOperationId', 'paymentOperationId', 'recipientActorId', 'operationRoot', 'frostOperationRoot', 'bundleDigest', 'chainId', 'executionBindingDigest', 'preparedAuthorizationDigest', 'selectionRoot', 'outcomeHeight', 'branch', 'phase', 'revision', 'attempts']
	const optional = ['requestDigest', 'terminalResponseDigest', 'recipientImportDigest', 'reasonCode']
	const keys = Object.keys(record)
	if (required.some((key) => !keys.includes(key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) {
		throw new Error('DEMO_FRIDAY_COORDINATOR_STATE: stored record has missing or unexpected fields')
	}
	if (record.schema !== 'PLEBEIAN_FRIDAY_COORDINATOR_RECORD_V2' || record.deploymentId !== deploymentId
		|| !['outbid_return', 'rejected_return', 'funding_abort_return', 'winner_payout', 'reserve_unmet_return'].includes(record.branch)
		|| !['queued', 'executing', 'mint_unknown', 'recipient_pending', 'completed', 'quarantined'].includes(record.phase)
		|| !Number.isSafeInteger(record.revision) || record.revision < 0 || !Number.isSafeInteger(record.attempts) || record.attempts < 0
		|| !Number.isSafeInteger(record.outcomeHeight) || record.outcomeHeight < 1) {
		throw new Error('DEMO_FRIDAY_COORDINATOR_STATE: stored deployment, schema, branch, phase or counters differ')
	}
	exactText(record.scope, 'stored scope'); exactText(record.chainId, 'stored chainId')
	exactText(record.authorityOperationId, 'stored authorityOperationId'); exactText(record.paymentOperationId, 'stored paymentOperationId')
	if (!HEX_32.test(record.recipientActorId)) throw new Error('DEMO_FRIDAY_COORDINATOR: stored recipientActorId is invalid')
	for (const [label, value] of [
		['operationRoot', record.operationRoot], ['frostOperationRoot', record.frostOperationRoot], ['bundleDigest', record.bundleDigest],
		['executionBindingDigest', record.executionBindingDigest],
		['preparedAuthorizationDigest', record.preparedAuthorizationDigest], ['selectionRoot', record.selectionRoot],
	] as const) digest(value, label)
	for (const [label, value] of [['requestDigest', record.requestDigest], ['terminalResponseDigest', record.terminalResponseDigest], ['recipientImportDigest', record.recipientImportDigest]] as const) {
		if (value !== undefined) digest(value, label)
	}
	if (record.reasonCode !== undefined) exactText(record.reasonCode, 'stored reasonCode')
	if ((record.phase === 'recipient_pending' && record.terminalResponseDigest === undefined)
		|| (record.phase === 'completed' && (record.terminalResponseDigest === undefined || record.recipientImportDigest === undefined))) {
		throw new Error('DEMO_FRIDAY_COORDINATOR_STATE: stored outcome fields do not match phase')
	}
	return clone(record)
}

export class DemoFridayCoordinatorSqlite {
	readonly storeGeneration: string
	constructor(private readonly database: Database, readonly deploymentId: string) {
		exactText(deploymentId, 'deploymentId')
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS friday_coordinator_metadata (
				id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), schema TEXT NOT NULL,
				deployment_id TEXT NOT NULL, store_generation TEXT NOT NULL, global_revision INTEGER NOT NULL
			) STRICT;
			CREATE TABLE IF NOT EXISTS friday_coordinator_operations (
				scope TEXT PRIMARY KEY NOT NULL,
				authority_operation_id TEXT UNIQUE NOT NULL,
				payment_operation_id TEXT UNIQUE NOT NULL,
				operation_root TEXT UNIQUE NOT NULL,
				bundle_digest TEXT UNIQUE NOT NULL,
				prepared_authorization_digest TEXT UNIQUE NOT NULL,
				selection_root TEXT UNIQUE NOT NULL,
				branch TEXT NOT NULL,
				phase TEXT NOT NULL,
				revision INTEGER NOT NULL,
				record_json TEXT NOT NULL
			) STRICT`)
		database.transaction(() => {
			const metadata = database.query<{ schema: string; deployment_id: string; store_generation: string; global_revision: number }, []>(
				'SELECT schema, deployment_id, store_generation, global_revision FROM friday_coordinator_metadata WHERE id = 1',
			).get()
			if (metadata === null) {
				database.query(`INSERT INTO friday_coordinator_metadata
					(id, schema, deployment_id, store_generation, global_revision) VALUES (1, ?, ?, ?, 0)`)
					.run('PLEBEIAN_FRIDAY_COORDINATOR_DB_V3', deploymentId, randomBytes(32).toString('hex'))
			} else if (metadata.schema !== 'PLEBEIAN_FRIDAY_COORDINATOR_DB_V3' || metadata.deployment_id !== deploymentId
				|| !HEX_32.test(metadata.store_generation) || !Number.isSafeInteger(metadata.global_revision) || metadata.global_revision < 0) {
				throw new Error('DEMO_FRIDAY_COORDINATOR_DEPLOYMENT: database belongs to another schema or deployment')
			}
		}).immediate()
		this.storeGeneration = database.query<{ store_generation: string }, []>(
			'SELECT store_generation FROM friday_coordinator_metadata WHERE id = 1',
		).get()!.store_generation
	}

	#advanceGlobalRevision(): void {
		const result = this.database.query(`UPDATE friday_coordinator_metadata
			SET global_revision = global_revision + 1 WHERE id = 1`).run()
		if (result.changes !== 1) throw new Error('DEMO_FRIDAY_COORDINATOR_ANCHOR: metadata revision did not advance')
	}

	anchorSnapshot(): DemoFridayCoordinatorAnchorSnapshotV1 {
		const metadata = this.database.query<{ store_generation: string; global_revision: number }, []>(
			'SELECT store_generation, global_revision FROM friday_coordinator_metadata WHERE id = 1',
		).get()
		if (metadata === null || metadata.store_generation !== this.storeGeneration
			|| !Number.isSafeInteger(metadata.global_revision) || metadata.global_revision < 0) {
			throw new Error('DEMO_FRIDAY_COORDINATOR_ANCHOR: store metadata changed')
		}
		const rows = this.database.query<{ record_json: string }, []>(
			'SELECT record_json FROM friday_coordinator_operations ORDER BY scope',
		).all().map((row) => exactRecord(JSON.parse(row.record_json) as unknown, this.deploymentId))
		const stateDigest = createHash('sha256').update(JSON.stringify([
			'PLEBEIAN_FRIDAY_COORDINATOR_STATE_V1', this.deploymentId,
			metadata.store_generation, metadata.global_revision, rows,
		])).digest('hex')
		return {
			schema: 'PLEBEIAN_FRIDAY_COORDINATOR_ANCHOR_SNAPSHOT_V1', deploymentId: this.deploymentId,
			storeGeneration: metadata.store_generation, globalRevision: metadata.global_revision, stateDigest,
		}
	}

	#read(scope: string): DemoFridayCoordinatorRecordV2 | null {
		const row = this.database.query<{ record_json: string }, [string]>(
			'SELECT record_json FROM friday_coordinator_operations WHERE scope = ?',
		).get(scope)
		return row === null ? null : exactRecord(JSON.parse(row.record_json) as unknown, this.deploymentId)
	}

	#replace(record: DemoFridayCoordinatorRecordV2, priorRevision: number): void {
		const result = this.database.query(`UPDATE friday_coordinator_operations
			SET phase = ?, revision = ?, record_json = ?
			WHERE scope = ? AND operation_root = ? AND bundle_digest = ? AND revision = ?`).run(
			record.phase, record.revision, JSON.stringify(record), record.scope,
			record.operationRoot, record.bundleDigest, priorRevision,
		)
		if (result.changes !== 1) throw new Error('DEMO_FRIDAY_COORDINATOR_CAS: operation changed concurrently')
	}

	enqueueAuthorized(input: {
		scope: string; authorityOperationId: string; paymentOperationId: string
		recipientActorId: string
		operationRoot: string; frostOperationRoot: string; bundleDigest: string; branch: DemoFridayTerminalBranch
		chainId: string; executionBindingDigest: string; preparedAuthorizationDigest: string
		selectionRoot: string; outcomeHeight: number
	}): DemoFridayCoordinatorRecordV2 {
		exactText(input.scope, 'scope'); exactText(input.chainId, 'chainId')
		exactText(input.authorityOperationId, 'authorityOperationId'); exactText(input.paymentOperationId, 'paymentOperationId')
		if (!HEX_32.test(input.recipientActorId)) throw new Error('DEMO_FRIDAY_COORDINATOR: recipientActorId is invalid')
		digest(input.operationRoot, 'operationRoot'); digest(input.frostOperationRoot, 'frostOperationRoot'); digest(input.bundleDigest, 'bundleDigest')
		digest(input.executionBindingDigest, 'executionBindingDigest')
		digest(input.preparedAuthorizationDigest, 'preparedAuthorizationDigest'); digest(input.selectionRoot, 'selectionRoot')
		if (!Number.isSafeInteger(input.outcomeHeight) || input.outcomeHeight < 1) throw new Error('DEMO_FRIDAY_COORDINATOR: outcomeHeight is invalid')
		if (!['outbid_return', 'rejected_return', 'funding_abort_return', 'winner_payout', 'reserve_unmet_return'].includes(input.branch)) {
			throw new Error('DEMO_FRIDAY_COORDINATOR: unsupported terminal branch')
		}
		return this.database.transaction(() => {
			const prior = this.#read(input.scope)
			if (prior !== null) {
				if (prior.authorityOperationId !== input.authorityOperationId || prior.paymentOperationId !== input.paymentOperationId
					|| prior.recipientActorId !== input.recipientActorId
					|| prior.operationRoot !== input.operationRoot || prior.frostOperationRoot !== input.frostOperationRoot
					|| prior.bundleDigest !== input.bundleDigest || prior.branch !== input.branch
					|| prior.chainId !== input.chainId || prior.executionBindingDigest !== input.executionBindingDigest
					|| prior.preparedAuthorizationDigest !== input.preparedAuthorizationDigest || prior.selectionRoot !== input.selectionRoot
					|| prior.outcomeHeight !== input.outcomeHeight) {
					throw new Error('DEMO_FRIDAY_COORDINATOR_CONFLICT: scope already owns another branch or operation')
				}
				return clone(prior)
			}
			const record: DemoFridayCoordinatorRecordV2 = {
				schema: 'PLEBEIAN_FRIDAY_COORDINATOR_RECORD_V2', deploymentId: this.deploymentId,
				scope: input.scope, authorityOperationId: input.authorityOperationId,
				paymentOperationId: input.paymentOperationId, recipientActorId: input.recipientActorId,
				operationRoot: input.operationRoot,
				frostOperationRoot: input.frostOperationRoot,
				bundleDigest: input.bundleDigest, chainId: input.chainId,
				executionBindingDigest: input.executionBindingDigest,
				preparedAuthorizationDigest: input.preparedAuthorizationDigest, selectionRoot: input.selectionRoot,
				outcomeHeight: input.outcomeHeight,
				branch: input.branch, phase: 'queued', revision: 0, attempts: 0,
			}
			this.database.query(`INSERT INTO friday_coordinator_operations
				(scope, authority_operation_id, payment_operation_id, operation_root, bundle_digest,
				 prepared_authorization_digest, selection_root, branch, phase, revision, record_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
				record.scope, record.authorityOperationId, record.paymentOperationId, record.operationRoot,
				record.bundleDigest, record.preparedAuthorizationDigest, record.selectionRoot,
				record.branch, record.phase, record.revision, JSON.stringify(record),
			)
			this.#advanceGlobalRevision()
			return clone(record)
		}).immediate()
	}

	read(scope: string): DemoFridayCoordinatorRecordV2 | null { const value = this.#read(scope); return value === null ? null : clone(value) }

	listNonterminal(): DemoFridayCoordinatorRecordV2[] {
		return this.database.query<{ record_json: string }, []>(`SELECT record_json FROM friday_coordinator_operations
			WHERE phase != 'completed' ORDER BY scope`).all().map((row) => exactRecord(JSON.parse(row.record_json) as unknown, this.deploymentId))
	}

	/** A process vanished while effects may have been in flight. Enter exact recovery, never fresh payment. */
	markInterruptedExecutionsUnknown(): number {
		return this.database.transaction(() => {
			const rows = this.database.query<{ record_json: string }, []>(`SELECT record_json FROM friday_coordinator_operations
				WHERE phase = 'executing'`).all()
			for (const row of rows) {
				const record = exactRecord(JSON.parse(row.record_json) as unknown, this.deploymentId)
				const prior = record.revision
				record.phase = 'mint_unknown'; record.reasonCode = 'COORDINATOR_RESTART_DURING_EXECUTION'; record.revision += 1
				this.#replace(record, prior)
			}
			if (rows.length !== 0) this.#advanceGlobalRevision()
			return rows.length
		}).immediate()
	}

	transition(scope: string, from: DemoFridayCoordinatorPhase[], mutate: (record: DemoFridayCoordinatorRecordV2) => void): DemoFridayCoordinatorRecordV2 {
		return this.database.transaction(() => {
			const record = this.#read(scope)
			if (record === null || !from.includes(record.phase)) throw new Error('DEMO_FRIDAY_COORDINATOR_STATE: operation is absent or in another phase')
			const prior = record.revision
			mutate(record); record.revision += 1
			this.#replace(record, prior)
			this.#advanceGlobalRevision()
			return clone(record)
		}).immediate()
	}
}

function exactOutcomeDigest(value: string, label: string): string { digest(value, label); return value }

export function createDemoFridayCoordinatorWorker(
	store: DemoFridayCoordinatorSqlite,
	ports: DemoFridayCoordinatorPorts,
	rollbackAnchor?: DemoFridayCoordinatorRollbackAnchorPort,
) {
	const anchor = (): void => rollbackAnchor?.observeExact(store.anchorSnapshot())
	return Object.freeze({
		recoverStartup(): number { anchor(); const changed = store.markInterruptedExecutionsUnknown(); anchor(); return changed },
		async runExact(scope: string): Promise<DemoFridayCoordinatorRecordV2> {
			anchor()
			const executing = store.transition(scope, ['queued'], (record) => {
				record.phase = 'executing'; record.attempts += 1; delete record.reasonCode
			})
			let outcome: DemoFridayExecutionOutcome
			try { outcome = await ports.executeExact(executing) }
			catch (error) {
				const failed = store.transition(scope, ['executing'], (record) => {
					record.phase = 'mint_unknown'; record.reasonCode = error instanceof Error ? error.name : 'EXECUTION_ERROR'
				})
				anchor()
				return failed
			}
			const completed = store.transition(scope, ['executing'], (record) => {
				record.requestDigest = exactOutcomeDigest(outcome.requestDigest, 'requestDigest')
				if (outcome.status === 'mint_unknown') { record.phase = 'mint_unknown'; return }
				record.terminalResponseDigest = exactOutcomeDigest(outcome.terminalResponseDigest, 'terminalResponseDigest')
				if (outcome.status === 'recipient_pending') { record.phase = 'recipient_pending'; return }
				record.recipientImportDigest = exactOutcomeDigest(outcome.recipientImportDigest, 'recipientImportDigest')
				record.phase = 'completed'
			})
			anchor()
			return completed
		},
		async reconcileExact(scope: string): Promise<DemoFridayCoordinatorRecordV2> {
			anchor()
			const record = store.read(scope)
			if (record === null) throw new Error('DEMO_FRIDAY_COORDINATOR_STATE: operation is absent')
			if (record.phase === 'mint_unknown') {
				const recovered = await ports.recoverExact(record)
				if (recovered.status === 'indeterminate') { anchor(); return record }
				if (recovered.status === 'retry_ready') {
					const retry = store.transition(scope, ['mint_unknown'], (next) => {
						if (next.attempts >= 3) { next.phase = 'quarantined'; next.reasonCode = 'PRE_MINT_RETRY_LIMIT'; return }
						next.phase = 'queued'; next.reasonCode = 'EXACT_PRE_MINT_RETRY_READY'
					})
					anchor()
					return retry
				}
				const pending = store.transition(scope, ['mint_unknown'], (next) => {
					next.phase = 'recipient_pending'
					next.terminalResponseDigest = exactOutcomeDigest(recovered.terminalResponseDigest, 'terminalResponseDigest')
				})
				anchor()
				return pending
			}
			if (record.phase === 'recipient_pending') {
				const imported = await ports.importExact(record)
				if (imported.status === 'recipient_pending') { anchor(); return record }
				const completed = store.transition(scope, ['recipient_pending'], (next) => {
					next.phase = 'completed'
					next.recipientImportDigest = exactOutcomeDigest(imported.recipientImportDigest, 'recipientImportDigest')
				})
				anchor()
				return completed
			}
			anchor()
			return record
		},
	})
}
