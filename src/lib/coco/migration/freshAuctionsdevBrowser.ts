import type { Manager } from '@cashu/coco-core'
import { authStore } from '@/lib/stores/auth'
import { nip60Store } from '@/lib/stores/nip60'
import { getLegacyTruncatedUserScopedKey } from '@/lib/wallet/storage'
import { IndexedDbCocoAuctionCommandRepository } from '../auctions/commandRepository'
import { readCocoFakeMintIdentityCommitments, readCocoV2AuctionEnvironment, readMarketCommitSha } from '../auctions/mode'
import { cocoRuntimeRegistry, getCocoDatabaseName, getCocoRuntimeScope } from '../runtime'
import { hasCocoSeedVaultRecord, verifyCocoSeedVaultRoundTrip } from '../seedVault'
import { createCommitment } from './commitment'
import { createMigrationIdentity } from './identity'
import { IndexedDbMigrationControlStore } from './indexedDbStore'
import { MigrationSafetyError, type FreshAuctionsdevPreflightEvidence, type MigrationIdentity } from './model'
import { commitFreshAuctionsdevSelection, createFreshAuctionsdevEvidence } from './freshAuctionsdev'
import { createFreshAuctionsdevPublicReport, type FreshAuctionsdevPublicReport } from './freshAuctionsdevReport'
import { createInitialFreshTestControlRecord, getMigrationAuthorityPurpose, type MigrationControlStore } from './store'

const LEGACY_TRUNCATED_PREFIXES = [
	'nip60_pending_tokens',
	'nip60_default_mint',
	'cashu_pending_tokens',
	'auction_bidder_records_v1',
	'auction_bid_pre_lock_recovery_v1',
	'auction_bid_republish_events_v1',
] as const

interface SnapshotCounts {
	legacySpendableCount: number
	legacyReservationCount: number
	legacyPendingCount: number
	legacyAuthorityCount: number
	auctionRecoveryCount: number
	truncatedStorageCount: number
	truncatedDatabaseCount: number
	activeLegacyWriterCount: number
	legacyWriterGeneration: number
	cocoBalanceAmount: bigint
	cocoHistoryCount: number
	cocoInFlightCount: number
	cocoOrphanCount: number
	hostCommandCount: number
	authoritativeDatabaseCount: number
	plaintextSecretRecordCount: number
}

const proofCount = (wallet: NonNullable<typeof nip60Store.state.wallet>, state: 'available' | 'reserved'): number =>
	Array.from(wallet.state.getMintsProofs({ validStates: new Set([state]) as never }).values()).reduce(
		(total, proofs) => total + proofs.length,
		0,
	)

const databaseNames = async (): Promise<readonly string[]> => {
	if (!indexedDB.databases)
		throw new MigrationSafetyError('STORAGE_FAILURE', 'IndexedDB database enumeration is required for fresh-wallet preflight')
	return (await indexedDB.databases()).map((database) => database.name).filter((name): name is string => Boolean(name))
}

const legacyStorageSnapshot = (account: string): Readonly<Record<string, string | null>> =>
	Object.freeze(
		Object.fromEntries(
			LEGACY_TRUNCATED_PREFIXES.map((prefix) => [prefix, localStorage.getItem(getLegacyTruncatedUserScopedKey(prefix, account))]),
		),
	)

async function allHistoryCount(manager: Manager): Promise<number> {
	let total = 0
	for (let page = 0; page < 100; page++) {
		const entries = await manager.history.getPaginatedHistory(page * 200, 200)
		total += entries.length
		if (entries.length < 200) return total
	}
	throw new MigrationSafetyError('CUTOVER_BLOCKED', 'Coco history exceeds the bounded preflight scan')
}

