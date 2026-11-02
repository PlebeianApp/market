/**
 * Independent fail-closed anchor for the Friday coordinator journal.
 *
 * This database must live outside the coordinator database's backup boundary.
 * It detects a replacement generation, a lower observed revision, or changed
 * state at the same revision. It cannot detect a coherent rollback of both
 * databases; deployment therefore still needs an external monotonic witness.
 */
import { Database } from 'bun:sqlite'

import type {
	DemoFridayCoordinatorAnchorSnapshotV1,
	DemoFridayCoordinatorRollbackAnchorPort,
} from './demo-friday-coordinator-runtime'

const HEX_32 = /^[0-9a-f]{64}$/

function exact(snapshot: DemoFridayCoordinatorAnchorSnapshotV1): DemoFridayCoordinatorAnchorSnapshotV1 {
	if (snapshot.schema !== 'PLEBEIAN_FRIDAY_COORDINATOR_ANCHOR_SNAPSHOT_V1'
		|| typeof snapshot.deploymentId !== 'string' || snapshot.deploymentId.length === 0
		|| snapshot.deploymentId.trim() !== snapshot.deploymentId
		|| !HEX_32.test(snapshot.storeGeneration) || !HEX_32.test(snapshot.stateDigest)
		|| !Number.isSafeInteger(snapshot.globalRevision) || snapshot.globalRevision < 0
		|| Object.keys(snapshot).sort().join(',')
			!== 'deploymentId,globalRevision,schema,stateDigest,storeGeneration') {
		throw new Error('DEMO_FRIDAY_COORDINATOR_ANCHOR: snapshot is malformed')
	}
	return structuredClone(snapshot)
}

export class DemoFridayCoordinatorRollbackAnchorSqlite implements DemoFridayCoordinatorRollbackAnchorPort {
	constructor(
		private readonly database: Database,
		private readonly allowFirstEnrollment = false,
	) {
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS friday_coordinator_rollback_anchor (
				id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
				schema TEXT NOT NULL, deployment_id TEXT NOT NULL, store_generation TEXT NOT NULL,
				maximum_global_revision INTEGER NOT NULL, state_digest TEXT NOT NULL
			) STRICT`)
	}

	observeExact(snapshotValue: DemoFridayCoordinatorAnchorSnapshotV1): void {
		const snapshot = exact(snapshotValue)
		this.database.transaction(() => {
			const row = this.database.query<{
				schema: string; deployment_id: string; store_generation: string
				maximum_global_revision: number; state_digest: string
			}, []>(`SELECT schema,deployment_id,store_generation,maximum_global_revision,state_digest
				FROM friday_coordinator_rollback_anchor WHERE id=1`).get()
			if (row === null) {
				if (!this.allowFirstEnrollment || snapshot.globalRevision !== 0) {
					throw new Error('DEMO_FRIDAY_COORDINATOR_ROLLBACK: independent anchor is missing after initialization')
				}
				this.database.query(`INSERT INTO friday_coordinator_rollback_anchor
					(id,schema,deployment_id,store_generation,maximum_global_revision,state_digest)
					VALUES(1,?,?,?,?,?)`).run(
					'PLEBEIAN_FRIDAY_COORDINATOR_ROLLBACK_ANCHOR_V1', snapshot.deploymentId,
					snapshot.storeGeneration, snapshot.globalRevision, snapshot.stateDigest,
				)
				return
			}
			if (row.schema !== 'PLEBEIAN_FRIDAY_COORDINATOR_ROLLBACK_ANCHOR_V1'
				|| row.deployment_id !== snapshot.deploymentId || row.store_generation !== snapshot.storeGeneration) {
				throw new Error('DEMO_FRIDAY_COORDINATOR_ROLLBACK: deployment or store generation was replaced')
			}
			if (snapshot.globalRevision < row.maximum_global_revision) {
				throw new Error('DEMO_FRIDAY_COORDINATOR_ROLLBACK: coordinator revision regressed')
			}
			if (snapshot.globalRevision === row.maximum_global_revision) {
				if (snapshot.stateDigest !== row.state_digest) {
					throw new Error('DEMO_FRIDAY_COORDINATOR_ROLLBACK: coordinator state changed at an anchored revision')
				}
				return
			}
			const updated = this.database.query(`UPDATE friday_coordinator_rollback_anchor
				SET maximum_global_revision=?,state_digest=?
				WHERE id=1 AND maximum_global_revision=? AND state_digest=?`).run(
				snapshot.globalRevision, snapshot.stateDigest, row.maximum_global_revision, row.state_digest,
			)
			if (updated.changes !== 1) throw new Error('DEMO_FRIDAY_COORDINATOR_ROLLBACK: anchor changed concurrently')
		}).immediate()
	}
}
