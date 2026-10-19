/**
 * Encrypted, executor-local SQLite durability for the offline maintainer, recovery journal, and
 * recipient-private opening journal. The caller owns the 32-byte encryption key; it is never
 * persisted. Every record is AES-256-GCM sealed with store/scope associated data, and SQLite plus
 * its sidecars are forced to owner-only permissions after each transaction.
 */
import { Database } from 'bun:sqlite'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'

import {
	demoMaintainerFederationSessionId,
	type DemoMaintainerFederationAttempt,
	type DemoMaintainerOfflineRecord,
	type DemoMaintainerOfflineStore,
} from './demo-maintainer-offline'
import type { DemoSigAllRecoveryRecord, DemoSigAllRecoveryStore } from './demo-sigall-recovery'
import type { DemoRecipientPrivateJournalPort, DemoRecipientPrivateRecord } from './demo-sigall-recipient'

const HEX_32 = /^[0-9a-f]{64}$/
const STORE_DOMAIN = 'coco-demo-encrypted-sqlite-v1'

type JsonPrimitive = string | number | boolean | null
export type DemoSqliteJsonValue = JsonPrimitive | DemoSqliteJsonValue[] | { readonly [key: string]: DemoSqliteJsonValue }

export interface DemoRecipientOpeningCodec<OpeningRef> {
	encode(value: OpeningRef): DemoSqliteJsonValue
	decode(value: DemoSqliteJsonValue): OpeningRef
}

export interface DemoEncryptedSqliteOptions {
	/** Absolute, consumer-local database path. In-memory databases are deliberately refused. */
	readonly databasePath: string
	/** Exactly 32 bytes. The key remains caller-owned and is not written to SQLite. */
	readonly encryptionKey: Uint8Array
	readonly busyTimeoutMs?: number
}

interface SealedRow {
	revision: number
	nonce: Uint8Array
	ciphertext: Uint8Array
}

interface StoreRuntime {
	readonly database: Database
	readonly databasePath: string
	readonly cryptoKey: Promise<CryptoKey>
	readonly withTransaction: <T>(run: () => Promise<T>) => Promise<T>
	readonly hardenFiles: () => void
	readonly close: () => void
}

function refuse(code: string, detail: string): never {
	throw new Error(`${code}: ${detail}`)
}

function requireScope(scope: string): void {
	if (typeof scope !== 'string' || scope.length === 0 || scope.length > 2048) refuse('DEMO_SQLITE_SCOPE', 'scope must be a bounded non-empty string')
}

function requireDigest(value: string, name: string): void {
	if (!HEX_32.test(value)) refuse('DEMO_SQLITE_DIGEST', `${name} must be 32 lowercase hex bytes`)
}

function bytes(value: Uint8Array | ArrayBuffer): Uint8Array {
	return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value)
}

function bufferSource(value: Uint8Array): ArrayBuffer {
	return Uint8Array.from(value).buffer
}

function clone<T>(value: T): T {
	return structuredClone(value)
}

function exactJson(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right)
}

