import { getTokenMetadata, initializeCoco, type Manager } from '@cashu/coco-core'
import { IndexedDbRepositories } from '@cashu/coco-indexeddb'
import { getEncodedToken } from '@cashu/cashu-ts'
import { createCashuTestMintWallet, waitForCashuTestMintQuotePaid } from '@/lib/cashu/testMint'
import { loadOrCreateCocoSeed } from './seedVault'
import type { CocoAuctionAccountIdentity } from './auctions/types'
import { assertFakeCocoAuctionMint, readCocoV2AuctionEnvironment } from './auctions/mode'
import { assertCocoAuctionAccountIdentity } from './auctions/canonical'
import { runBrowserFreshAuctionsdevCocoMutation } from './migration/runtimeGate'

export interface CocoAccountRuntime {
	account: CocoAuctionAccountIdentity
	manager: Manager
	loadSeed(): Promise<Uint8Array>
}

export const getCocoRuntimeScope = (account: CocoAuctionAccountIdentity): string => `${account.environmentId}:${account.accountPubkey}`
export const getCocoDatabaseName = (account: CocoAuctionAccountIdentity): string =>
	`plebeian_coco_v2_${account.environmentId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${account.accountPubkey}`

export class CocoRuntimeRegistry {
	private readonly runtimes = new Map<string, Promise<CocoAccountRuntime>>()

	get(accountInput: CocoAuctionAccountIdentity): Promise<CocoAccountRuntime> {
		const account = assertCocoAuctionAccountIdentity(accountInput)
		const key = getCocoRuntimeScope(account)
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
		const scope = getCocoRuntimeScope(account)
		const loadSeed = () => loadOrCreateCocoSeed(scope)
		const repo = new IndexedDbRepositories({ name: getCocoDatabaseName(account) })
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

	async dispose(accountInput: CocoAuctionAccountIdentity): Promise<void> {
		const account = assertCocoAuctionAccountIdentity(accountInput)
		const key = getCocoRuntimeScope(account)
		const runtime = this.runtimes.get(key)
		if (!runtime) return
		this.runtimes.delete(key)
		;(await runtime).manager.dispose()
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

export const COCO_DEFAULT_FAKE_FUNDING_AMOUNT = 500
export const COCO_MAX_FAKE_FUNDING_AMOUNT = 100_000

export const assertCocoTestFundingAllowed = (
	environment: {
		environmentId: string
		monetaryMode: string
		fakeMintAllowlist: readonly string[]
	},
	amount: number,
	requestedMintUrl?: string,
): string => {
	if (environment.monetaryMode !== 'fake') throw new Error('Coco test-mint funding is restricted to fake funds')
	if (environment.environmentId !== 'auctionsdev' && environment.environmentId !== 'test') {
		throw new Error('Coco test-mint funding is restricted to auctionsdev/test')
	}
	if (!Number.isSafeInteger(amount) || amount < 1 || amount > COCO_MAX_FAKE_FUNDING_AMOUNT) {
		throw new Error(`Test funding must be a whole number between 1 and ${COCO_MAX_FAKE_FUNDING_AMOUNT.toLocaleString()} sats`)
	}
	const mintUrl = requestedMintUrl?.trim().replace(/\/$/, '') || environment.fakeMintAllowlist[0]
	if (!mintUrl) throw new Error('Coco test-mint funding requires an allowlisted fake mint')
	if (!environment.fakeMintAllowlist.includes(mintUrl)) throw new Error('Selected test mint is not in the Coco fake-mint allowlist')
	return mintUrl
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
	return runBrowserFreshAuctionsdevCocoMutation(
		{ account: account.accountPubkey, environment: account.environmentId as 'auctionsdev' | 'test' },
		async () => {
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
		},
	)
}

/**
 * Convenience funding for the fake-funds Auction profile. The test mint issues
 * an encoded token, then the normal fenced Coco receive path verifies and
 * persists it. This cannot run in a real-funds or non-test environment.
 */
export const addCocoAuctionTestFunds = async (
	account: CocoAuctionAccountIdentity,
	amount: number,
	requestedMintUrl?: string,
): Promise<CocoAuctionBalanceProjection> => {
	const environment = readCocoV2AuctionEnvironment()
	if (account.environmentId !== environment.environmentId) throw new Error('Coco funding account belongs to another environment')
	const mintUrl = assertCocoTestFundingAllowed(environment, amount, requestedMintUrl)
	const { cashuWallet: wallet, keysetId } = await createCashuTestMintWallet(mintUrl, { allowKeysetFallback: true })
	const quote = await wallet.createMintQuoteBolt11(amount)
	await waitForCashuTestMintQuotePaid(wallet, quote)
	const proofs = await wallet.mintProofsBolt11(amount, quote, keysetId ? { keysetId } : undefined)
	const receivedAmount = proofs.reduce((total, proof) => total + proof.amount.toNumber(), 0)
	if (receivedAmount !== amount) {
		throw new Error('Fake mint returned an unexpected funding amount')
	}
	const token = getEncodedToken({ mint: mintUrl, proofs, unit: 'sat' })
	return receiveCocoAuctionFakeFunds(account, token)
}
