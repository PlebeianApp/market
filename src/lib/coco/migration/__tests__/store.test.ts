import { describe, expect, test } from 'bun:test'
import {
	InMemoryMigrationControlStore,
	MigrationSafetyError,
	assertMigrationControlRecordShape,
	beginLegacyMonetaryMutation,
	commitCutover,
	createInitialControlRecord,
	endLegacyMonetaryMutation,
	installReadinessEvidence,
	recordLateInventoryDiscovery,
	transitionMigrationPhase,
	type CutoverExpectedState,
	type MigrationControlRecord,
} from '..'
import { IDENTITY, createReadyRecord } from './fixtures'

function expectedFor(record: MigrationControlRecord): CutoverExpectedState {
	return {
		...IDENTITY,
		revision: record.revision,
		phase: 'COCO_READY',
		inventoryCommitment: record.inventorySeal!.commitment,
		accountingCommitment: record.accountingReport!.commitment,
		cocoAuthorityGeneration: record.cocoAuthorityGeneration!,
		recoveryQuiescenceCommitment: record.recoveryQuiescenceCertificate!.commitment,
		legacyQuiescenceCommitment: record.legacyQuiescenceCertificate!.commitment,
	}
}

describe('migration control CAS', () => {
	test('rejects undeclared fields even when their names do not look secret', async () => {
		const ready = await createReadyRecord()
		expect(() => assertMigrationControlRecordShape({ ...ready, opaqueData: 'not-an-approved-field' })).toThrow()
	})

	test('survives a store restart at every pre-cutover phase', async () => {
		let record = createInitialControlRecord(IDENTITY)
		const phases = ['MIGRATION_SNAPSHOT_FROZEN', 'IMPORTING', 'RESOLVING', 'VERIFYING', 'COCO_READY'] as const
		for (const phase of phases) {
			const restarted = new InMemoryMigrationControlStore([record])
			record = await transitionMigrationPhase(restarted, IDENTITY, record.revision, phase)
			expect((await restarted.get(IDENTITY.namespace))?.phase).toBe(phase)
		}
	})

	test('rejects stale revision, stale epoch, wrong account, and wrong environment', async () => {
		const record = createInitialControlRecord(IDENTITY)
		const store = new InMemoryMigrationControlStore([record])
		await expect(transitionMigrationPhase(store, IDENTITY, 99, 'MIGRATION_SNAPSHOT_FROZEN')).rejects.toMatchObject({
			code: 'STALE_REVISION',
		})
		await expect(
			transitionMigrationPhase(store, { ...IDENTITY, epoch: 'stale-epoch' }, 0, 'MIGRATION_SNAPSHOT_FROZEN'),
		).rejects.toMatchObject({ code: 'STALE_EPOCH' })
		await expect(
			transitionMigrationPhase(store, { ...IDENTITY, account: 'b'.repeat(64) }, 0, 'MIGRATION_SNAPSHOT_FROZEN'),
		).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
		await expect(
			transitionMigrationPhase(store, { ...IDENTITY, environment: 'staging' }, 0, 'MIGRATION_SNAPSHOT_FROZEN'),
		).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
	})

	test('commits cutover atomically and permanently disables legacy monetary writers', async () => {
		const ready = await createReadyRecord()
		const store = new InMemoryMigrationControlStore([ready])
		const committed = await commitCutover(store, expectedFor(ready))
		expect(committed.phase).toBe('CUTOVER_COMMITTED')
		expect(committed.legacyMonetaryMutationAllowed).toBe(false)
		expect(committed.cocoCanonical).toBe(true)
		expect(committed.boundCocoGeneration).toBe(7)
		expect(committed.cutoverEvidenceCommitment).toMatch(/^sha256:[0-9a-f]{64}$/)
		const restarted = new InMemoryMigrationControlStore([committed])
		expect((await restarted.get(IDENTITY.namespace))?.phase).toBe('CUTOVER_COMMITTED')

		await expect(
			beginLegacyMonetaryMutation(store, {
				identity: IDENTITY,
				expectedRevision: ready.revision,
				leaseId: 'stale-runtime-lease',
				writerId: 'stale-runtime',
				operationId: 'stale-operation',
			}),
		).rejects.toMatchObject({ code: 'LEGACY_WRITER_DISABLED' })
	})

	test('an active legacy writer lease blocks cutover until its exact lease closes', async () => {
		const ready = await createReadyRecord()
		const store = new InMemoryMigrationControlStore([ready])
		const lease = await beginLegacyMonetaryMutation(store, {
			identity: IDENTITY,
			expectedRevision: ready.revision,
			leaseId: 'writer-lease',
			writerId: 'nip60-send',
			operationId: 'legacy-send-1',
			startedAtMs: 10,
		})
		const withLease = (await store.get(IDENTITY.namespace))!
		await expect(commitCutover(store, expectedFor(withLease as MigrationControlRecord))).rejects.toMatchObject({
			code: 'CUTOVER_BLOCKED',
		})
		await endLegacyMonetaryMutation(store, IDENTITY, lease.leaseId)
		const afterLease = (await store.get(IDENTITY.namespace))!
		expect(afterLease.activeLegacyWriters).toHaveLength(0)
		expect(afterLease.legacyWriterGeneration).toBe(2)
		await expect(commitCutover(store, expectedFor(afterLease as MigrationControlRecord))).rejects.toMatchObject({
			code: 'CUTOVER_BLOCKED',
		})
	})

	test('rejects stale cutover evidence without modifying the durable record', async () => {
		const ready = await createReadyRecord()
		const store = new InMemoryMigrationControlStore([ready])
		await expect(commitCutover(store, { ...expectedFor(ready), revision: ready.revision - 1 })).rejects.toBeInstanceOf(MigrationSafetyError)
		expect((await store.get(IDENTITY.namespace))?.phase).toBe('COCO_READY')
	})

	test('readiness installation recomputes evidence instead of trusting persisted booleans', async () => {
		const ready = await createReadyRecord()
		const empty: MigrationControlRecord = {
			...ready,
			revision: 8,
			inventorySeal: null,
			accountingReport: null,
			cocoAuthorityGeneration: null,
			recoveryQuiescenceCertificate: null,
			legacyQuiescenceCertificate: null,
		}
		const store = new InMemoryMigrationControlStore([empty])
		await expect(
			installReadinessEvidence(store, IDENTITY, 8, {
				inventorySeal: ready.inventorySeal!,
				accountingReport: { ...ready.accountingReport!, reconciled: false },
				cocoAuthorityGeneration: 7,
				recoveryQuiescenceCertificate: ready.recoveryQuiescenceCertificate!,
				legacyQuiescenceCertificate: ready.legacyQuiescenceCertificate!,
			}),
		).rejects.toMatchObject({ code: 'INVALID_INPUT' })
		expect((await store.get(IDENTITY.namespace))?.revision).toBe(8)
	})

	test('late discovery durably invalidates the seal across restart', async () => {
		const ready = await createReadyRecord()
		const store = new InMemoryMigrationControlStore([ready])
		const invalidated = await recordLateInventoryDiscovery(store, IDENTITY, ready.revision, 'late-source')
		expect(invalidated.lateDiscoveryIds).toEqual(['late-source'])
		expect(invalidated.inventorySeal?.lateDiscoveries).toEqual(['late-source'])
		const restarted = new InMemoryMigrationControlStore([invalidated])
		expect((await restarted.get(IDENTITY.namespace))?.lateDiscoveryIds).toEqual(['late-source'])
		await expect(commitCutover(restarted, expectedFor(invalidated as MigrationControlRecord))).rejects.toMatchObject({
			code: 'CUTOVER_BLOCKED',
		})
	})
})
