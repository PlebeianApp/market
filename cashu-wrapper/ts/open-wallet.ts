/**
 * open-wallet.ts — the one call that opens the wallet **domain** the host runs over.
 *
 * ## Why this exists
 *
 * `openCocoRuntime` opens Coco and hands back our read/reconcile runtime, but the *acting* surface a host
 * adapter moves money through - the rail (`createCocoRail(manager)`) - needs the same Coco manager, and the
 * runtime deliberately does not expose it (the runtime is read/reconcile-shaped by design; packing a manager
 * onto it would leak Coco's shape into the host's contract). A caller that opened Coco twice to get both would
 * have two managers over the same storage, which is exactly the fencing hazard ADR-0010's authority namespace
 * exists to prevent. So the domain opens Coco **once** and hands back both halves together: this function.
 *
 * It is the composition root's call. The plugin does not touch Coco: it asks for a `WalletDomain` here, receives
 * `{ runtime, rail }`, and registers the adapters over the rail. `runtimeOverManager` and `createCocoRail` stay
 * the only places that know Coco's shape, and this module names neither `Manager`'s members nor Coco's families.
 *
 * ## The browser's repositories, and the test seam
 *
 * In the browser the proof authority is `@cashu/coco-indexeddb`'s `IndexedDbRepositories`. A suite that cannot
 * run IndexedDB (a headless DOM with none, or a plain `bun` test) supplies `repositories` - Coco's own
 * `MemoryRepositories` through `openMemoryWalletDomain` - so the same wiring is exercised without a browser.
 */

import { initializeCoco, MemoryRepositories, type Keypair, type Manager } from '@cashu/coco-core'
import type { Plugin } from '@cashu/coco-core/plugin'
import { IndexedDbRepositories } from '@cashu/coco-indexeddb'
import { createCocoRail, type CocoRailPort } from './coco-rail'
import { runtimeOverManager, type CocoRepositories } from './coco-runtime'
import { proofPoint } from './nut-client'
import { seedGetterFor, type SeedStore } from './seed-store'
import type { CocoWalletRuntime, WalletAccount } from './types'
import { disposeFridayWallet, FridayWalletCleanupUnconfirmed, FridayWalletOpeningFailed, walletOpeningFailure } from './demo-friday-wallet-drain'

/** The two halves of the wallet domain the host and its adapters run over: the runtime and the acting rail. */
export interface WalletDomain {
	/** The account-scoped runtime the host drives: read/reconcile, plus the balance projection. */
	readonly runtime: CocoWalletRuntime
	/** The acting surface the host's application adapters move money through. */
	readonly rail: CocoRailPort
	/**
	 * Coco's durable P2PK keyring, exposed only as a signing closure. The secret
	 * key never leaves this domain and every transient copy is zeroed after use.
	 * Application adapters must add their own exact role/domain validation before
	 * calling `signDigest`; this is deliberately not exported to page code.
	 */
	readonly paymentKey: {
		getPublicKey(): Promise<string>
		signDigest(digest: Uint8Array): Promise<Uint8Array>
	}
	dispose(): Promise<void>
}

export interface OpenWalletDomainOptions {
	/** Caller retains its wallet lease until late initialization cleanup completes. */
	readonly signal?: AbortSignal
	readonly account: WalletAccount
	/** The app's own seed custody (`seed-store.ts`): Coco is handed the seed and stores none. */
	readonly seedStore: SeedStore
	/** The IndexedDB database name, where the backend builds its own repository root. */
	readonly repositoryName?: string
	/** The durable identity that fences concurrent sessions over the same storage, per ADR-0010. */
	readonly authority?: { readonly namespace?: string; readonly ownerId?: string }
	/** Supply the repository root directly (Coco's `MemoryRepositories`, or the app's own) instead of IndexedDB. */
	readonly repositories?: CocoRepositories
	/** Exact transport supplied by the application; used by Coco and the rail. */
	readonly requestFetch?: typeof fetch
	/** Test-only loopback HTTP exception. Remote browser wallets remain HTTPS-only. */
	readonly allowLoopbackHttp?: boolean
	/** Explicit isolated FIPS ULA HTTP exception for the server-side demo lab. */
	readonly allowFipsUlaHttp?: boolean
}

