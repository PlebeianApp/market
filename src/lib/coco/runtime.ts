import { getTokenMetadata, initializeCoco, type Manager } from '@cashu/coco-core'
import { IndexedDbRepositories } from '@cashu/coco-indexeddb'
import { loadOrCreateCocoSeed } from './seedVault'
import type { CocoAuctionAccountIdentity } from './auctions/types'
import { assertFakeCocoAuctionMint, readCocoV2AuctionEnvironment } from './auctions/mode'
import { assertCocoAuctionAccountIdentity } from './auctions/canonical'

export interface CocoAccountRuntime {
	account: CocoAuctionAccountIdentity
	manager: Manager
	loadSeed(): Promise<Uint8Array>
}

const runtimeKey = (account: CocoAuctionAccountIdentity): string => `${account.environmentId}:${account.accountPubkey}`
const databaseName = (account: CocoAuctionAccountIdentity): string =>
	`plebeian_coco_v2_${account.environmentId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${account.accountPubkey}`

export class CocoRuntimeRegistry {
	private readonly runtimes = new Map<string, Promise<CocoAccountRuntime>>()

	get(accountInput: CocoAuctionAccountIdentity): Promise<CocoAccountRuntime> {
		const account = assertCocoAuctionAccountIdentity(accountInput)
		const key = runtimeKey(account)
		const existing = this.runtimes.get(key)
		if (existing) return existing
		const creating = this.create(account).catch((error) => {
			if (this.runtimes.get(key) === creating) this.runtimes.delete(key)
			throw error
		})
		this.runtimes.set(key, creating)
		return creating
	}

	private async create(account: CocoAuctionAccountIdentity): Promise<CocoAccountRuntime> {
		const scope = runtimeKey(account)
		const loadSeed = () => loadOrCreateCocoSeed(scope)
		const repo = new IndexedDbRepositories({ name: databaseName(account) })
		const manager = await initializeCoco({
			repo,
			seedGetter: loadSeed,
			authority: { namespace: scope, ownerId: crypto.randomUUID() },
			watchers: {
				mintOperationWatcher: { disabled: true },
				proofStateWatcher: { disabled: true },
				meltQuoteWatcher: { disabled: true },
			},
			processors: {
				mintOperationProcessor: { disabled: true },
				meltSettlementProcessor: { disabled: true },
			},
		})
		return { account, manager, loadSeed }
	}
}

export const cocoRuntimeRegistry = new CocoRuntimeRegistry()

export interface CocoAuctionBalanceProjection {
	mintUrl: string
	unit: 'sat'
	spendable: number
	reserved: number
	total: number
}

const trustAllowlistedMint = async (manager: Manager, mintUrl: string): Promise<void> => {
	if (await manager.mint.isTrustedMint(mintUrl)) return
	const known = (await manager.mint.getAllMints()).some((mint) => mint.mintUrl === mintUrl)
	if (known) await manager.mint.trustMint(mintUrl)
	else await manager.mint.addMint(mintUrl, { trusted: true })
}

export const getCocoAuctionBalances = async (account: CocoAuctionAccountIdentity): Promise<readonly CocoAuctionBalanceProjection[]> => {
	const environment = readCocoV2AuctionEnvironment()
	if (account.environmentId !== environment.environmentId) throw new Error('Coco balance account belongs to another environment')
	const runtime = await cocoRuntimeRegistry.get(account)
	const balances = await runtime.manager.wallet.balances.byMint({ mintUrls: [...environment.fakeMintAllowlist], units: ['sat'] })
	return environment.fakeMintAllowlist.map((mintUrl) => {
		const balance = balances[mintUrl]
		return {
			mintUrl,
			unit: 'sat' as const,
			spendable: balance?.spendable.toNumber() ?? 0,
			reserved: balance?.reserved.toNumber() ?? 0,
			total: balance?.total.toNumber() ?? 0,
		}
	})
}

/** Fake-funds-only sealed token ingress used by the normal Receive eCash UI. */
export const receiveCocoAuctionFakeFunds = async (
	account: CocoAuctionAccountIdentity,
	encodedToken: string,
): Promise<CocoAuctionBalanceProjection> => {
	const environment = readCocoV2AuctionEnvironment()
	if (account.environmentId !== environment.environmentId) throw new Error('Coco receive account belongs to another environment')
	const metadata = getTokenMetadata(encodedToken)
	const mintUrl = assertFakeCocoAuctionMint(metadata.mint, environment)
	const runtime = await cocoRuntimeRegistry.get(account)
	await trustAllowlistedMint(runtime.manager, mintUrl)
	const token = await runtime.manager.wallet.decodeToken(encodedToken, mintUrl)
	if ((token.unit ?? 'sat').toLowerCase() !== 'sat') throw new Error('Coco Auction fake funding accepts sat tokens only')
	await runtime.manager.wallet.receive(token)
	const balances = await getCocoAuctionBalances(account)
	const projection = balances.find((balance) => balance.mintUrl === mintUrl)
	if (!projection) throw new Error('Coco did not project the received fake-funds balance')
	return projection
}
