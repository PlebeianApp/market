import { createFridayMintReadTransport } from './demo-friday-mint-read-transport'
/**
 * Browser-owned Coco v2 wallet boundary for the Friday fake-money flow.
 *
 * This is deliberately not a second wallet implementation. Proofs and
 * operation recovery live in Coco's IndexedDB repositories; the application
 * supplies only browser seed custody, one exact mint origin and caller-owned
 * operation identities. The returned locked token is a private value for the
 * in-browser exact-package builder and must never be logged or placed in a
 * Nostr event.
 */
import {
	createOriginBoundMintFetch,
	verifyThresholdSigAllToken,
	type CocoMintSnapshot,
	type ThresholdSigAllLockTarget,
} from './coco-rail'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { openWalletDomain, type WalletDomain } from './open-wallet'
import { disposeFridayWallet, FridayWalletCleanupUnconfirmed, walletOpeningFailure } from './demo-friday-wallet-drain'
import { createBrowserSeedStore, type SeedStore } from './seed-store'
import type {
	DemoFridayBrowserPaymentStatePort,
	DemoFridayFakeFundingPolicyV1,
	DemoFridayFakeFundingRecord,
} from './demo-friday-browser-payment-state'

const HEX_32 = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/

function fundingPolicyDigest(policy: DemoFridayFakeFundingPolicyV1): string {
	return bytesToHex(sha256(utf8ToBytes(`{"max_per_request":${policy.maxPerRequest},"max_resulting_balance":${policy.browserWalletAdvisoryMaxResultingBalance},"schema":"PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1"}`)))
}

export interface DemoFridayBrowserCocoWallet {
	readonly actor: string
	readonly mintUrl: string
	readonly seedLocation: ReturnType<SeedStore['location']>
	inspect(): Promise<CocoMintSnapshot>
	balance(): ReturnType<WalletDomain['runtime']['balance']>
	/** Real fake-mint funding through Coco; never a UI-only balance mutation. */
	fundFake(input: { amount: number; operationId: string; environmentId: string;
		browserWalletAdvisoryMaxResultingBalance?: number;
		policy?: DemoFridayFakeFundingPolicyV1;
		journal: Pick<DemoFridayBrowserPaymentStatePort, 'loadFakeFunding' | 'saveFakeFunding'> }): Promise<{
		operationId: string; state: 'finalized'; balance: number
	}>
	/** Persist or rejoin the Coco send operation without contacting the mint. */
	prepareThresholdFundingOperation(input: {
		amount: number
		operationId: string
		lock: ThresholdSigAllLockTarget
	}): Promise<{ operationId: string; state: 'prepared' | 'executing' | 'pending' }>
	prepareThresholdFunding(input: {
		amount: number
		operationId: string
		lock: ThresholdSigAllLockTarget
	}): Promise<{ operationId: string; token: string; state: 'pending'; amount: number; keysetId: string }>
	/** Rejoin an already prepared Coco send without creating a new authorization or spend. */
	recoverThresholdFunding(input: {
		amount: number
		operationId: string
		keysetId: string
		lock: ThresholdSigAllLockTarget
	}): Promise<{ operationId: string; token: string; state: 'pending'; amount: number; keysetId: string }>
	importTerminalToken(input: { operationId: string; token: string }): Promise<{ operationId: string; state: 'finalized' }>
	/** Coco-keyring-backed, role-restricted seller payment key. */
	readonly sellerRecipientKey: {
		getPublicKey(): Promise<string>
		signRecipientCapability(value: {
			digest: string
			recipientPublicKey: string
			operationId: string
			role: 'winner_settlement'
		}): Promise<string>
		signTerminalAck(value: {
			digest: string
			recipientPublicKey: string
			operationId: string
			role: 'winner_settlement'
		}): Promise<string>
	}
	dispose(): Promise<void>
}

