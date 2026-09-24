import type { Proof } from '@cashu/cashu-ts'
import type { HistoryEntry } from 'coco-cashu-core'
import { getAuctionHdAccountFromWalletKeys } from '@/lib/auctionHd'
import { cashuStore } from '@/lib/stores/cashu'
import { configStore } from '@/lib/stores/config'
import { nip60Store } from '@/lib/stores/nip60'
import { authStore } from '@/lib/stores/auth'
import { getLegacyTruncatedUserScopedKey, readLegacyTruncatedUserDataForInventory } from '@/lib/wallet/storage'
import { createCommitment } from './commitment'
import { createMigrationIdentity, normalizeMintUrl } from './identity'
import { IndexedDbMigrationControlStore } from './indexedDbStore'
import { MigrationSafetyError, type MigrationIdentity, type ProductionEnumerator } from './model'
import type { InventoryProjection, InventoryProjectionItem, TrustedProductionInventoryPort } from './inventory'
import type { MigrationControlStore } from './store'

const NIP60_PENDING_TOKENS_KEY = 'nip60_pending_tokens'
const COCO_PENDING_TOKENS_KEY = 'cashu_pending_tokens'
const BIDDER_RECORDS_KEY = 'auction_bidder_records_v1'
const PRE_LOCK_RECOVERY_RECORDS_KEY = 'auction_bid_pre_lock_recovery_v1'
const SAT = 'sat'
const AUTHORITY_MINT = 'https://authority.invalid'
const SOURCE_SCHEMA = 'plebeian-market-maintained-wallet-inventory'
const SOURCE_VERSION = '2'
const TRUNCATED_SCOPE_REASON = 'legacy-truncated-pubkey-scope'

type ProjectionMap = Readonly<Record<ProductionEnumerator, readonly InventoryProjectionItem[]>>

const LEGACY_BUCKETS = [NIP60_PENDING_TOKENS_KEY, COCO_PENDING_TOKENS_KEY, BIDDER_RECORDS_KEY, PRE_LOCK_RECOVERY_RECORDS_KEY] as const

function legacyBucketSnapshot(account: string): Readonly<Record<string, string | null>> {
	return Object.freeze(
		Object.fromEntries(LEGACY_BUCKETS.map((key) => [key, localStorage.getItem(getLegacyTruncatedUserScopedKey(key, account))])),
	)
}

function publicHistoryProjection(entries: readonly HistoryEntry[]) {
	return entries.map((entry) => ({
		id: entry.id,
		type: entry.type,
		state: 'state' in entry ? String(entry.state) : '',
		mint: entry.mintUrl,
		unit: entry.unit,
		amount: entry.amount,
	}))
}

function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new MigrationSafetyError('INVALID_INPUT', `${label} is malformed`)
	}
	return value as Record<string, unknown>
}

function array(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new MigrationSafetyError('INVALID_INPUT', `${label} is malformed`)
	return value
}

function text(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new MigrationSafetyError('INVALID_INPUT', `${label} is malformed`)
	return value
}

function amount(value: unknown, label: string): bigint {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new MigrationSafetyError('INVALID_INPUT', `${label} is malformed`)
	}
	return BigInt(value)
}

async function sourceId(kind: string, metadata: Record<string, unknown>): Promise<string> {
	return `${kind}:${(await createCommitment('market-coco-v2-production-source-v1', metadata)).slice('sha256:'.length)}`
}

function unattributed(item: Omit<InventoryProjectionItem, 'accountAttribution' | 'attributionReason'>): InventoryProjectionItem {
	return {
		...item,
		accountAttribution: 'UNATTRIBUTED',
		attributionReason: TRUNCATED_SCOPE_REASON,
	}
}

async function proofItems(wallet: NonNullable<typeof nip60Store.state.wallet>, state: 'available' | 'reserved') {
	const result: InventoryProjectionItem[] = []
	const byMint = wallet.state.getMintsProofs({ validStates: new Set([state]) as never })
	for (const [mint, proofs] of Array.from(byMint.entries())) {
		for (const proof of proofs as Proof[]) {
			result.push({
				sourceId: await sourceId('nip60-proof', { mint: normalizeMintUrl(mint), keysetId: proof.id, commitment: proof.C }),
				mint,
				unit: SAT,
				amount: BigInt(proof.amount),
				state: state === 'available' ? 'AVAILABLE' : 'LOCKED',
				accountAttribution: 'CANONICAL_ACCOUNT',
				legacyAuthorityRetained: true,
			})
		}
	}
	return result
}

