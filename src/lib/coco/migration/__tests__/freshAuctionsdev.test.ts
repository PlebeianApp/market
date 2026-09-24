import { describe, expect, test } from 'bun:test'
import { evaluateCutover } from '../cutover'
import { buildCanonicalWalletNamespace } from '../identity'
import {
	commitFreshAuctionsdevSelection,
	createFreshAuctionsdevEvidence,
	evaluateFreshAuctionsdevEvidence,
	rollbackFreshAuctionsdevSelection,
	type FreshAuctionsdevEvidenceInput,
} from '../freshAuctionsdev'
import { createFreshAuctionsdevPublicReport, verifyFreshAuctionsdevPublicReport } from '../freshAuctionsdevReport'
import { runFreshAuctionsdevCocoMutationAgainstControlStore, runLegacyMutationAgainstControlStore } from '../runtimeGate'
import { InMemoryMigrationControlStore, beginLegacyMonetaryMutation, commitCutover, createInitialFreshTestControlRecord } from '../store'

const ACCOUNT = 'a'.repeat(64)
const IDENTITY = {
	account: ACCOUNT,
	environment: 'auctionsdev' as const,
	namespace: buildCanonicalWalletNamespace({ account: ACCOUNT, environment: 'auctionsdev' }),
	epoch: 'fresh-auctionsdev-epoch-1',
}

