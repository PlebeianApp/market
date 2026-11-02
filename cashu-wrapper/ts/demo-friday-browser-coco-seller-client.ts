import { useFridayWallet } from './demo-friday-wallet-drain'
/** Browser-owned Coco seller plan registration and winner import. */
import { hasValidDleq } from '@cashu/cashu-ts'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import type { createDemoFridayBrowserCocoWalletFactory } from './demo-friday-browser-coco-wallet'
import { exactDemoFridayCocoTerminalNotice, importDemoFridayCocoTerminal } from './demo-friday-browser-coco-terminal'
import type { DemoFridayCocoTerminalPort } from './demo-friday-browser-coco-client'
import type { DemoFridayBrowserPaymentStatePort } from './demo-friday-browser-payment-state'
import {
	prepareDemoFridaySellerWinnerPlan, awaitDemoFridaySellerApproval,
	type DemoFridaySellerNostrPort,
	type DemoFridaySellerOpeningRefV1,
	type DemoFridaySellerRecipientKeyPort,
	type DemoFridaySellerWinnerPlanChallengeV1,
	type DemoFridaySellerWinnerPlanEnvelopeV1,
	type DemoFridaySellerWinnerPlanPublicV1,
} from './demo-friday-browser-coco-seller-plan'
import type { DemoRecipientImportReceipt, DemoRecipientKeyset } from './demo-sigall-recipient'
import { demoDenominationKeyDigest } from './demo-sigall-settlement'
import {
	keysetPublicKey, unblindBlindedSignature,
	type BlindedSignature, type BlindingData, type CashuProof,
} from './nut-client'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
const ACK_CONTEXT = utf8ToBytes('PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1')

export interface DemoFridaySellerPlanRegisteredV1 {
	schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_REGISTERED_V1'
	status: 'registered'
	planDigest: string
	plan: DemoFridaySellerWinnerPlanPublicV1
}

/** Same-origin service. It stores only the public plan and Nostr authorization. */
export interface DemoFridaySellerPlanServicePort {
	/** Discover public pending challenges for the authenticated seller browser. */
	listPendingExact(sellerActor: string): Promise<DemoFridaySellerWinnerPlanChallengeV1[]>
	challengeExact(request: { sellerActor: string; auctionId: string; fundingOperationId: string }): Promise<DemoFridaySellerWinnerPlanChallengeV1>
	readExact(request: { sellerActor: string; auctionId: string; fundingOperationId: string }): Promise<DemoFridaySellerPlanRegisteredV1 | null>
	registerExact(envelope: DemoFridaySellerWinnerPlanEnvelopeV1): Promise<DemoFridaySellerPlanRegisteredV1>
}

export interface DemoFridaySellerTrustedDeploymentV1 {
	environmentId: string
	canonicalMintUrl: string
	keyset: DemoRecipientKeyset
}

export interface DemoFridaySellerRecipientPaymentKeyPort extends DemoFridaySellerRecipientKeyPort {
	/** Signs only the canonical terminal acknowledgement digest. */
	signTerminalAck(value: {
		digest: string
		recipientPublicKey: string
		operationId: string
		role: 'winner_settlement'
	}): Promise<string>
}

export interface DemoFridaySellerApprovalControl {
	assertActive?: () => Promise<void>
	signal?: AbortSignal
	expectedChallenge?: DemoFridaySellerWinnerPlanChallengeV1
	onPlan?: (challenge: DemoFridaySellerWinnerPlanChallengeV1) => void
}

export interface DemoFridayBrowserCocoSellerClient {
	prepareAndRegister(request: { auctionId: string; fundingOperationId: string } & DemoFridaySellerApprovalControl): Promise<DemoFridaySellerPlanRegisteredV1>
	importWinnerExact(request: { auctionId: string; fundingOperationId: string }): Promise<DemoRecipientImportReceipt | null>
}

