import { createCommitment } from './commitment'
import { createMigrationIdentity, normalizeMintUrl, normalizeUnit, requireSafeId } from './identity'
import {
	REQUIRED_PRODUCTION_ENUMERATORS,
	MigrationSafetyError,
	type EnumeratorCompletionEvidence,
	type InventoryItem,
	type InventorySeal,
	type MigrationIdentity,
	type MonetaryItemState,
	type ProductionEnumerator,
} from './model'

export interface InventoryProjection {
	sourceSchema: string
	sourceVersion: string
	items: readonly InventoryProjectionItem[]
}

export interface InventoryProjectionItem {
	sourceId: string
	mint: string
	unit: string
	amount: bigint
	state: MonetaryItemState
	legacyAuthorityRetained?: boolean
	uncertainRemoteEffect?: boolean
	unresolvedP2pkRecovery?: boolean
	cocoOperationId?: string
	hostCommandId?: string
	hostCommandBoundOperationId?: string
}

export interface TrustedProductionInventoryPort {
	readLegacySpendableProofs(identity: Readonly<MigrationIdentity>): Promise<InventoryProjection>
	readLegacyReservations(identity: Readonly<MigrationIdentity>): Promise<InventoryProjection>
	readLegacyPendingOutbound(identity: Readonly<MigrationIdentity>): Promise<InventoryProjection>
	readNip60PendingRecovery(identity: Readonly<MigrationIdentity>): Promise<InventoryProjection>
	readAuctionBidderP2pk(identity: Readonly<MigrationIdentity>): Promise<InventoryProjection>
	readAuctionSellerP2pkAuthority(identity: Readonly<MigrationIdentity>): Promise<InventoryProjection>
	readInFlightMigrations(identity: Readonly<MigrationIdentity>): Promise<InventoryProjection>
	readUnresolvedRemoteOperations(identity: Readonly<MigrationIdentity>): Promise<InventoryProjection>
	readCocoOpeningBaseline(identity: Readonly<MigrationIdentity>): Promise<InventoryProjection>
}

export interface ProductionInventoryRun {
	identity: Readonly<MigrationIdentity>
	completions: readonly EnumeratorCompletionEvidence[]
	items: readonly InventoryItem[]
}

const VALID_STATES = new Set<MonetaryItemState>([
	'AVAILABLE',
	'PENDING',
	'EXECUTING',
	'LOCKED',
	'AMBIGUOUS',
	'QUARANTINED',
	'RESOLVED',
	'CONSUMED',
])

const PORT_READERS: Readonly<
	Record<
		ProductionEnumerator,
		(port: TrustedProductionInventoryPort) => TrustedProductionInventoryPort[keyof TrustedProductionInventoryPort]
	>
> = Object.freeze({
	LEGACY_SPENDABLE_PROOFS: (port) => port.readLegacySpendableProofs,
	LEGACY_RESERVATIONS: (port) => port.readLegacyReservations,
	LEGACY_PENDING_OUTBOUND: (port) => port.readLegacyPendingOutbound,
	NIP60_PENDING_RECOVERY: (port) => port.readNip60PendingRecovery,
	AUCTION_BIDDER_P2PK: (port) => port.readAuctionBidderP2pk,
	AUCTION_SELLER_P2PK_AUTHORITY: (port) => port.readAuctionSellerP2pkAuthority,
	IN_FLIGHT_MIGRATIONS: (port) => port.readInFlightMigrations,
	UNRESOLVED_REMOTE_OPERATIONS: (port) => port.readUnresolvedRemoteOperations,
	COCO_OPENING_BASELINE: (port) => port.readCocoOpeningBaseline,
})

function requireAmount(value: unknown): bigint {
	if (typeof value !== 'bigint' || value < BigInt(0)) throw new MigrationSafetyError('INVALID_INPUT', 'inventory amount is invalid')
	return value
}

function requireState(value: unknown): MonetaryItemState {
	if (typeof value !== 'string' || !VALID_STATES.has(value as MonetaryItemState)) {
		throw new MigrationSafetyError('INVALID_INPUT', 'inventory state is invalid')
	}
	return value as MonetaryItemState
}

