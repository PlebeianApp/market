import { describe, expect, test } from 'bun:test'
import { evaluateCutover, selectWalletAuthority, type CutoverBlocker, type MigrationControlRecord } from '..'
import { createReadyRecord } from './fixtures'

function clone(record: MigrationControlRecord): MigrationControlRecord {
	return structuredClone(record)
}

describe('cutover predicate', () => {
	test('allows only the fully reconciled zero-unresolved state', async () => {
		const ready = await createReadyRecord()
		expect(evaluateCutover(ready)).toEqual({ allowed: true, blockers: [] })
	})

	test('enumerates every independent production blocker', async () => {
		const ready = await createReadyRecord()
		const cases: Array<[CutoverBlocker, (record: MigrationControlRecord) => void]> = [
			['WRONG_PHASE', (record) => void (record.phase = 'VERIFYING')],
			[
				'REQUIRED_ENUMERATOR_INCOMPLETE',
				(record) => void (record.inventorySeal = { ...record.inventorySeal!, completions: record.inventorySeal!.completions.slice(1) }),
			],
			['UNRESOLVED_ITEM', (record) => void (record.inventorySeal!.items[0].state = 'PENDING')],
			['UNSAFE_FINAL_DISPOSITION', (record) => void (record.accountingReport!.dispositions[0].disposition = 'QUARANTINED')],
			['RETAINED_LEGACY_AUTHORITY', (record) => void (record.inventorySeal!.items[0].legacyAuthorityRetained = true)],
			['LATE_DISCOVERY', (record) => void (record.inventorySeal = { ...record.inventorySeal!, lateDiscoveries: ['late-source'] })],
			['ACCOUNTING_NOT_RECONCILED', (record) => void (record.accountingReport!.reconciled = false)],
			['LEGACY_QUIESCENCE_MISSING', (record) => void (record.legacyQuiescenceCertificate = null)],
			[
				'ACTIVE_LEGACY_WRITER',
				(record) =>
					void (record.activeLegacyWriters = [
						{
							leaseId: 'lease',
							writerId: 'writer',
							operationId: 'operation',
							startedAtMs: 1,
							controlRevision: record.revision,
						},
					]),
			],
			['UNCERTAIN_REMOTE_EFFECT', (record) => void (record.inventorySeal!.items[0].uncertainRemoteEffect = true)],
			['ORPHAN_COCO_OPERATION', (record) => void (record.orphanCocoOperationIds = ['orphan-operation'])],
			['UNBOUND_HOST_COMMAND', (record) => void (record.unboundHostCommandIds = ['unbound-command'])],
			['COCO_AUTHORITY_GENERATION_UNKNOWN', (record) => void (record.cocoAuthorityGeneration = null)],
			['COCO_RECOVERY_QUIESCENCE_MISSING', (record) => void (record.recoveryQuiescenceCertificate = null)],
		]
		for (const [expectedBlocker, mutate] of cases) {
			const record = clone(ready)
			mutate(record)
			const assessment = evaluateCutover(record)
			expect(assessment.allowed, expectedBlocker).toBe(false)
			expect(assessment.blockers, expectedBlocker).toContain(expectedBlocker)
		}
	})

	test('Coco unavailability after commitment never selects legacy authority', async () => {
		const record = await createReadyRecord()
		record.phase = 'CUTOVER_COMMITTED'
		record.cocoCanonical = true
		record.legacyMonetaryMutationAllowed = false
		expect(selectWalletAuthority(record, false)).toBe('COCO_RECOVERY_UNAVAILABLE')
		expect(selectWalletAuthority(record, true)).toBe('COCO')
	})
})
