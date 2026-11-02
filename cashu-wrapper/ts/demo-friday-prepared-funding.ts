/**
 * Exact browser-prepared funding package validation and non-bearer replay
 * journal for the Friday fake-money route.
 *
 * The exact bundle contains Cashu bearer secrets and therefore belongs only in
 * the encrypted private store.  This module returns it solely so the caller can
 * pass it directly to that store; the durable replay journal below persists
 * only public digests and event/operation identities.
 */
import { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'

import {
	verifyDemoFridayBrowserFundingAuthorization,
	type DemoFridayBrowserFundingAuthorizationV1,
} from './demo-friday-browser-funding-authorization'
import {
	demoMaintainerScopeFor,
	validateDemoMaintainerExactTemplateBundle,
	type DemoMaintainerExactTemplateBundle,
	type DemoMaintainerOfflineIdentity,
	type DemoMaintainerOfflineStore,
} from './demo-maintainer-offline'

export interface DemoFridayPreparedFundingEnvelopeV1 {
	schema: 'PLEBEIAN_FRIDAY_PREPARED_FUNDING_ENVELOPE_V1'
	authorization: unknown
	bundle: DemoMaintainerExactTemplateBundle
}

export interface DemoFridayVerifiedPreparedFundingV1 {
	authorization: DemoFridayBrowserFundingAuthorizationV1
	bundle: DemoMaintainerExactTemplateBundle
	scope: string
}

export interface DemoFridayFundingReplayRecordV1 {
	schema: 'PLEBEIAN_FRIDAY_FUNDING_REPLAY_RECORD_V1'
	eventId: string
	fundingOperationId: string
	bundleDigest: string
	scope: string
	phase: 'claimed' | 'stored' | 'admitted' | 'quarantined'
	revision: number
	admission?: DemoFridayFundingAdmissionCommitV1
}

export interface DemoFridayFundingAdmissionCommitV1 {
	schema: 'PLEBEIAN_FRIDAY_FUNDING_ADMISSION_COMMIT_V1'
	/** The replay-key identity of the distinct kind-28647 funding authorization. */
	eventId: string
	/** The exact kind-28641 bid event committed by Comet. */
	bidEventId: string
	fundingOperationId: string
	bundleDigest: string
	scope: string
	receiptDigest: string
	transactionHash: string
	committedHeight: number
	disposition: 'active' | 'rejected_return'
	rejectionReason?: 'auction_not_open' | 'seller_self_bid' | 'late' | 'below_minimum' | 'stale_leader' | 'funding_expired'
}

export interface DemoFridayFundingReplayAnchorSnapshotV1 {
	schema: 'PLEBEIAN_FRIDAY_FUNDING_REPLAY_ANCHOR_V1'
	deploymentId: string
	storeGeneration: string
	globalRevision: number
	stateDigest: string
}

export interface DemoFridayFundingReplayAnchorPort {
	/** Must live outside the replay/private-store backup boundary. */
	observeExact(snapshot: DemoFridayFundingReplayAnchorSnapshotV1): void
}

/** Separate-database monotonic anchor; deployment must place it outside the replay/private backup boundary. */
export class DemoFridayFundingReplayRollbackAnchorSqlite implements DemoFridayFundingReplayAnchorPort {
	constructor(private readonly database: Database, private readonly allowFirstEnrollment = false) {
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS friday_funding_replay_anchor (
				id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), deployment_id TEXT NOT NULL,
				store_generation TEXT NOT NULL, global_revision INTEGER NOT NULL, state_digest TEXT NOT NULL
			) STRICT`)
	}

	observeExact(snapshot: DemoFridayFundingReplayAnchorSnapshotV1): void {
		if (snapshot.schema !== 'PLEBEIAN_FRIDAY_FUNDING_REPLAY_ANCHOR_V1'
			|| !/^[A-Za-z0-9_-]{1,160}$/.test(snapshot.deploymentId)
			|| !HEX_32.test(snapshot.storeGeneration) || !HEX_32.test(snapshot.stateDigest)
			|| !Number.isSafeInteger(snapshot.globalRevision) || snapshot.globalRevision < 0) {
			refuse('replay rollback snapshot is malformed')
		}
		this.database.transaction(() => {
			const prior = this.database.query<{
				deployment_id: string; store_generation: string; global_revision: number; state_digest: string
			}, []>(`SELECT deployment_id, store_generation, global_revision, state_digest
				FROM friday_funding_replay_anchor WHERE id = 1`).get()
			if (prior === null) {
				if (!this.allowFirstEnrollment || snapshot.globalRevision !== 0) {
					refuse('replay rollback anchor is missing after initialization')
				}
				this.database.query(`INSERT INTO friday_funding_replay_anchor
					(id, deployment_id, store_generation, global_revision, state_digest) VALUES (1, ?, ?, ?, ?)`)
					.run(snapshot.deploymentId, snapshot.storeGeneration, snapshot.globalRevision, snapshot.stateDigest)
				return
			}
			if (prior.deployment_id !== snapshot.deploymentId || prior.store_generation !== snapshot.storeGeneration
				|| snapshot.globalRevision < prior.global_revision
				|| (snapshot.globalRevision === prior.global_revision && snapshot.stateDigest !== prior.state_digest)) {
				refuse('replay database was replaced, restored, or changed at one revision')
			}
			if (snapshot.globalRevision > prior.global_revision) {
				this.database.query(`UPDATE friday_funding_replay_anchor SET global_revision = ?, state_digest = ?
					WHERE id = 1 AND global_revision = ?`).run(
					snapshot.globalRevision, snapshot.stateDigest, prior.global_revision,
				)
			}
		}).immediate()
	}
}

const HEX_32 = /^[0-9a-f]{64}$/

function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_PREPARED_FUNDING: ${message}`) }

