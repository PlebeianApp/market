import { useFridayWallet } from './demo-friday-wallet-drain'
/** Actual browser composition for the fake-money Friday flow. */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	createDemoFridayBrowserCocoClient,
	type DemoFridayBrowserFundingRequestV1,
	type DemoFridayNostrSignerPort,
} from './demo-friday-browser-coco-client'
import { createDemoFridayBrowserCocoSellerClient, type DemoFridaySellerApprovalControl } from './demo-friday-browser-coco-seller-client'
import { awaitDemoFridaySellerApproval } from './demo-friday-browser-coco-seller-plan'
import { createDemoFridayBrowserCocoWalletFactory } from './demo-friday-browser-coco-wallet'
import {
	createDemoFridayBrowserPaymentState,
	type DemoFridayFakeFundingPolicyV1,
} from './demo-friday-browser-payment-state'
import { createDemoFridayBrowserExactEnvelopeBuilder } from './demo-friday-browser-exact-envelope-builder'
import {
	createDemoFridayBrowserSellerPlanHttp,
	createDemoFridayBrowserSellerPlanIntentHttp,
	createDemoFridayBrowserTrustedAuctionFundingHttp,
	createDemoFridayBrowserTrustedDeploymentHttp,
} from './demo-friday-browser-trust-http'
import {
	demoFridaySellerPlanIntentUnsignedEvent,
	type DemoFridaySellerPlanIntentContentV1,
} from './demo-friday-browser-trust-service'
import {
	createDemoFridayBrowserAuthorityFundingHttp,
	createDemoFridayBrowserAuthorityFundingAbortHttp,
	createDemoFridayBrowserAuthorityTerminalHttp,
} from './demo-friday-browser-authority-http'
import {
	createDemoFridayBrowserFundingAbortClient,
	type DemoFridayBrowserAbortNostrPort,
	type DemoFridayBrowserAbortResultV1,
} from './demo-friday-browser-funding-abort'
import {
	DEMO_FRIDAY_BROWSER_ACCEPTANCE_DRIVER_STATUS,
	runDemoFridayBrowserAcceptance,
} from './demo-friday-browser-acceptance-runner'
import {
	createDemoFridayR20BrowserRoleController,
	exactDemoFridayR20BrowserReadiness,
	type DemoFridayR20AcceptancePinsV1,
	type DemoFridayR20BrowserRole,
	type DemoFridayR20BrowserRoleController,
} from './demo-friday-r20-browser-acceptance-composition'

const HEX_32 = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
const STORAGE_KEY = 'plebeian-friday-browser-public-operations-v1'

export type ExternalSigner = {
	getPublicKey(): Promise<string>
	signEvent(event: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<{
		id: string; pubkey: string; sig: string; kind: number; created_at: number; tags: string[][]; content: string
	}>
}

interface PublicPendingBidV1 extends DemoFridayBrowserFundingRequestV1 {
	schema: 'PLEBEIAN_FRIDAY_BROWSER_PENDING_BID_V1'
	actor: string
	environmentId: string
	sellerActor: string
	expiresAt: number
	admitted?: true
}

interface PublicSellerOperationV1 {
	schema: 'PLEBEIAN_FRIDAY_BROWSER_SELLER_OPERATION_V1'
	actor: string
	environmentId: string
	auctionId: string
	fundingOperationId: string
}

interface PublicStateV1 {
	schema: 'PLEBEIAN_FRIDAY_BROWSER_PUBLIC_STATE_V1'
	pendingBids: PublicPendingBidV1[]
	sellerOperations: PublicSellerOperationV1[]
	pendingFaucet?: { actor: string; environmentId: string; fundingOperationId: string; amount: number; policyDigest?: string }
}

function refuse(message: string): never { throw new Error(`PLEBEIAN_FRIDAY_BROWSER: ${message}`) }
function origin(): string {
	const value = globalThis.location?.origin
	if (typeof value !== 'string') refuse('browser origin is unavailable')
	const parsed = new URL(value)
	if (parsed.protocol !== 'https:' || parsed.origin !== value) refuse('Friday browser flow requires the exact public HTTPS origin')
	return parsed.origin
}
function nowSeconds(): number { return Math.floor(Date.now() / 1_000) }
function freshOperationId(): string { return bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32))) }
function fakeFundingPolicyBytes(maxPerRequest: number, maxResultingBalance: number): string {
	return `{"max_per_request":${maxPerRequest},"max_resulting_balance":${maxResultingBalance},"schema":"PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1"}`
}
function fakeFundingPolicyDigest(maxPerRequest: number, maxResultingBalance: number): string {
	return bytesToHex(sha256(utf8ToBytes(fakeFundingPolicyBytes(maxPerRequest, maxResultingBalance))))
}
const LEGACY_FAKE_FUNDING_POLICY: DemoFridayFakeFundingPolicyV1 = Object.freeze({
	schema: 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1', maxPerRequest: 10_000,
	browserWalletAdvisoryMaxResultingBalance: 50_000,
	digest: fakeFundingPolicyDigest(10_000, 50_000),
})