function createRuntime(options: DemoEncryptedSqliteOptions): StoreRuntime {
	if (!isAbsolute(options.databasePath) || options.databasePath.includes('\0') || options.databasePath === ':memory:') {
		refuse('DEMO_SQLITE_PATH', 'databasePath must be an absolute durable file path')
	}
	if (!(options.encryptionKey instanceof Uint8Array) || options.encryptionKey.byteLength !== 32) {
		refuse('DEMO_SQLITE_KEY', 'encryptionKey must contain exactly 32 bytes')
	}
	const timeout = options.busyTimeoutMs ?? 5_000
	if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) refuse('DEMO_SQLITE_TIMEOUT', 'busyTimeoutMs must be from 1 through 60000')
	mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 })
	const database = new Database(options.databasePath, { create: true, strict: true })
	database.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${timeout};`)
	database.exec(`
		CREATE TABLE IF NOT EXISTS sealed_records (
			store_name TEXT NOT NULL,
			scope TEXT NOT NULL,
			revision INTEGER NOT NULL CHECK (revision >= 0),
			nonce BLOB NOT NULL,
			ciphertext BLOB NOT NULL,
			PRIMARY KEY (store_name, scope)
		) STRICT;
	`)
	const keyBytes = new Uint8Array(options.encryptionKey)
	const cryptoKey = crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
	keyBytes.fill(0)
	let tail: Promise<void> = Promise.resolve()
	const hardenFiles = () => {
		for (const path of [options.databasePath, `${options.databasePath}-wal`, `${options.databasePath}-shm`]) {
			if (existsSync(path)) chmodSync(path, 0o600)
		}
	}
	hardenFiles()
	return {
		database,
		databasePath: options.databasePath,
		cryptoKey,
		hardenFiles,
		async withTransaction<T>(run: () => Promise<T>): Promise<T> {
			let release!: () => void
			const prior = tail
			tail = new Promise<void>((resolve) => { release = resolve })
			await prior
			try {
				database.exec('BEGIN IMMEDIATE')
				try {
					const result = await run()
					database.exec('COMMIT')
					hardenFiles()
					return result
				} catch (error) {
					try { database.exec('ROLLBACK') } catch { /* preserve the original error */ }
					throw error
				}
			} finally {
				release()
			}
		},
		close() { database.close(); hardenFiles() },
	}
}

function aad(storeName: string, scope: string): Uint8Array {
	return new TextEncoder().encode(`${STORE_DOMAIN}\0${storeName}\0${scope}`)
}

async function seal(runtime: StoreRuntime, storeName: string, scope: string, value: unknown): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
	let plaintext: Uint8Array
	try { plaintext = new TextEncoder().encode(JSON.stringify(value)) }
	catch { return refuse('DEMO_SQLITE_SERIALIZE', 'record is not JSON serializable') }
	const nonce = crypto.getRandomValues(new Uint8Array(12))
	try {
		const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bufferSource(nonce), additionalData: bufferSource(aad(storeName, scope)), tagLength: 128 }, await runtime.cryptoKey, bufferSource(plaintext))
		return { nonce, ciphertext: new Uint8Array(ciphertext) }
	} finally {
		plaintext.fill(0)
	}
}

async function open<T>(runtime: StoreRuntime, storeName: string, scope: string, row: SealedRow): Promise<T> {
	let plaintext: ArrayBuffer
	try {
		plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bufferSource(bytes(row.nonce)), additionalData: bufferSource(aad(storeName, scope)), tagLength: 128 }, await runtime.cryptoKey, bufferSource(bytes(row.ciphertext)))
	} catch {
		return refuse('DEMO_SQLITE_AUTHENTICATION', 'sealed record authentication failed')
	}
	const clear = new Uint8Array(plaintext)
	try { return JSON.parse(new TextDecoder().decode(clear)) as T }
	catch { return refuse('DEMO_SQLITE_RECORD', 'sealed record is malformed') }
	finally { clear.fill(0) }
}

function readRow(runtime: StoreRuntime, storeName: string, scope: string): SealedRow | null {
	const row = runtime.database.query<{ revision: number; nonce: Uint8Array; ciphertext: Uint8Array }, [string, string]>(
		'SELECT revision, nonce, ciphertext FROM sealed_records WHERE store_name = ? AND scope = ?',
	).get(storeName, scope)
	return row === null ? null : { revision: row.revision, nonce: bytes(row.nonce), ciphertext: bytes(row.ciphertext) }
}

async function writeRow(runtime: StoreRuntime, storeName: string, scope: string, revision: number, value: unknown): Promise<void> {
	const sealed = await seal(runtime, storeName, scope, value)
	runtime.database.query(
		`INSERT INTO sealed_records (store_name, scope, revision, nonce, ciphertext) VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(store_name, scope) DO UPDATE SET revision=excluded.revision, nonce=excluded.nonce, ciphertext=excluded.ciphertext`,
	).run(storeName, scope, revision, sealed.nonce, sealed.ciphertext)
}

export function createDemoMaintainerOfflineSqliteStore(options: DemoEncryptedSqliteOptions & { readonly nowSeconds?: () => number }): DemoMaintainerOfflineStore & { close(): void } {
	const runtime = createRuntime(options)
	const storeName = 'maintainer-offline'
	const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
	const readRecord = async (scope: string): Promise<{ row: SealedRow; record: DemoMaintainerOfflineRecord } | null> => {
		const row = readRow(runtime, storeName, scope)
		return row === null ? null : { row, record: await open(runtime, storeName, scope, row) }
	}
	return {
		async persistPrepared(scope, bundle, persistOptions) {
			requireScope(scope); requireDigest(bundle.bundleDigest, 'bundleDigest')
			if (!Number.isSafeInteger(persistOptions.notAfter) || persistOptions.notAfter < 1) refuse('DEMO_SQLITE_ADMISSION', 'notAfter must be a positive integer')
			return runtime.withTransaction(async () => {
				const admittedAt = nowSeconds()
				if (!Number.isSafeInteger(admittedAt) || admittedAt < 1 || admittedAt > persistOptions.notAfter) refuse('DEMO_SQLITE_ADMISSION', 'authoritative admission deadline passed')
				const held = await readRecord(scope)
				if (held !== null) {
					if (!exactJson(held.record.bundle, bundle) || held.record.admission.notAfter !== persistOptions.notAfter) refuse('DEMO_SQLITE_BUNDLE_CONFLICT', 'scope already owns another exact bundle')
					return clone(held.record)
				}
				const record: DemoMaintainerOfflineRecord = {
					bundle: clone(bundle),
					admission: { schema: 'COCO_DEMO_MAINTAINER_ADMISSION_RECEIPT_V1', bundleDigest: bundle.bundleDigest, admittedAt, notAfter: persistOptions.notAfter },
				}
				await writeRow(runtime, storeName, scope, 0, record)
				return clone(record)
			})
		},
		async loadExact(scope, bundleDigest) {
			requireScope(scope); requireDigest(bundleDigest, 'bundleDigest')
			const held = await readRecord(scope)
			return held === null || held.record.bundle.bundleDigest !== bundleDigest ? null : clone(held.record)
		},
		async bindOutcome(scope, bundleDigest, selection) {
			requireScope(scope); requireDigest(bundleDigest, 'bundleDigest')
			return runtime.withTransaction(async () => {
				const held = await readRecord(scope)
				if (held === null || held.record.bundle.bundleDigest !== bundleDigest) refuse('DEMO_SQLITE_BUNDLE_MISSING', 'exact bundle is unavailable')
				if (held.record.selection !== undefined && !exactJson(held.record.selection, selection)) refuse('DEMO_SQLITE_OUTCOME_CONFLICT', 'scope is already bound to another outcome')
				const record = held.record.selection === undefined ? { ...held.record, selection: clone(selection) } : held.record
				if (held.record.selection === undefined) await writeRow(runtime, storeName, scope, held.row.revision + 1, record)
				return clone(record)
			})
		},
		async reserveFederationAttempt(scope, bundleDigest, selectionRoot, excludeParticipantId) {
			requireScope(scope); requireDigest(bundleDigest, 'bundleDigest'); requireDigest(selectionRoot, 'selectionRoot')
			if (excludeParticipantId !== undefined && ![1, 2, 3, 4].includes(excludeParticipantId)) refuse('DEMO_SQLITE_ATTEMPT', 'excluded participant must be in [1,2,3,4]')
			return runtime.withTransaction(async () => {
				const held = await readRecord(scope)
				if (held === null || held.record.bundle.bundleDigest !== bundleDigest || held.record.selection?.selectionRoot !== selectionRoot) refuse('DEMO_SQLITE_SELECTION_CONFLICT', 'exact selected bundle is unavailable')
				if (held.record.authorization !== undefined) refuse('DEMO_SQLITE_ATTEMPT', 'authorization already exists')
				const attemptNumber = (held.record.federationAttempts?.length ?? 0) + 1
				const attempt: DemoMaintainerFederationAttempt = {
					schema: 'COCO_DEMO_MAINTAINER_FEDERATION_ATTEMPT_V1', attemptNumber,
					sessionId: demoMaintainerFederationSessionId(selectionRoot, attemptNumber),
					...(excludeParticipantId === undefined ? {} : { excludeParticipantId }),
				}
				const record = { ...held.record, federationAttempts: [...(held.record.federationAttempts ?? []), attempt] }
				await writeRow(runtime, storeName, scope, held.row.revision + 1, record)
				return clone(attempt)
			})
		},
		async saveAuthorization(scope, bundleDigest, selectionRoot, authorization) {
			requireScope(scope); requireDigest(bundleDigest, 'bundleDigest'); requireDigest(selectionRoot, 'selectionRoot')
			return runtime.withTransaction(async () => {
				const held = await readRecord(scope)
				if (held === null || held.record.bundle.bundleDigest !== bundleDigest || held.record.selection?.selectionRoot !== selectionRoot) refuse('DEMO_SQLITE_SELECTION_CONFLICT', 'exact selected bundle is unavailable')
				if (!held.record.federationAttempts?.some((attempt) => attempt.sessionId === authorization.sessionId)) refuse('DEMO_SQLITE_AUTHORIZATION', 'authorization session was not durably reserved')
				if (held.record.authorization !== undefined && !exactJson(held.record.authorization, authorization)) refuse('DEMO_SQLITE_AUTHORIZATION_CONFLICT', 'another authorization already exists')
				const record = held.record.authorization === undefined ? { ...held.record, authorization: clone(authorization) } : held.record
				if (held.record.authorization === undefined) await writeRow(runtime, storeName, scope, held.row.revision + 1, record)
				return clone(record)
			})
		},
		close: runtime.close,
	}
}

export function createDemoSigAllRecoverySqliteStore(options: DemoEncryptedSqliteOptions): DemoSigAllRecoveryStore & { close(): void } {
	const runtime = createRuntime(options)
	const storeName = 'sigall-recovery'
	const readRecord = async (scope: string): Promise<{ row: SealedRow; record: DemoSigAllRecoveryRecord } | null> => {
		const row = readRow(runtime, storeName, scope)
		return row === null ? null : { row, record: await open(runtime, storeName, scope, row) }
	}
	return {
		async createOrGet(record) {
			requireScope(record.scope); requireDigest(record.operationRoot, 'operationRoot')
			return runtime.withTransaction(async () => {
				const held = await readRecord(record.scope)
				if (held !== null) return { record: clone(held.record), created: false }
				await writeRow(runtime, storeName, record.scope, record.revision, clone(record))
				return { record: clone(record), created: true }
			})
		},
		async read(scope) {
			requireScope(scope)
			const held = await readRecord(scope)
			return held === null ? null : clone(held.record)
		},
		async compareAndSwap(scope, expectedRevision, next) {
			requireScope(scope)
			return runtime.withTransaction(async () => {
				const held = await readRecord(scope)
				if (held === null || held.record.revision !== expectedRevision || held.row.revision !== expectedRevision || next.scope !== scope || next.revision !== expectedRevision + 1) return false
				await writeRow(runtime, storeName, scope, next.revision, clone(next))
				return true
			})
		},
		close: runtime.close,
	}
}

export function createDemoRecipientPrivateSqliteJournal<OpeningRef>(options: DemoEncryptedSqliteOptions & { readonly openingCodec: DemoRecipientOpeningCodec<OpeningRef> }): DemoRecipientPrivateJournalPort<OpeningRef> & { close(): void } {
	const runtime = createRuntime(options)
	const storeName = 'recipient-private'
	const encode = (record: DemoRecipientPrivateRecord<OpeningRef>): DemoSqliteJsonValue => ({
		...record,
		privateOpeningRefs: record.privateOpeningRefs.map((value) => options.openingCodec.encode(value)),
	}) as unknown as DemoSqliteJsonValue
	const decode = (value: DemoSqliteJsonValue): DemoRecipientPrivateRecord<OpeningRef> => {
		if (typeof value !== 'object' || value === null || Array.isArray(value) || !Array.isArray(value.privateOpeningRefs)) refuse('DEMO_SQLITE_RECIPIENT_RECORD', 'private record is malformed')
		return { ...(value as unknown as DemoRecipientPrivateRecord<OpeningRef>), privateOpeningRefs: value.privateOpeningRefs.map((item) => options.openingCodec.decode(item)) }
	}
	const readRecord = async (scope: string): Promise<{ row: SealedRow; encoded: DemoSqliteJsonValue; record: DemoRecipientPrivateRecord<OpeningRef> } | null> => {
		const row = readRow(runtime, storeName, scope)
		if (row === null) return null
		const encoded = await open<DemoSqliteJsonValue>(runtime, storeName, scope, row)
		return { row, encoded, record: decode(encoded) }
	}
	return {
		runExclusive(scope, run) {
			requireScope(scope)
			return runtime.withTransaction(run)
		},
		async load(scope) {
			requireScope(scope)
			const held = await readRecord(scope)
			return held === null ? null : clone(held.record)
		},
		async savePrepared(scope, record) {
			requireScope(scope)
			if (record.scope !== scope) refuse('DEMO_SQLITE_RECIPIENT_SCOPE', 'record scope differs from journal scope')
			const encoded = encode(clone(record))
			const held = await readRecord(scope)
			if (held !== null) {
				if (!exactJson(held.encoded, encoded)) refuse('DEMO_SQLITE_RECIPIENT_CONFLICT', 'scope already owns another private record')
				return
			}
			await writeRow(runtime, storeName, scope, 0, encoded)
		},
		async markImported(scope, requestDigest, responseDigest) {
			requireScope(scope); requireDigest(requestDigest, 'requestDigest'); requireDigest(responseDigest, 'responseDigest')
			const held = await readRecord(scope)
			if (held === null || held.record.requestDigest !== requestDigest) refuse('DEMO_SQLITE_RECIPIENT_ROOT', 'prepared recipient record is unavailable')
			if (held.record.importedResponseDigest !== undefined && held.record.importedResponseDigest !== responseDigest) refuse('DEMO_SQLITE_RECIPIENT_RESPONSE_CONFLICT', 'another response is already imported')
			if (held.record.importedResponseDigest === responseDigest) return
			const next: DemoRecipientPrivateRecord<OpeningRef> = { ...held.record, importedResponseDigest: responseDigest }
			await writeRow(runtime, storeName, scope, held.row.revision + 1, encode(next))
		},
		close: runtime.close,
	}
}

