import { Database } from 'bun:sqlite'

import type { DemoSignerCoordinatorAnchorPort, DemoSignerDurableBindingV1 } from './demo-signer-rpc'

function stableIdentity(value: DemoSignerDurableBindingV1): string {
	return JSON.stringify({
		schema: value.schema, participantId: value.participantId, keysetId: value.keysetId,
		keysetVersion: value.keysetVersion, dkgRunId: value.dkgRunId,
		publicKeyPackageSha256: value.publicKeyPackageSha256, signerRosterDigest: value.signerRosterDigest,
		journalGeneration: value.journalGeneration, stateDirectory: value.stateDirectory,
		stateDirectoryIdentity: value.stateDirectoryIdentity, processIdentity: value.processIdentity,
		verifyingShare: value.verifyingShare,
	})
}

/**
 * Coordinator-side monotonic anchor. This database must not share a snapshot
 * boundary with signer journals. Restoring both sides together remains a
 * disclosed rollback limit and requires manual quarantine/key rotation.
 */
export class DemoSignerCoordinatorAnchorSqlite implements DemoSignerCoordinatorAnchorPort {
	readonly #assert: (binding: DemoSignerDurableBindingV1) => void
	readonly #observe: (binding: DemoSignerDurableBindingV1, processInstanceId: string) => void

	constructor(database: Database) {
		database.exec(`
			PRAGMA journal_mode = WAL;
			PRAGMA synchronous = FULL;
			CREATE TABLE IF NOT EXISTS demo_signer_coordinator_anchor (
				participant_id INTEGER PRIMARY KEY NOT NULL,
				stable_identity TEXT NOT NULL,
				maximum_restart_epoch INTEGER NOT NULL,
				process_instance_id TEXT
			) STRICT;
		`)
		const transaction = database.transaction((binding: DemoSignerDurableBindingV1) => {
			if (binding.schema !== 'COCO_DEMO_SIGNER_DURABLE_BINDING_V1'
				|| ![1, 2, 3, 4].includes(binding.participantId)
				|| !Number.isSafeInteger(binding.restartEpoch) || binding.restartEpoch < 1
				|| !/^[0-9a-f]{64}$/.test(binding.journalGeneration)
				|| !/^[0-9a-f]{64}$/.test(binding.stateDirectoryIdentity)) {
				throw new Error('DEMO_SIGNER_ANCHOR_BINDING: signer durable binding is malformed')
			}
			const identity = stableIdentity(binding)
			const found = database.query<{ stable_identity: string; maximum_restart_epoch: number }, [number]>(
				'SELECT stable_identity, maximum_restart_epoch FROM demo_signer_coordinator_anchor WHERE participant_id = ?',
			).get(binding.participantId)
			if (found === null) {
				database.query('INSERT INTO demo_signer_coordinator_anchor(participant_id, stable_identity, maximum_restart_epoch, process_instance_id) VALUES (?, ?, ?, NULL)')
					.run(binding.participantId, identity, binding.restartEpoch)
				return
			}
			if (found.stable_identity !== identity) {
				throw new Error('DEMO_SIGNER_ANCHOR_REPLACED: signer journal generation, DKG, state directory, or roster changed')
			}
			if (binding.restartEpoch < found.maximum_restart_epoch) {
				throw new Error('DEMO_SIGNER_ANCHOR_REGRESSED: signer restart epoch regressed')
			}
			if (binding.restartEpoch > found.maximum_restart_epoch) {
				const result = database.query('UPDATE demo_signer_coordinator_anchor SET maximum_restart_epoch = ?, process_instance_id = NULL WHERE participant_id = ? AND maximum_restart_epoch = ?')
					.run(binding.restartEpoch, binding.participantId, found.maximum_restart_epoch)
				if (result.changes !== 1) throw new Error('DEMO_SIGNER_ANCHOR_CAS: signer epoch changed concurrently')
			}
		})
		this.#assert = transaction.immediate.bind(transaction)
		const observe = database.transaction((binding: DemoSignerDurableBindingV1, processInstanceId: string) => {
			if (processInstanceId.length === 0 || processInstanceId.trim() !== processInstanceId) {
				throw new Error('DEMO_SIGNER_ANCHOR_PROCESS: process instance is invalid')
			}
			const found = database.query<{
				stable_identity: string; maximum_restart_epoch: number; process_instance_id: string | null
			}, [number]>('SELECT stable_identity, maximum_restart_epoch, process_instance_id FROM demo_signer_coordinator_anchor WHERE participant_id = ?')
				.get(binding.participantId)
			if (found === null || found.stable_identity !== stableIdentity(binding)
				|| found.maximum_restart_epoch !== binding.restartEpoch) {
				throw new Error('DEMO_SIGNER_ANCHOR_PROCESS: process observation differs from anchored signer metadata')
			}
			if (found.process_instance_id !== null && found.process_instance_id !== processInstanceId) {
				throw new Error('DEMO_SIGNER_ANCHOR_ROLLBACK: another process reused an already observed restart epoch')
			}
			if (found.process_instance_id === null) {
				const result = database.query('UPDATE demo_signer_coordinator_anchor SET process_instance_id = ? WHERE participant_id = ? AND maximum_restart_epoch = ? AND process_instance_id IS NULL')
					.run(processInstanceId, binding.participantId, binding.restartEpoch)
				if (result.changes !== 1) throw new Error('DEMO_SIGNER_ANCHOR_CAS: signer process observation changed concurrently')
			}
		})
		this.#observe = observe.immediate.bind(observe)
	}

	async assertCurrent(binding: DemoSignerDurableBindingV1): Promise<void> {
		this.#assert(structuredClone(binding))
	}

	async observeProcess(binding: DemoSignerDurableBindingV1, processInstanceId: string): Promise<void> {
		this.#observe(structuredClone(binding), processInstanceId)
	}
}
