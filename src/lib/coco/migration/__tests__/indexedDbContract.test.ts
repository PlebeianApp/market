import 'fake-indexeddb/auto'
import { describe, expect, test } from 'bun:test'
import {
	IndexedDbMigrationControlStore,
	commitCutover,
	runLegacyMutationAgainstControlStore,
	type CutoverExpectedState,
	type MigrationControlRecord,
} from '..'
import { IndexedDbRecoveryMetadataStore, createRecoveryMetadata } from '../../recovery'
import { createReadyRecord } from './fixtures'

function expectedFor(record: MigrationControlRecord): CutoverExpectedState {
	return {
		namespace: record.namespace,
		account: record.account,
		environment: record.environment,
		epoch: record.epoch,
		revision: record.revision,
		phase: 'COCO_READY',
		inventoryCommitment: record.inventorySeal!.commitment,
		accountingCommitment: record.accountingReport!.commitment,
		cocoAuthorityGeneration: record.cocoAuthorityGeneration!,
		recoveryQuiescenceCommitment: record.recoveryQuiescenceCertificate!.commitment,
		legacyQuiescenceCommitment: record.legacyQuiescenceCertificate!.commitment,
	}
}

describe('IndexedDB migration and recovery contract', () => {
	test('persists an atomic cutover fence that a stale runtime observes after reopening', async () => {
		const ready = await createReadyRecord()
		const databaseName = `coco-control-contract-${crypto.randomUUID()}`
		const first = new IndexedDbMigrationControlStore(databaseName)
		await first.create(ready)
		await commitCutover(first, expectedFor(ready))
		first.close()

		const reopened = new IndexedDbMigrationControlStore(databaseName)
		const committed = await reopened.get(ready.namespace)
		expect(committed).toMatchObject({
			phase: 'CUTOVER_COMMITTED',
			legacyMonetaryMutationAllowed: false,
			cocoCanonical: true,
		})
		let calls = 0
		await expect(
			runLegacyMutationAgainstControlStore(
				reopened,
				{ account: ready.account, environment: ready.environment, writerId: 'stale-browser-runtime' },
				async () => {
					calls++
				},
			),
		).rejects.toMatchObject({ code: 'LEGACY_WRITER_DISABLED' })
		expect(calls).toBe(0)
		reopened.close()
	})

	test('uses the full wallet namespace in the recovery composite key', async () => {
		const databaseName = `coco-recovery-contract-${crypto.randomUUID()}`
		const store = new IndexedDbRecoveryMetadataStore(databaseName)
		const namespaceA = `plebeian-market:coco:v2:production:nostr:${'a'.repeat(64)}`
		const namespaceB = `plebeian-market:coco:v2:production:nostr:${'b'.repeat(64)}`
		const base = {
			id: 'same-id',
			cocoOperationId: 'operation-1',
			derivationPurpose: 'auction-p2pk',
			derivationVersion: 1,
			derivationReference: 'public-reference-1',
			publicKey: `02${'3'.repeat(64)}`,
			publicConditionFingerprint: `sha256:${'4'.repeat(64)}`,
			status: 'PENDING' as const,
			updatedAtMs: 1,
		}
		await store.put(createRecoveryMetadata({ ...base, walletNamespace: namespaceA }))
		await store.put(createRecoveryMetadata({ ...base, walletNamespace: namespaceB, cocoOperationId: 'operation-2' }))

		expect((await store.get(namespaceA, base.id))?.cocoOperationId).toBe('operation-1')
		expect((await store.get(namespaceB, base.id))?.cocoOperationId).toBe('operation-2')
		expect(await store.list(namespaceA)).toHaveLength(1)
		expect(await store.list(namespaceB)).toHaveLength(1)
		store.close()
	})
})
