import 'fake-indexeddb/auto'
import { describe, expect, test } from 'bun:test'
import { commitFreshAuctionsdevSelection, createFreshAuctionsdevEvidence } from '../freshAuctionsdev'
import { buildCanonicalWalletNamespace } from '../identity'
import { IndexedDbMigrationControlStore } from '../indexedDbStore'
import type { CutoverExpectedState, MigrationControlRecord } from '../model'
import { runLegacyMutationAgainstControlStore } from '../runtimeGate'
import { commitCutover, createInitialFreshTestControlRecord } from '../store'
import { IndexedDbRecoveryMetadataStore, createRecoveryMetadata } from '../../recovery'
import { hasCocoSeedVaultRecord, verifyCocoSeedVaultRoundTrip } from '../../seedVault'
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
	test('round-trips the protected seed with a non-extractable wrapping key', async () => {
		const scope = `test:${crypto.randomUUID()}`
		expect(await hasCocoSeedVaultRecord(scope)).toBe(false)
		const result = await verifyCocoSeedVaultRoundTrip(scope)
		expect(result).toMatchObject({ roundTripVerified: true, keyExtractable: false })
		expect(result.ciphertextCommitment).toMatch(/^sha256:[0-9a-f]{64}$/)
		expect(await hasCocoSeedVaultRecord(scope)).toBe(true)
	})

	test('persists the irreversible fresh-test authority and full 64-character namespace', async () => {
		const account = 'c'.repeat(64)
		const identity = {
			account,
			environment: 'auctionsdev' as const,
			namespace: buildCanonicalWalletNamespace({ account, environment: 'auctionsdev' }),
			epoch: 'indexeddb-fresh-epoch',
		}
		const databaseName = `coco-fresh-control-${crypto.randomUUID()}`
		const store = new IndexedDbMigrationControlStore(databaseName)
		await store.create(createInitialFreshTestControlRecord(identity))
		const evidence = await createFreshAuctionsdevEvidence({
			...identity,
			marketCommit: 'd'.repeat(40),
			frozenSnapshotId: `sha256:${'1'.repeat(64)}`,
			collectedAtMs: 1,
			fakeMintCount: 1,
			fakeMintIdentityCommitment: `sha256:${'2'.repeat(64)}`,
			fakeMintIdentityVerified: true,
			legacySpendableCount: 0,
			legacyReservationCount: 0,
			legacyPendingCount: 0,
			legacyAuthorityCount: 0,
			auctionRecoveryCount: 0,
			truncatedStorageCount: 0,
			truncatedDatabaseCount: 0,
			activeLegacyWriterCount: 0,
			legacyWriterGeneration: 0,
			cocoBalanceAmount: 0n,
			cocoHistoryCount: 0,
			cocoInFlightCount: 0,
			cocoOrphanCount: 0,
			hostCommandCount: 0,
			authoritativeDatabaseCount: 1,
			preexistingAuthoritativeDatabaseCount: 0,
			preexistingVaultRecordCount: 0,
			vaultRoundTripVerified: true,
			vaultKeyExtractable: false,
			plaintextSecretRecordCount: 0,
		})
		await commitFreshAuctionsdevSelection(store, identity, 0, evidence)
		store.close()

		const reopened = new IndexedDbMigrationControlStore(databaseName)
		const committed = await reopened.get(identity.namespace)
		expect(committed).toMatchObject({
			account,
			authorityPurpose: 'FRESH_AUCTIONSDEV_TEST',
			phase: 'FRESH_TEST_COMMITTED',
			legacyMonetaryMutationAllowed: false,
			cocoCanonical: true,
		})
		reopened.close()
	})

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