function exactKeys(value: object, expected: string[]): void {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
		refuse('object has missing or unexpected fields')
	}
}

function exactAdmissionCommit(commit: DemoFridayFundingAdmissionCommitV1): DemoFridayFundingAdmissionCommitV1 {
	exactKeys(commit, ['schema', 'eventId', 'bidEventId', 'fundingOperationId', 'bundleDigest', 'scope',
		'receiptDigest', 'transactionHash', 'committedHeight', 'disposition',
		...(commit.rejectionReason === undefined ? [] : ['rejectionReason'])])
	if (commit.schema !== 'PLEBEIAN_FRIDAY_FUNDING_ADMISSION_COMMIT_V1'
		|| !HEX_32.test(commit.eventId) || !HEX_32.test(commit.bidEventId)
		|| !HEX_32.test(commit.bundleDigest) || !HEX_32.test(commit.scope)
		|| !HEX_32.test(commit.receiptDigest) || !HEX_32.test(commit.transactionHash)
		|| typeof commit.fundingOperationId !== 'string' || commit.fundingOperationId.length < 1
		|| commit.fundingOperationId.length > 160 || !Number.isSafeInteger(commit.committedHeight)
		|| commit.committedHeight < 1) refuse('admission commit is malformed')
	if ((commit.disposition === 'active' && commit.rejectionReason !== undefined)
		|| (commit.disposition === 'rejected_return' && ![
			'auction_not_open', 'seller_self_bid', 'late', 'below_minimum', 'stale_leader', 'funding_expired',
		].includes(commit.rejectionReason ?? ''))
		|| !['active', 'rejected_return'].includes(commit.disposition)) {
		refuse('admission commit disposition is malformed')
	}
	return structuredClone(commit)
}