async function collectCounts(
	identity: MigrationIdentity,
	store: MigrationControlStore,
	account: { accountPubkey: string; environmentId: string },
): Promise<SnapshotCounts> {
	const nip60 = nip60Store.state
	if (nip60.account !== identity.account || (nip60.status !== 'ready' && nip60.status !== 'no_wallet')) {
		throw new MigrationSafetyError('IDENTITY_MISMATCH', 'NIP-60 must be loaded for the exact canonical account')
	}
	const control = await store.get(identity.namespace)
	if (!control) throw new MigrationSafetyError('STORAGE_FAILURE', 'fresh-test control record is unavailable')
	const wallet = nip60.wallet
	const commands = await new IndexedDbCocoAuctionCommandRepository().listByAccount(account)
	const runtime = await cocoRuntimeRegistry.get(account)
	const balances = await runtime.manager.wallet.balances.byMint()
	const balance = Object.values(balances).reduce((total, item) => total + BigInt(item.total.toNumber()), BigInt(0))
	const [sendPrepared, sendInFlight, receivePrepared, receiveInFlight, mintPending, mintInFlight, meltPrepared, meltInFlight] =
		await Promise.all([
			runtime.manager.ops.send.listPrepared(),
			runtime.manager.ops.send.listInFlight(),
			runtime.manager.ops.receive.listPrepared(),
			runtime.manager.ops.receive.listInFlight(),
			runtime.manager.ops.mint.listPending(),
			runtime.manager.ops.mint.listInFlight(),
			runtime.manager.ops.melt.listPrepared(),
			runtime.manager.ops.melt.listInFlight(),
		])
	const operationIds = new Set(
		[
			...sendPrepared,
			...sendInFlight,
			...receivePrepared,
			...receiveInFlight,
			...mintPending,
			...mintInFlight,
			...meltPrepared,
			...meltInFlight,
		].map((operation) => operation.id),
	)
	const commandOperationIds = new Set(commands.map((command) => command.operationId))
	const databases = await databaseNames()
	const expectedDatabase = getCocoDatabaseName(account)
	const truncatedDatabase = `cashu_wallet_${identity.account.slice(0, 8)}`
	const storage = legacyStorageSnapshot(identity.account)
	const activeDeposit = nip60.activeDeposit && ['pending', 'awaiting_confirmation_retry'].includes(nip60.depositStatus) ? 1 : 0
	return {
		legacySpendableCount: wallet ? proofCount(wallet, 'available') : 0,
		legacyReservationCount: wallet ? proofCount(wallet, 'reserved') : 0,
		legacyPendingCount: nip60.pendingTokens.length + activeDeposit,
		legacyAuthorityCount: wallet ? wallet.privkeys.size : 0,
		auctionRecoveryCount: Object.entries(storage).filter(([key, value]) => key.startsWith('auction_') && value !== null).length,
		truncatedStorageCount: Object.values(storage).filter((value) => value !== null).length,
		truncatedDatabaseCount: databases.filter((name) => name === truncatedDatabase).length,
		activeLegacyWriterCount: control.activeLegacyWriters.length,
		legacyWriterGeneration: control.legacyWriterGeneration,
		cocoBalanceAmount: balance,
		cocoHistoryCount: await allHistoryCount(runtime.manager),
		cocoInFlightCount: operationIds.size,
		cocoOrphanCount: Array.from(operationIds).filter((id) => !commandOperationIds.has(id)).length,
		hostCommandCount: commands.length,
		authoritativeDatabaseCount: databases.filter((name) => name === expectedDatabase).length,
		plaintextSecretRecordCount: localStorage.getItem(`cashu_wallet_seed_${identity.account}`) === null ? 0 : 1,
	}
}

async function verifyFakeMints(fetcher: typeof fetch) {
	const environment = readCocoV2AuctionEnvironment()
	if (environment.environmentId !== 'auctionsdev' && environment.environmentId !== 'test') {
		throw new MigrationSafetyError('CUTOVER_BLOCKED', 'fresh-wallet preflight is restricted to auctionsdev/test')
	}
	const configured = readCocoFakeMintIdentityCommitments()
	const verified: { mintCommitment: string; identityCommitment: string }[] = []
	for (const mint of environment.fakeMintAllowlist) {
		const expected = configured.get(mint)
		if (!expected) throw new MigrationSafetyError('CUTOVER_BLOCKED', 'fake mint has no pinned public identity commitment')
		const response = await fetcher(`${mint}/v1/info`, { cache: 'no-store', credentials: 'omit' })
		if (!response.ok) throw new MigrationSafetyError('CUTOVER_BLOCKED', 'fake mint identity endpoint is unavailable')
		const info = (await response.json()) as unknown
		const actual = await createCommitment('market-coco-v2-fake-mint-info-v1', { mintUrl: mint, info })
		if (actual !== expected) throw new MigrationSafetyError('CUTOVER_BLOCKED', 'fake mint identity does not match its pinned commitment')
		verified.push({ mintCommitment: await createCommitment('market-coco-v2-fake-mint-url-v1', mint), identityCommitment: actual })
	}
	if (configured.size !== environment.fakeMintAllowlist.length) {
		throw new MigrationSafetyError('CUTOVER_BLOCKED', 'fake mint identity set does not exactly match the allowlist')
	}
	return {
		count: verified.length,
		commitment: await createCommitment('market-coco-v2-fake-mint-identities-v1', verified),
	}
}