function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_COCO_SELLER_CLIENT: ${message}`) }

function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('canonical value contains a non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') refuse('canonical value contains an unsupported type')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function exactOrigin(value: string): string {
	let url: URL
	try { url = new URL(value) } catch { return refuse('mint identity is invalid') }
	if (value !== url.origin || url.protocol !== 'https:' || url.port !== '' || url.username !== ''
		|| url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') refuse('mint identity is not one HTTPS origin')
	return url.origin
}

function exactDeployment(value: DemoFridaySellerTrustedDeploymentV1): DemoFridaySellerTrustedDeploymentV1 {
	if (!ID.test(value.environmentId) || exactOrigin(value.canonicalMintUrl) !== value.canonicalMintUrl
		|| value.keyset.unit !== 'sat' || !ID.test(value.keyset.id) || Object.keys(value.keyset.keys).length < 1
		|| Object.values(value.keyset.keys).some((key) => !COMPRESSED_KEY.test(key))) refuse('trusted deployment is malformed')
	return structuredClone(value)
}

function exactRegistered(value: DemoFridaySellerPlanRegisteredV1, expected?: {
	sellerActor: string; auctionId: string; fundingOperationId: string
}): DemoFridaySellerPlanRegisteredV1 {
	if (value.schema !== 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_REGISTERED_V1' || value.status !== 'registered'
		|| !HEX_32.test(value.planDigest) || value.plan.schema !== 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_V1'
		|| !HEX_32.test(value.plan.sellerActor) || !HEX_32.test(value.plan.bidderActor)
		|| !ID.test(value.plan.auctionId) || !ID.test(value.plan.fundingOperationId)
		|| !Number.isSafeInteger(value.plan.bidAmount) || value.plan.bidAmount < 1
		|| !COMPRESSED_KEY.test(value.plan.recipientPublicKey)
		|| value.plan.recipientPublicKey !== value.plan.recipientPlan.capability.recipientPublicKey
		|| value.plan.recipientPlan.capability.role !== 'winner_settlement'
		|| value.plan.recipientPlan.capability.operationId !== value.plan.fundingOperationId
		|| value.plan.recipientPlan.capability.network !== value.plan.authNetworkId
		|| value.plan.recipientPlan.capability.chainId !== value.plan.chainId
		|| value.plan.recipientPlan.capability.auctionId !== value.plan.auctionId
		|| value.plan.recipientPlan.capability.mintUrl !== value.plan.canonicalMintUrl
		|| value.plan.recipientPlan.capability.unit !== 'sat'
		|| value.plan.recipientPlan.outputs.reduce((sum, output) => sum + output.amount, 0) !== value.plan.bidAmount) {
		refuse('registered seller plan is malformed')
	}
	if (bytesToHex(sha256(utf8ToBytes(canonical(value.plan)))) !== value.planDigest) refuse('registered seller plan digest differs')
	if (expected !== undefined && (value.plan.sellerActor !== expected.sellerActor
		|| value.plan.auctionId !== expected.auctionId || value.plan.fundingOperationId !== expected.fundingOperationId)) {
		refuse('registered seller plan differs from the request')
	}
	return structuredClone(value)
}

function noticeDigest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(canonical(value)))) }

function ackDigest(digest: string, receipt: unknown): string {
	if (!HEX_32.test(digest)) refuse('notice digest is malformed')
	return bytesToHex(sha256(concatBytes(ACK_CONTEXT, hexToBytes(digest), utf8ToBytes(canonical(receipt)))))
}

export function createDemoFridayBrowserCocoSellerClient(options: {
	deployment: { readExact(): Promise<DemoFridaySellerTrustedDeploymentV1> }
	walletFactory: ReturnType<typeof createDemoFridayBrowserCocoWalletFactory>
	state: DemoFridayBrowserPaymentStatePort
	nostr: DemoFridaySellerNostrPort
	plans: DemoFridaySellerPlanServicePort
	terminal: DemoFridayCocoTerminalPort
	nowSeconds?: () => number
}): DemoFridayBrowserCocoSellerClient {
	const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000))
	const identity = async (request: { auctionId: string; fundingOperationId: string }) => {
		if (!ID.test(request.auctionId) || !ID.test(request.fundingOperationId)) refuse('seller request identity is malformed')
		const sellerActor = await options.nostr.getPublicKey()
		if (!HEX_32.test(sellerActor)) refuse('seller Nostr identity is malformed')
		return { sellerActor, auctionId: request.auctionId, fundingOperationId: request.fundingOperationId }
	}
	return Object.freeze({
		async prepareAndRegister(request: { auctionId: string; fundingOperationId: string } & DemoFridaySellerApprovalControl) {
			const wait = <T>(read: () => Promise<T>) => awaitDemoFridaySellerApproval(request.signal, read)
			const expected = await wait(() => identity(request))
			await wait(async () => request.assertActive?.())
			const deployment = exactDeployment(await wait(() => options.deployment.readExact()))
			// Request cancellation is independent of lease lifetime. A queued
			// acquisition cancels; an already-running opener retains the lease
			// until its late result and all wallet work have been disposed.
			return wait(() => options.state.runWalletExclusive({ actor: expected.sellerActor, environmentId: deployment.environmentId }, async () => {
				if (request.signal?.aborted) refuse('seller approval cancelled')
				await wait(async () => request.assertActive?.())
				const existing = await wait(() => options.plans.readExact(expected))
				if (existing !== null) return exactRegistered(existing, expected)
				const challenge = structuredClone(await wait(() => options.plans.challengeExact(expected)))
				if (request.expectedChallenge !== undefined && canonical(challenge) !== canonical(request.expectedChallenge)) refuse('pending seller challenge changed')
				if (challenge.sellerActor !== expected.sellerActor || challenge.auctionId !== expected.auctionId
					|| challenge.fundingOperationId !== expected.fundingOperationId
					|| challenge.canonicalMintUrl !== deployment.canonicalMintUrl
					|| challenge.activeSatKeysetId !== deployment.keyset.id
					|| challenge.denominationKeyDigest !== demoDenominationKeyDigest(deployment.keyset.keys)) {
					refuse('seller challenge differs from trusted deployment or request')
				}
				// Do not race this resource-producing promise inside the lease. The
				// UI request is already cancellable outside it, and a late wallet must
				// be disposed before another tab may open the same repository.
				const wallet = await options.walletFactory.openExact({ actor: expected.sellerActor,
					environmentId: deployment.environmentId, canonicalMintUrl: deployment.canonicalMintUrl, signal: request.signal })
				const pendingWalletWork = new Set<Promise<unknown>>()
				const track = <T>(read: () => Promise<T>): Promise<T> => {
					const task = Promise.resolve().then(() => {
						if (request.signal?.aborted) refuse('seller approval cancelled')
						return read()
					})
					pendingWalletWork.add(task)
					void task.then(() => pendingWalletWork.delete(task), () => pendingWalletWork.delete(task))
					return task
				}
				const recipientKey = {
					getPublicKey: () => track(() => wallet.sellerRecipientKey.getPublicKey()),
					signRecipientCapability: (value: Parameters<typeof wallet.sellerRecipientKey.signRecipientCapability>[0]) =>
						track(() => wallet.sellerRecipientKey.signRecipientCapability(value)),
				}
				return useFridayWallet(wallet, async () => {
					if (request.signal?.aborted) refuse('seller approval cancelled')
					const assertSigningScope = async () => {
						if (request.signal?.aborted) refuse('seller approval cancelled')
						await wait(async () => request.assertActive?.())
						const [owner, currentDeployment, currentChallenge, recipient] = await wait(() => Promise.all([
							options.nostr.getPublicKey(), options.deployment.readExact(),
							options.plans.challengeExact(expected), recipientKey.getPublicKey(),
						]))
						if (owner !== expected.sellerActor || canonical(exactDeployment(currentDeployment)) !== canonical(deployment)
							|| canonical(currentChallenge) !== canonical(challenge) || recipient !== challenge.sellerPaymentPublicKey
							|| nowSeconds() >= challenge.expiresAt) refuse('seller approval scope changed or expired; new bid intent required')
						await wait(async () => request.assertActive?.())
						if (request.signal?.aborted) refuse('seller approval cancelled')
					}
					await assertSigningScope()
					request.onPlan?.(structuredClone(challenge))
					const envelope = await prepareDemoFridaySellerWinnerPlan({ challenge, keyset: deployment.keyset,
						journal: options.state, recipientKey,
						nostr: options.nostr, nowSeconds: nowSeconds(), assertSigningScope, signal: request.signal })
					await assertSigningScope()
					// Submission may already have committed if cancellation wins this wait.
					// Durable public discovery is retained for exact read/import recovery.
					const registered = exactRegistered(await wait(() => options.plans.registerExact(envelope)), expected)
					if (registered.planDigest !== envelope.planDigest || canonical(registered.plan) !== canonical(envelope.plan)) refuse('registered seller plan differs from signed plan')
					return registered
				}, async () => {
					// Retain ownership until tracked keyring work and cleanup drain.
					await Promise.allSettled([...pendingWalletWork])
				})
			}, request.signal))
		},

		async importWinnerExact(request: { auctionId: string; fundingOperationId: string }) {
			const expected = await identity(request)
			const registeredValue = await options.plans.readExact(expected)
			// Discovery is durable before approval. A denied/cancelled plan has no
			// registration yet and must not block passive imports for other operations.
			if (registeredValue === null) return null
			const registered = exactRegistered(registeredValue, expected)
			const deployment = exactDeployment(await options.deployment.readExact())
			const operationIdentity = { actor: expected.sellerActor, environmentId: deployment.environmentId,
				fundingOperationId: expected.fundingOperationId }
			const replay = await options.state.loadSellerTerminalAck(operationIdentity)
			if (replay !== null) {
				if (replay.auctionId !== expected.auctionId
					|| replay.ack.importReceipt.recipientPublicKey !== registered.plan.recipientPublicKey) {
					refuse('persisted seller acknowledgement belongs to another terminal operation')
				}
				await options.terminal.acknowledgeExact(structuredClone(replay.ack))
				return { ...structuredClone(replay.ack.importReceipt), alreadyImported: true }
			}
			const plan = registered.plan
			if (plan.canonicalMintUrl !== deployment.canonicalMintUrl || plan.activeSatKeysetId !== deployment.keyset.id
				|| plan.denominationKeyDigest !== demoDenominationKeyDigest(deployment.keyset.keys)) refuse('seller plan differs from trusted deployment')
			const rawNotice = await options.terminal.readNoticeExact({ actor: expected.sellerActor,
				fundingOperationId: expected.fundingOperationId })
			if (rawNotice === null) return null
			const notice = exactDemoFridayCocoTerminalNotice(rawNotice)
			if (notice.role !== 'winner_settlement') refuse('seller client rejects non-winner terminal notices')
			return options.state.runWalletExclusive({ actor: expected.sellerActor, environmentId: deployment.environmentId }, async () => {
				const held = await options.state.loadSellerTerminalAck(operationIdentity)
				if (held !== null) {
					if (held.auctionId !== expected.auctionId
						|| held.ack.importReceipt.recipientPublicKey !== plan.recipientPublicKey) {
						refuse('persisted seller acknowledgement belongs to another terminal operation')
					}
					await options.terminal.acknowledgeExact(structuredClone(held.ack))
					return { ...structuredClone(held.ack.importReceipt), alreadyImported: true }
				}
				const wallet = await options.walletFactory.openExact({ actor: expected.sellerActor,
					environmentId: deployment.environmentId, canonicalMintUrl: deployment.canonicalMintUrl })
				const { receipt, transportReceipt, signature } = await useFridayWallet(wallet, async () => {
					const receipt = await importDemoFridayCocoTerminal<DemoFridaySellerOpeningRefV1, CashuProof[]>({
					notice, expectedActor: expected.sellerActor, intent: {
						...structuredClone(plan.recipientPlan.capability), schema: 'COCO_DEMO_RECIPIENT_INTENT_V1',
						amounts: plan.recipientPlan.outputs.map((output) => output.amount),
					}, keyset: deployment.keyset, journal: options.state, wallet,
					roleBinding: {
						async assertWinnerRecipient(binding) {
							if (binding.operationId !== expected.fundingOperationId
								|| binding.recipientPublicKey !== plan.recipientPublicKey) refuse('winner role binding changed')
						},
						async assertRefundRecipient() { refuse('seller client rejects refund role') },
					},
					unblinder: { async unblindExact(value) {
						return value.signatures.map((signature, index) => {
							const opening = value.privateOpeningRefs[index]
							if (opening === undefined || opening.B_ !== value.outputs[index]?.B_) refuse('seller opening differs from output')
							const blinding: BlindingData = { secret: opening.secret, r: BigInt(`0x${opening.r}`), B_: opening.B_ }
							return unblindBlindedSignature(signature as BlindedSignature, blinding,
								keysetPublicKey(value.keyset, signature.amount))
						})
					} },
					verifier: { async verifyExact(value) {
						if (value.unblindedRef.length !== value.outputs.length
							|| value.unblindedRef.some((proof) => !hasValidDleq(proof as never, value.keyset as never, { require: true }))) {
							refuse('seller proofs failed exact mint DLEQ verification')
						}
						return value.unblindedRef
					} },
					})
					const { alreadyImported: _localOnly, ...publicReceipt } = receipt
					const transportReceipt: Parameters<DemoFridayCocoTerminalPort['acknowledgeExact']>[0]['importReceipt'] = { schema: 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1' as const,
						operationId: publicReceipt.operationId, role: 'winner_settlement' as const,
						recipientPublicKey: publicReceipt.recipientPublicKey, amount: publicReceipt.amount,
						proofCount: publicReceipt.proofCount, imported: true as const }
					const digest = noticeDigest(notice)
					const signature = await wallet.sellerRecipientKey.signTerminalAck({ digest: ackDigest(digest, transportReceipt),
						recipientPublicKey: plan.recipientPublicKey, operationId: plan.fundingOperationId, role: 'winner_settlement' })
					return { receipt, transportReceipt, signature }
				})
			if (!HEX_64.test(signature)) refuse('recipient acknowledgement signature is malformed')
			const digest = noticeDigest(notice)
			const acknowledgement = { schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_ACK_V1' as const,
				actor: expected.sellerActor, fundingOperationId: expected.fundingOperationId, noticeDigest: digest,
				importReceipt: transportReceipt, recipientAckSignature: signature }
			await options.state.saveSellerTerminalAck({ schema: 'PLEBEIAN_FRIDAY_SELLER_TERMINAL_ACK_RECORD_V1',
				actor: expected.sellerActor, environmentId: deployment.environmentId,
				auctionId: expected.auctionId, fundingOperationId: expected.fundingOperationId,
				ack: acknowledgement })
			await options.terminal.acknowledgeExact(acknowledgement)
				return receipt
			})
		},
	})
}