function normalizeItem(source: ProductionEnumerator, item: InventoryProjectionItem): Readonly<InventoryItem> {
	const normalized = {
		sourceId: requireSafeId(item.sourceId, 'sourceId'),
		source,
		mint: normalizeMintUrl(item.mint),
		unit: normalizeUnit(item.unit),
		amount: requireAmount(item.amount),
		state: requireState(item.state),
		legacyAuthorityRetained: item.legacyAuthorityRetained ?? false,
		uncertainRemoteEffect: item.uncertainRemoteEffect ?? false,
		unresolvedP2pkRecovery: item.unresolvedP2pkRecovery ?? false,
		...(item.cocoOperationId ? { cocoOperationId: requireSafeId(item.cocoOperationId, 'cocoOperationId') } : {}),
		...(item.hostCommandId ? { hostCommandId: requireSafeId(item.hostCommandId, 'hostCommandId') } : {}),
		...(item.hostCommandBoundOperationId
			? { hostCommandBoundOperationId: requireSafeId(item.hostCommandBoundOperationId, 'hostCommandBoundOperationId') }
			: {}),
	}
	if (
		typeof normalized.legacyAuthorityRetained !== 'boolean' ||
		typeof normalized.uncertainRemoteEffect !== 'boolean' ||
		typeof normalized.unresolvedP2pkRecovery !== 'boolean'
	) {
		throw new MigrationSafetyError('INVALID_INPUT', 'inventory flags are invalid')
	}
	return Object.freeze(normalized)
}

function normalizeProjection(projection: InventoryProjection): Readonly<InventoryProjection> {
	if (!Array.isArray(projection.items)) throw new MigrationSafetyError('INVALID_INPUT', 'inventory projection items are invalid')
	return Object.freeze({
		sourceSchema: requireSafeId(projection.sourceSchema, 'sourceSchema'),
		sourceVersion: requireSafeId(projection.sourceVersion, 'sourceVersion'),
		items: Object.freeze([...projection.items]),
	})
}

export async function enumerateProductionInventory(
	identityInput: MigrationIdentity,
	port: TrustedProductionInventoryPort,
	completedAtMs = Date.now(),
): Promise<Readonly<ProductionInventoryRun>> {
	const identity = createMigrationIdentity(identityInput)
	if (!Number.isSafeInteger(completedAtMs) || completedAtMs < 0) {
		throw new MigrationSafetyError('INVALID_INPUT', 'inventory completion time is invalid')
	}
	const completions: EnumeratorCompletionEvidence[] = []
	const items: InventoryItem[] = []
	const seenSourceIds = new Set<string>()

	for (const source of REQUIRED_PRODUCTION_ENUMERATORS) {
		const read = PORT_READERS[source](port)
		if (typeof read !== 'function') throw new MigrationSafetyError('INVALID_INPUT', `trusted enumerator ${source} is unavailable`)
		const projection = normalizeProjection(await read.call(port, identity))
		const sourceItems = projection.items.map((item) => normalizeItem(source, item))
		for (const item of sourceItems) {
			if (seenSourceIds.has(item.sourceId)) {
				throw new MigrationSafetyError('DUPLICATE_SOURCE', `duplicate monetary source ${item.sourceId}`)
			}
			seenSourceIds.add(item.sourceId)
			items.push(item)
		}
		const inventoryCommitment = await createCommitment('market-coco-v2-enumerator-v1', {
			identity,
			source,
			sourceSchema: projection.sourceSchema,
			sourceVersion: projection.sourceVersion,
			items: sourceItems,
		})
		completions.push(
			Object.freeze({
				...identity,
				source,
				sourceSchema: projection.sourceSchema,
				sourceVersion: projection.sourceVersion,
				itemCount: sourceItems.length,
				inventoryCommitment,
				completedAtMs,
			}),
		)
	}

	return Object.freeze({ identity, completions: Object.freeze(completions), items: Object.freeze(items) })
}