async function pendingTokenItems(account: string) {
	const rawNip60 = readLegacyTruncatedUserDataForInventory(NIP60_PENDING_TOKENS_KEY, account)
	const rawCoco = readLegacyTruncatedUserDataForInventory(COCO_PENDING_TOKENS_KEY, account)
	const outbound: InventoryProjectionItem[] = []
	const recovery: InventoryProjectionItem[] = []

	for (const [storeKind, raw] of [
		['nip60', rawNip60],
		['coco', rawCoco],
	] as const) {
		if (raw === null) continue
		for (const entry of array(raw, `${storeKind} pending-token bucket`)) {
			const token = object(entry, `${storeKind} pending token`)
			const id = text(token.id, `${storeKind} pending token id`)
			const mint = text(token.mintUrl, `${storeKind} pending token mint`)
			const tokenAmount = amount(token.amount, `${storeKind} pending token amount`)
			const status = text(token.status, `${storeKind} pending token status`)
			const context = token.context && typeof token.context === 'object' ? (token.context as Record<string, unknown>) : null
			const auctionRecovery = storeKind === 'nip60' && context?.kind === 'auction_bid'
			const item = unattributed({
				sourceId: await sourceId(`${storeKind}-pending`, { id, mint: normalizeMintUrl(mint), amount: tokenAmount, status }),
				mint,
				unit: SAT,
				amount: tokenAmount,
				state: status === 'pending' ? (auctionRecovery ? 'LOCKED' : 'PENDING') : 'CONSUMED',
				legacyAuthorityRetained: status === 'pending',
				uncertainRemoteEffect: status === 'pending',
				unresolvedP2pkRecovery: auctionRecovery && status === 'pending',
			})
			;(auctionRecovery ? recovery : outbound).push(item)
		}
	}
	return { outbound, recovery }
}

async function bidderP2pkItems(account: string) {
	const items: InventoryProjectionItem[] = []
	const recordsRaw = readLegacyTruncatedUserDataForInventory(BIDDER_RECORDS_KEY, account)
	if (recordsRaw !== null) {
		for (const entry of array(recordsRaw, 'Auction bidder record bucket')) {
			const record = object(entry, 'Auction bidder record')
			const bidEventId = text(record.bidEventId, 'Auction bidder record id')
			const mint = text(record.mintUrl, 'Auction bidder record mint')
			const lockedAmount = amount(record.legLockedAmount, 'Auction bidder locked amount')
			const status = text(record.status, 'Auction bidder record status')
			const unresolved = status === 'live' || status === 'griefed'
			items.push(
				unattributed({
					sourceId: await sourceId('auction-bidder', { bidEventId, mint: normalizeMintUrl(mint), amount: lockedAmount, status }),
					mint,
					unit: SAT,
					amount: lockedAmount,
					state: unresolved ? 'LOCKED' : 'CONSUMED',
					legacyAuthorityRetained: unresolved,
					unresolvedP2pkRecovery: unresolved,
				}),
			)
		}
	}

	const preLockRaw = readLegacyTruncatedUserDataForInventory(PRE_LOCK_RECOVERY_RECORDS_KEY, account)
	if (preLockRaw !== null) {
		for (const entry of Object.values(object(preLockRaw, 'Auction pre-lock recovery bucket'))) {
			const record = object(entry, 'Auction pre-lock recovery record')
			const id = text(record.id, 'Auction pre-lock recovery id')
			const mint = text(record.mintUrl, 'Auction pre-lock recovery mint')
			const lockedAmount = amount(record.legLockAmount, 'Auction pre-lock recovery amount')
			items.push(
				unattributed({
					sourceId: await sourceId('auction-prelock', { id, mint: normalizeMintUrl(mint), amount: lockedAmount }),
					mint,
					unit: SAT,
					amount: lockedAmount,
					state: 'AMBIGUOUS',
					legacyAuthorityRetained: true,
					uncertainRemoteEffect: true,
					unresolvedP2pkRecovery: true,
				}),
			)
		}
	}
	return items
}