export interface WalletProofProjection {
	readonly amount: number
	readonly keysetId: string
	readonly amountKey: string
	readonly inputFeePpk: number
	readonly reservationId: string
	readonly active: true
}

export interface ProjectedWalletDomain extends WalletDomain {
	projectBidMaterial(mintUrl: string, amount: number, inputFeePpk: number): Promise<readonly WalletProofProjection[]>
}

export interface OpenProjectedWalletDomainOptions {
	readonly account: WalletAccount
	readonly seedStore: SeedStore
	readonly repositoryName: string
	readonly authority: { readonly namespace?: string; readonly ownerId?: string }
	readonly requestFetch: typeof fetch
	/** App-owned public identifier derivation; receives only a proof's public curve point, never its secret. */
	readonly reservationId: (mintUrl: string, proofYHex: string) => Promise<string>
}

function paymentKeyOver(manager: Manager): WalletDomain['paymentKey'] {
	const exactKeypair = async (): Promise<Keypair> => {
		const existing = await manager.keyring.getLatestKeyPair()
		return existing ?? manager.keyring.generateKeyPair(true)
	}
	return Object.freeze({
		async getPublicKey(): Promise<string> {
			const keypair = await exactKeypair()
			try { return keypair.publicKeyHex }
			finally { keypair.secretKey.fill(0) }
		},
		async signDigest(digest: Uint8Array): Promise<Uint8Array> {
			if (!(digest instanceof Uint8Array) || digest.length !== 32) {
				throw new Error('COCO_WALLET_DOMAIN: payment digest must be exactly 32 bytes')
			}
			const keypair = await exactKeypair()
			try {
				const { schnorr } = await import('@noble/curves/secp256k1.js')
				return schnorr.sign(digest, keypair.secretKey)
			} finally { keypair.secretKey.fill(0) }
		},
	})
}

/**
 * Open Coco once and hand back the wallet domain: the runtime the host drives and the rail its adapters act
 * through, both over one manager. `dispose()` closes the manager and, where this call built the IndexedDB
 * repository root, closes that too.
 */
export async function openWalletDomain(options: OpenWalletDomainOptions): Promise<WalletDomain> {
	options.signal?.throwIfAborted()
	let owned: IndexedDbRepositories | null = null
	let manager: Manager | undefined
	let attemptedManager = false
	try {
		let repo: CocoRepositories
		if (options.repositories !== undefined) {
			repo = options.repositories
		} else {
			owned = new IndexedDbRepositories(options.repositoryName === undefined ? {} : { name: options.repositoryName })
			await owned.init()
			repo = owned
		}
		options.signal?.throwIfAborted()
		attemptedManager = true
		manager = await initializeCoco({
			repo,
			seedGetter: seedGetterFor(options.seedStore),
			...(options.authority !== undefined ? { authority: options.authority } : {}),
			...(options.requestFetch !== undefined ? { requestFetch: options.requestFetch } : {}),
		})
		options.signal?.throwIfAborted()
		const openedManager = manager
		const resource = { async dispose() {
			try {
				if (typeof openedManager.dispose !== 'function') throw new Error('wallet manager has no drain method')
				await openedManager.dispose()
			} finally { owned?.close() }
		} }
		return {
			runtime: runtimeOverManager(options.account, manager),
			rail: createCocoRail(manager, {
				...(options.requestFetch !== undefined ? { fetchImpl: options.requestFetch } : {}),
				allowLoopbackHttp: options.allowLoopbackHttp ?? false,
				allowFipsUlaHttp: options.allowFipsUlaHttp ?? false,
			}),
			paymentKey: paymentKeyOver(manager),
			dispose: () => disposeFridayWallet(resource),
		}
	} catch (error) {
		// Initialization cannot be forcibly interrupted inside Coco/IndexedDB.
		// Await its result, close late resources and only then release the lease.
		try {
			if (manager !== undefined) await disposeFridayWallet(manager)
		} catch (cleanupError) {
			throw new FridayWalletCleanupUnconfirmed(error, cleanupError)
		} finally {
			try { owned?.close() } catch (cleanupError) { throw new FridayWalletCleanupUnconfirmed(error, cleanupError) }
		}
		// Coco may fail before returning its partial manager. Only its typed
		// confirmed cleanup result permits normal ownership release at that stage.
		throw attemptedManager && manager === undefined ? walletOpeningFailure(error) : new FridayWalletOpeningFailed(error)
	}
}