export async function collectBrowserFreshAuctionsdevEvidence(
	identityInput: MigrationIdentity,
	options: { store?: MigrationControlStore; fetcher?: typeof fetch; marketCommit?: string } = {},
): Promise<Readonly<FreshAuctionsdevPreflightEvidence>> {
	if (typeof indexedDB === 'undefined' || typeof localStorage === 'undefined') {
		throw new MigrationSafetyError('STORAGE_FAILURE', 'browser IndexedDB and localStorage are required for fresh-wallet preflight')
	}
	const identity = createMigrationIdentity(identityInput)
	if (identity.environment !== 'auctionsdev' && identity.environment !== 'test') {
		throw new MigrationSafetyError('CUTOVER_BLOCKED', 'fresh-wallet preflight cannot authorize production or staging')
	}
	if (authStore.state.user?.pubkey?.trim().toLowerCase() !== identity.account) {
		throw new MigrationSafetyError('IDENTITY_MISMATCH', 'authenticated account does not match fresh-wallet preflight')
	}
	const environment = readCocoV2AuctionEnvironment()
	if (environment.environmentId !== identity.environment)
		throw new MigrationSafetyError('IDENTITY_MISMATCH', 'runtime environment does not match preflight')
	const account = { accountPubkey: identity.account, environmentId: identity.environment }
	const defaultStore = options.store ? null : new IndexedDbMigrationControlStore()
	const store = options.store ?? defaultStore!
	try {
		let control = await store.get(identity.namespace)
		if (!control) control = await store.create(createInitialFreshTestControlRecord(identity))
		if (getMigrationAuthorityPurpose(control) !== 'FRESH_AUCTIONSDEV_TEST' || control.phase !== 'FRESH_TEST_PREPARING') {
			throw new MigrationSafetyError('INVALID_PHASE', 'fresh-test control record is not preparing')
		}
		const revision = control.revision
		const storageBefore = legacyStorageSnapshot(identity.account)
		const databasesBefore = await databaseNames()
		const preexistingAuthoritativeDatabaseCount = databasesBefore.filter((name) => name === getCocoDatabaseName(account)).length
		const preexistingVaultRecordCount = (await hasCocoSeedVaultRecord(getCocoRuntimeScope(account))) ? 1 : 0
		const first = await collectCounts(identity, store, account)
		const vault = await verifyCocoSeedVaultRoundTrip(getCocoRuntimeScope(account))
		const fakeMints = await verifyFakeMints(options.fetcher ?? fetch)
		const second = await collectCounts(identity, store, account)
		const controlAfter = await store.get(identity.namespace)
		if (
			!controlAfter ||
			controlAfter.revision !== revision ||
			JSON.stringify(first, (_, value) => (typeof value === 'bigint' ? value.toString() : value)) !==
				JSON.stringify(second, (_, value) => (typeof value === 'bigint' ? value.toString() : value)) ||
			JSON.stringify(storageBefore) !== JSON.stringify(legacyStorageSnapshot(identity.account))
		) {
			throw new MigrationSafetyError('STALE_REVISION', 'wallet inventory changed during the frozen preflight snapshot')
		}
		const frozenSnapshotId = await createCommitment('market-coco-v2-fresh-frozen-snapshot-v1', {
			identity,
			revision,
			counts: first,
			preexistingAuthoritativeDatabaseCount,
			preexistingVaultRecordCount,
			fakeMintIdentityCommitment: fakeMints.commitment,
			seedCiphertextCommitment: vault.ciphertextCommitment,
		})
		return createFreshAuctionsdevEvidence({
			...identity,
			marketCommit: options.marketCommit ?? readMarketCommitSha(),
			frozenSnapshotId,
			collectedAtMs: Date.now(),
			fakeMintCount: fakeMints.count,
			fakeMintIdentityCommitment: fakeMints.commitment,
			fakeMintIdentityVerified: true,
			...first,
			preexistingAuthoritativeDatabaseCount,
			preexistingVaultRecordCount,
			vaultRoundTripVerified: vault.roundTripVerified,
			vaultKeyExtractable: vault.keyExtractable,
		})
	} finally {
		defaultStore?.close()
	}
}

export async function commitBrowserFreshAuctionsdevPreflight(
	identity: MigrationIdentity,
	options: { store?: MigrationControlStore; fetcher?: typeof fetch; marketCommit?: string } = {},
): Promise<Readonly<FreshAuctionsdevPublicReport>> {
	const defaultStore = options.store ? null : new IndexedDbMigrationControlStore()
	const store = options.store ?? defaultStore!
	try {
		const evidence = await collectBrowserFreshAuctionsdevEvidence(identity, { ...options, store })
		const control = await store.get(identity.namespace)
		if (!control) throw new MigrationSafetyError('STORAGE_FAILURE', 'fresh-test control record disappeared before commit')
		const committed = await commitFreshAuctionsdevSelection(store, identity, control.revision, evidence)
		if (!committed.freshTestSelectionCommitment) {
			throw new MigrationSafetyError('STORAGE_FAILURE', 'fresh-test selection commitment was not persisted')
		}
		return createFreshAuctionsdevPublicReport(evidence, {
			legacyWritersDisabled: !committed.legacyMonetaryMutationAllowed,
			selectionCommitment: committed.freshTestSelectionCommitment,
		})
	} finally {
		defaultStore?.close()
	}
}