async function sellerAuthorityItems(wallet: NonNullable<typeof nip60Store.state.wallet>) {
	let walletP2pk = ''
	try {
		walletP2pk = wallet.p2pk
	} catch {
		return []
	}
	const signer = wallet.privkeys.get(walletP2pk)
	const privateKey = signer?.privateKey
	if (!privateKey) {
		return [
			{
				sourceId: await sourceId('auction-seller-authority', { walletP2pk, status: 'missing-private-authority' }),
				mint: wallet.mints[0] ?? AUTHORITY_MINT,
				unit: SAT,
				amount: BigInt(0),
				state: 'AMBIGUOUS' as const,
				accountAttribution: 'CANONICAL_ACCOUNT' as const,
				legacyAuthorityRetained: true,
				unresolvedP2pkRecovery: true,
			},
		]
	}
	const account = await getAuctionHdAccountFromWalletKeys(walletP2pk, privateKey)
	const xpub = account.publicExtendedKey
	if (!xpub) throw new MigrationSafetyError('INVALID_INPUT', 'Auction seller authority has no public extended key')
	return [
		{
			sourceId: await sourceId('auction-seller-authority', { walletP2pk, xpub }),
			mint: wallet.mints[0] ?? AUTHORITY_MINT,
			unit: SAT,
			amount: BigInt(0),
			state: 'AVAILABLE' as const,
			accountAttribution: 'CANONICAL_ACCOUNT' as const,
			legacyAuthorityRetained: true,
			unresolvedP2pkRecovery: true,
		},
	]
}

async function allCocoHistory(): Promise<HistoryEntry[]> {
	const manager = cashuStore.state.manager
	if (!manager) return []
	const entries: HistoryEntry[] = []
	const pageSize = 200
	for (let page = 0; page < 100; page++) {
		const batch = await manager.history.getPaginatedHistory(page * pageSize, pageSize)
		entries.push(...batch)
		if (batch.length < pageSize) return entries
	}
	throw new MigrationSafetyError('INVALID_INPUT', 'Coco history exceeds the bounded production inventory scan')
}

