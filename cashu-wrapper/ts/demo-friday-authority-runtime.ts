/** Concrete durable adapters for the fixed Friday authority process. */
import { Database } from 'bun:sqlite'

import type {
	DemoFridayAuthorityHealthPort,
	DemoFridayFixedAuthorityService,
	DemoFridayTrustedTerminalSourcePort,
	DemoFridayTrustedTerminalCandidateV1,
} from './demo-friday-authority-service'
import type { DemoFridayCoordinatorRollbackAnchorPort, DemoFridayCoordinatorSqlite } from './demo-friday-coordinator-runtime'
import type {
	DemoIntegratedThreshold3QueuedTerminalResult,
	DemoIntegratedThreshold3TerminalRequest,
} from './demo-integrated-threshold3-terminal-service'

const ID = /^[A-Za-z0-9_-]{1,160}$/
const HEX_32 = /^[0-9a-f]{64}$/

export interface DemoFridayTrustedTerminalReferenceV1 {
	schema: 'PLEBEIAN_FRIDAY_TERMINAL_REFERENCE_V1'
	reference: string
	identityDigest: string
}

export interface DemoFridayFixedTerminalResolverPort {
	/** Build capabilities only from fixed process configuration and trusted stores. */
	resolveExact(reference: DemoFridayTrustedTerminalReferenceV1): Promise<DemoIntegratedThreshold3TerminalRequest>
}

export interface DemoFridayTerminalSourceRuntimePort extends DemoFridayTrustedTerminalSourcePort {
	recoverInterruptedExact(): number
	pendingCount(): number
}

/**
 * The database stores no capabilities or bearer proofs. It serializes exact
 * authenticated terminal references and resolves them through one fixed
 * process composition captured at construction.
 */