function exactFakeFundingPolicy(value: DemoFridayFakeFundingPolicyV1): DemoFridayFakeFundingPolicyV1 {
	if (value.schema !== 'PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1'
		|| !Number.isSafeInteger(value.maxPerRequest) || value.maxPerRequest < 1
		|| !Number.isSafeInteger(value.browserWalletAdvisoryMaxResultingBalance)
		|| value.browserWalletAdvisoryMaxResultingBalance < value.maxPerRequest
		|| value.browserWalletAdvisoryMaxResultingBalance > Number.MAX_SAFE_INTEGER
		|| value.digest !== fakeFundingPolicyDigest(value.maxPerRequest,
			value.browserWalletAdvisoryMaxResultingBalance)) refuse('fake funding policy is invalid')
	return Object.freeze({ ...value })
}

function exactPublicState(parsed: unknown): PublicStateV1 {
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) refuse('public operation index is malformed')
	const value = parsed as PublicStateV1
	if (value.schema !== 'PLEBEIAN_FRIDAY_BROWSER_PUBLIC_STATE_V1'
		|| !Array.isArray(value.pendingBids) || !Array.isArray(value.sellerOperations)) refuse('public operation index schema differs')
	if (value.pendingBids.some((entry) => entry.schema !== 'PLEBEIAN_FRIDAY_BROWSER_PENDING_BID_V1'
		|| !HEX_32.test(entry.actor) || !ID.test(entry.environmentId) || !HEX_32.test(entry.sellerActor)
		|| !ID.test(entry.auctionId) || !ID.test(entry.fundingOperationId)
		|| !Number.isSafeInteger(entry.bidAmount) || entry.bidAmount < 1
		|| entry.fullPoolAmount !== entry.bidAmount || entry.reservedPoolAmount !== entry.fullPoolAmount
		|| (entry.replacesBidId !== '' && !HEX_32.test(entry.replacesBidId))
		|| !Number.isSafeInteger(entry.locktime) || !Number.isSafeInteger(entry.expiresAt)
		|| (entry.admitted !== undefined && entry.admitted !== true))
		|| value.sellerOperations.some((entry) => entry.schema !== 'PLEBEIAN_FRIDAY_BROWSER_SELLER_OPERATION_V1'
			|| !HEX_32.test(entry.actor) || !ID.test(entry.environmentId) || !ID.test(entry.auctionId)
			|| !ID.test(entry.fundingOperationId))
		|| (value.pendingFaucet !== undefined && (!HEX_32.test(value.pendingFaucet.actor)
			|| !ID.test(value.pendingFaucet.environmentId) || !ID.test(value.pendingFaucet.fundingOperationId)
			|| !Number.isSafeInteger(value.pendingFaucet.amount) || value.pendingFaucet.amount < 1
			|| value.pendingFaucet.amount > Number.MAX_SAFE_INTEGER
			|| (value.pendingFaucet.policyDigest !== undefined
				&& !HEX_32.test(value.pendingFaucet.policyDigest))))) refuse('public operation index contains a malformed entry')
	return structuredClone(value)
}

export function validateDemoFridayBrowserPublicState(value: unknown): void { exactPublicState(value) }