/** Pure domain adapter; production opening below always supplies a real Coco domain. */
export function demoFridayBrowserCocoWalletOverDomain(options: {
	actor: string
	mintUrl: string
	seedLocation: ReturnType<SeedStore['location']>
	snapshot: CocoMintSnapshot
	domain: WalletDomain
}): DemoFridayBrowserCocoWallet {
	const { actor, mintUrl, snapshot, domain } = options
	const exactSellerSignature = async (value: {
		digest: string; recipientPublicKey: string; operationId: string; role: 'winner_settlement'
	}): Promise<string> => {
		if (!HEX_32.test(value.digest) || !/^(?:02|03)[0-9a-f]{64}$/.test(value.recipientPublicKey)
			|| !ID.test(value.operationId) || value.role !== 'winner_settlement') {
			throw new Error('DEMO_FRIDAY_BROWSER_COCO: seller signing request is malformed')
		}
		const publicKey = await domain.paymentKey.getPublicKey()
		if (publicKey !== value.recipientPublicKey) {
			throw new Error('DEMO_FRIDAY_BROWSER_COCO: seller signing key differs from Coco keyring')
		}
		return bytesToHex(await domain.paymentKey.signDigest(hexToBytes(value.digest)))
	}
	const readHeldThresholdToken = async (input: Parameters<DemoFridayBrowserCocoWallet['recoverThresholdFunding']>[0]) => {
		if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > 50_000
			|| !ID.test(input.operationId) || typeof input.keysetId !== 'string' || input.keysetId.length < 1) {
			throw new Error('DEMO_FRIDAY_BROWSER_COCO: funding recovery request is invalid')
		}
		const held = await domain.rail.lockedToken({ operationId: input.operationId })
		if (held === null || held.mintUrl !== mintUrl || held.unit !== 'sat') {
			throw new Error('DEMO_FRIDAY_BROWSER_COCO: exact Coco locked token is absent')
		}
		const verified = verifyThresholdSigAllToken(held.token, input.keysetId, input.lock)
		if (verified.amount !== input.amount) {
			throw new Error('DEMO_FRIDAY_BROWSER_COCO: exact Coco locked amount differs from the persisted operation')
		}
		return { token: held.token, amount: verified.amount }
	}
	return Object.freeze({
		actor, mintUrl, seedLocation: options.seedLocation,
		async inspect() {
			const current = await domain.rail.inspectMint({ mintUrl })
			if (current.activeSatKeysetId !== snapshot.activeSatKeysetId || current.inputFeePpk !== 0) {
				throw new Error('DEMO_FRIDAY_BROWSER_COCO: active keyset changed')
			}
			return current
		},
		balance: () => domain.runtime.balance({ mintUrl, unit: 'sat' }),
		async fundFake(input: Parameters<DemoFridayBrowserCocoWallet['fundFake']>[0]) {
			const legacy = input.policy === undefined
			const maxPerRequest = input.policy?.maxPerRequest ?? 10_000
			const cap = input.browserWalletAdvisoryMaxResultingBalance
				?? input.policy?.browserWalletAdvisoryMaxResultingBalance ?? 50_000
			if ((!legacy && (input.policy?.schema !== 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1'
				|| input.policy.digest !== fundingPolicyDigest(input.policy)
				|| (input.browserWalletAdvisoryMaxResultingBalance !== undefined
					&& input.browserWalletAdvisoryMaxResultingBalance !== input.policy.browserWalletAdvisoryMaxResultingBalance)))
				|| !Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > maxPerRequest
				|| !Number.isSafeInteger(maxPerRequest) || maxPerRequest < 1 || maxPerRequest > cap
				|| !Number.isSafeInteger(cap) || cap < input.amount || cap > Number.MAX_SAFE_INTEGER || !ID.test(input.operationId)
				|| !ID.test(input.environmentId)) {
				throw new Error('DEMO_FRIDAY_BROWSER_COCO: fake funding request is invalid')
			}
			const identity = { actor, environmentId: input.environmentId, fundingOperationId: input.operationId }
			let record = await input.journal.loadFakeFunding(identity)
			if (record === null) {
				const before = await domain.runtime.balance({ mintUrl, unit: 'sat' })
				if (!Number.isSafeInteger(before.total) || before.total < 0
					|| input.amount > Number.MAX_SAFE_INTEGER - before.total
					|| before.total + input.amount > cap) {
					throw new Error('DEMO_FRIDAY_BROWSER_COCO: fake funding browser-wallet advisory balance limit exceeded')
				}
				record = legacy ? { schema: 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V1', revision: 0,
					actor, environmentId: input.environmentId, fundingOperationId: input.operationId,
					canonicalMintUrl: mintUrl, amount: input.amount, identityCap: cap, phase: 'intent' }
					: { schema: 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V2', revision: 0,
						actor, environmentId: input.environmentId, fundingOperationId: input.operationId,
						canonicalMintUrl: mintUrl, amount: input.amount,
						browserWalletAdvisoryMaxResultingBalance: cap, maxPerRequest,
						policySchema: input.policy!.schema, policyDigest: input.policy!.digest, phase: 'intent' }
				await input.journal.saveFakeFunding(record, null)
			} else if (record.canonicalMintUrl !== mintUrl || record.amount !== input.amount
				|| (legacy && record.schema !== 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V1')
				|| (legacy && record.schema === 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V1' && record.identityCap !== cap)
				|| (!legacy && record.schema === 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V1'
					&& (input.policy!.digest !== '3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069'
						|| maxPerRequest !== 10_000 || cap !== 50_000 || record.identityCap !== cap))
				|| (!legacy && record.schema === 'PLEBEIAN_FRIDAY_FAKE_FUNDING_RECORD_V2'
					&& (record.browserWalletAdvisoryMaxResultingBalance !== cap
						|| record.maxPerRequest !== maxPerRequest || record.policySchema !== input.policy!.schema
						|| record.policyDigest !== input.policy!.digest))) {
				throw new Error('DEMO_FRIDAY_BROWSER_COCO: fake funding retry changed its immutable intent')
			}
			let mayCreateQuote = false
			if (record.phase === 'intent') {
				const next: DemoFridayFakeFundingRecord = { ...record, revision: record.revision + 1,
					phase: 'quote_requested' }
				await input.journal.saveFakeFunding(next, record.revision); record = next; mayCreateQuote = true
			}
			if (record.phase === 'quote_requested') {
				// Coco does not bind its pending quote projection to this browser
				// faucet operation.  Adopting even one same-amount quote could
				// consume another operation's invoice.  A lost create response
				// remains unavailable; never guess or fresh-mint on retry.
				if (!mayCreateQuote) {
					throw new Error('DEMO_FRIDAY_BROWSER_COCO: fake funding quote response is unknown; fresh minting is refused')
				}
				const quote = await domain.rail.createMintQuote({ mintUrl, amount: input.amount, unit: 'sat' })
				if (quote.mintUrl !== mintUrl || quote.unit !== 'sat' || quote.amount !== input.amount || !ID.test(quote.quoteId)) {
					throw new Error('DEMO_FRIDAY_BROWSER_COCO: fake funding quote differs from the persisted intent')
				}
				const next: DemoFridayFakeFundingRecord = { ...record, revision: record.revision + 1,
					phase: 'quoted', quoteId: quote.quoteId }
				await input.journal.saveFakeFunding(next, record.revision); record = next
			}
			if (record.phase === 'quoted') {
				let quote = await domain.rail.refreshMintQuote({ mintUrl, quoteId: record.quoteId! })
				for (let attempt = 0; !['PAID', 'ISSUED'].includes(quote.state) && attempt < 40; attempt += 1) {
					await new Promise((resolve) => setTimeout(resolve, 250))
					quote = await domain.rail.refreshMintQuote({ mintUrl, quoteId: record!.quoteId! })
				}
				if (!['PAID', 'ISSUED'].includes(quote.state) || quote.amount !== input.amount
					|| quote.mintUrl !== mintUrl || quote.unit !== 'sat') {
					throw new Error('DEMO_FRIDAY_BROWSER_COCO: fake funding quote is not paid and exact')
				}
				const operation = await domain.rail.prepareMintOperation({ mintUrl, quoteId: record.quoteId!, amount: input.amount })
				if (operation.quoteId !== record.quoteId || !ID.test(operation.operationId)) {
					throw new Error('DEMO_FRIDAY_BROWSER_COCO: fake funding operation differs from the exact quote')
				}
				const next: DemoFridayFakeFundingRecord = { ...record, revision: record.revision + 1,
					phase: 'operation_bound', mintOperationId: operation.operationId }
				await input.journal.saveFakeFunding(next, record.revision); record = next
			}
			if (record.phase === 'operation_bound') {
				const operation = await domain.rail.resumeMintOperation({ operationId: record.mintOperationId!, quoteId: record.quoteId! })
				if (operation.operationId !== record.mintOperationId || operation.quoteId !== record.quoteId
					|| operation.state !== 'finalized') {
					throw new Error('DEMO_FRIDAY_BROWSER_COCO: fake funding operation is not finalized and exact')
				}
				const next: DemoFridayFakeFundingRecord = { ...record, revision: record.revision + 1, phase: 'finalized' }
				await input.journal.saveFakeFunding(next, record.revision); record = next
			}
			if (record.phase !== 'finalized') throw new Error('DEMO_FRIDAY_BROWSER_COCO: fake funding did not reach final state')
			const after = await domain.runtime.balance({ mintUrl, unit: 'sat' })
			return { operationId: input.operationId, state: 'finalized' as const, balance: after.total }
		},
		async prepareThresholdFundingOperation(input: Parameters<DemoFridayBrowserCocoWallet['prepareThresholdFundingOperation']>[0]) {
			if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > 50_000 || !ID.test(input.operationId)) {
				throw new Error('DEMO_FRIDAY_BROWSER_COCO: funding request is invalid')
			}
			const result = await domain.rail.prepareThresholdSigAll({
				mintUrl, amount: input.amount, unit: 'sat', operationId: input.operationId, lock: input.lock,
			})
			if (result.operationId !== input.operationId || !['prepared', 'executing', 'pending'].includes(result.state)) {
				throw new Error('DEMO_FRIDAY_BROWSER_COCO: threshold operation was not durably prepared')
			}
			return { operationId: result.operationId, state: result.state as 'prepared' | 'executing' | 'pending' }
		},
		async prepareThresholdFunding(input: Parameters<DemoFridayBrowserCocoWallet['prepareThresholdFunding']>[0]) {
			if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > 50_000 || !ID.test(input.operationId)) {
				throw new Error('DEMO_FRIDAY_BROWSER_COCO: funding request is invalid')
			}
			const result = await domain.rail.resumeThresholdSigAll({
				mintUrl, amount: input.amount, unit: 'sat', operationId: input.operationId, lock: input.lock,
			})
			if (result.operationId !== input.operationId || result.state !== 'pending') {
				throw new Error('DEMO_FRIDAY_BROWSER_COCO: threshold reservation is not durably pending')
			}
			const held = await readHeldThresholdToken({ ...input, keysetId: snapshot.activeSatKeysetId })
			return { operationId: result.operationId, token: held.token, state: result.state,
				amount: held.amount, keysetId: snapshot.activeSatKeysetId } as const
		},
		async recoverThresholdFunding(input: Parameters<DemoFridayBrowserCocoWallet['recoverThresholdFunding']>[0]) {
			const resumed = await domain.rail.resumeThresholdSigAll({
				mintUrl, amount: input.amount, unit: 'sat', operationId: input.operationId, lock: input.lock,
			})
			if (resumed.operationId !== input.operationId || resumed.state !== 'pending') {
				throw new Error('DEMO_FRIDAY_BROWSER_COCO: exact Coco threshold operation did not resume')
			}
			const held = await readHeldThresholdToken(input)
			return { operationId: resumed.operationId, token: held.token, state: 'pending' as const,
				amount: held.amount, keysetId: input.keysetId }
		},
		async importTerminalToken(input: Parameters<DemoFridayBrowserCocoWallet['importTerminalToken']>[0]) {
			if (!ID.test(input.operationId) || typeof input.token !== 'string' || input.token.length < 1) {
				throw new Error('DEMO_FRIDAY_BROWSER_COCO: terminal token input is invalid')
			}
			const result = await domain.rail.receive({ token: input.token, operationId: input.operationId })
			if (result.operationId !== input.operationId || result.state !== 'finalized') {
				throw new Error('DEMO_FRIDAY_BROWSER_COCO: terminal token is not finalized in Coco')
			}
			return { operationId: input.operationId, state: 'finalized' as const }
		},
		sellerRecipientKey: Object.freeze({
			getPublicKey: () => domain.paymentKey.getPublicKey(),
			signRecipientCapability: exactSellerSignature,
			signTerminalAck: exactSellerSignature,
		}),
		dispose: () => disposeFridayWallet(domain),
	} satisfies DemoFridayBrowserCocoWallet)
}