/**
 * Open one browser-scoped domain with the read-only proof projection needed by the authenticated demo.
 * Coco services, repositories, proof secrets and manager lifetime remain inside this wrapper boundary; the
 * app receives only its WalletDomain ports and public proof metadata.
 */
export async function openProjectedWalletDomain(options: OpenProjectedWalletDomainOptions): Promise<ProjectedWalletDomain> {
	const repository = new IndexedDbRepositories({ name: options.repositoryName })
	let projection: ((mintUrl: string, amount: number, inputFeePpk: number) => Promise<readonly WalletProofProjection[]>) | undefined
	const projectionPlugin: Plugin<readonly ['proofService', 'mintService']> = {
		name: `${options.authority.namespace ?? 'wallet'}.proof-projection`,
		required: ['proofService', 'mintService'] as const,
		onInit(context) {
			projection = async (mintUrl, amount, inputFeePpk) => {
				const proofs = await context.services.proofService.selectProofsToSend(mintUrl, { unit: 'sat', amount } as never, false)
				const metadata = await context.services.mintService.ensureUpdatedMint(mintUrl)
				const keysets = new Map(metadata.keysets.filter((keyset) => keyset.unit === 'sat' && keyset.active).map((keyset) => [keyset.id, keyset]))
				return Promise.all(proofs.map(async (proof): Promise<WalletProofProjection> => {
					const value = proof as unknown as { amount: unknown; id: string; secret: string }
					const held = value.amount as { value?: unknown }
					const numeric = typeof value.amount === 'number' ? value.amount : typeof held?.value === 'number' ? held.value : Number(held?.value ?? value.amount)
					const keyset = keysets.get(value.id)
					if (!Number.isSafeInteger(numeric) || numeric <= 0 || keyset === undefined || keyset.feePpk !== inputFeePpk) throw new Error('refused-demo-proof-projection')
					const amountKey = keyset.keypairs[String(numeric)]
					if (typeof amountKey !== 'string' || amountKey.length === 0) throw new Error('refused-demo-proof-projection')
					const proofYHex = proofPoint({ secret: value.secret }).toHex()
					return { amount: numeric, keysetId: value.id, amountKey, inputFeePpk: keyset.feePpk, reservationId: await options.reservationId(mintUrl, proofYHex), active: true }
				}))
			}
		},
	}
	try {
		await repository.init()
		const manager = await initializeCoco({
			repo: repository,
			seedGetter: seedGetterFor(options.seedStore),
			plugins: [projectionPlugin],
			authority: options.authority,
			requestFetch: options.requestFetch,
			webSocketFactory: null,
		})
		return {
			runtime: runtimeOverManager(options.account, manager),
			rail: createCocoRail(manager, { fetchImpl: options.requestFetch }),
			paymentKey: paymentKeyOver(manager),
			async projectBidMaterial(mintUrl, amount, inputFeePpk) {
				if (projection === undefined) throw new Error('refused-demo-proof-projection-unavailable')
				return projection(mintUrl, amount, inputFeePpk)
			},
			async dispose() { await manager.dispose?.(); repository.close() },
		}
	} catch (error) {
		repository.close()
		throw error
	}
}

/**
 * The same domain over Coco's in-memory repositories: for a suite or a worker with no IndexedDB. It is the same
 * wiring as the browser path with one substitution, so a test exercises the real runtime and rail rather than a
 * stand-in - and, being in-memory, it is not durable and is never the browser's store.
 */
export function openMemoryWalletDomain(options: {
	readonly account: WalletAccount
	readonly seedStore: SeedStore
	readonly authority?: { readonly namespace?: string; readonly ownerId?: string }
}): Promise<WalletDomain> {
	return openWalletDomain({ ...options, repositories: new MemoryRepositories() })
}