export class DemoFridayTrustedTerminalSqlite implements DemoFridayTrustedTerminalSourcePort {
	constructor(private readonly database: Database, private readonly resolver: DemoFridayFixedTerminalResolverPort) {
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS friday_terminal_references (
				reference TEXT PRIMARY KEY NOT NULL,
				identity_digest TEXT UNIQUE NOT NULL,
				phase TEXT NOT NULL,
				revision INTEGER NOT NULL,
				result_json TEXT
			) STRICT`)
	}

	enqueueAuthenticatedExact(value: DemoFridayTrustedTerminalReferenceV1): void {
		if (value.schema !== 'PLEBEIAN_FRIDAY_TERMINAL_REFERENCE_V1' || !ID.test(value.reference)
			|| !HEX_32.test(value.identityDigest)) throw new Error('DEMO_FRIDAY_TERMINAL_SOURCE: reference is invalid')
		this.database.transaction(() => {
			const row = this.database.query<{ identity_digest: string }, [string]>(
				'SELECT identity_digest FROM friday_terminal_references WHERE reference = ?',
			).get(value.reference)
			if (row !== null) {
				if (row.identity_digest !== value.identityDigest) throw new Error('DEMO_FRIDAY_TERMINAL_SOURCE_CONFLICT: reference identity changed')
				return
			}
			try {
				this.database.query(`INSERT INTO friday_terminal_references
					(reference, identity_digest, phase, revision) VALUES (?, ?, 'pending', 0)`)
					.run(value.reference, value.identityDigest)
			} catch { throw new Error('DEMO_FRIDAY_TERMINAL_SOURCE_CONFLICT: identity already belongs to another reference') }
		}).immediate()
	}

	async nextExact(): Promise<DemoFridayTrustedTerminalCandidateV1 | null> {
		const row = this.database.transaction(() => {
			const candidate = this.database.query<{ reference: string; identity_digest: string; revision: number }, []>(
				`SELECT reference, identity_digest, revision FROM friday_terminal_references
				 WHERE phase = 'pending' ORDER BY rowid LIMIT 1`,
			).get()
			if (candidate === null) return null
			const changed = this.database.query(`UPDATE friday_terminal_references
				SET phase = 'resolving', revision = ? WHERE reference = ? AND phase = 'pending' AND revision = ?`)
				.run(candidate.revision + 1, candidate.reference, candidate.revision)
			if (changed.changes !== 1) throw new Error('DEMO_FRIDAY_TERMINAL_SOURCE_CAS: reference claim changed concurrently')
			return { reference: candidate.reference, identity_digest: candidate.identity_digest }
		}).immediate()
		if (row === null) return null
		const reference: DemoFridayTrustedTerminalReferenceV1 = {
			schema: 'PLEBEIAN_FRIDAY_TERMINAL_REFERENCE_V1', reference: row.reference,
			identityDigest: row.identity_digest,
		}
		return { reference: reference.reference, request: await this.resolver.resolveExact(reference) }
	}

	async markQueuedExact(reference: string, result: DemoIntegratedThreshold3QueuedTerminalResult): Promise<void> {
		if (!ID.test(reference)) throw new Error('DEMO_FRIDAY_TERMINAL_SOURCE: acknowledgement reference is invalid')
		this.database.transaction(() => {
			const row = this.database.query<{ phase: string; revision: number; result_json: string | null }, [string]>(
				'SELECT phase, revision, result_json FROM friday_terminal_references WHERE reference = ?',
			).get(reference)
			if (row === null) throw new Error('DEMO_FRIDAY_TERMINAL_SOURCE: acknowledged reference is absent')
			const exact = JSON.stringify(result)
			if (row.phase === 'queued') {
				if (row.result_json !== exact) throw new Error('DEMO_FRIDAY_TERMINAL_SOURCE_CONFLICT: acknowledgement differs')
				return
			}
			if (row.phase !== 'resolving') throw new Error('DEMO_FRIDAY_TERMINAL_SOURCE_CONFLICT: terminal reference is not resolving')
			const changed = this.database.query(`UPDATE friday_terminal_references
				SET phase = 'queued', revision = ?, result_json = ?
				WHERE reference = ? AND phase = 'resolving' AND revision = ?`).run(
				row.revision + 1, exact, reference, row.revision,
			)
			if (changed.changes !== 1) throw new Error('DEMO_FRIDAY_TERMINAL_SOURCE_CAS: reference changed concurrently')
		}).immediate()
	}

	/** Restart-only recovery. Queue insertion is exact/idempotent, so an interrupted resolving row is retried. */
	recoverInterruptedExact(): number {
		return this.database.transaction(() => this.database.query(`UPDATE friday_terminal_references
			SET phase = 'pending', revision = revision + 1 WHERE phase = 'resolving'`).run().changes).immediate()
	}

	pendingCount(): number {
		return this.database.query<{ count: number }, []>(
			"SELECT count(*) AS count FROM friday_terminal_references WHERE phase IN ('pending', 'resolving')",
		).get()!.count
	}
}

export interface DemoFridayTrustedCommitReaderPort {
	readExact(signal?: AbortSignal): Promise<{ chainId: string; height: number }>
}

/** Fixed health adapter: rollback anchor first, then pinned chain height. */
export function createDemoFridayAuthorityHealth(options: {
	deploymentId: string
	chainId: string
	coordinatorStore: DemoFridayCoordinatorSqlite
	rollbackAnchor: DemoFridayCoordinatorRollbackAnchorPort
	terminalSource: DemoFridayTerminalSourceRuntimePort
	commitReader: DemoFridayTrustedCommitReaderPort
 now?: () => number
}): DemoFridayAuthorityHealthPort {
	if (!ID.test(options.deploymentId) || !ID.test(options.chainId)) throw new Error('DEMO_FRIDAY_HEALTH: deployment or chain is invalid')
 let lastHeight = 0, lastProgress = -Infinity, lastClock = -Infinity, safetyQuarantined = false
 const now = options.now ?? (() => performance.now())
 const read = async () => {
   const queuePending = options.coordinatorStore.listNonterminal().length + options.terminalSource.pendingCount()
   try { options.rollbackAnchor.observeExact(options.coordinatorStore.anchorSnapshot()) }
   catch { safetyQuarantined = true }
   const result = (consensusAvailable: boolean) => ({ deploymentId: options.deploymentId,
    quarantined: safetyQuarantined, queuePending, lastCommittedHeight: lastHeight, consensusAvailable })
   if (safetyQuarantined) return result(false)
   let timer: ReturnType<typeof setTimeout> | undefined
   const abort = new AbortController()
   try {
    const started = now()
    const commit = await Promise.race([options.commitReader.readExact(abort.signal), new Promise<never>((_, reject) => {
     timer = setTimeout(() => { abort.abort(); reject(new Error('commit timeout')) }, 5_000)
    })])
    const observed = now()
    if (!Number.isFinite(started) || !Number.isFinite(observed) || observed < started || observed < lastClock || observed - started > 5_000) return result(false)
    lastClock = observed
    if (commit.chainId !== options.chainId || !Number.isSafeInteger(commit.height) || commit.height < 1
     || commit.height < lastHeight) { safetyQuarantined = true; return result(false) }
    if (commit.height > lastHeight) { lastHeight = commit.height; lastProgress = started }
    return result(observed - lastProgress < 20_000)
   } catch { return result(false) }
   finally { clearTimeout(timer); abort.abort() }
 }
 let pending: ReturnType<typeof read> | undefined
 return Object.freeze({ readExact() {
  pending ??= read().finally(() => { pending = undefined })
  return pending
 } })
}

/** Serial bounded drain loop. A failure stops the loop and quarantines process startup. */
export async function runDemoFridayAuthorityDrainLoop(options: {
	service: DemoFridayFixedAuthorityService
	signal: AbortSignal
	intervalMs?: number
	sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}): Promise<void> {
	const interval = options.intervalMs ?? 1_000
	if (!Number.isSafeInteger(interval) || interval < 10 || interval > 60_000) throw new Error('DEMO_FRIDAY_DRAIN: interval is invalid')
	const sleep = options.sleep ?? (async (milliseconds, signal) => {
		await new Promise<void>((resolve, reject) => {
			const finish = (): void => { signal.removeEventListener('abort', abort); resolve() }
			const timer = setTimeout(finish, milliseconds)
			const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('DEMO_FRIDAY_DRAIN: stopped')) }
			if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
		})
	})
	while (!options.signal.aborted) {
		const result = await options.service.drainOne()
		if (result === 'idle' && !options.signal.aborted) await sleep(interval, options.signal)
	}
}