function exactReplayRecord(value: unknown): DemoFridayFundingReplayRecordV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('stored replay record is not an object')
	const raw = value as DemoFridayFundingReplayRecordV1
	exactKeys(raw, raw.phase === 'admitted'
		? ['schema', 'eventId', 'fundingOperationId', 'bundleDigest', 'scope', 'phase', 'revision', 'admission']
		: ['schema', 'eventId', 'fundingOperationId', 'bundleDigest', 'scope', 'phase', 'revision'])
	if (raw.schema !== 'PLEBEIAN_FRIDAY_FUNDING_REPLAY_RECORD_V1' || !HEX_32.test(raw.eventId)
		|| !HEX_32.test(raw.bundleDigest) || !HEX_32.test(raw.scope)
		|| typeof raw.fundingOperationId !== 'string' || raw.fundingOperationId.length < 1
		|| raw.fundingOperationId.length > 160 || !['claimed', 'stored', 'admitted', 'quarantined'].includes(raw.phase)
		|| !Number.isSafeInteger(raw.revision) || raw.revision < 0) refuse('stored replay record is malformed')
	if (raw.phase === 'admitted') {
		if (raw.admission === undefined) refuse('stored admission commit is absent')
		const admission = exactAdmissionCommit(raw.admission)
		if (admission.eventId !== raw.eventId || admission.fundingOperationId !== raw.fundingOperationId
			|| admission.bundleDigest !== raw.bundleDigest || admission.scope !== raw.scope) {
			refuse('stored admission commit is absent or belongs to another event')
		}
	} else if (raw.admission !== undefined) refuse('non-admitted replay record contains an admission commit')
	return structuredClone(raw)
}

/**
 * Recompute every package-derived digest and signature, then bind the exact
 * package to the Nostr/payment-key authorization. Nothing supplied by the
 * client is trusted merely because it has the right hash shape.
 */
export function verifyDemoFridayPreparedFundingEnvelope(
	value: unknown,
	pins: { authNetworkId: string; chainId: string; mintUrl: string; nowSeconds: number },
): DemoFridayVerifiedPreparedFundingV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('envelope is not an object')
	const raw = value as Record<string, unknown>
	exactKeys(raw, ['schema', 'authorization', 'bundle'])
	if (raw.schema !== 'PLEBEIAN_FRIDAY_PREPARED_FUNDING_ENVELOPE_V1') refuse('envelope schema differs')
	const authorization = verifyDemoFridayBrowserFundingAuthorization(raw.authorization, pins)
	const bundle = validateDemoMaintainerExactTemplateBundle(
		raw.bundle as DemoMaintainerExactTemplateBundle, pins.nowSeconds, true,
	)
	const content = authorization.content
	const winner = bundle.winner
	const refund = bundle.refund
	if (winner.network !== content.authNetworkId || winner.chainId !== content.chainId
		|| winner.auctionId !== content.auctionId || winner.operationId !== content.fundingOperationId
		|| winner.bidderActorId !== authorization.event.pubkey || winner.amount !== content.amount
		|| winner.mintUrl !== content.mintUrl || winner.bidderPublicKey !== content.paymentPublicKey
		|| winner.refundPublicKey !== content.refundPublicKey
		|| bundle.bundleDigest !== content.bundleDigest
		|| refund.templateDigest !== content.returnPackageDigest
		|| refund.cashuSigAllDigest !== content.returnCashuSigAllDigest
		|| refund.bidderMainSignature !== content.bidderReturnSignature) {
		refuse('authorization differs from the recomputed exact package')
	}
	return { authorization, bundle, scope: demoMaintainerScopeFor(winner) }
}

