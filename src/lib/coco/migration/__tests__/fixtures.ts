import { buildAccountingReport, createCocoDestinationEvidence, createVerifiedDispositionEvidence } from '../accounting'
import {
	enumerateProductionInventory,
	sealProductionInventory,
	type InventoryProjection,
	type InventoryProjectionItem,
	type TrustedProductionInventoryPort,
} from '../inventory'
import type { MigrationControlRecord, MigrationIdentity, ProductionEnumerator } from '../model'
import { createInitialControlRecord, createLegacyQuiescenceCertificate } from '../store'
import { createRecoveryQuiescenceCertificate } from '../../recovery'

export const ACCOUNT = 'a'.repeat(64)
export const IDENTITY: MigrationIdentity = Object.freeze({
	namespace: `plebeian-market:coco:v2:production:nostr:${ACCOUNT}`,
	account: ACCOUNT,
	environment: 'production',
	epoch: 'epoch-2026-09-21',
})

const METHOD_BY_SOURCE: Record<ProductionEnumerator, keyof TrustedProductionInventoryPort> = {
	LEGACY_SPENDABLE_PROOFS: 'readLegacySpendableProofs',
	LEGACY_RESERVATIONS: 'readLegacyReservations',
	LEGACY_PENDING_OUTBOUND: 'readLegacyPendingOutbound',
	NIP60_PENDING_RECOVERY: 'readNip60PendingRecovery',
	AUCTION_BIDDER_P2PK: 'readAuctionBidderP2pk',
	AUCTION_SELLER_P2PK_AUTHORITY: 'readAuctionSellerP2pkAuthority',
	IN_FLIGHT_MIGRATIONS: 'readInFlightMigrations',
	UNRESOLVED_REMOTE_OPERATIONS: 'readUnresolvedRemoteOperations',
	COCO_OPENING_BASELINE: 'readCocoOpeningBaseline',
}

export function projection(items: readonly InventoryProjectionItem[] = []): InventoryProjection {
	return { sourceSchema: 'market-source-v1', sourceVersion: '1', snapshotId: 'frozen-snapshot-1', items }
}

export function createInventoryPort(
	overrides: Partial<Record<ProductionEnumerator, InventoryProjection>> = {},
): TrustedProductionInventoryPort {
	const port = {} as TrustedProductionInventoryPort
	for (const [source, method] of Object.entries(METHOD_BY_SOURCE) as [ProductionEnumerator, keyof TrustedProductionInventoryPort][]) {
		port[method] = async () => overrides[source] ?? projection()
	}
	return port
}

export function item(sourceId: string, overrides: Partial<InventoryProjectionItem> = {}): InventoryProjectionItem {
	return {
		sourceId,
		mint: 'https://mint.example',
		unit: 'sat',
		amount: BigInt(5),
		state: 'RESOLVED',
		accountAttribution: 'CANONICAL_ACCOUNT',
		...overrides,
	}
}

export async function createReadyRecord(): Promise<MigrationControlRecord> {
	const port = createInventoryPort({
		LEGACY_SPENDABLE_PROOFS: projection([item('legacy-proof-1')]),
		COCO_OPENING_BASELINE: projection([item('coco-opening-1', { amount: BigInt(10) })]),
	})
	const run = await enumerateProductionInventory(IDENTITY, port, 1)
	const seal = await sealProductionInventory(run, 4, 2)
	const source = seal.items.find((candidate) => candidate.sourceId === 'legacy-proof-1')!
	const disposition = await createVerifiedDispositionEvidence(source, {
		disposition: 'COCO_OWNED',
		destinationAmount: BigInt(5),
		consumedAmount: BigInt(0),
		feeAmount: BigInt(0),
		destinationId: 'coco-proof-set-1',
		cocoOperationId: 'coco-operation-1',
		evidenceId: 'disposition-evidence-1',
	})
	const destination = await createCocoDestinationEvidence({
		mint: 'https://mint.example',
		unit: 'sat',
		amount: BigInt(15),
		authorityGeneration: 7,
		snapshotId: 'coco-destination-snapshot-1',
	})
	const accountingReport = await buildAccountingReport(seal, [disposition], [destination])
	const recoveryQuiescenceCertificate = await createRecoveryQuiescenceCertificate(IDENTITY, 7, [], 'recovery-quiescence-1', 3)
	const initial = createInitialControlRecord(IDENTITY)
	const legacyQuiescenceCertificate = await createLegacyQuiescenceCertificate(initial, seal, 'legacy-quiescence-1', 4)
	return {
		...initial,
		phase: 'COCO_READY',
		revision: 9,
		inventorySeal: seal,
		accountingReport,
		cocoAuthorityGeneration: 7,
		recoveryQuiescenceCertificate,
		legacyQuiescenceCertificate,
	}
}