function readPublicState(): PublicStateV1 {
	const raw = globalThis.localStorage.getItem(STORAGE_KEY)
	if (raw === null) return { schema: 'PLEBEIAN_FRIDAY_BROWSER_PUBLIC_STATE_V1', pendingBids: [], sellerOperations: [] }
	let parsed: unknown
	try { parsed = JSON.parse(raw) } catch { return refuse('public operation index is not JSON') }
	return exactPublicState(parsed)
}
function writePublicState(state: PublicStateV1): void { globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) }

function nostr(external: ExternalSigner): DemoFridayNostrSignerPort {
	return Object.freeze({
		async getPublicKey() {
			const value = await external.getPublicKey()
			if (!HEX_32.test(value)) refuse('Nostr signer returned an invalid public key')
			return value
		},
		async signEvent(event: Parameters<DemoFridayNostrSignerPort['signEvent']>[0]) {
			const { pubkey, ...unsigned } = event
			const signed = await external.signEvent(structuredClone(unsigned))
			if (signed.pubkey !== pubkey || signed.kind !== event.kind || signed.created_at !== event.created_at
				|| JSON.stringify(signed.tags) !== JSON.stringify(event.tags) || signed.content !== event.content) {
				refuse('NIP-07 changed the exact event')
			}
			return structuredClone(signed)
		},
	})
}

function abortNostr(external: ExternalSigner): DemoFridayBrowserAbortNostrPort {
	return Object.freeze({
		async getPublicKey() {
			const value = await external.getPublicKey()
			if (!HEX_32.test(value)) refuse('Nostr signer returned an invalid public key')
			return value
		},
		async signEvent(event: Parameters<DemoFridayBrowserAbortNostrPort['signEvent']>[0]) {
			const { pubkey, ...unsigned } = event
			const signed = await external.signEvent(structuredClone(unsigned))
			if (signed.pubkey !== pubkey || signed.kind !== 28_650 || signed.created_at !== event.created_at
				|| JSON.stringify(signed.tags) !== JSON.stringify(event.tags) || signed.content !== event.content) {
				refuse('NIP-07 changed the exact FundingAbort event')
			}
			return structuredClone(signed) as Awaited<ReturnType<DemoFridayBrowserAbortNostrPort['signEvent']>>
		},
	})
}

export interface PlebeianFridayBrowserController {
	actor(): Promise<string>
	fundingPolicy(): DemoFridayFakeFundingPolicyV1
	pendingFakeFunding(): Promise<{ amount: number; operationId: string; policyDigest: string } | null>
	sellerPaymentPublicKey(): Promise<string>
	balance(): Promise<{ available: number; reserved: number; locked: number; pending: number; unresolved: number; total: number }>
	fundFake(amount: number): Promise<{ operationId: string; state: 'finalized'; balance: number }>
	placeBid(request: Omit<DemoFridayBrowserFundingRequestV1, 'fundingOperationId'>): Promise<
		{ status: 'seller_plan_pending'; fundingOperationId: string; sellerActor: string; expiresAt: number }
		| { status: 'prepared' | 'admitted' | 'rejected_return' | 'unknown'; fundingOperationId: string; committedHeight?: number }
	>
	serviceSellerPlans(control?: Omit<DemoFridaySellerApprovalControl, 'expectedChallenge'> & { auctionIds?: string[]; deploymentPins?: DemoFridayR20AcceptancePinsV1 }): Promise<{ registered: number; operations: string[] }>
	importAvailable(): Promise<{ refunds: number; winnerPayments: number }>
	cancelPending(fundingOperationId: string, reason?: 'prebroadcast_client_abandonment' | 'prebroadcast_service_failure'):
		Promise<DemoFridayBrowserAbortResultV1>
	recoverCancellation(fundingOperationId: string): Promise<DemoFridayBrowserAbortResultV1>
}