/** Process-safe, non-bearer replay ownership. */
export class DemoFridayFundingReplaySqlite {
	readonly storeGeneration: string
	constructor(private readonly database: Database, readonly deploymentId = 'friday-local') {
		if (!/^[A-Za-z0-9_-]{1,160}$/.test(deploymentId)) refuse('deployment identity is invalid')
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS friday_funding_replay_metadata (
				id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), schema TEXT NOT NULL,
				deployment_id TEXT NOT NULL, store_generation TEXT NOT NULL, global_revision INTEGER NOT NULL
			) STRICT;
			CREATE TABLE IF NOT EXISTS friday_funding_replay (
				event_id TEXT PRIMARY KEY NOT NULL,
				funding_operation_id TEXT UNIQUE NOT NULL,
				bundle_digest TEXT UNIQUE NOT NULL,
				scope TEXT UNIQUE NOT NULL,
				phase TEXT NOT NULL,
				revision INTEGER NOT NULL,
				record_json TEXT NOT NULL
			) STRICT`)
		this.database.transaction(() => {
			const metadata = this.database.query<{
				schema: string; deployment_id: string; store_generation: string; global_revision: number
			}, []>(`SELECT schema, deployment_id, store_generation, global_revision
				FROM friday_funding_replay_metadata WHERE id = 1`).get()
			if (metadata === null) {
				this.database.query(`INSERT INTO friday_funding_replay_metadata
					(id, schema, deployment_id, store_generation, global_revision) VALUES (1, ?, ?, ?, 0)`)
					.run('PLEBEIAN_FRIDAY_FUNDING_REPLAY_DB_V2', deploymentId, randomBytes(32).toString('hex'))
			} else if (metadata.schema !== 'PLEBEIAN_FRIDAY_FUNDING_REPLAY_DB_V2'
				|| metadata.deployment_id !== deploymentId || !HEX_32.test(metadata.store_generation)
				|| !Number.isSafeInteger(metadata.global_revision) || metadata.global_revision < 0) {
				refuse('replay database belongs to another deployment or schema')
			}
		}).immediate()
		this.storeGeneration = this.database.query<{ store_generation: string }, []>(
			'SELECT store_generation FROM friday_funding_replay_metadata WHERE id = 1',
		).get()!.store_generation
	}

	#advance(): void {
		if (this.database.query(`UPDATE friday_funding_replay_metadata
			SET global_revision = global_revision + 1 WHERE id = 1`).run().changes !== 1) {
			refuse('replay metadata did not advance')
		}
	}

	anchorSnapshot(): DemoFridayFundingReplayAnchorSnapshotV1 {
		const metadata = this.database.query<{ store_generation: string; global_revision: number }, []>(
			'SELECT store_generation, global_revision FROM friday_funding_replay_metadata WHERE id = 1',
		).get()
		if (metadata === null || metadata.store_generation !== this.storeGeneration
			|| !Number.isSafeInteger(metadata.global_revision) || metadata.global_revision < 0) {
			refuse('replay metadata changed')
		}
		const records = this.database.query<{ record_json: string }, []>(
			'SELECT record_json FROM friday_funding_replay ORDER BY event_id',
		).all().map(({ record_json }) => exactReplayRecord(JSON.parse(record_json) as unknown))
		return {
			schema: 'PLEBEIAN_FRIDAY_FUNDING_REPLAY_ANCHOR_V1', deploymentId: this.deploymentId,
			storeGeneration: metadata.store_generation, globalRevision: metadata.global_revision,
			stateDigest: createHash('sha256').update(JSON.stringify([
				'PLEBEIAN_FRIDAY_FUNDING_REPLAY_STATE_V1', this.deploymentId,
				metadata.store_generation, metadata.global_revision, records,
			])).digest('hex'),
		}
	}

	/** Exact public replay identity for an authenticated post-commit confirmer. */
	readExact(eventId: string): DemoFridayFundingReplayRecordV1 | null {
		if (!HEX_32.test(eventId)) refuse('replay event identity is malformed')
		const row = this.database.query<{ record_json: string }, [string]>(
			'SELECT record_json FROM friday_funding_replay WHERE event_id = ?',
		).get(eventId)
		return row === null ? null : exactReplayRecord(JSON.parse(row.record_json) as unknown)
	}

	/** Unique operation lookup used by validator-confirmed pre-broadcast abort recovery. */
	readByOperationExact(fundingOperationId: string): DemoFridayFundingReplayRecordV1 | null {
		if (!/^[A-Za-z0-9_-]{1,160}$/.test(fundingOperationId)) refuse('funding operation identity is malformed')
		const row = this.database.query<{ record_json: string }, [string]>(
			'SELECT record_json FROM friday_funding_replay WHERE funding_operation_id = ?',
		).get(fundingOperationId)
		return row === null ? null : exactReplayRecord(JSON.parse(row.record_json) as unknown)
	}

	listAdmittedExact(): DemoFridayFundingReplayRecordV1[] {
		return this.database.query<{ record_json: string }, []>(
			"SELECT record_json FROM friday_funding_replay WHERE phase = 'admitted' ORDER BY event_id",
		).all().map(({ record_json }) => exactReplayRecord(JSON.parse(record_json) as unknown))
	}

	claimExact(value: DemoFridayVerifiedPreparedFundingV1): DemoFridayFundingReplayRecordV1 {
		const record: DemoFridayFundingReplayRecordV1 = {
			schema: 'PLEBEIAN_FRIDAY_FUNDING_REPLAY_RECORD_V1',
			eventId: value.authorization.event.id,
			fundingOperationId: value.authorization.content.fundingOperationId,
			bundleDigest: value.bundle.bundleDigest,
			scope: value.scope,
			phase: 'claimed', revision: 0,
		}
		if (![record.eventId, record.bundleDigest, record.scope].every((item) => HEX_32.test(item))) {
			refuse('event, bundle, or scope digest is invalid')
		}
		return this.database.transaction(() => {
			const existing = this.database.query<{ record_json: string }, [string, string, string, string]>(
				`SELECT record_json FROM friday_funding_replay
				 WHERE event_id = ? OR funding_operation_id = ? OR bundle_digest = ? OR scope = ?`,
			).all(record.eventId, record.fundingOperationId, record.bundleDigest, record.scope)
			if (existing.length !== 0) {
				if (existing.length !== 1) refuse('replay indexes disagree')
				const prior = exactReplayRecord(JSON.parse(existing[0]!.record_json) as unknown)
				if (prior.eventId !== record.eventId || prior.fundingOperationId !== record.fundingOperationId
					|| prior.bundleDigest !== record.bundleDigest || prior.scope !== record.scope) {
					refuse('event, operation, bundle, or scope was already consumed by another request')
				}
				return structuredClone(prior)
			}
			this.database.query(`INSERT INTO friday_funding_replay
				(event_id, funding_operation_id, bundle_digest, scope, phase, revision, record_json)
				VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
				record.eventId, record.fundingOperationId, record.bundleDigest, record.scope,
				record.phase, record.revision, JSON.stringify(record),
			)
			this.#advance()
			return structuredClone(record)
		}).immediate()
	}

	transitionExact(
		eventId: string,
		expected: DemoFridayFundingReplayRecordV1['phase'],
		next: Exclude<DemoFridayFundingReplayRecordV1['phase'], 'claimed'>,
	): DemoFridayFundingReplayRecordV1 {
		if (!((expected === 'claimed' && (next === 'stored' || next === 'quarantined'))
			|| (expected === 'stored' && next === 'quarantined'))) {
			refuse('replay phase transition is not permitted')
		}
		return this.database.transaction(() => {
			const row = this.database.query<{ record_json: string }, [string]>(
				'SELECT record_json FROM friday_funding_replay WHERE event_id = ?',
			).get(eventId)
			if (row === null) refuse('replay record is absent')
			const prior = exactReplayRecord(JSON.parse(row.record_json) as unknown)
			if (prior.phase === next) return structuredClone(prior)
			if (prior.phase !== expected) refuse('replay phase changed or is terminal')
			const updated = { ...prior, phase: next, revision: prior.revision + 1 }
			const result = this.database.query(`UPDATE friday_funding_replay
				SET phase = ?, revision = ?, record_json = ?
				WHERE event_id = ? AND phase = ? AND revision = ?`).run(
				updated.phase, updated.revision, JSON.stringify(updated), eventId, prior.phase, prior.revision,
			)
			if (result.changes !== 1) refuse('replay record changed concurrently')
			this.#advance()
			return structuredClone(updated)
		}).immediate()
	}

	admitExact(commit: DemoFridayFundingAdmissionCommitV1): DemoFridayFundingReplayRecordV1 {
		const exactCommit = exactAdmissionCommit(commit)
		return this.database.transaction(() => {
			const row = this.database.query<{ record_json: string }, [string]>(
				'SELECT record_json FROM friday_funding_replay WHERE event_id = ?',
			).get(commit.eventId)
			if (row === null) refuse('admission replay record is absent')
			const prior = exactReplayRecord(JSON.parse(row.record_json) as unknown)
			if (prior.fundingOperationId !== exactCommit.fundingOperationId || prior.bundleDigest !== exactCommit.bundleDigest
				|| prior.scope !== exactCommit.scope) refuse('admission commit differs from claimed funding identity')
			if (prior.phase === 'admitted') {
				if (JSON.stringify(prior.admission) !== JSON.stringify(exactCommit)) refuse('admission commit changed after acceptance')
				return structuredClone(prior)
			}
			if (prior.phase !== 'stored' || prior.admission !== undefined) refuse('funding package is not ready for admission')
			const updated: DemoFridayFundingReplayRecordV1 = {
				...prior, phase: 'admitted', revision: prior.revision + 1, admission: exactCommit,
			}
			const result = this.database.query(`UPDATE friday_funding_replay
				SET phase = ?, revision = ?, record_json = ?
				WHERE event_id = ? AND phase = 'stored' AND revision = ?`).run(
				updated.phase, updated.revision, JSON.stringify(updated), exactCommit.eventId, prior.revision,
			)
			if (result.changes !== 1) refuse('admission replay record changed concurrently')
			this.#advance()
			return structuredClone(updated)
		}).immediate()
	}
}

