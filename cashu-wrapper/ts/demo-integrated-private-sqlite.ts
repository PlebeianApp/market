/** Restart-safe private journals for the isolated integrated fake-money harness. */
import { Database } from 'bun:sqlite'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import type {
	DemoMaintainerFederationAttempt,
	DemoMaintainerOfflineRecord,
	DemoMaintainerOfflineStore,
	DemoMaintainerOutcomeSelection,
	DemoMaintainerExactTemplateBundle,
} from './demo-maintainer-offline'
import type { DemoMaintainerFederationAuthorization } from './demo-maintainer-federation'
import { demoMaintainerFederationSessionId } from './demo-maintainer-offline'
import type { DemoSigAllRecoveryRecord, DemoSigAllRecoveryStore } from './demo-sigall-recovery'
import {
	validateDemoFridayFundingAbortRecoveryCapsule,
	type DemoFridayFundingAbortCapsuleStore,
	type DemoFridayFundingAbortCapsuleTerminalStore,
	type DemoFridayFundingAbortCapsuleTerminalV1,
	type DemoFridayFundingAbortRecoveryCapsuleV1,
} from './demo-friday-funding-abort-capsule'
import type { DemoMaintainerOfflineIdentity } from './demo-maintainer-offline'

const HEX_32 = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/

function clone<T>(value: T): T { return structuredClone(value) }
function exact(value: unknown): string { return JSON.stringify(value) }
function text(value: string, field: string): void {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) throw new Error(`DEMO_PRIVATE_SQLITE: ${field} is invalid`)
}

/**
 * The offline bundle contains bearer proofs and private recovery material, so
 * every record is AES-256-GCM encrypted before SQLite sees it. The caller owns
 * a fresh 32-byte throwaway key and a mode-0600 database path; neither belongs
 * in evidence or command-line arguments.
 */
export class DemoMaintainerEncryptedSqliteStore implements DemoMaintainerOfflineStore {
	readonly #database: Database
	readonly #key: Uint8Array
	readonly #nowSeconds: () => number