export function createPlebeianFridayBrowserController(externalSigner: ExternalSigner,
	fundingPolicyValue: DemoFridayFakeFundingPolicyV1 = LEGACY_FAKE_FUNDING_POLICY): PlebeianFridayBrowserController {
	const fundingPolicy = exactFakeFundingPolicy(fundingPolicyValue)
	const publicOrigin = origin()
	const signer = nostr(externalSigner)
	const state = createDemoFridayBrowserPaymentState()
	const updatePublicState = <T>(change: (value: PublicStateV1) => Promise<T> | T): Promise<T> =>
		state.runPublicIndexExclusive(async () => {
			const value = readPublicState(), result = await change(value)
			writePublicState(value)
			return result
		})
	const snapshotPublicState = (): Promise<PublicStateV1> =>
		state.runPublicIndexExclusive(async () => readPublicState())
	const walletFactory = createDemoFridayBrowserCocoWalletFactory({ browserOrigin: publicOrigin })
	const deployment = createDemoFridayBrowserTrustedDeploymentHttp({ origin: publicOrigin })
	const auction = createDemoFridayBrowserTrustedAuctionFundingHttp({ origin: publicOrigin })
	const plans = createDemoFridayBrowserSellerPlanHttp({ origin: publicOrigin })
	const intent = createDemoFridayBrowserSellerPlanIntentHttp({ origin: publicOrigin })
	const terminal = createDemoFridayBrowserAuthorityTerminalHttp({ origin: publicOrigin })
	const admission = createDemoFridayBrowserAuthorityFundingHttp({ origin: publicOrigin })
	const abortAuthority = createDemoFridayBrowserAuthorityFundingAbortHttp({ origin: publicOrigin })
	const client = async () => {
		const trusted = await deployment.readExact()
		return createDemoFridayBrowserCocoClient({ deployment, auction, walletFactory, state, nostrSigner: signer,
			builder: createDemoFridayBrowserExactEnvelopeBuilder({ participants: trusted.participants }), admission, terminal })
	}
	const seller = createDemoFridayBrowserCocoSellerClient({ deployment, walletFactory, state, nostr: signer, plans, terminal })
	const actor = () => signer.getPublicKey()
	const abortClient = async (environmentId: string) => {
		const trusted = await deployment.readExact()
		if (trusted.environmentId !== environmentId) refuse('cancellation belongs to another deployment')
		const browserClient = await client()
		return createDemoFridayBrowserFundingAbortClient({
			pins: { authNetworkId: trusted.authNetworkId, chainId: trusted.chainId,
				genesisSha256: trusted.genesisSha256, mintUrl: trusted.canonicalMintUrl,
				activeKeysetId: trusted.mintSnapshot.activeSatKeysetId,
				committeePublicKey: trusted.committeePublicKey, committeeKeysetId: trusted.committeeKeysetId,
				committeeKeysetVersion: trusted.committeeKeysetVersion, dkgRunId: trusted.dkgRunId,
				publicKeyPackageSha256: trusted.publicKeyPackageSha256,
				signerRosterDigest: trusted.signerRosterDigest },
			state, walletFactory, authority: abortAuthority, nostrSigner: abortNostr(externalSigner),
			journal: {
				runExclusive: (identity, run) => state.runOperationExclusive(identity, run),
				loadExact: (identity) => state.loadFundingAbort(identity),
				saveExact: (record, revision) => state.saveFundingAbort(record, revision),
			},
			discovery: {
				async assertRetainedExact(identity) {
					const current = await snapshotPublicState()
					if (!current.pendingBids.some((entry) => entry.actor === identity.actor
						&& entry.environmentId === identity.environmentId
						&& entry.fundingOperationId === identity.fundingOperationId)) {
						refuse('cancellation operation is absent from durable public discovery')
					}
				},
				async markImportedExact(request) {
					await updatePublicState((current) => {
						const before = current.pendingBids.length
						current.pendingBids = current.pendingBids.filter((entry) => !(entry.actor === request.actor
							&& entry.environmentId === request.environmentId
							&& entry.fundingOperationId === request.fundingOperationId))
						if (current.pendingBids.length !== before - 1) refuse('imported cancellation discovery identity changed')
					})
				},
			},
			returns: { importReturnExact: (identity) => browserClient.importRefundExact(identity) },
		})
	}
	const walletUse = async <T>(run: (wallet: Awaited<ReturnType<typeof walletFactory.openExact>>) => Promise<T>,
		expectedActor?: string): Promise<T> => {
		const [trusted, owner] = await Promise.all([deployment.readExact(), actor()])
		if (expectedActor !== undefined && owner !== expectedActor) refuse('NIP-07 account changed during wallet operation')
		return state.runWalletExclusive({ actor: owner, environmentId: trusted.environmentId }, async () => {
			const wallet = await walletFactory.openExact({ actor: owner, environmentId: trusted.environmentId,
				canonicalMintUrl: trusted.canonicalMintUrl })
			return useFridayWallet(wallet, () => run(wallet))
		})
	}
	return Object.freeze({
		actor,
		fundingPolicy: () => fundingPolicy,
		async pendingFakeFunding() {
			const [owner, trusted, value] = await Promise.all([actor(), deployment.readExact(), snapshotPublicState()])
			const pending = value.pendingFaucet
			if (pending === undefined) return null
			if (pending.actor !== owner || pending.environmentId !== trusted.environmentId) {
				refuse('pending fake funding belongs to another actor or deployment')
			}
			return { amount: pending.amount, operationId: pending.fundingOperationId,
				policyDigest: pending.policyDigest ?? LEGACY_FAKE_FUNDING_POLICY.digest }
		},
		sellerPaymentPublicKey: () => walletUse((wallet) => wallet.sellerRecipientKey.getPublicKey()),
		balance: () => walletUse((wallet) => wallet.balance()),
		async fundFake(amount: number) {
			if (!Number.isSafeInteger(amount) || amount < 1 || amount > fundingPolicy.maxPerRequest) refuse('fake funding amount is invalid')
			const [trusted, owner] = await Promise.all([deployment.readExact(), actor()])
			const held = await updatePublicState((publicState) => {
				if (publicState.pendingFaucet !== undefined) {
					if (publicState.pendingFaucet.actor !== owner || publicState.pendingFaucet.environmentId !== trusted.environmentId
						|| publicState.pendingFaucet.amount !== amount
						|| (publicState.pendingFaucet.policyDigest ?? LEGACY_FAKE_FUNDING_POLICY.digest) !== fundingPolicy.digest) {
						refuse('an unresolved fake funding operation must recover under its original amount and policy')
					}
					return structuredClone(publicState.pendingFaucet)
				}
				publicState.pendingFaucet = { actor: owner, environmentId: trusted.environmentId,
					fundingOperationId: `faucet-${freshOperationId()}`, amount, policyDigest: fundingPolicy.digest }
				return structuredClone(publicState.pendingFaucet)
			})
			const result = await walletUse((wallet) => wallet.fundFake({ amount, operationId: held.fundingOperationId,
				environmentId: held.environmentId,
				browserWalletAdvisoryMaxResultingBalance: fundingPolicy.browserWalletAdvisoryMaxResultingBalance,
				policy: fundingPolicy, journal: state }), held.actor)
			await updatePublicState((publicState) => {
				if (publicState.pendingFaucet?.fundingOperationId !== held.fundingOperationId) {
					refuse('fake funding discovery changed before finalization')
				}
				delete publicState.pendingFaucet
			})
			return result
		},
		async placeBid(requestValue: Omit<DemoFridayBrowserFundingRequestV1, 'fundingOperationId'>) {
			if (!ID.test(requestValue.auctionId) || !Number.isSafeInteger(requestValue.bidAmount)
				|| requestValue.bidAmount < 1 || !Number.isSafeInteger(requestValue.fullPoolAmount)
				|| requestValue.fullPoolAmount !== requestValue.bidAmount
				|| requestValue.reservedPoolAmount !== requestValue.fullPoolAmount
				|| (requestValue.replacesBidId !== '' && !HEX_32.test(requestValue.replacesBidId))
				|| !Number.isSafeInteger(requestValue.locktime) || requestValue.locktime < nowSeconds() + 600) {
				refuse('bid request is invalid; own raises remain fail-closed')
			}
			const [trusted, owner] = await Promise.all([deployment.readExact(), actor()])
			const pending = await updatePublicState(async (publicState) => {
				let held = publicState.pendingBids.find((entry) => entry.actor === owner
					&& entry.environmentId === trusted.environmentId && entry.auctionId === requestValue.auctionId
					&& entry.bidAmount === requestValue.bidAmount && entry.replacesBidId === requestValue.replacesBidId)
				// Expiry ends authorization for a *new* preparation; it never proves
				// that an earlier signed transaction was absent from Comet.  Retain the
				// durable public identity so prepareAndFinalize/readExact can recover an
				// admitted or code-zero rejected return after a lost response.  Removal
				// is permitted only by the terminal import/acknowledgement lifecycle.
				if (held !== undefined) return structuredClone(held)
				const fundingOperationId = freshOperationId(), expiresAt = nowSeconds() + 240
				const content: DemoFridaySellerPlanIntentContentV1 = {
					schema: 'PLEBEIAN_FRIDAY_SELLER_PLAN_INTENT_V1', authNetworkId: trusted.authNetworkId,
					chainId: trusted.chainId, auctionId: requestValue.auctionId, fundingOperationId,
					bidAmount: requestValue.bidAmount, fullPoolAmount: requestValue.fullPoolAmount,
					replacesBidId: requestValue.replacesBidId, canonicalMintUrl: trusted.canonicalMintUrl, expiresAt,
				}
				const signed = await signer.signEvent(demoFridaySellerPlanIntentUnsignedEvent(owner, nowSeconds(), content))
				const challenge = await intent.issueExact(signed)
				held = { schema: 'PLEBEIAN_FRIDAY_BROWSER_PENDING_BID_V1', actor: owner,
					environmentId: trusted.environmentId, sellerActor: challenge.sellerActor,
					fundingOperationId, expiresAt, ...structuredClone(requestValue) }
				publicState.pendingBids.push(held)
				return structuredClone(held)
			})
			const exactPending = pending ?? refuse('pending bid did not persist')
			const registered = await plans.readExact({ sellerActor: exactPending.sellerActor,
				auctionId: exactPending.auctionId, fundingOperationId: exactPending.fundingOperationId })
			if (registered === null) return { status: 'seller_plan_pending' as const,
				fundingOperationId: exactPending.fundingOperationId, sellerActor: exactPending.sellerActor, expiresAt: exactPending.expiresAt }
			const result = await (await client()).prepareAndFinalize({
				auctionId: exactPending.auctionId, fundingOperationId: exactPending.fundingOperationId,
				bidAmount: exactPending.bidAmount, fullPoolAmount: exactPending.fullPoolAmount,
				reservedPoolAmount: exactPending.reservedPoolAmount, replacesBidId: exactPending.replacesBidId,
				locktime: exactPending.locktime,
			})
			if (result.status === 'admitted' || result.status === 'rejected_return') {
				await updatePublicState((publicState) => {
					const stored = publicState.pendingBids.find((entry) => entry.actor === owner
						&& entry.environmentId === trusted.environmentId
						&& entry.fundingOperationId === exactPending.fundingOperationId)
					if (stored === undefined) refuse('admitted operation disappeared from public discovery')
					stored.admitted = true
				})
			}
			return { status: result.status, fundingOperationId: result.fundingOperationId,
				...(result.committedHeight === undefined ? {} : { committedHeight: result.committedHeight }) }
		},
		async serviceSellerPlans(control: Omit<DemoFridaySellerApprovalControl, 'expectedChallenge'> & { auctionIds?: string[]; deploymentPins?: DemoFridayR20AcceptancePinsV1 } = {}) {
			const pins = control.deploymentPins === undefined ? undefined : structuredClone(control.deploymentPins)
			const wait = <T>(read: () => Promise<T>) => awaitDemoFridaySellerApproval(control.signal, read)
			const [owner, trusted] = await wait(() => Promise.all([actor(), deployment.readExact()]))
			// Copy caller selection so asynchronous UI changes cannot expand this pass.
			const auctionIds = control.auctionIds === undefined ? undefined : [...control.auctionIds]
			const assertActive = async () => {
				if (control.signal?.aborted) refuse('seller approval cancelled')
				const pinnedFields = ['environmentId', 'authNetworkId', 'chainId', 'genesisSha256', 'canonicalMintUrl',
					'committeePublicKey', 'committeeKeysetId', 'committeeKeysetVersion', 'dkgRunId',
					'publicKeyPackageSha256', 'signerRosterDigest'] as const
				if (pins !== undefined && pinnedFields.some((field) => trusted[field] !== pins[field])) refuse('seller deployment differs from release pins')
				await wait(async () => control.assertActive?.())
				const [currentOwner, currentDeployment] = await wait(() => Promise.all([actor(), deployment.readExact()]))
				if (currentOwner !== owner || JSON.stringify(currentDeployment) !== JSON.stringify(trusted)) refuse('seller actor or deployment changed')
				if (control.signal?.aborted) refuse('seller approval cancelled')
			}
			await assertActive()
			const pending = await wait(() => plans.listPendingExact(owner)), registered: string[] = []
			for (const challenge of pending) {
				if (auctionIds !== undefined && !auctionIds.includes(challenge.auctionId)) continue
				await assertActive()
				if (challenge.sellerActor !== owner || challenge.authNetworkId !== trusted.authNetworkId
					|| challenge.chainId !== trusted.chainId) refuse('seller challenge belongs to another actor or deployment')
				if (challenge.expiresAt <= nowSeconds()) refuse('seller plan expired; bidder needs a new intent')
				// Persist discovery before registration. If the server commits the
				// plan and its response is lost, the same operation remains visible
				// for exact read/import recovery.
				await updatePublicState((publicState) => {
					if (!publicState.sellerOperations.some((entry) => entry.actor === owner
						&& entry.environmentId === trusted.environmentId
						&& entry.fundingOperationId === challenge.fundingOperationId)) {
						publicState.sellerOperations.push({ schema: 'PLEBEIAN_FRIDAY_BROWSER_SELLER_OPERATION_V1',
						actor: owner, environmentId: trusted.environmentId, auctionId: challenge.auctionId,
						fundingOperationId: challenge.fundingOperationId })
					}
				})
				await seller.prepareAndRegister({ auctionId: challenge.auctionId, fundingOperationId: challenge.fundingOperationId,
					assertActive, signal: control.signal, onPlan: control.onPlan, expectedChallenge: structuredClone(challenge) })
				await assertActive()
				registered.push(challenge.fundingOperationId)
			}
			return { registered: registered.length, operations: registered }
		},
		async importAvailable() {
			const [owner, trusted] = await Promise.all([actor(), deployment.readExact()])
			const publicState = await snapshotPublicState()
			let refunds = 0, winnerPayments = 0
			const completedRefunds = new Set<string>(), completedWinners = new Set<string>()
			const browserClient = await client()
			for (const pending of publicState.pendingBids.filter((entry) => entry.actor === owner
				&& entry.environmentId === trusted.environmentId)) {
				const identity = { actor: owner, environmentId: pending.environmentId,
					fundingOperationId: pending.fundingOperationId }
				// Login/refresh recovery must not require the user to remember and
				// manually re-enter a cancellation operation ID. Only a previously
				// persisted, NIP-07-signed cancellation is resumed here; this never
				// creates new abort authority on the user's behalf.
				if (await state.loadFundingAbort(identity) !== null) {
					const recovered = await (await abortClient(pending.environmentId)).recoverExact(identity)
					if (recovered.status === 'COMMITTED_ABORT' && recovered.imported) {
						completedRefunds.add(`${pending.environmentId}\u0000${pending.fundingOperationId}`)
						if (!recovered.replay) refunds += 1
					}
					continue
				}
				const imported = await browserClient.importRefundExact({ actor: owner,
					environmentId: pending.environmentId, fundingOperationId: pending.fundingOperationId })
				if (imported !== null) {
					completedRefunds.add(`${pending.environmentId}\u0000${pending.fundingOperationId}`)
					if (imported.alreadyImported !== true) refunds += 1
				}
			}
			for (const operation of publicState.sellerOperations.filter((entry) => entry.actor === owner
				&& entry.environmentId === trusted.environmentId)) {
				const imported = await seller.importWinnerExact({ auctionId: operation.auctionId,
					fundingOperationId: operation.fundingOperationId })
				if (imported !== null) {
					completedWinners.add(`${operation.environmentId}\u0000${operation.fundingOperationId}`)
					if (imported.alreadyImported !== true) winnerPayments += 1
				}
			}
			// A terminal client returns only after the recipient import and its
			// canonical acknowledgement are durable.  That is the sole automatic
			// deletion boundary for the public discovery index; expiry and missing
			// RPC responses never remove an unresolved operation.
			if (completedRefunds.size > 0 || completedWinners.size > 0) {
				await updatePublicState((current) => {
					current.pendingBids = current.pendingBids.filter((entry) => !completedRefunds.has(
						`${entry.environmentId}\u0000${entry.fundingOperationId}`,
					))
					current.sellerOperations = current.sellerOperations.filter((entry) => !completedWinners.has(
						`${entry.environmentId}\u0000${entry.fundingOperationId}`,
					))
				})
			}
			return { refunds, winnerPayments }
		},
		async cancelPending(fundingOperationId: string,
			reason: 'prebroadcast_client_abandonment' | 'prebroadcast_service_failure' = 'prebroadcast_client_abandonment') {
			if (!ID.test(fundingOperationId)) refuse('cancellation funding operation is invalid')
			const [owner, trusted] = await Promise.all([actor(), deployment.readExact()])
			const publicState = await snapshotPublicState()
			const pending = publicState.pendingBids.find((entry) => entry.actor === owner
				&& entry.environmentId === trusted.environmentId
				&& entry.fundingOperationId === fundingOperationId)
			if (pending === undefined) refuse('cancellation operation is not retained')
			return (await abortClient(pending.environmentId)).requestExact({ actor: owner,
				environmentId: pending.environmentId, fundingOperationId }, reason)
		},
		async recoverCancellation(fundingOperationId: string) {
			if (!ID.test(fundingOperationId)) refuse('cancellation recovery operation is invalid')
			const [owner, trusted] = await Promise.all([actor(), deployment.readExact()])
			const publicState = await snapshotPublicState()
			const pending = publicState.pendingBids.find((entry) => entry.actor === owner
				&& entry.environmentId === trusted.environmentId
				&& entry.fundingOperationId === fundingOperationId)
			if (pending === undefined) refuse('cancellation recovery operation is not retained')
			return (await abortClient(pending.environmentId)).recoverExact({ actor: owner,
				environmentId: pending.environmentId, fundingOperationId })
		},
	})
}