/**
 * Crash-safe preparation composition. The replay claim is deliberately first:
 * a crash can strand one exact request, but can never admit an unowned package.
 * An exact retry either writes the encrypted bundle or proves the already
 * written bytes before advancing to stored. The external anchor is observed
 * before and after every durable step, so a restored replay database fails
 * closed instead of reopening an identity.
 */
export class DemoFridayPreparedFundingAdmission {
	constructor(private readonly options: {
		pins: { authNetworkId: string; chainId: string; mintUrl: string; nowSeconds: () => number }
		replay: DemoFridayFundingReplaySqlite
		anchor: DemoFridayFundingReplayAnchorPort
		privateStore: DemoMaintainerOfflineStore
		/** Fixed seller registry guard; it runs before any replay claim or bearer-package persistence. */
		registeredWinner: { assertRegisteredWinnerExact(request: {
			auctionId: string
			fundingOperationId: string
			bidderActor: string
			bidAmount: number
			winnerRequest: { capability: DemoMaintainerExactTemplateBundle['winner']['recipientCapability']; outputs: DemoMaintainerExactTemplateBundle['winner']['outputs'] }
		}): Promise<void> }
	}) {}

	#anchor(): void { this.options.anchor.observeExact(this.options.replay.anchorSnapshot()) }

