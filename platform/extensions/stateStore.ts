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

/**
 * Server-side extension store decisions (ADR-0023 §7). Holds only public identifiers and audit fields;
 * secrets stay in the environment and are never written here.
 */
export interface ExtensionStateStore {
	listSideloads(): SideloadRecord[]
	addSideload(record: SideloadRecord): AddSideloadResult
	removeSideload(pubkey: string): boolean
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