	constructor(database: Database, key: Uint8Array, nowSeconds: () => number = () => Math.floor(Date.now() / 1000)) {
		if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error('DEMO_PRIVATE_SQLITE: AES key must be exactly 32 bytes')
		this.#database = database
		this.#key = new Uint8Array(key)
		this.#nowSeconds = nowSeconds
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS demo_maintainer_private (
				scope TEXT PRIMARY KEY NOT NULL, bundle_digest TEXT UNIQUE NOT NULL,
				revision INTEGER NOT NULL, nonce BLOB NOT NULL, ciphertext BLOB NOT NULL, tag BLOB NOT NULL
			) STRICT`)
	}

	#seal(scope: string, bundleDigest: string, record: DemoMaintainerOfflineRecord): { nonce: Buffer; ciphertext: Buffer; tag: Buffer } {
		const nonce = randomBytes(12)
		const cipher = createCipheriv('aes-256-gcm', this.#key, nonce)
		cipher.setAAD(Buffer.from(`${scope}\0${bundleDigest}`, 'utf8'))
		const ciphertext = Buffer.concat([cipher.update(exact(record), 'utf8'), cipher.final()])
		return { nonce, ciphertext, tag: cipher.getAuthTag() }
	}

	#open(scope: string, bundleDigest: string, nonce: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array): DemoMaintainerOfflineRecord {
		const decipher = createDecipheriv('aes-256-gcm', this.#key, nonce)
		decipher.setAAD(Buffer.from(`${scope}\0${bundleDigest}`, 'utf8')); decipher.setAuthTag(Buffer.from(tag))
		return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as DemoMaintainerOfflineRecord
	}

	#read(scope: string): { bundleDigest: string; revision: number; record: DemoMaintainerOfflineRecord } | null {
		const row = this.#database.query<{
			bundle_digest: string; revision: number; nonce: Uint8Array; ciphertext: Uint8Array; tag: Uint8Array
		}, [string]>('SELECT bundle_digest, revision, nonce, ciphertext, tag FROM demo_maintainer_private WHERE scope = ?').get(scope)
		return row === null ? null : {
			bundleDigest: row.bundle_digest, revision: row.revision,
			record: this.#open(scope, row.bundle_digest, row.nonce, row.ciphertext, row.tag),
		}
	}

	#replace(scope: string, bundleDigest: string, revision: number, record: DemoMaintainerOfflineRecord): void {
		const sealed = this.#seal(scope, bundleDigest, record)
		const result = this.#database.query(`UPDATE demo_maintainer_private SET revision = ?, nonce = ?, ciphertext = ?, tag = ?
			WHERE scope = ? AND bundle_digest = ? AND revision = ?`).run(
			revision + 1, sealed.nonce, sealed.ciphertext, sealed.tag, scope, bundleDigest, revision,
		)
		if (result.changes !== 1) throw new Error('DEMO_PRIVATE_SQLITE_CAS: offline record changed concurrently')
	}

	async persistPrepared(scope: string, bundle: DemoMaintainerExactTemplateBundle, options: { notAfter: number }): Promise<DemoMaintainerOfflineRecord> {
		text(scope, 'scope'); if (!HEX_32.test(bundle.bundleDigest)) throw new Error('DEMO_PRIVATE_SQLITE: bundle digest is invalid')
		const admittedAt = this.#nowSeconds()
		if (!Number.isSafeInteger(options.notAfter) || admittedAt > options.notAfter) throw new Error('DEMO_PRIVATE_SQLITE: admission deadline passed')
		const transaction = this.#database.transaction(() => {
			const prior = this.#read(scope)
			if (prior !== null) {
				if (prior.bundleDigest !== bundle.bundleDigest || exact(prior.record.bundle) !== exact(bundle)) throw new Error('DEMO_PRIVATE_SQLITE_CONFLICT: scope already owns another bundle')
				return clone(prior.record)
			}
			const record: DemoMaintainerOfflineRecord = {
				bundle: clone(bundle), admission: {
					schema: 'COCO_DEMO_MAINTAINER_ADMISSION_RECEIPT_V1', bundleDigest: bundle.bundleDigest,
					admittedAt, notAfter: options.notAfter,
				},
			}
			const sealed = this.#seal(scope, bundle.bundleDigest, record)
			this.#database.query(`INSERT INTO demo_maintainer_private(scope, bundle_digest, revision, nonce, ciphertext, tag)
				VALUES (?, ?, 0, ?, ?, ?)`).run(scope, bundle.bundleDigest, sealed.nonce, sealed.ciphertext, sealed.tag)
			return clone(record)
		})
		return transaction.immediate()
	}

	async loadExact(scope: string, bundleDigest: string): Promise<DemoMaintainerOfflineRecord | null> {
		const row = this.#read(scope)
		return row === null || row.bundleDigest !== bundleDigest ? null : clone(row.record)
	}

	async bindOutcome(scope: string, bundleDigest: string, selection: DemoMaintainerOutcomeSelection): Promise<DemoMaintainerOfflineRecord> {
		const transaction = this.#database.transaction(() => {
			const row = this.#read(scope)
			if (row === null || row.bundleDigest !== bundleDigest) throw new Error('DEMO_PRIVATE_SQLITE: prepared bundle is absent')
			if (row.record.selection !== undefined && exact(row.record.selection) !== exact(selection)) throw new Error('DEMO_PRIVATE_SQLITE_CONFLICT: outcome already differs')
			if (row.record.selection === undefined) { row.record.selection = clone(selection); this.#replace(scope, bundleDigest, row.revision, row.record) }
			return clone(row.record)
		})
		return transaction.immediate()
	}

	async reserveFederationAttempt(scope: string, bundleDigest: string, selectionRoot: string, excludeParticipantId?: 1 | 2 | 3 | 4): Promise<DemoMaintainerFederationAttempt> {
		const transaction = this.#database.transaction(() => {
			const row = this.#read(scope)
			if (row === null || row.bundleDigest !== bundleDigest || row.record.selection?.selectionRoot !== selectionRoot) throw new Error('DEMO_PRIVATE_SQLITE: selected bundle is absent')
			const attemptNumber = (row.record.federationAttempts?.length ?? 0) + 1
			const attempt: DemoMaintainerFederationAttempt = {
				schema: 'COCO_DEMO_MAINTAINER_FEDERATION_ATTEMPT_V1', attemptNumber,
				sessionId: demoMaintainerFederationSessionId(selectionRoot, attemptNumber),
				...(excludeParticipantId === undefined ? {} : { excludeParticipantId }),
			}
			row.record.federationAttempts = [...(row.record.federationAttempts ?? []), clone(attempt)]
			this.#replace(scope, bundleDigest, row.revision, row.record)
			return clone(attempt)
		})
		return transaction.immediate()
	}

	async saveAuthorization(scope: string, bundleDigest: string, selectionRoot: string, authorization: DemoMaintainerFederationAuthorization): Promise<DemoMaintainerOfflineRecord> {
		const transaction = this.#database.transaction(() => {
			const row = this.#read(scope)
			if (row === null || row.bundleDigest !== bundleDigest || row.record.selection?.selectionRoot !== selectionRoot) throw new Error('DEMO_PRIVATE_SQLITE: selected bundle is absent')
			if (row.record.authorization !== undefined && exact(row.record.authorization) !== exact(authorization)) throw new Error('DEMO_PRIVATE_SQLITE_CONFLICT: authorization already differs')
			if (row.record.authorization === undefined) { row.record.authorization = clone(authorization); this.#replace(scope, bundleDigest, row.revision, row.record) }
			return clone(row.record)
		})
		return transaction.immediate()
	}
}

/**
 * Separate encrypted store for a locked Coco pool that has no valid bid
 * bundle yet.  It is intentionally not stored in demo_maintainer_private: a
 * synthetic winner package must never be invented just to make cancellation
 * possible.
 */
export class DemoFundingAbortCapsuleEncryptedSqliteStore implements DemoFridayFundingAbortCapsuleStore,
	DemoFridayFundingAbortCapsuleTerminalStore {
	readonly #database: Database
	readonly #key: Uint8Array

	constructor(database: Database, key: Uint8Array) {
		if (!(key instanceof Uint8Array) || key.length !== 32) {
			throw new Error('DEMO_ABORT_CAPSULE_SQLITE: AES key must be exactly 32 bytes')
		}
		this.#database = database; this.#key = new Uint8Array(key)
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS demo_funding_abort_capsules (
				operation_id TEXT PRIMARY KEY NOT NULL, capsule_digest TEXT UNIQUE NOT NULL,
				nonce BLOB NOT NULL, ciphertext BLOB NOT NULL, tag BLOB NOT NULL
			) STRICT;
			CREATE TABLE IF NOT EXISTS demo_funding_abort_terminal (
				operation_id TEXT PRIMARY KEY NOT NULL, capsule_digest TEXT UNIQUE NOT NULL,
				scope TEXT UNIQUE NOT NULL, selection_root TEXT UNIQUE NOT NULL,
				nonce BLOB NOT NULL, ciphertext BLOB NOT NULL, tag BLOB NOT NULL
			) STRICT`)
	}

	#seal(operationId: string, capsuleDigest: string, capsule: DemoFridayFundingAbortRecoveryCapsuleV1) {
		const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.#key, nonce)
		cipher.setAAD(Buffer.from(`${operationId}\0${capsuleDigest}`, 'utf8'))
		const ciphertext = Buffer.concat([cipher.update(exact(capsule), 'utf8'), cipher.final()])
		return { nonce, ciphertext, tag: cipher.getAuthTag() }
	}

	#open(operationId: string, capsuleDigest: string, nonce: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array) {
		const decipher = createDecipheriv('aes-256-gcm', this.#key, nonce)
		decipher.setAAD(Buffer.from(`${operationId}\0${capsuleDigest}`, 'utf8')); decipher.setAuthTag(Buffer.from(tag))
		return validateDemoFridayFundingAbortRecoveryCapsule(JSON.parse(
			Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
		) as DemoFridayFundingAbortRecoveryCapsuleV1)
	}

	async persistExact(value: DemoFridayFundingAbortRecoveryCapsuleV1): Promise<DemoFridayFundingAbortRecoveryCapsuleV1> {
		const capsule = validateDemoFridayFundingAbortRecoveryCapsule(value)
		const operationId = capsule.refund.operationId
		if (!ID.test(operationId)) throw new Error('DEMO_ABORT_CAPSULE_SQLITE: operation identity is invalid')
		return this.#database.transaction(() => {
			const prior = this.#database.query<{
				capsule_digest: string; nonce: Uint8Array; ciphertext: Uint8Array; tag: Uint8Array
			}, [string]>('SELECT capsule_digest,nonce,ciphertext,tag FROM demo_funding_abort_capsules WHERE operation_id=?')
				.get(operationId)
			if (prior !== null) {
				const opened = this.#open(operationId, prior.capsule_digest, prior.nonce, prior.ciphertext, prior.tag)
				if (prior.capsule_digest !== capsule.capsuleDigest || exact(opened) !== exact(capsule)) {
					throw new Error('DEMO_ABORT_CAPSULE_SQLITE_CONFLICT: operation already owns another capsule')
				}
				return clone(opened)
			}
			const sealed = this.#seal(operationId, capsule.capsuleDigest, capsule)
			this.#database.query(`INSERT INTO demo_funding_abort_capsules
				(operation_id,capsule_digest,nonce,ciphertext,tag) VALUES(?,?,?,?,?)`).run(
				operationId, capsule.capsuleDigest, sealed.nonce, sealed.ciphertext, sealed.tag,
			)
			return clone(capsule)
		}).immediate()
	}

	async readByOperationExact(operationId: string): Promise<DemoFridayFundingAbortRecoveryCapsuleV1> {
		if (!ID.test(operationId)) throw new Error('DEMO_ABORT_CAPSULE_SQLITE: operation identity is invalid')
		const row = this.#database.query<{
			capsule_digest: string; nonce: Uint8Array; ciphertext: Uint8Array; tag: Uint8Array
		}, [string]>('SELECT capsule_digest,nonce,ciphertext,tag FROM demo_funding_abort_capsules WHERE operation_id=?')
			.get(operationId)
		if (row === null) throw new Error('DEMO_ABORT_CAPSULE_SQLITE: capsule is absent')
		return clone(this.#open(operationId, row.capsule_digest, row.nonce, row.ciphertext, row.tag))
	}

	#exactTerminal(value: DemoFridayFundingAbortCapsuleTerminalV1): DemoFridayFundingAbortCapsuleTerminalV1 {
		if (value === null || typeof value !== 'object' || Array.isArray(value)
			|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
				'schema', 'operationId', 'capsuleDigest', 'scope', 'selectionRoot', 'authorization', 'prepared',
			].sort()) || value.schema !== 'PLEBEIAN_FRIDAY_FUNDING_ABORT_CAPSULE_TERMINAL_V1'
			|| !ID.test(value.operationId) || !HEX_32.test(value.capsuleDigest) || !HEX_32.test(value.scope)
			|| !HEX_32.test(value.selectionRoot)
			|| value.authorization.schema !== 'COCO_DEMO_MAINTAINER_FEDERATION_AUTHORIZATION_V1'
			|| value.authorization.threshold !== 3 || value.authorization.packageDigest !== value.prepared.operationRoot
			|| value.prepared.schema !== 'COCO_DEMO_MAINTAINER_PREPARED_AUTHORIZATION_V1'
			|| value.prepared.scope !== value.scope || value.prepared.bundleDigest !== value.capsuleDigest
			|| value.prepared.selectionRoot !== value.selectionRoot || value.prepared.operationId !== value.operationId
			|| value.prepared.role !== 'refund' || !HEX_32.test(value.prepared.operationRoot)
			|| !HEX_32.test(value.prepared.authorizationDigest)
			|| value.prepared.frostOperationRoot !== value.authorization.frostOperationRoot) {
			throw new Error('DEMO_ABORT_CAPSULE_SQLITE: terminal authority is malformed or mismatched')
		}
		return clone(value)
	}

	#sealTerminal(value: DemoFridayFundingAbortCapsuleTerminalV1) {
		const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.#key, nonce)
		cipher.setAAD(Buffer.from(`${value.operationId}\0${value.capsuleDigest}\0${value.scope}`, 'utf8'))
		const ciphertext = Buffer.concat([cipher.update(exact(value), 'utf8'), cipher.final()])
		return { nonce, ciphertext, tag: cipher.getAuthTag() }
	}

	#openTerminal(operationId: string, capsuleDigest: string, scope: string,
		nonce: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array) {
		const decipher = createDecipheriv('aes-256-gcm', this.#key, nonce)
		decipher.setAAD(Buffer.from(`${operationId}\0${capsuleDigest}\0${scope}`, 'utf8'))
		decipher.setAuthTag(Buffer.from(tag))
		return this.#exactTerminal(JSON.parse(Buffer.concat([
			decipher.update(ciphertext), decipher.final(),
		]).toString('utf8')) as DemoFridayFundingAbortCapsuleTerminalV1)
	}

	async persistTerminalExact(value: DemoFridayFundingAbortCapsuleTerminalV1) {
		const terminal = this.#exactTerminal(value)
		const capsule = await this.readByOperationExact(terminal.operationId)
		if (capsule.capsuleDigest !== terminal.capsuleDigest
			|| capsule.refund.templateDigest !== terminal.prepared.operationRoot) {
			throw new Error('DEMO_ABORT_CAPSULE_SQLITE: terminal authority differs from the encrypted capsule')
		}
		return this.#database.transaction(() => {
			const prior = this.#database.query<{
				capsule_digest: string; scope: string; nonce: Uint8Array; ciphertext: Uint8Array; tag: Uint8Array
			}, [string]>('SELECT capsule_digest,scope,nonce,ciphertext,tag FROM demo_funding_abort_terminal WHERE operation_id=?')
				.get(terminal.operationId)
			if (prior !== null) {
				const opened = this.#openTerminal(terminal.operationId, prior.capsule_digest, prior.scope,
					prior.nonce, prior.ciphertext, prior.tag)
				if (exact(opened) !== exact(terminal)) {
					throw new Error('DEMO_ABORT_CAPSULE_SQLITE_CONFLICT: terminal authority already differs')
				}
				return clone(opened)
			}
			const sealed = this.#sealTerminal(terminal)
			this.#database.query(`INSERT INTO demo_funding_abort_terminal
				(operation_id,capsule_digest,scope,selection_root,nonce,ciphertext,tag) VALUES(?,?,?,?,?,?,?)`).run(
				terminal.operationId, terminal.capsuleDigest, terminal.scope, terminal.selectionRoot,
				sealed.nonce, sealed.ciphertext, sealed.tag,
			)
			return clone(terminal)
		}).immediate()
	}

	async readTerminalExact(identity: DemoMaintainerOfflineIdentity) {
		if (!HEX_32.test(identity.scope) || !HEX_32.test(identity.bundleDigest)) {
			throw new Error('DEMO_ABORT_CAPSULE_SQLITE: terminal identity is malformed')
		}
		const row = this.#database.query<{
			operation_id: string; capsule_digest: string; scope: string; nonce: Uint8Array; ciphertext: Uint8Array; tag: Uint8Array
		}, [string, string]>(`SELECT operation_id,capsule_digest,scope,nonce,ciphertext,tag
			FROM demo_funding_abort_terminal WHERE scope=? AND capsule_digest=?`).get(identity.scope, identity.bundleDigest)
		if (row === null) return null
		const terminal = this.#openTerminal(row.operation_id, row.capsule_digest, row.scope,
			row.nonce, row.ciphertext, row.tag)
		if ((identity.expectedRole !== undefined && identity.expectedRole !== 'refund')
			|| (identity.expectedOperationId !== undefined && identity.expectedOperationId !== terminal.operationId)
			|| (identity.expectedOperationRoot !== undefined && identity.expectedOperationRoot !== terminal.prepared.operationRoot)
			|| (identity.expectedFrostOperationRoot !== undefined
				&& identity.expectedFrostOperationRoot !== terminal.prepared.frostOperationRoot)) {
			throw new Error('DEMO_ABORT_CAPSULE_SQLITE: terminal identity differs')
		}
		return clone(terminal)
	}
}

/** Non-bearer exact mint-operation journal with process-safe SQLite CAS. */
export class DemoSigAllRecoverySqliteStore implements DemoSigAllRecoveryStore {
	constructor(private readonly database: Database) {
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS demo_sigall_recovery (
				scope TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, operation_root TEXT NOT NULL,
				request_digest TEXT NOT NULL, record_json TEXT NOT NULL
			) STRICT`)
	}

	async createOrGet(record: DemoSigAllRecoveryRecord): Promise<{ record: DemoSigAllRecoveryRecord; created: boolean }> {
		const transaction = this.database.transaction(() => {
			const row = this.database.query<{ record_json: string }, [string]>('SELECT record_json FROM demo_sigall_recovery WHERE scope = ?').get(record.scope)
			if (row !== null) {
				const prior = JSON.parse(row.record_json) as DemoSigAllRecoveryRecord
				if (prior.operationRoot !== record.operationRoot || prior.requestDigest !== record.requestDigest) throw new Error('DEMO_RECOVERY_SQLITE_CONFLICT: scope already owns another exact request')
				return { record: clone(prior), created: false }
			}
			this.database.query(`INSERT INTO demo_sigall_recovery(scope, revision, operation_root, request_digest, record_json)
				VALUES (?, ?, ?, ?, ?)`).run(record.scope, record.revision, record.operationRoot, record.requestDigest, exact(record))
			return { record: clone(record), created: true }
		})
		return transaction.immediate()
	}

	async read(scope: string): Promise<DemoSigAllRecoveryRecord | null> {
		const row = this.database.query<{ record_json: string }, [string]>('SELECT record_json FROM demo_sigall_recovery WHERE scope = ?').get(scope)
		return row === null ? null : clone(JSON.parse(row.record_json) as DemoSigAllRecoveryRecord)
	}

	async compareAndSwap(scope: string, expectedRevision: number, next: DemoSigAllRecoveryRecord): Promise<boolean> {
		if (next.scope !== scope || next.revision !== expectedRevision + 1) return false
		const result = this.database.query(`UPDATE demo_sigall_recovery SET revision = ?, record_json = ?
			WHERE scope = ? AND revision = ? AND operation_root = ? AND request_digest = ?`).run(
			next.revision, exact(next), scope, expectedRevision, next.operationRoot, next.requestDigest,
		)
		return result.changes === 1
	}
}