	async prepareExact(value: unknown): Promise<{
		verified: DemoFridayVerifiedPreparedFundingV1
		identity: DemoMaintainerOfflineIdentity
		replay: DemoFridayFundingReplayRecordV1
	}> {
		this.#anchor()
		const nowSeconds = this.options.pins.nowSeconds()
		const verified = verifyDemoFridayPreparedFundingEnvelope(value, { ...this.options.pins, nowSeconds })
		await this.options.registeredWinner.assertRegisteredWinnerExact({
			auctionId: verified.bundle.winner.auctionId,
			fundingOperationId: verified.bundle.winner.operationId,
			bidderActor: verified.authorization.event.pubkey,
			bidAmount: verified.bundle.winner.amount,
			winnerRequest: { capability: structuredClone(verified.bundle.winner.recipientCapability),
				outputs: structuredClone(verified.bundle.winner.outputs) },
		})
		let replay = this.options.replay.claimExact(verified)
		this.#anchor()
		if (replay.phase === 'quarantined') refuse('replay identity is quarantined')
		const identity = { scope: verified.scope, bundleDigest: verified.bundle.bundleDigest }
		let stored = await this.options.privateStore.loadExact(identity.scope, identity.bundleDigest)
		if (stored === null) {
			if (replay.phase !== 'claimed') refuse('durable package disappeared after replay advanced')
			stored = await this.options.privateStore.persistPrepared(identity.scope, structuredClone(verified.bundle), {
				notAfter: Math.min(verified.bundle.winner.validUntil, verified.bundle.winner.closeTime),
			})
		}
		if (JSON.stringify(stored.bundle) !== JSON.stringify(verified.bundle)
			|| stored.admission.bundleDigest !== identity.bundleDigest) {
			if (replay.phase === 'claimed') replay = this.options.replay.transitionExact(replay.eventId, 'claimed', 'quarantined')
			this.#anchor(); refuse('encrypted store returned different package bytes')
		}
		if (replay.phase === 'claimed') replay = this.options.replay.transitionExact(replay.eventId, 'claimed', 'stored')
		this.#anchor()
		return { verified, identity, replay }
	}