/**
 * Opens one role of the staged R20 acceptance workflow.  The public server
 * readiness flags and exact deployment pins are checked before the Coco
 * controller, IndexedDB state, or wallet manager is constructed.
 */
export async function connectPlebeianFridayR20AcceptanceRole(options: {
	role: DemoFridayR20BrowserRole
	signer: ExternalSigner
	pins: DemoFridayR20AcceptancePinsV1
	fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}): Promise<DemoFridayR20BrowserRoleController> {
	const controller = await connectPlebeianFridayR20Controller(options)
	return createDemoFridayR20BrowserRoleController({ role: options.role, signer: options.signer,
		pins: options.pins, controller })
}

/** Opens the ordinary Nostr/Coco browser flow only after exact R20 readiness and pin checks. */
export async function connectPlebeianFridayR20Controller(options: {
	signer: ExternalSigner
	pins: DemoFridayR20AcceptancePinsV1
	fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}): Promise<PlebeianFridayBrowserController> {
	const fetchImpl = options.fetchImpl ?? fetch
	const response = await fetchImpl('/api/config', { method: 'GET', redirect: 'error', credentials: 'same-origin',
		headers: { accept: 'application/json' } })
	if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'application/json') {
		refuse('R20 readiness endpoint is unavailable')
	}
	let value: unknown
	try { value = await response.json() } catch { return refuse('R20 readiness endpoint is not JSON') }
	const readiness = exactDemoFridayR20BrowserReadiness(value, options.pins)
	return createPlebeianFridayBrowserController(options.signer, readiness.fake_funding_policy)
}

Object.defineProperty(globalThis, 'plebeianFridayConnect', {
	configurable: false, enumerable: false, writable: false,
	value: (signer: ExternalSigner) => createPlebeianFridayBrowserController(signer),
})

Object.defineProperty(globalThis, 'plebeianFridayRunAcceptance', {
	configurable: false, enumerable: false, writable: false,
	value: runDemoFridayBrowserAcceptance,
})

Object.defineProperty(globalThis, 'plebeianFridayAcceptanceDriverStatus', {
	configurable: false, enumerable: false, writable: false,
	value: DEMO_FRIDAY_BROWSER_ACCEPTANCE_DRIVER_STATUS,
})

Object.defineProperty(globalThis, 'plebeianFridayR20AcceptanceConnect', {
	configurable: false, enumerable: false, writable: false,
	value: connectPlebeianFridayR20AcceptanceRole,
})

Object.defineProperty(globalThis, 'plebeianFridayR20Connect', {
	configurable: false, enumerable: false, writable: false,
	value: connectPlebeianFridayR20Controller,
})