const baseInput = (): FreshAuctionsdevEvidenceInput => ({
	...IDENTITY,
	marketCommit: 'b'.repeat(40),
	frozenSnapshotId: `sha256:${'1'.repeat(64)}`,
	collectedAtMs: 100,
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

describe('fresh AuctionsDev wallet authority', () => {
	test('accepts only a fresh, zero-balance, verified fake-mint namespace', async () => {
		const evidence = await createFreshAuctionsdevEvidence(baseInput())
		expect(await evaluateFreshAuctionsdevEvidence(evidence)).toEqual({ allowed: true, blockers: [] })
		const store = new InMemoryMigrationControlStore([createInitialFreshTestControlRecord(IDENTITY)])
		const committed = await commitFreshAuctionsdevSelection(store, IDENTITY, 0, evidence)
		expect(committed).toMatchObject({
			authorityPurpose: 'FRESH_AUCTIONSDEV_TEST',
			phase: 'FRESH_TEST_COMMITTED',
			legacyMonetaryMutationAllowed: false,
			cocoCanonical: true,
		})
		expect(committed.cutoverEvidenceCommitment).toBeNull()
		expect(committed.freshTestSelectionCommitment).toMatch(/^sha256:[0-9a-f]{64}$/)
		expect(evaluateCutover(committed).blockers).toContain('WRONG_AUTHORITY_PURPOSE')
		const report = await createFreshAuctionsdevPublicReport(evidence, {
			legacyWritersDisabled: !committed.legacyMonetaryMutationAllowed,
			selectionCommitment: committed.freshTestSelectionCommitment!,
		})
		expect(report).toMatchObject({
			schemaVersion: 1,
			profile: 'FRESH_AUCTIONSDEV_TEST',
			verdict: 'FRESH_AUCTIONSDEV_READY',
			marketCommit: 'b'.repeat(40),
			counts: { cocoBalance: '0', truncatedStorage: 0, authoritativeDatabases: 1 },
			assertions: { legacyWritersDisabled: true, protectedSeedRoundTrip: true },
		})
		expect(report.reportCommitment).toMatch(/^sha256:[0-9a-f]{64}$/)
		expect(JSON.stringify(report)).not.toContain(ACCOUNT)
		expect(JSON.stringify(report)).not.toMatch(/bearer|privateKey|encodedToken|proofs/i)
		await expect(
			verifyFreshAuctionsdevPublicReport(report, {
				marketCommit: 'b'.repeat(40),
				account: ACCOUNT,
				environment: 'auctionsdev',
			}),
		).resolves.toMatchObject({ reportCommitment: report.reportCommitment })
		await expect(
			verifyFreshAuctionsdevPublicReport(
				{ ...report, bearerToken: 'forbidden' },
				{
					marketCommit: 'b'.repeat(40),
					account: ACCOUNT,
					environment: 'auctionsdev',
				},
			),
		).rejects.toThrow('does not match schema')
	})

	test('reports every independent fresh-wallet fail-closed condition', async () => {
		const cases: Array<[string, Partial<FreshAuctionsdevEvidenceInput>]> = [
			['FAKE_MINT_UNVERIFIED', { fakeMintIdentityVerified: false }],
			['FAKE_MINT_MISSING', { fakeMintCount: 0 }],
			['LEGACY_INVENTORY_PRESENT', { legacySpendableCount: 1 }],
			['LEGACY_INVENTORY_PRESENT', { legacyReservationCount: 1 }],
			['LEGACY_INVENTORY_PRESENT', { legacyPendingCount: 1 }],
			['LEGACY_AUTHORITY_PRESENT', { legacyAuthorityCount: 1 }],
			['AUCTION_RECOVERY_PRESENT', { auctionRecoveryCount: 1 }],
			['TRUNCATED_STORAGE_PRESENT', { truncatedStorageCount: 1 }],
			['TRUNCATED_DATABASE_PRESENT', { truncatedDatabaseCount: 1 }],
			['ACTIVE_LEGACY_WRITER', { activeLegacyWriterCount: 1 }],
			['COCO_BALANCE_NONZERO', { cocoBalanceAmount: 1n }],
			['COCO_HISTORY_PRESENT', { cocoHistoryCount: 1 }],
			['COCO_IN_FLIGHT', { cocoInFlightCount: 1 }],
			['COCO_ORPHAN', { cocoOrphanCount: 1 }],
			['HOST_COMMAND_PRESENT', { hostCommandCount: 1 }],
			['AUTHORITATIVE_DATABASE_INVALID', { authoritativeDatabaseCount: 0 }],
			['AUTHORITATIVE_DATABASE_INVALID', { authoritativeDatabaseCount: 2 }],
			['NAMESPACE_NOT_FRESH', { preexistingAuthoritativeDatabaseCount: 1 }],
			['NAMESPACE_NOT_FRESH', { preexistingVaultRecordCount: 1 }],
			['VAULT_ROUND_TRIP_FAILED', { vaultRoundTripVerified: false }],
			['VAULT_KEY_EXTRACTABLE', { vaultKeyExtractable: true }],
			['PLAINTEXT_SECRET_PRESENT', { plaintextSecretRecordCount: 1 }],
		]
		for (const [blocker, patch] of cases) {
			const evidence = await createFreshAuctionsdevEvidence({ ...baseInput(), ...patch })
			expect((await evaluateFreshAuctionsdevEvidence(evidence)).blockers).toContain(blocker)
		}
	})

	test('rejects production, staging, truncated accounts, mismatched SHA, and tampered evidence', async () => {
		for (const environment of ['production', 'staging'] as const) {
			const account = baseInput()
			await expect(
				createFreshAuctionsdevEvidence({
					...account,
					environment,
					namespace: buildCanonicalWalletNamespace({ account: ACCOUNT, environment }),
				}),
			).rejects.toMatchObject({ code: 'INVALID_INPUT' })
		}
		await expect(createFreshAuctionsdevEvidence({ ...baseInput(), account: 'abc' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
		const evidence = await createFreshAuctionsdevEvidence(baseInput())
		expect(
			(
				await evaluateFreshAuctionsdevEvidence(evidence, {
					marketCommit: 'c'.repeat(40),
					account: ACCOUNT,
					environment: 'auctionsdev',
				})
			).blockers,
		).toContain('IDENTITY_MISMATCH')
		expect((await evaluateFreshAuctionsdevEvidence({ ...evidence, cocoHistoryCount: 1 })).blockers).toContain('EVIDENCE_COMMITMENT_INVALID')
	})

	test('stale legacy runtime shuts down and Coco mutation starts only after the exact fresh commit', async () => {
		const evidence = await createFreshAuctionsdevEvidence(baseInput())
		const store = new InMemoryMigrationControlStore([createInitialFreshTestControlRecord(IDENTITY)])
		let legacyCalls = 0
		let cocoCalls = 0
		const legacyCall = () =>
			runLegacyMutationAgainstControlStore(store, { account: ACCOUNT, environment: 'auctionsdev', writerId: 'stale-runtime' }, async () => {
				legacyCalls++
			})
		const cocoCall = () =>
			runFreshAuctionsdevCocoMutationAgainstControlStore(store, { account: ACCOUNT, environment: 'auctionsdev' }, async () => {
				cocoCalls++
			})
		await expect(cocoCall()).rejects.toMatchObject({ code: 'CUTOVER_BLOCKED' })
		await commitFreshAuctionsdevSelection(store, IDENTITY, 0, evidence)
		await expect(legacyCall()).rejects.toMatchObject({ code: 'LEGACY_WRITER_DISABLED' })
		await cocoCall()
		expect({ legacyCalls, cocoCalls }).toEqual({ legacyCalls: 0, cocoCalls: 1 })
	})

	test('rejects local-e2e identity and blocks AuctionsDev Coco mutations before fresh commit', async () => {
		const store = new InMemoryMigrationControlStore([createInitialFreshTestControlRecord(IDENTITY)])
		await expect(
			runFreshAuctionsdevCocoMutationAgainstControlStore(store, { account: ACCOUNT, environment: 'auctionsdev' }, async () => {}),
		).rejects.toMatchObject({ code: 'CUTOVER_BLOCKED' })
		await expect(
			runFreshAuctionsdevCocoMutationAgainstControlStore(store, { account: ACCOUNT, environment: 'local-e2e' as never }, async () => {}),
		).rejects.toMatchObject({ code: 'INVALID_INPUT' })
	})

	test('rolls back before commit but is irreversible after commit', async () => {
		const rollbackStore = new InMemoryMigrationControlStore([createInitialFreshTestControlRecord(IDENTITY)])
		expect((await rollbackFreshAuctionsdevSelection(rollbackStore, IDENTITY, 0)).phase).toBe('FRESH_TEST_ROLLED_BACK')
		await expect(
			commitFreshAuctionsdevSelection(rollbackStore, IDENTITY, 1, await createFreshAuctionsdevEvidence(baseInput())),
		).rejects.toMatchObject({ code: 'INVALID_PHASE' })

		const committedStore = new InMemoryMigrationControlStore([createInitialFreshTestControlRecord(IDENTITY)])
		await commitFreshAuctionsdevSelection(committedStore, IDENTITY, 0, await createFreshAuctionsdevEvidence(baseInput()))
		await expect(rollbackFreshAuctionsdevSelection(committedStore, IDENTITY, 1)).rejects.toMatchObject({ code: 'INVALID_PHASE' })
	})

	test('active writer and stale revision prevent an atomic selection', async () => {
		const store = new InMemoryMigrationControlStore([createInitialFreshTestControlRecord(IDENTITY)])
		await beginLegacyMonetaryMutation(store, {
			identity: IDENTITY,
			expectedRevision: 0,
			leaseId: 'lease-1',
			writerId: 'nip60-send',
			operationId: 'operation-1',
		})
		await expect(
			commitFreshAuctionsdevSelection(store, IDENTITY, 0, await createFreshAuctionsdevEvidence(baseInput())),
		).rejects.toMatchObject({
			code: 'STALE_REVISION',
		})
	})

	test('fresh authority can never call the production cutover commit', async () => {
		const record = createInitialFreshTestControlRecord(IDENTITY)
		const store = new InMemoryMigrationControlStore([record])
		await expect(
			commitCutover(store, {
				...IDENTITY,
				revision: 0,
				phase: 'COCO_READY',
				inventoryCommitment: `sha256:${'1'.repeat(64)}`,
				accountingCommitment: `sha256:${'2'.repeat(64)}`,
				cocoAuthorityGeneration: 0,
				recoveryQuiescenceCommitment: `sha256:${'3'.repeat(64)}`,
				legacyQuiescenceCommitment: `sha256:${'4'.repeat(64)}`,
			}),
		).rejects.toMatchObject({ code: 'CUTOVER_BLOCKED' })
	})
})