	markAdmittedExact(commit: DemoFridayFundingAdmissionCommitV1): DemoFridayFundingReplayRecordV1 {
		this.#anchor()
		const result = this.options.replay.admitExact(commit)
		this.#anchor()
		return result
	}

	/**
	 * Re-read one stored package through the rollback anchor.  The caller gets
	 * the exact encrypted-store record, never authority to synthesize package
	 * fields from an RPC response.
	 */
	async readStoredExact(eventId: string): Promise<{
		replay: DemoFridayFundingReplayRecordV1
		identity: DemoMaintainerOfflineIdentity
		stored: NonNullable<Awaited<ReturnType<DemoMaintainerOfflineStore['loadExact']>>>
	}> {
		this.#anchor()
		const replay = this.options.replay.readExact(eventId)
		if (replay === null || !['stored', 'admitted'].includes(replay.phase)) {
			refuse('stored replay identity is absent or not ready')
		}
		const identity = { scope: replay.scope, bundleDigest: replay.bundleDigest }
		const stored = await this.options.privateStore.loadExact(identity.scope, identity.bundleDigest)
		if (stored === null || stored.bundle.bundleDigest !== replay.bundleDigest
			|| stored.admission.bundleDigest !== replay.bundleDigest) {
			refuse('encrypted exact package is absent or differs from replay identity')
		}
		this.#anchor()
		return { replay, identity, stored }
	}

	async readStoredByOperationExact(fundingOperationId: string): Promise<{
		replay: DemoFridayFundingReplayRecordV1
		identity: DemoMaintainerOfflineIdentity
		stored: NonNullable<Awaited<ReturnType<DemoMaintainerOfflineStore['loadExact']>>>
	}> {
		this.#anchor()
		const replay = this.options.replay.readByOperationExact(fundingOperationId)
		if (replay === null || !['stored', 'admitted'].includes(replay.phase)) {
			refuse('stored funding operation is absent or not ready')
		}
		const identity = { scope: replay.scope, bundleDigest: replay.bundleDigest }
		const stored = await this.options.privateStore.loadExact(identity.scope, identity.bundleDigest)
		if (stored === null || stored.bundle.bundleDigest !== replay.bundleDigest
			|| stored.admission.bundleDigest !== replay.bundleDigest) {
			refuse('encrypted exact operation package is absent or differs from replay identity')
		}
		this.#anchor()
		return { replay, identity, stored }
	}

	listAdmittedExact(): DemoFridayFundingReplayRecordV1[] {
		this.#anchor()
		const records = this.options.replay.listAdmittedExact()
		this.#anchor()
		return records
	}
}