async function freezeProjectionMap(identityInput: MigrationIdentity, controlStore: MigrationControlStore): Promise<ProjectionMap> {
	const identity = createMigrationIdentity(identityInput)
	const authenticatedAccount = authStore.state.user?.pubkey?.toLowerCase()
	if (authenticatedAccount !== identity.account)
		throw new MigrationSafetyError('IDENTITY_MISMATCH', 'authenticated account does not match inventory')
	if ((configStore.state.config.stage ?? 'development') !== identity.environment) {
		throw new MigrationSafetyError('IDENTITY_MISMATCH', 'runtime environment does not match inventory')
	}

	const nip60 = nip60Store.state
	if (!nip60.wallet || nip60.account !== identity.account || (nip60.status !== 'ready' && nip60.status !== 'no_wallet')) {
		throw new MigrationSafetyError('IDENTITY_MISMATCH', 'NIP-60 inventory is not loaded for the canonical account')
	}
	const coco = cashuStore.state
	if (!coco.manager || coco.account !== identity.account || coco.status !== 'ready') {
		throw new MigrationSafetyError('IDENTITY_MISMATCH', 'Coco baseline is not loaded for the canonical account')
	}

	const control = await controlStore.get(identity.namespace)
	if (!control) throw new MigrationSafetyError('STORAGE_FAILURE', 'migration control record is unavailable for production inventory')
	if (control.epoch !== identity.epoch)
		throw new MigrationSafetyError('STALE_EPOCH', 'migration control epoch changed before inventory freeze')
	if (control.phase !== 'MIGRATION_SNAPSHOT_FROZEN') {
		throw new MigrationSafetyError('INVALID_PHASE', 'production inventory requires the frozen snapshot phase')
	}
	if (control.activeLegacyWriters.length > 0) {
		throw new MigrationSafetyError('CUTOVER_BLOCKED', 'production inventory cannot freeze while legacy writers are active')
	}

	const controlRevision = control.revision
	const writerGeneration = control.legacyWriterGeneration
	const bucketsBefore = legacyBucketSnapshot(identity.account)
	const availableProofs = await proofItems(nip60.wallet, 'available')
	const reservedProofs = await proofItems(nip60.wallet, 'reserved')
	const pending = await pendingTokenItems(identity.account)
	const bidderP2pk = await bidderP2pkItems(identity.account)
	const sellerAuthority = await sellerAuthorityItems(nip60.wallet)

	const inFlight: InventoryProjectionItem[] = []
	for (const lease of control.activeLegacyWriters) {
		inFlight.push({
			sourceId: await sourceId('legacy-writer', { leaseId: lease.leaseId, operationId: lease.operationId }),
			mint: AUTHORITY_MINT,
			unit: SAT,
			amount: BigInt(0),
			state: 'EXECUTING',
			accountAttribution: 'CANONICAL_ACCOUNT',
			legacyAuthorityRetained: true,
			uncertainRemoteEffect: true,
		})
	}

	const unresolvedRemote: InventoryProjectionItem[] = []
	if (nip60.activeDeposit && (nip60.depositStatus === 'pending' || nip60.depositStatus === 'awaiting_confirmation_retry')) {
		unresolvedRemote.push({
			sourceId: await sourceId('nip60-deposit', { invoice: nip60.depositInvoice ? 'present' : 'missing', status: nip60.depositStatus }),
			mint: nip60.defaultMint ?? nip60.mints[0] ?? AUTHORITY_MINT,
			unit: SAT,
			amount: BigInt(0),
			state: 'PENDING',
			accountAttribution: 'CANONICAL_ACCOUNT',
			legacyAuthorityRetained: true,
			uncertainRemoteEffect: true,
		})
	}
	const cocoHistory = await allCocoHistory()
	for (const entry of cocoHistory) {
		const state = 'state' in entry ? String(entry.state) : ''
		const final = (entry.type === 'mint' && state === 'ISSUED') || (entry.type === 'melt' && state === 'PAID')
		if ((entry.type !== 'mint' && entry.type !== 'melt') || final) continue
		unresolvedRemote.push(
			unattributed({
				sourceId: await sourceId('coco-remote-operation', { id: entry.id, type: entry.type, state, mint: entry.mintUrl }),
				mint: entry.mintUrl,
				unit: entry.unit,
				amount: BigInt(entry.amount),
				state: 'PENDING',
				uncertainRemoteEffect: true,
			}),
		)
	}

	const balances = await coco.manager.wallet.getBalances()
	const allMints = new Set((await coco.manager.mint.getAllMints()).map((mint) => mint.mintUrl))
	Object.keys(balances).forEach((mint) => allMints.add(mint))
	const opening: InventoryProjectionItem[] = []
	for (const mint of Array.from(allMints).sort()) {
		const value = balances[mint] ?? 0
		if (!Number.isSafeInteger(value) || value < 0) throw new MigrationSafetyError('INVALID_INPUT', 'Coco opening balance is invalid')
		opening.push(
			unattributed({
				sourceId: await sourceId('coco-opening', { mint: normalizeMintUrl(mint), unit: SAT }),
				mint,
				unit: SAT,
				amount: BigInt(value),
				state: value === 0 ? 'RESOLVED' : 'AMBIGUOUS',
				legacyAuthorityRetained: value > 0,
				uncertainRemoteEffect: value > 0,
			}),
		)
	}

	const controlAfter = await controlStore.get(identity.namespace)
	if (
		!controlAfter ||
		controlAfter.revision !== controlRevision ||
		controlAfter.legacyWriterGeneration !== writerGeneration ||
		controlAfter.phase !== 'MIGRATION_SNAPSHOT_FROZEN' ||
		controlAfter.activeLegacyWriters.length > 0
	) {
		throw new MigrationSafetyError('STALE_REVISION', 'migration control changed during production inventory freeze')
	}
	if (JSON.stringify(legacyBucketSnapshot(identity.account)) !== JSON.stringify(bucketsBefore)) {
		throw new MigrationSafetyError('STALE_REVISION', 'legacy local inventory changed during production inventory freeze')
	}
	const availableAfter = await proofItems(nip60.wallet, 'available')
	const reservedAfter = await proofItems(nip60.wallet, 'reserved')
	if (
		(await createCommitment('market-coco-v2-proof-snapshot-v1', { availableProofs, reservedProofs })) !==
		(await createCommitment('market-coco-v2-proof-snapshot-v1', { availableProofs: availableAfter, reservedProofs: reservedAfter }))
	) {
		throw new MigrationSafetyError('STALE_REVISION', 'NIP-60 proof inventory changed during production inventory freeze')
	}
	const balancesAfter = await coco.manager.wallet.getBalances()
	const historyAfter = await allCocoHistory()
	if (
		(await createCommitment('market-coco-v2-coco-public-snapshot-v1', {
			balances,
			history: publicHistoryProjection(cocoHistory),
		})) !==
		(await createCommitment('market-coco-v2-coco-public-snapshot-v1', {
			balances: balancesAfter,
			history: publicHistoryProjection(historyAfter),
		}))
	) {
		throw new MigrationSafetyError('STALE_REVISION', 'Coco public inventory changed during production inventory freeze')
	}

	return Object.freeze({
		LEGACY_SPENDABLE_PROOFS: Object.freeze(availableProofs),
		LEGACY_RESERVATIONS: Object.freeze(reservedProofs),
		LEGACY_PENDING_OUTBOUND: Object.freeze(pending.outbound),
		NIP60_PENDING_RECOVERY: Object.freeze(pending.recovery),
		AUCTION_BIDDER_P2PK: Object.freeze(bidderP2pk),
		AUCTION_SELLER_P2PK_AUTHORITY: Object.freeze(sellerAuthority),
		IN_FLIGHT_MIGRATIONS: Object.freeze(inFlight),
		UNRESOLVED_REMOTE_OPERATIONS: Object.freeze(unresolvedRemote),
		COCO_OPENING_BASELINE: Object.freeze(opening),
	})
}

