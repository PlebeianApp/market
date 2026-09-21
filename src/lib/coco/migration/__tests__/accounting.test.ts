import { describe, expect, test } from 'bun:test'
import {
	buildAccountingReport,
	createCocoDestinationEvidence,
	createVerifiedDispositionEvidence,
	enumerateProductionInventory,
	sealProductionInventory,
} from '..'
import { IDENTITY, createInventoryPort, item, projection } from './fixtures'

async function accountingFixture() {
	const run = await enumerateProductionInventory(
		IDENTITY,
		createInventoryPort({
			LEGACY_SPENDABLE_PROOFS: projection([item('source-1', { amount: BigInt(8) })]),
			COCO_OPENING_BASELINE: projection([item('opening-1', { amount: BigInt(10) })]),
		}),
	)
	const seal = await sealProductionInventory(run, 1)
	const source = seal.items.find((candidate) => candidate.sourceId === 'source-1')!
	const disposition = await createVerifiedDispositionEvidence(source, {
		disposition: 'COCO_OWNED',
		destinationAmount: BigInt(7),
		consumedAmount: BigInt(0),
		feeAmount: BigInt(1),
		destinationId: 'destination-1',
		cocoOperationId: 'operation-1',
		evidenceId: 'evidence-1',
	})
	return { seal, source, disposition }
}

describe('migration accounting', () => {
	test('reconciles opening Coco plus migrated value against final destinations, consumption, and fees', async () => {
		const { seal, disposition } = await accountingFixture()
		const destination = await createCocoDestinationEvidence({
			mint: 'https://mint.example',
			unit: 'sat',
			amount: BigInt(17),
			authorityGeneration: 1,
			snapshotId: 'snapshot-1',
		})
		const report = await buildAccountingReport(seal, [disposition], [destination])
		expect(report.reconciled).toBe(true)
		expect(report.buckets[0].delta).toBe(BigInt(0))
	})

	test('reports an accounting mismatch without silently dropping value', async () => {
		const { seal, disposition } = await accountingFixture()
		const destination = await createCocoDestinationEvidence({
			mint: 'https://mint.example',
			unit: 'sat',
			amount: BigInt(16),
			authorityGeneration: 1,
			snapshotId: 'snapshot-1',
		})
		const report = await buildAccountingReport(seal, [disposition], [destination])
		expect(report.reconciled).toBe(false)
		expect(report.failureReasons.some((reason) => reason.startsWith('bucket-accounting-mismatch:'))).toBe(true)
	})

	test('rejects duplicate source satisfaction and duplicate destination identity', async () => {
		const { seal, disposition } = await accountingFixture()
		const destination = await createCocoDestinationEvidence({
			mint: 'https://mint.example',
			unit: 'sat',
			amount: BigInt(17),
			authorityGeneration: 1,
			snapshotId: 'snapshot-1',
		})
		const report = await buildAccountingReport(seal, [disposition, disposition], [destination])
		expect(report.reconciled).toBe(false)
		expect(report.failureReasons).toContain('duplicate-or-unknown-source:source-1')
	})

	test('does not accept a caller boolean as migration success evidence', async () => {
		const { source } = await accountingFixture()
		await expect(
			createVerifiedDispositionEvidence(source, {
				disposition: 'COCO_OWNED',
				destinationAmount: BigInt(8),
				consumedAmount: BigInt(0),
				feeAmount: BigInt(0),
				evidenceId: 'caller-says-true',
			}),
		).rejects.toMatchObject({ code: 'INVALID_INPUT' })
	})
})
