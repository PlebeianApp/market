import { createCommitment } from './commitment'
import { normalizeMintUrl, normalizeUnit, requireSafeId } from './identity'
import {
	MigrationSafetyError,
	type AccountingBucketResult,
	type AccountingReport,
	type CocoDestinationEvidence,
	type FinalDisposition,
	type InventoryItem,
	type InventorySeal,
	type VerifiedDispositionEvidence,
} from './model'

export interface VerifiedDispositionInput {
	disposition: FinalDisposition
	destinationAmount: bigint
	consumedAmount: bigint
	feeAmount: bigint
	destinationId?: string
	cocoOperationId?: string
	evidenceId: string
}

export interface CocoDestinationInput {
	mint: string
	unit: string
	amount: bigint
	authorityGeneration: number
	snapshotId: string
}

function requireAmount(value: unknown, field: string): bigint {
	if (typeof value !== 'bigint' || value < BigInt(0)) throw new MigrationSafetyError('INVALID_INPUT', `${field} is invalid`)
	return value
}

function bucketKey(mint: string, unit: string): string {
	return JSON.stringify([mint, unit])
}

export async function createVerifiedDispositionEvidence(
	source: InventoryItem,
	input: VerifiedDispositionInput,
): Promise<Readonly<VerifiedDispositionEvidence>> {
	const destinationAmount = requireAmount(input.destinationAmount, 'destinationAmount')
	const consumedAmount = requireAmount(input.consumedAmount, 'consumedAmount')
	const feeAmount = requireAmount(input.feeAmount, 'feeAmount')
	const evidenceId = requireSafeId(input.evidenceId, 'evidenceId')
	const destinationId = input.destinationId ? requireSafeId(input.destinationId, 'destinationId') : undefined
	const cocoOperationId = input.cocoOperationId ? requireSafeId(input.cocoOperationId, 'cocoOperationId') : undefined
	if (source.cocoOperationId && source.cocoOperationId !== cocoOperationId) {
		throw new MigrationSafetyError('IDENTITY_MISMATCH', 'disposition is bound to another Coco operation')
	}
	if (input.disposition === 'COCO_OWNED') {
		if (!destinationId || !cocoOperationId || consumedAmount !== BigInt(0) || destinationAmount + feeAmount !== source.amount) {
			throw new MigrationSafetyError('INVALID_INPUT', 'COCO_OWNED evidence is not bound to a balanced Coco destination')
		}
	} else if (input.disposition === 'CONSUMED_COMPLETED') {
		if (!destinationId || destinationAmount !== BigInt(0) || consumedAmount + feeAmount !== source.amount) {
			throw new MigrationSafetyError('INVALID_INPUT', 'CONSUMED_COMPLETED evidence is not bound to a balanced terminal effect')
		}
	} else if (destinationAmount !== BigInt(0) || consumedAmount !== BigInt(0) || feeAmount !== BigInt(0)) {
		throw new MigrationSafetyError('INVALID_INPUT', 'non-terminal disposition cannot account for value')
	}
	const payload = {
		sourceId: source.sourceId,
		disposition: input.disposition,
		mint: source.mint,
		unit: source.unit,
		sourceAmount: source.amount,
		destinationAmount,
		consumedAmount,
		feeAmount,
		...(destinationId ? { destinationId } : {}),
		...(cocoOperationId ? { cocoOperationId } : {}),
		evidenceId,
	}
	return Object.freeze({
		...payload,
		evidenceCommitment: await createCommitment('market-coco-v2-disposition-evidence-v1', payload),
	})
}

export async function createCocoDestinationEvidence(input: CocoDestinationInput): Promise<Readonly<CocoDestinationEvidence>> {
	const payload = {
		mint: normalizeMintUrl(input.mint),
		unit: normalizeUnit(input.unit),
		amount: requireAmount(input.amount, 'Coco destination amount'),
		authorityGeneration: input.authorityGeneration,
		snapshotId: requireSafeId(input.snapshotId, 'snapshotId'),
	}
	if (!Number.isSafeInteger(payload.authorityGeneration) || payload.authorityGeneration < 0) {
		throw new MigrationSafetyError('INVALID_INPUT', 'Coco authority generation is invalid')
	}
	return Object.freeze({
		...payload,
		evidenceCommitment: await createCommitment('market-coco-v2-destination-evidence-v1', payload),
	})
}

async function dispositionEvidenceIsAuthentic(evidence: VerifiedDispositionEvidence): Promise<boolean> {
	const { evidenceCommitment: _commitment, ...payload } = evidence
	return (await createCommitment('market-coco-v2-disposition-evidence-v1', payload)) === evidence.evidenceCommitment
}

async function destinationEvidenceIsAuthentic(evidence: CocoDestinationEvidence): Promise<boolean> {
	const { evidenceCommitment: _commitment, ...payload } = evidence
	return (await createCommitment('market-coco-v2-destination-evidence-v1', payload)) === evidence.evidenceCommitment
}

