/** Durable seller-plan registry and independent rollback anchor. */
import { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'

import type {
	DemoFridaySellerPlanRecordV1,
	DemoFridaySellerPlanRegistryPort,
} from './demo-friday-browser-trust-service'
import type { DemoFridaySellerWinnerPlanEnvelopeV1 } from './demo-friday-browser-coco-seller-plan'

const HEX_32 = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_SELLER_PLAN_SQLITE: ${message}`) }
function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') { if (!Number.isSafeInteger(value)) fail('non-safe integer'); return JSON.stringify(value) }
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') fail('unsupported canonical value')
	const row = value as Record<string, unknown>
	return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`
}
function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex') }

export interface DemoFridaySellerPlanAnchorSnapshotV1 {
	schema: 'PLEBEIAN_FRIDAY_SELLER_PLAN_ANCHOR_V1'
	deploymentId: string
	storeGeneration: string
	globalRevision: number
	stateDigest: string
}

export interface DemoFridaySellerPlanAnchorPort {
	observeExact(snapshot: DemoFridaySellerPlanAnchorSnapshotV1): void
}

/** Must be stored outside the seller-plan database backup boundary. */
export class DemoFridaySellerPlanRollbackAnchorSqlite implements DemoFridaySellerPlanAnchorPort {
	constructor(private readonly database: Database, private readonly allowFirstEnrollment = false) {
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS friday_seller_plan_rollback_anchor (
				id INTEGER PRIMARY KEY NOT NULL CHECK (id=1), deployment_id TEXT NOT NULL,
				store_generation TEXT NOT NULL, maximum_global_revision INTEGER NOT NULL,
				state_digest TEXT NOT NULL
			) STRICT`)
	}

	observeExact(snapshot: DemoFridaySellerPlanAnchorSnapshotV1): void {
		if (snapshot.schema !== 'PLEBEIAN_FRIDAY_SELLER_PLAN_ANCHOR_V1'
			|| !ID.test(snapshot.deploymentId) || !HEX_32.test(snapshot.storeGeneration)
			|| !HEX_32.test(snapshot.stateDigest) || !Number.isSafeInteger(snapshot.globalRevision)
			|| snapshot.globalRevision < 0) fail('rollback snapshot is malformed')
		this.database.transaction(() => {
			const prior = this.database.query<{
				deployment_id: string; store_generation: string; maximum_global_revision: number; state_digest: string
			}, []>(`SELECT deployment_id,store_generation,maximum_global_revision,state_digest
				FROM friday_seller_plan_rollback_anchor WHERE id=1`).get()
			if (prior === null) {
				if (!this.allowFirstEnrollment || snapshot.globalRevision !== 0) fail('rollback anchor is missing after initialization')
				this.database.query(`INSERT INTO friday_seller_plan_rollback_anchor
					(id,deployment_id,store_generation,maximum_global_revision,state_digest) VALUES(1,?,?,?,?)`)
					.run(snapshot.deploymentId, snapshot.storeGeneration, snapshot.globalRevision, snapshot.stateDigest)
				return
			}
			if (prior.deployment_id !== snapshot.deploymentId || prior.store_generation !== snapshot.storeGeneration
				|| snapshot.globalRevision < prior.maximum_global_revision
				|| (snapshot.globalRevision === prior.maximum_global_revision && snapshot.stateDigest !== prior.state_digest)) {
				fail('seller-plan database was replaced, restored, or changed at one revision')
			}
			if (snapshot.globalRevision > prior.maximum_global_revision) {
				const changed = this.database.query(`UPDATE friday_seller_plan_rollback_anchor
					SET maximum_global_revision=?,state_digest=?
					WHERE id=1 AND maximum_global_revision=? AND state_digest=?`).run(
					snapshot.globalRevision, snapshot.stateDigest,
					prior.maximum_global_revision, prior.state_digest,
				)
				if (changed.changes !== 1) fail('rollback anchor changed concurrently')
			}
		}).immediate()
	}
}

function exactRecord(value: unknown): DemoFridaySellerPlanRecordV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('stored record is not an object')
	const record = structuredClone(value) as DemoFridaySellerPlanRecordV1
	if (!HEX_32.test(record.intentEventId) || !ID.test(record.challenge.fundingOperationId)
		|| record.challenge.fundingOperationId !== record.intent.fundingOperationId
		|| record.challenge.auctionId !== record.intent.auctionId
		|| record.challenge.bidAmount !== record.intent.bidAmount
		|| record.challenge.canonicalMintUrl !== record.intent.canonicalMintUrl
		|| !HEX_32.test(record.deploymentDigest)
		|| (record.envelope !== null
			&& record.envelope.plan.fundingOperationId !== record.challenge.fundingOperationId)) {
		fail('stored record identity is malformed')
	}
	return record
}

export class DemoFridaySellerPlanSqlite implements DemoFridaySellerPlanRegistryPort {
	readonly storeGeneration: string
	constructor(
		private readonly database: Database,
		readonly deploymentId: string,
		private readonly anchor: DemoFridaySellerPlanAnchorPort,
	) {
		if (!ID.test(deploymentId)) fail('deployment identity is malformed')
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS friday_seller_plan_metadata (
				id INTEGER PRIMARY KEY NOT NULL CHECK (id=1), deployment_id TEXT NOT NULL,
				store_generation TEXT NOT NULL, global_revision INTEGER NOT NULL
			) STRICT;
			CREATE TABLE IF NOT EXISTS friday_seller_plan_registry (
				funding_operation_id TEXT PRIMARY KEY NOT NULL,
				intent_event_id TEXT UNIQUE NOT NULL, record_json TEXT NOT NULL
			) STRICT`)
		database.transaction(() => {
			const row = database.query<{ deployment_id: string; store_generation: string }, []>(
				'SELECT deployment_id,store_generation FROM friday_seller_plan_metadata WHERE id=1',
			).get()
			if (row === null) database.query(`INSERT INTO friday_seller_plan_metadata
				(id,deployment_id,store_generation,global_revision) VALUES(1,?,?,0)`)
				.run(deploymentId, randomBytes(32).toString('hex'))
			else if (row.deployment_id !== deploymentId || !HEX_32.test(row.store_generation)) {
				fail('seller-plan database belongs to another deployment')
			}
		}).immediate()
		this.storeGeneration = database.query<{ store_generation: string }, []>(
			'SELECT store_generation FROM friday_seller_plan_metadata WHERE id=1',
		).get()!.store_generation
		anchor.observeExact(this.anchorSnapshot())
	}

	anchorSnapshot(): DemoFridaySellerPlanAnchorSnapshotV1 {
		const meta = this.database.query<{ store_generation: string; global_revision: number }, []>(
			'SELECT store_generation,global_revision FROM friday_seller_plan_metadata WHERE id=1',
		).get()
		if (meta === null || meta.store_generation !== this.storeGeneration
			|| !Number.isSafeInteger(meta.global_revision) || meta.global_revision < 0) fail('seller-plan metadata changed')
		const records = this.database.query<{ record_json: string }, []>(
			'SELECT record_json FROM friday_seller_plan_registry ORDER BY funding_operation_id',
		).all().map(({ record_json }) => exactRecord(JSON.parse(record_json) as unknown))
		return { schema: 'PLEBEIAN_FRIDAY_SELLER_PLAN_ANCHOR_V1', deploymentId: this.deploymentId,
			storeGeneration: this.storeGeneration, globalRevision: meta.global_revision,
			stateDigest: digest(['PLEBEIAN_FRIDAY_SELLER_PLAN_STATE_V1', this.deploymentId,
				this.storeGeneration, meta.global_revision, records]) }
	}

	#createOrAdvance(run: () => void): void {
		this.database.transaction(() => {
			run()
			if (this.database.query(`UPDATE friday_seller_plan_metadata
				SET global_revision=global_revision+1 WHERE id=1`).run().changes !== 1) fail('global revision did not advance')
		}).immediate()
		this.anchor.observeExact(this.anchorSnapshot())
	}

	createChallengeExact(recordValue: DemoFridaySellerPlanRecordV1): DemoFridaySellerPlanRecordV1 {
		const record = exactRecord(recordValue)
		if (record.envelope !== null) fail('new seller challenge already contains an envelope')
		const prior = this.readExact(record.challenge.fundingOperationId)
		if (prior !== null) {
			if (canonical(prior) !== canonical(record)) fail('funding operation already owns another challenge')
			return prior
		}
		this.#createOrAdvance(() => {
			const result = this.database.query(`INSERT INTO friday_seller_plan_registry
				(funding_operation_id,intent_event_id,record_json) VALUES(?,?,?)`).run(
				record.challenge.fundingOperationId, record.intentEventId, canonical(record),
			)
			if (result.changes !== 1) fail('seller challenge was not inserted')
		})
		return record
	}

	readExact(fundingOperationId: string): DemoFridaySellerPlanRecordV1 | null {
		if (!ID.test(fundingOperationId)) fail('funding operation is malformed')
		this.anchor.observeExact(this.anchorSnapshot())
		const row = this.database.query<{ record_json: string }, [string]>(
			'SELECT record_json FROM friday_seller_plan_registry WHERE funding_operation_id=?',
		).get(fundingOperationId)
		return row === null ? null : exactRecord(JSON.parse(row.record_json) as unknown)
	}

	listBySellerExact(sellerActor: string): DemoFridaySellerPlanRecordV1[] {
		if (!HEX_32.test(sellerActor)) fail('seller identity is malformed')
		this.anchor.observeExact(this.anchorSnapshot())
		return this.database.query<{ record_json: string }, [string]>(`SELECT record_json
			FROM friday_seller_plan_registry WHERE json_extract(record_json,'$.challenge.sellerActor')=?
			ORDER BY funding_operation_id`,).all(sellerActor)
			.map(({ record_json }) => exactRecord(JSON.parse(record_json) as unknown))
	}

	registerExact(fundingOperationId: string, envelope: DemoFridaySellerWinnerPlanEnvelopeV1): DemoFridaySellerPlanRecordV1 {
		const prior = this.readExact(fundingOperationId)
		if (prior === null) fail('seller plan has no issued challenge')
		if (prior.envelope !== null) {
			if (canonical(prior.envelope) !== canonical(envelope)) fail('seller plan changed after registration')
			return prior
		}
		const next = exactRecord({ ...prior, envelope: structuredClone(envelope) })
		this.#createOrAdvance(() => {
			const changed = this.database.query(`UPDATE friday_seller_plan_registry SET record_json=?
				WHERE funding_operation_id=? AND record_json=?`).run(canonical(next), fundingOperationId, canonical(prior))
			if (changed.changes !== 1) fail('seller plan changed concurrently')
		})
		return next
	}
}