class FrozenProductionInventoryPort implements TrustedProductionInventoryPort {
	constructor(
		private readonly snapshotId: string,
		private readonly projections: ProjectionMap,
	) {}

	private projection(source: ProductionEnumerator): InventoryProjection {
		return Object.freeze({
			sourceSchema: SOURCE_SCHEMA,
			sourceVersion: SOURCE_VERSION,
			snapshotId: this.snapshotId,
			items: this.projections[source],
		})
	}

	readLegacySpendableProofs = async () => this.projection('LEGACY_SPENDABLE_PROOFS')
	readLegacyReservations = async () => this.projection('LEGACY_RESERVATIONS')
	readLegacyPendingOutbound = async () => this.projection('LEGACY_PENDING_OUTBOUND')
	readNip60PendingRecovery = async () => this.projection('NIP60_PENDING_RECOVERY')
	readAuctionBidderP2pk = async () => this.projection('AUCTION_BIDDER_P2PK')
	readAuctionSellerP2pkAuthority = async () => this.projection('AUCTION_SELLER_P2PK_AUTHORITY')
	readInFlightMigrations = async () => this.projection('IN_FLIGHT_MIGRATIONS')
	readUnresolvedRemoteOperations = async () => this.projection('UNRESOLVED_REMOTE_OPERATIONS')
	readCocoOpeningBaseline = async () => this.projection('COCO_OPENING_BASELINE')
}

/**
 * Captures every maintained source once, then serves all nine enumerators from
 * that immutable view. The resulting evidence contains hashes and public
 * metadata only; bearer tokens, proof secrets, seeds, and private keys are not
 * copied into the migration database.
 */
export async function freezeMaintainedProductionInventory(
	identity: MigrationIdentity,
	controlStore: MigrationControlStore = new IndexedDbMigrationControlStore(),
): Promise<TrustedProductionInventoryPort> {
	const projections = await freezeProjectionMap(identity, controlStore)
	const snapshotId = await createCommitment('market-coco-v2-maintained-snapshot-v2', { identity, projections })
	return new FrozenProductionInventoryPort(snapshotId, projections)
}
