import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const DEFAULT_EXTENSIONS_STATE_PATH = './data/extensions.sqlite'
export const MAX_SIDELOADS = 50

export interface SideloadRecord {
	pubkey: string
	/** Admin pubkey that added the server. */
	addedBy: string
	addedAt: number
}

export type AddSideloadResult = 'added' | 'exists' | 'limit_reached'

export const MAX_BINDINGS = 50

/** A pinned remote tool binding (ADR-0023 §7.5). Public identifiers and audit fields only. */
export interface RemoteBindingRecord {
	serverPubkey: string
	toolName: string
	actionName: string
	capability: string
	auth: 'user' | 'admin'
	perPubkey: number
	windowSeconds: number
	/** sha256 of the reviewed tool `inputSchema`; a different announced hash stops the binding. */
	inputSchemaHash: string
	/** Display name of the server when it was bound, used while its announcement is unavailable. */
	serverName: string
	enabled: boolean
	createdBy: string
	createdAt: number
}

export type AddBindingResult = 'added' | 'exists' | 'limit_reached'

/**
 * Server-side extension store decisions (ADR-0023 §7). Holds only public identifiers and audit fields;
 * secrets stay in the environment and are never written here.
 */
export interface ExtensionStateStore {
	listSideloads(): SideloadRecord[]
	addSideload(record: SideloadRecord): AddSideloadResult
	removeSideload(pubkey: string): boolean
	listBindings(): RemoteBindingRecord[]
	addBinding(record: RemoteBindingRecord): AddBindingResult
	updateBinding(serverPubkey: string, actionName: string, change: { enabled?: boolean; inputSchemaHash?: string }): boolean
	removeBinding(serverPubkey: string, actionName: string): boolean
	close(): void
}

export class SqliteExtensionStateStore implements ExtensionStateStore {
	private readonly db: Database

	constructor(path: string = DEFAULT_EXTENSIONS_STATE_PATH) {
		if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
		this.db = new Database(path, { create: true })
		this.db.exec('PRAGMA journal_mode = WAL;')
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS sideloads (
				pubkey TEXT PRIMARY KEY,
				added_by TEXT NOT NULL,
				added_at INTEGER NOT NULL
			)
		`)
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS bindings (
				server_pubkey TEXT NOT NULL,
				action_name TEXT NOT NULL,
				tool_name TEXT NOT NULL,
				capability TEXT NOT NULL,
				auth TEXT NOT NULL CHECK (auth IN ('user', 'admin')),
				per_pubkey INTEGER NOT NULL,
				window_seconds INTEGER NOT NULL,
				input_schema_hash TEXT NOT NULL,
				server_name TEXT NOT NULL,
				enabled INTEGER NOT NULL,
				created_by TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				PRIMARY KEY (server_pubkey, action_name)
			)
		`)
	}

	listBindings(): RemoteBindingRecord[] {
		const rows = this.db.query('SELECT * FROM bindings ORDER BY created_at, server_pubkey, action_name').all() as Record<string, unknown>[]
		return rows.map((row) => ({
			serverPubkey: String(row.server_pubkey),
			toolName: String(row.tool_name),
			actionName: String(row.action_name),
			capability: String(row.capability),
			auth: row.auth === 'admin' ? 'admin' : 'user',
			perPubkey: Number(row.per_pubkey),
			windowSeconds: Number(row.window_seconds),
			inputSchemaHash: String(row.input_schema_hash),
			serverName: String(row.server_name),
			enabled: Number(row.enabled) === 1,
			createdBy: String(row.created_by),
			createdAt: Number(row.created_at),
		}))
	}

	addBinding(record: RemoteBindingRecord): AddBindingResult {
		return this.db.transaction((): AddBindingResult => {
			if (this.db.query('SELECT 1 FROM bindings WHERE server_pubkey = ? AND action_name = ?').get(record.serverPubkey, record.actionName)) {
				return 'exists'
			}
			const { count } = this.db.query('SELECT COUNT(*) AS count FROM bindings').get() as { count: number }
			if (count >= MAX_BINDINGS) return 'limit_reached'
			this.db
				.query(
					`INSERT INTO bindings (server_pubkey, action_name, tool_name, capability, auth, per_pubkey, window_seconds,
						input_schema_hash, server_name, enabled, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					record.serverPubkey,
					record.actionName,
					record.toolName,
					record.capability,
					record.auth,
					record.perPubkey,
					record.windowSeconds,
					record.inputSchemaHash,
					record.serverName,
					record.enabled ? 1 : 0,
					record.createdBy,
					record.createdAt,
				)
			return 'added'
		})()
	}

	updateBinding(serverPubkey: string, actionName: string, change: { enabled?: boolean; inputSchemaHash?: string }): boolean {
		const sets: string[] = []
		const values: (string | number)[] = []
		if (change.enabled !== undefined) {
			sets.push('enabled = ?')
			values.push(change.enabled ? 1 : 0)
		}
		if (change.inputSchemaHash !== undefined) {
			sets.push('input_schema_hash = ?')
			values.push(change.inputSchemaHash)
		}
		if (sets.length === 0) return false
		return (
			this.db
				.query(`UPDATE bindings SET ${sets.join(', ')} WHERE server_pubkey = ? AND action_name = ?`)
				.run(...values, serverPubkey, actionName).changes > 0
		)
	}

	removeBinding(serverPubkey: string, actionName: string): boolean {
		return this.db.query('DELETE FROM bindings WHERE server_pubkey = ? AND action_name = ?').run(serverPubkey, actionName).changes > 0
	}

	listSideloads(): SideloadRecord[] {
		const rows = this.db.query('SELECT pubkey, added_by, added_at FROM sideloads ORDER BY added_at, pubkey').all() as {
			pubkey: string
			added_by: string
			added_at: number
		}[]
		return rows.map((row) => ({ pubkey: row.pubkey, addedBy: row.added_by, addedAt: row.added_at }))
	}

	addSideload(record: SideloadRecord): AddSideloadResult {
		return this.db.transaction((): AddSideloadResult => {
			if (this.db.query('SELECT 1 FROM sideloads WHERE pubkey = ?').get(record.pubkey)) return 'exists'
			const { count } = this.db.query('SELECT COUNT(*) AS count FROM sideloads').get() as { count: number }
			if (count >= MAX_SIDELOADS) return 'limit_reached'
			this.db
				.query('INSERT INTO sideloads (pubkey, added_by, added_at) VALUES (?, ?, ?)')
				.run(record.pubkey, record.addedBy, record.addedAt)
			return 'added'
		})()
	}

	removeSideload(pubkey: string): boolean {
		return this.db.query('DELETE FROM sideloads WHERE pubkey = ?').run(pubkey).changes > 0
	}

	close(): void {
		this.db.close()
	}
}
