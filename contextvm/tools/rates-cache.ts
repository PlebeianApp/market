import { Database } from 'bun:sqlite'

export class RatesCache {
	private db: Database
	private getStmt: ReturnType<Database['prepare']>
	private setStmt: ReturnType<Database['prepare']>
	private deleteStmt: ReturnType<Database['prepare']>
	private deleteExpiredStmt: ReturnType<Database['prepare']>

	constructor(dbPath: string = ':memory:') {
		this.db = new Database(dbPath, { create: true })
		this.db.exec('PRAGMA journal_mode = WAL;')

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS cache (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				expires_at INTEGER NOT NULL
			)
		`)

		this.getStmt = this.db.prepare('SELECT value, expires_at FROM cache WHERE key = ?')
		this.setStmt = this.db.prepare('INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)')
		this.deleteStmt = this.db.prepare('DELETE FROM cache WHERE key = ?')
		this.deleteExpiredStmt = this.db.prepare('DELETE FROM cache WHERE expires_at < ?')
	}

	get(key: string): string | null {
		const row = this.getStmt.get(key) as { value: string; expires_at: number } | undefined
		if (!row) return null

		if (Date.now() > row.expires_at) {
			this.deleteStmt.run(key)
			return null
		}

		return row.value
	}

	set(key: string, value: string, ttlMs: number): void {
		const expiresAt = Date.now() + ttlMs
		this.setStmt.run(key, value, expiresAt)
	}

	evictExpired(): number {
		const result = this.deleteExpiredStmt.run(Date.now())
		return result.changes
	}

	close(): void {
		this.db.close()
	}
}