export async function buildAccountingReport(
	seal: InventorySeal,
	dispositions: readonly VerifiedDispositionEvidence[],
	destinations: readonly CocoDestinationEvidence[],
): Promise<Readonly<AccountingReport>> {
	const failures: string[] = []
	const migrationItems = seal.items.filter((item) => item.source !== 'COCO_OPENING_BASELINE')
	const openingItems = seal.items.filter((item) => item.source === 'COCO_OPENING_BASELINE')
	const sources = new Map(migrationItems.map((item) => [item.sourceId, item]))
	const seenSources = new Set<string>()
	const seenDestinations = new Set<string>()
	const seenDestinationIds = new Set<string>()

	for (const evidence of dispositions) {
		const source = sources.get(evidence.sourceId)
		if (!source || seenSources.has(evidence.sourceId)) {
			failures.push(`duplicate-or-unknown-source:${evidence.sourceId}`)
			continue
		}
		seenSources.add(evidence.sourceId)
		if (!(await dispositionEvidenceIsAuthentic(evidence))) failures.push(`invalid-disposition-commitment:${evidence.sourceId}`)
		if (source.mint !== evidence.mint || source.unit !== evidence.unit || source.amount !== evidence.sourceAmount) {
			failures.push(`source-binding-mismatch:${evidence.sourceId}`)
		}
		if (evidence.destinationId) {
			if (seenDestinationIds.has(evidence.destinationId)) failures.push(`duplicate-destination:${evidence.destinationId}`)
			seenDestinationIds.add(evidence.destinationId)
		}
		if (evidence.disposition !== 'COCO_OWNED' && evidence.disposition !== 'CONSUMED_COMPLETED') {
			failures.push(`unsafe-disposition:${evidence.sourceId}`)
		}
		if (evidence.destinationAmount + evidence.consumedAmount + evidence.feeAmount !== evidence.sourceAmount) {
			failures.push(`source-accounting-mismatch:${evidence.sourceId}`)
		}
	}
	for (const source of migrationItems) {
		if (!seenSources.has(source.sourceId)) failures.push(`missing-disposition:${source.sourceId}`)
	}
	for (const destination of destinations) {
		const key = bucketKey(destination.mint, destination.unit)
		if (seenDestinations.has(key)) failures.push(`duplicate-coco-destination:${key}`)
		seenDestinations.add(key)
		if (!(await destinationEvidenceIsAuthentic(destination))) failures.push(`invalid-destination-commitment:${key}`)
	}

	const allBucketKeys = new Set<string>()
	for (const item of seal.items) allBucketKeys.add(bucketKey(item.mint, item.unit))
	for (const destination of destinations) allBucketKeys.add(bucketKey(destination.mint, destination.unit))
	const buckets: AccountingBucketResult[] = []
	for (const key of Array.from(allBucketKeys).sort()) {
		const [mint, unit] = JSON.parse(key) as [string, string]
		const openingCocoAmount = openingItems
			.filter((item) => item.mint === mint && item.unit === unit)
			.reduce((total, item) => total + item.amount, BigInt(0))
		const bucketDispositions = dispositions.filter((item) => item.mint === mint && item.unit === unit)
		const verifiedMigratedSourceAmount = bucketDispositions.reduce((total, item) => total + item.sourceAmount, BigInt(0))
		const verifiedConsumedAmount = bucketDispositions.reduce((total, item) => total + item.consumedAmount, BigInt(0))
		const verifiedFeeAmount = bucketDispositions.reduce((total, item) => total + item.feeAmount, BigInt(0))
		const verifiedCocoDestinationAmount =
			destinations.find((destination) => destination.mint === mint && destination.unit === unit)?.amount ?? BigInt(0)
		const delta =
			verifiedCocoDestinationAmount + verifiedConsumedAmount + verifiedFeeAmount - openingCocoAmount - verifiedMigratedSourceAmount
		if (delta !== BigInt(0)) failures.push(`bucket-accounting-mismatch:${mint}:${unit}`)
		buckets.push(
			Object.freeze({
				mint,
				unit,
				openingCocoAmount,
				verifiedMigratedSourceAmount,
				verifiedCocoDestinationAmount,
				verifiedConsumedAmount,
				verifiedFeeAmount,
				delta,
			}),
		)
	}

	const reportWithoutCommitment = {
		namespace: seal.namespace,
		account: seal.account,
		environment: seal.environment,
		epoch: seal.epoch,
		reconciled: failures.length === 0,
		buckets: Object.freeze(buckets),
		sourceCount: migrationItems.length,
		dispositions: Object.freeze([...dispositions]),
		destinations: Object.freeze([...destinations]),
		failureReasons: Object.freeze(Array.from(new Set(failures)).sort()),
	}
	return Object.freeze({
		...reportWithoutCommitment,
		commitment: await createCommitment('market-coco-v2-accounting-report-v1', reportWithoutCommitment),
	})
}

export async function verifyAccountingReport(seal: InventorySeal, report: AccountingReport): Promise<void> {
	if (
		report.namespace !== seal.namespace ||
		report.account !== seal.account ||
		report.environment !== seal.environment ||
		report.epoch !== seal.epoch
	) {
		throw new MigrationSafetyError('IDENTITY_MISMATCH', 'accounting report identity does not match inventory')
	}
	const rebuilt = await buildAccountingReport(seal, report.dispositions, report.destinations)
	if (
		rebuilt.commitment !== report.commitment ||
		rebuilt.reconciled !== report.reconciled ||
		rebuilt.sourceCount !== report.sourceCount ||
		JSON.stringify(rebuilt.failureReasons) !== JSON.stringify(report.failureReasons)
	) {
		throw new MigrationSafetyError('INVALID_INPUT', 'accounting report does not match its source evidence')
	}
}
