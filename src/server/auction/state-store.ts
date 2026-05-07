import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Issuer-private SQLite store for the CVM auction tools.
 *
 * Nostr is the canonical store for auction events (kind 30408) and the
 * path registry (kind 30410). It can't usefully hold:
 *   - rate-limit counters per (auction, bidder), which are issuer-only
 *     observations of request volume,
 *   - request-id dedup, used to reject replays of `request_path` calls
 *     within a window.
 *
 * Both are small, append-only, and need to survive a process restart so
 * a misbehaving bidder can't reset their counters by triggering a
 * reload. Schema:
 *
 *   path_request_dedup(issuer_pubkey, auction_event_id, bidder_pubkey, request_id, seen_at)
 *     PRIMARY KEY (issuer_pubkey, auction_event_id, bidder_pubkey, request_id)
 *
 *   path_request_window(issuer_pubkey, auction_event_id, bidder_pubkey, requested_at)
 *     INDEX (issuer_pubkey, auction_event_id, bidder_pubkey, requested_at)
 *
 * Both tables get periodic GC against a sliding window.
 */

const DEDUP_WINDOW_S = 30 * 60
const RATE_WINDOW_S = 60
const RATE_MAX_PER_WINDOW = 10

export class AuctionStateStore {
	private db: Database
	private dedupInsertStmt: ReturnType<Database['prepare']>
	private dedupExistsStmt: ReturnType<Database['prepare']>
	private dedupGcStmt: ReturnType<Database['prepare']>
	private rateInsertStmt: ReturnType<Database['prepare']>
	private rateCountStmt: ReturnType<Database['prepare']>
	private rateGcStmt: ReturnType<Database['prepare']>

	constructor(dbPath: string = ':memory:') {
		if (dbPath !== ':memory:') {
			mkdirSync(dirname(dbPath), { recursive: true })
		}
		this.db = new Database(dbPath, { create: true })
		this.db.exec('PRAGMA journal_mode = WAL;')

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS path_request_dedup (
				issuer_pubkey TEXT NOT NULL,
				auction_event_id TEXT NOT NULL,
				bidder_pubkey TEXT NOT NULL,
				request_id TEXT NOT NULL,
				seen_at INTEGER NOT NULL,
				PRIMARY KEY (issuer_pubkey, auction_event_id, bidder_pubkey, request_id)
			);
			CREATE INDEX IF NOT EXISTS idx_dedup_seen_at ON path_request_dedup(seen_at);

			CREATE TABLE IF NOT EXISTS path_request_window (
				issuer_pubkey TEXT NOT NULL,
				auction_event_id TEXT NOT NULL,
				bidder_pubkey TEXT NOT NULL,
				requested_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_window_lookup
				ON path_request_window(issuer_pubkey, auction_event_id, bidder_pubkey, requested_at);
		`)

		this.dedupInsertStmt = this.db.prepare(
			`INSERT INTO path_request_dedup (issuer_pubkey, auction_event_id, bidder_pubkey, request_id, seen_at)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT DO NOTHING`,
		)
		this.dedupExistsStmt = this.db.prepare(
			`SELECT 1 FROM path_request_dedup
			 WHERE issuer_pubkey = ? AND auction_event_id = ? AND bidder_pubkey = ? AND request_id = ?`,
		)
		this.dedupGcStmt = this.db.prepare(`DELETE FROM path_request_dedup WHERE seen_at < ?`)

		this.rateInsertStmt = this.db.prepare(
			`INSERT INTO path_request_window (issuer_pubkey, auction_event_id, bidder_pubkey, requested_at)
			 VALUES (?, ?, ?, ?)`,
		)
		this.rateCountStmt = this.db.prepare(
			`SELECT COUNT(*) AS n FROM path_request_window
			 WHERE issuer_pubkey = ? AND auction_event_id = ? AND bidder_pubkey = ? AND requested_at >= ?`,
		)
		this.rateGcStmt = this.db.prepare(`DELETE FROM path_request_window WHERE requested_at < ?`)
	}

	/**
	 * Atomically:
	 *   1. Reject if `(issuer, auction, bidder, requestId)` was already seen within DEDUP_WINDOW.
	 *   2. Reject if the bidder has already made `RATE_MAX_PER_WINDOW` requests in
	 *      the last `RATE_WINDOW_S` seconds for this auction.
	 *   3. Otherwise record the request and return.
	 *
	 * Throws on rejection; the message is stable so handlers can surface it.
	 */
	enforcePathRequestRateLimit(params: {
		issuerPubkey: string
		auctionEventId: string
		bidderPubkey: string
		requestId: string
	}): void {
		const now = Math.floor(Date.now() / 1000)

		// Periodic GC — cheap because of the seen_at / requested_at indexes.
		// Run on every call but the WHERE clause is selective.
		this.dedupGcStmt.run(now - DEDUP_WINDOW_S)
		this.rateGcStmt.run(now - RATE_WINDOW_S * 10)

		const dedupHit = this.dedupExistsStmt.get(
			params.issuerPubkey,
			params.auctionEventId,
			params.bidderPubkey,
			params.requestId,
		)
		if (dedupHit) {
			throw new Error('Duplicate path request id (already processed)')
		}

		const cutoff = now - RATE_WINDOW_S
		const row = this.rateCountStmt.get(params.issuerPubkey, params.auctionEventId, params.bidderPubkey, cutoff) as
			| { n: number }
			| undefined
		if (row && row.n >= RATE_MAX_PER_WINDOW) {
			throw new Error('Too many path requests for this auction; please slow down')
		}

		this.dedupInsertStmt.run(params.issuerPubkey, params.auctionEventId, params.bidderPubkey, params.requestId, now)
		this.rateInsertStmt.run(params.issuerPubkey, params.auctionEventId, params.bidderPubkey, now)
	}

	close(): void {
		this.db.close()
	}
}

let cached: AuctionStateStore | null = null

export function getAuctionStateStore(): AuctionStateStore {
	if (cached) return cached
	const path = process.env.AUCTION_STATE_PATH || './contextvm/data/auction-state.sqlite'
	cached = new AuctionStateStore(path)
	return cached
}