function exactMint(value: string, allowLoopbackHttp: boolean): string {
	const url = new URL(value)
	const loopback = allowLoopbackHttp && url.protocol === 'http:' && url.hostname === '127.0.0.1'
	if (value !== url.origin || url.pathname !== '/' || url.search !== '' || url.hash !== ''
		|| url.username !== '' || url.password !== '' || (url.protocol !== 'https:' && !loopback)) {
		throw new Error('DEMO_FRIDAY_BROWSER_COCO: mint is not one exact allowed origin')
	}
	return url.origin
}

/**
 * Deferred opener used by the browser client so its wallet-wide Web Lock is
 * acquired before Coco constructs a manager or claims repository authority.
 */
export function createDemoFridayBrowserCocoWalletFactory(options: {
	browserOrigin?: string
	repositoryName?: string
	seedStore?: SeedStore
	fetchImpl?: typeof fetch
	allowLoopbackHttp?: boolean
	/** Resource-lifecycle test seam; ordinary browser opening uses openWalletDomain. */
	openDomain?: typeof openWalletDomain
} = {}) {
	return Object.freeze({
		openExact(request: { actor: string; environmentId: string; canonicalMintUrl: string; signal?: AbortSignal }) {
			return openDemoFridayBrowserCocoWallet({
				...options, actor: request.actor, environmentId: request.environmentId,
				mintUrl: request.canonicalMintUrl, signal: request.signal,
			})
		},
	})
}

