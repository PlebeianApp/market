import { Database } from 'bun:sqlite'

export interface WalletStateRecord {
	pubkey: string
	encryptedState: string
	version: number
	sequence: number
	storedAt: number
}

/**
 * SQLite-backed store for encrypted wallet state snapshots.
 *
 * Snapshots are stored encrypted at rest: the `encrypted_state` column holds
 * the NIP-44 ciphertext produced by the client, never plaintext proofs. The
 * server never decrypts the payload — it only stores and returns it. This keeps
 * the server a dumb, encrypted relay for wallet state (per ADR-019 Tier 1).
 *
 * Versioning: each accepted write bumps the per-pubkey version. A client may
 * pass the version it last saw; if it does not match the current stored version
 * the write is rejected (optimistic concurrency) so a stale overwriter cannot
 * clobber newer state.
 */
export class WalletStateStore {
	private db: Database
	private upsertStmt: ReturnType<Database['prepare']>
	private getStmt: ReturnType<Database['prepare']>
	private getVersionStmt: ReturnType<Database['prepare']>

	constructor(dbPath: string = ':memory:') {
		this.db = new Database(dbPath, { create: true })
		this.db.exec('PRAGMA journal_mode = WAL;')

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS wallet_state (
				pubkey TEXT PRIMARY KEY,
				encrypted_state TEXT NOT NULL,
				version INTEGER NOT NULL,
				sequence INTEGER NOT NULL,
				stored_at INTEGER NOT NULL
			)
		`)

		this.upsertStmt = this.db.prepare(`
			INSERT INTO wallet_state (pubkey, encrypted_state, version, sequence, stored_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(pubkey) DO UPDATE SET
				encrypted_state = excluded.encrypted_state,
				version = excluded.version,
				sequence = excluded.sequence,
				stored_at = excluded.stored_at
		`)
		this.getStmt = this.db.prepare(
			'SELECT pubkey, encrypted_state, version, sequence, stored_at FROM wallet_state WHERE pubkey = ?',
		)
		this.getVersionStmt = this.db.prepare('SELECT version FROM wallet_state WHERE pubkey = ?')
	}

	/**
	 * Store a snapshot for a pubkey. Returns the new version number.
	 *
	 * If `expectedVersion` is provided and does not match the currently stored
	 * version, the write is rejected (returns null) to prevent stale overwrites.
	 * When no snapshot exists yet, the first write is always accepted.
	 */
	sync(
		pubkey: string,
		encryptedState: string,
		sequence: number,
		expectedVersion?: number,
		now: number = Date.now(),
	): number | null {
		const current = this.getVersionStmt.get(pubkey) as { version: number } | undefined

		if (expectedVersion !== undefined) {
			const currentVersion = current?.version ?? 0
			if (currentVersion !== expectedVersion) {
				return null
			}
		}

		const nextVersion = (current?.version ?? 0) + 1
		this.upsertStmt.run(pubkey, encryptedState, nextVersion, sequence, now)
		return nextVersion
	}

	/**
	 * Return the latest stored snapshot for a pubkey, or null if none exists.
	 */
	get(pubkey: string): WalletStateRecord | null {
		const row = this.getStmt.get(pubkey) as
			| { pubkey: string; encrypted_state: string; version: number; sequence: number; stored_at: number }
			| undefined
		if (!row) return null

		return {
			pubkey: row.pubkey,
			encryptedState: row.encrypted_state,
			version: row.version,
			sequence: row.sequence,
			storedAt: row.stored_at,
		}
	}

	close(): void {
		this.db.close()
	}
}