export async function sealProductionInventory(
	run: ProductionInventoryRun,
	sealedAtRevision: number,
	sealedAtMs = Date.now(),
): Promise<Readonly<InventorySeal>> {
	const identity = createMigrationIdentity(run.identity)
	if (!Number.isSafeInteger(sealedAtRevision) || sealedAtRevision < 0 || !Number.isSafeInteger(sealedAtMs) || sealedAtMs < 0) {
		throw new MigrationSafetyError('INVALID_INPUT', 'inventory seal version is invalid')
	}
	const sources = new Set(run.completions.map((completion) => completion.source))
	if (
		run.completions.length !== REQUIRED_PRODUCTION_ENUMERATORS.length ||
		REQUIRED_PRODUCTION_ENUMERATORS.some((source) => !sources.has(source))
	) {
		throw new MigrationSafetyError('INVALID_INPUT', 'required production enumeration is incomplete')
	}
	const sourceIds = new Set<string>()
	const openingBaselines = new Set<string>()
	for (const item of run.items) {
		if (sourceIds.has(item.sourceId)) throw new MigrationSafetyError('DUPLICATE_SOURCE', `duplicate monetary source ${item.sourceId}`)
		sourceIds.add(item.sourceId)
		if (item.source === 'COCO_OPENING_BASELINE') {
			const key = JSON.stringify([item.mint, item.unit])
			if (openingBaselines.has(key)) {
				throw new MigrationSafetyError('DUPLICATE_SOURCE', `duplicate Coco opening baseline ${key}`)
			}
			openingBaselines.add(key)
		}
	}
	for (const completion of run.completions) {
		if (
			completion.namespace !== identity.namespace ||
			completion.account !== identity.account ||
			completion.environment !== identity.environment ||
			completion.epoch !== identity.epoch
		) {
			throw new MigrationSafetyError('IDENTITY_MISMATCH', 'enumerator completion identity does not match inventory')
		}
		const sourceItems = run.items.filter((item) => item.source === completion.source)
		if (sourceItems.length !== completion.itemCount) {
			throw new MigrationSafetyError('INVALID_INPUT', 'enumerator item count does not match inventory')
		}
		const expectedCommitment = await createCommitment('market-coco-v2-enumerator-v1', {
			identity,
			source: completion.source,
			sourceSchema: completion.sourceSchema,
			sourceVersion: completion.sourceVersion,
			items: sourceItems,
		})
		if (expectedCommitment !== completion.inventoryCommitment) {
			throw new MigrationSafetyError('INVALID_INPUT', 'enumerator commitment does not match inventory')
		}
	}
	const commitment = await createCommitment('market-coco-v2-inventory-seal-v1', {
		identity,
		sealedAtRevision,
		completions: run.completions,
		items: run.items,
	})
	const seal = Object.freeze({
		...identity,
		sealedAtRevision,
		sealedAtMs,
		itemCount: run.items.length,
		commitment,
		completions: Object.freeze([...run.completions]),
		items: Object.freeze([...run.items]),
		lateDiscoveries: Object.freeze([]),
	})
	await verifyInventorySeal(seal)
	return seal
}

export async function verifyInventorySeal(seal: InventorySeal): Promise<void> {
	const identity = createMigrationIdentity(seal)
	if (seal.itemCount !== seal.items.length) throw new MigrationSafetyError('INVALID_INPUT', 'sealed inventory item count is invalid')
	const sources = new Set(seal.completions.map((completion) => completion.source))
	if (
		seal.completions.length !== REQUIRED_PRODUCTION_ENUMERATORS.length ||
		REQUIRED_PRODUCTION_ENUMERATORS.some((source) => !sources.has(source))
	) {
		throw new MigrationSafetyError('INVALID_INPUT', 'sealed production enumeration is incomplete')
	}
	const seenSourceIds = new Set<string>()
	const openingBaselines = new Set<string>()
	for (const item of seal.items) {
		if (seenSourceIds.has(item.sourceId)) throw new MigrationSafetyError('DUPLICATE_SOURCE', 'sealed inventory has duplicate source')
		seenSourceIds.add(item.sourceId)
		if (item.source === 'COCO_OPENING_BASELINE') {
			const key = JSON.stringify([item.mint, item.unit])
			if (openingBaselines.has(key)) throw new MigrationSafetyError('DUPLICATE_SOURCE', 'sealed inventory has duplicate opening baseline')
			openingBaselines.add(key)
		}
	}
	for (const completion of seal.completions) {
		if (
			completion.namespace !== identity.namespace ||
			completion.account !== identity.account ||
			completion.environment !== identity.environment ||
			completion.epoch !== identity.epoch
		) {
			throw new MigrationSafetyError('IDENTITY_MISMATCH', 'sealed enumerator identity does not match')
		}
		const sourceItems = seal.items.filter((item) => item.source === completion.source)
		if (completion.itemCount !== sourceItems.length) {
			throw new MigrationSafetyError('INVALID_INPUT', 'sealed enumerator count does not match')
		}
		const commitment = await createCommitment('market-coco-v2-enumerator-v1', {
			identity,
			source: completion.source,
			sourceSchema: completion.sourceSchema,
			sourceVersion: completion.sourceVersion,
			items: sourceItems,
		})
		if (commitment !== completion.inventoryCommitment) {
			throw new MigrationSafetyError('INVALID_INPUT', 'sealed enumerator commitment does not match')
		}
	}
	const commitment = await createCommitment('market-coco-v2-inventory-seal-v1', {
		identity,
		sealedAtRevision: seal.sealedAtRevision,
		completions: seal.completions,
		items: seal.items,
	})
	if (commitment !== seal.commitment) throw new MigrationSafetyError('INVALID_INPUT', 'inventory seal commitment does not match')
}

export function invalidateSealForLateDiscovery(seal: InventorySeal, sourceId: string): Readonly<InventorySeal> {
	const normalizedSourceId = requireSafeId(sourceId, 'sourceId')
	if (seal.items.some((item) => item.sourceId === normalizedSourceId)) return seal
	return Object.freeze({
		...seal,
		lateDiscoveries: Object.freeze(Array.from(new Set([...seal.lateDiscoveries, normalizedSourceId])).sort()),
	})
}