export async function openDemoFridayBrowserCocoWallet(options: {
	signal?: AbortSignal
	actor: string
	mintUrl: string
	environmentId: string
	/** Explicit test seam; a real browser defaults to globalThis.location.origin. */
	browserOrigin?: string
	repositoryName?: string
	seedStore?: SeedStore
	fetchImpl?: typeof fetch
	allowLoopbackHttp?: boolean
	/** Resource-lifecycle test seam; not exposed by the browser controller. */
	openDomain?: typeof openWalletDomain
}): Promise<DemoFridayBrowserCocoWallet> {
	options.signal?.throwIfAborted()
	if (!HEX_32.test(options.actor) || !ID.test(options.environmentId)) {
		throw new Error('DEMO_FRIDAY_BROWSER_COCO: actor or environment is invalid')
	}
	const allowLoopbackHttp = options.allowLoopbackHttp ?? false
	const mintUrl = exactMint(options.mintUrl, allowLoopbackHttp)
	const observedBrowserOrigin = options.browserOrigin
		?? (typeof globalThis.location === 'object' ? globalThis.location.origin : undefined)
	if (!allowLoopbackHttp) {
		if (observedBrowserOrigin === undefined || exactMint(observedBrowserOrigin, false) !== mintUrl) {
			throw new Error('DEMO_FRIDAY_BROWSER_COCO: mint must equal the browser HTTPS origin')
		}
	}
	// Each actor owns a separate Coco repository and deterministic counter.
	// Namespace the seed by the same immutable account identity so two Nostr
	// identities can never derive identical proof outputs at counter zero.
	const seedStore = options.seedStore ?? createBrowserSeedStore({ namespace: `${options.environmentId}:${options.actor}` })
	const mintFetch = options.fetchImpl ?? fetch
	const cancellableFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
		options.signal?.throwIfAborted()
		const inherited = init?.signal ?? (input instanceof Request ? input.signal : undefined)
		const signal = options.signal === undefined ? inherited
			: inherited ? AbortSignal.any([options.signal, inherited]) : options.signal
		return mintFetch(input, { ...init, ...(signal ? { signal } : {}) })
	}) as typeof fetch
	const boundedFetch = createFridayMintReadTransport(
		createOriginBoundMintFetch(mintUrl, cancellableFetch, { allowLoopbackHttp }),
	)
	const domain = await (options.openDomain ?? openWalletDomain)({
		account: { accountId: options.actor, environmentId: options.environmentId }, seedStore,
		repositoryName: options.repositoryName ?? `plebeian-friday-coco-${options.environmentId}-${options.actor}`,
		authority: { namespace: `plebeian-friday-browser-${options.environmentId}-${options.actor}`, ownerId: crypto.randomUUID() },
		requestFetch: boundedFetch, allowLoopbackHttp, signal: options.signal,
	}).catch((error: unknown) => { throw walletOpeningFailure(error) })
	try {
		options.signal?.throwIfAborted()
		const trusted = await domain.rail.trustMint({ mintUrl })
		options.signal?.throwIfAborted()
		if (!trusted.trusted) throw new Error('DEMO_FRIDAY_BROWSER_COCO: configured fake mint is not trusted')
		const snapshot = await domain.rail.inspectMint({ mintUrl })
		options.signal?.throwIfAborted()
		if (snapshot.inputFeePpk !== 0) throw new Error('DEMO_FRIDAY_BROWSER_COCO: active keyset is not zero-fee')
		return demoFridayBrowserCocoWalletOverDomain({
			actor: options.actor, mintUrl, seedLocation: seedStore.location(), snapshot, domain,
		})
	} catch (error) {
		try { await disposeFridayWallet(domain) }
		catch (cleanupError) { throw new FridayWalletCleanupUnconfirmed(error, cleanupError) }
		throw error
	}
}
