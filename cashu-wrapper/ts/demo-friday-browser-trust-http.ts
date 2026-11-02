/** Same-origin HTTP mappings for the browser's fixed trusted-read ports. */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import type {
	DemoFridayTrustedAuctionFundingPort,
	DemoFridayTrustedAuctionFundingV1,
	DemoFridayTrustedBrowserDeploymentPort,
	DemoFridayTrustedBrowserDeploymentV1,
} from './demo-friday-browser-coco-client'
import type {
	DemoFridaySellerPlanRegisteredV1,
	DemoFridaySellerPlanServicePort,
} from './demo-friday-browser-coco-seller-client'
import type {
	DemoFridaySellerWinnerPlanChallengeV1,
	DemoFridaySellerWinnerPlanEnvelopeV1,
	DemoFridaySellerWinnerPlanPublicV1,
} from './demo-friday-browser-coco-seller-plan'
import type { DemoFridaySignedNostrBidV1 } from './demo-friday-browser-payment-state'
import { demoDenominationKeyDigest, demoOutputsDigest } from './demo-sigall-settlement'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const POINT = /^(?:02|03)[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
type DemoBrowserFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function refuse(message: string): never { throw new Error(`DEMO_FRIDAY_BROWSER_TRUST_HTTP: ${message}`) }

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) refuse(`${label} has missing or unexpected fields`)
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse(`${label} is not an object`)
	return value as Record<string, unknown>
}

function exactOrigin(value: string): string {
	let url: URL
	try { url = new URL(value) } catch { return refuse('origin is invalid') }
	if (value !== url.origin || url.protocol !== 'https:' || url.port !== '' || url.username !== ''
		|| url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') refuse('origin must be one exact HTTPS origin')
	return url.origin
}

function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') { if (!Number.isSafeInteger(value)) refuse('canonical value is not a safe integer'); return JSON.stringify(value) }
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	const valueRecord = record(value, 'canonical value')
	return `{${Object.keys(valueRecord).sort().map((key) => `${JSON.stringify(key)}:${canonical(valueRecord[key])}`).join(',')}}`
}

async function exactJson(response: Response): Promise<unknown> {
	if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'application/json') refuse(`trusted endpoint returned HTTP ${response.status}`)
	return response.json() as Promise<unknown>
}

function poster(options: { origin: string; fetchImpl?: DemoBrowserFetch }) {
	const origin = exactOrigin(options.origin)
	const fetchImpl = options.fetchImpl ?? fetch
	return async (path: string, body: unknown) => exactJson(await fetchImpl(`${origin}${path}`, {
		method: 'POST', redirect: 'error', credentials: 'same-origin',
		headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body),
	}))
}

function exactKeyset(value: unknown) {
	const raw = record(value, 'keyset')
	exactKeys(raw, ['id', 'unit', 'keys'], 'keyset')
	const keys = record(raw.keys, 'denomination keys')
	if (!ID.test(String(raw.id)) || raw.unit !== 'sat' || Object.keys(keys).length < 1
		|| Object.entries(keys).some(([amount, key]) => !/^[1-9][0-9]*$/.test(amount) || !POINT.test(String(key)))) refuse('keyset is malformed')
	return { id: String(raw.id), unit: 'sat', keys: Object.fromEntries(Object.entries(keys).map(([amount, key]) => [amount, String(key)])) }
}

function exactDeployment(value: unknown): DemoFridayTrustedBrowserDeploymentV1 {
	const raw = record(value, 'deployment')
	exactKeys(raw, ['schema', 'environmentId', 'authNetworkId', 'chainId', 'genesisSha256', 'canonicalMintUrl', 'mintSnapshot', 'keyset',
		'committeePublicKey', 'committeeKeysetId', 'committeeKeysetVersion', 'dkgRunId', 'publicKeyPackageSha256',
		'signerRosterDigest', 'participants'], 'deployment')
	const snapshot = record(raw.mintSnapshot, 'mint snapshot')
	exactKeys(snapshot, ['mintUrl', 'mintPublicKey', 'serverVersion', 'activeSatKeysetId', 'denominationKeyDigest',
		'denominationAmounts', 'inputFeePpk', 'nuts'], 'mint snapshot')
	const keyset = exactKeyset(raw.keyset)
	const mint = exactOrigin(String(raw.canonicalMintUrl))
	const amounts = Object.keys(keyset.keys).map(Number).sort((a, b) => a - b)
	if (raw.schema !== 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_V1'
		|| !ID.test(String(raw.environmentId)) || !ID.test(String(raw.authNetworkId)) || !ID.test(String(raw.chainId))
		|| !HEX_32.test(String(raw.genesisSha256))
		|| !POINT.test(String(raw.committeePublicKey)) || !ID.test(String(raw.committeeKeysetId))
		|| !ID.test(String(raw.committeeKeysetVersion)) || !ID.test(String(raw.dkgRunId))
		|| !HEX_32.test(String(raw.publicKeyPackageSha256)) || !HEX_32.test(String(raw.signerRosterDigest))
		|| !Array.isArray(raw.participants) || raw.participants.length !== 4
		|| raw.participants.some((participant, index) => {
			const entry = record(participant, 'FROST participant')
			return Object.keys(entry).length !== 2 || entry.identifier !== index + 1
				|| !POINT.test(String(entry.verifyingShare))
		})
		|| snapshot.mintUrl !== mint || !POINT.test(String(snapshot.mintPublicKey))
		|| typeof snapshot.serverVersion !== 'string' || snapshot.serverVersion.length < 1 || snapshot.serverVersion.length > 160
		|| snapshot.activeSatKeysetId !== keyset.id || snapshot.denominationKeyDigest !== demoDenominationKeyDigest(keyset.keys)
		|| !Array.isArray(snapshot.denominationAmounts) || JSON.stringify([...snapshot.denominationAmounts].sort((a, b) => Number(a) - Number(b))) !== JSON.stringify(amounts)
		|| snapshot.inputFeePpk !== 0 || !Array.isArray(snapshot.nuts)
		|| (snapshot.nuts as unknown[]).some((nut) => !Number.isSafeInteger(nut))
		|| ![4, 7, 9, 10, 11, 12].every((nut) => (snapshot.nuts as unknown[]).includes(nut))) refuse('deployment cryptographic identity is malformed')
	return structuredClone(value) as DemoFridayTrustedBrowserDeploymentV1
}

function exactWinnerRequest(value: unknown) {
	const raw = record(value, 'winner request')
	exactKeys(raw, ['capability', 'outputs'], 'winner request')
	const capability = record(raw.capability, 'winner capability')
	exactKeys(capability, ['schema', 'network', 'chainId', 'auctionId', 'operationId', 'role', 'mintUrl', 'unit',
		'recipientPublicKey', 'outputsDigest', 'signature'], 'winner capability')
	if (capability.schema !== 'COCO_DEMO_RECIPIENT_CAPABILITY_V1' || capability.role !== 'winner_settlement'
		|| !ID.test(String(capability.network)) || !ID.test(String(capability.chainId)) || !ID.test(String(capability.auctionId))
		|| !ID.test(String(capability.operationId)) || exactOrigin(String(capability.mintUrl)) !== capability.mintUrl
		|| capability.unit !== 'sat' || !POINT.test(String(capability.recipientPublicKey))
		|| !HEX_32.test(String(capability.outputsDigest)) || !HEX_64.test(String(capability.signature))) refuse('winner capability is malformed')
	if (!Array.isArray(raw.outputs) || raw.outputs.length < 1 || raw.outputs.length > 64) refuse('winner outputs are malformed')
	const outputs = raw.outputs.map((entry) => {
		const output = record(entry, 'winner output'); exactKeys(output, ['amount', 'id', 'B_'], 'winner output')
		if (!Number.isSafeInteger(output.amount) || Number(output.amount) < 1 || !ID.test(String(output.id)) || !POINT.test(String(output.B_))) refuse('winner output is malformed')
		return { amount: Number(output.amount), id: String(output.id), B_: String(output.B_) }
	})
	if (capability.outputsDigest !== demoOutputsDigest(outputs)) refuse('winner outputs differ from capability')
	return { capability: structuredClone(capability), outputs }
}

function exactAuction(value: unknown): DemoFridayTrustedAuctionFundingV1 {
	const raw = record(value, 'auction funding')
	exactKeys(raw, ['schema', 'auctionId', 'sellerPaymentPublicKey', 'leaderBidId', 'leaderActor', 'leaderBidAmount', 'winnerRequest'], 'auction funding')
	if (raw.schema !== 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_V1' || !ID.test(String(raw.auctionId))
		|| !POINT.test(String(raw.sellerPaymentPublicKey))
		|| typeof raw.leaderBidId !== 'string' || typeof raw.leaderActor !== 'string' || !Number.isSafeInteger(raw.leaderBidAmount)
		|| ((raw.leaderBidId === '') !== (raw.leaderActor === '')) || ((raw.leaderBidId === '') !== (raw.leaderBidAmount === 0))
		|| (raw.leaderBidId !== '' && (!HEX_32.test(raw.leaderBidId) || !HEX_32.test(raw.leaderActor) || Number(raw.leaderBidAmount) < 1))) refuse('auction funding identity is malformed')
	return { schema: raw.schema, auctionId: String(raw.auctionId), sellerPaymentPublicKey: String(raw.sellerPaymentPublicKey), leaderBidId: raw.leaderBidId,
		leaderActor: raw.leaderActor, leaderBidAmount: Number(raw.leaderBidAmount), winnerRequest: exactWinnerRequest(raw.winnerRequest) as never }
}

function exactChallenge(value: unknown): DemoFridaySellerWinnerPlanChallengeV1 {
	const raw = record(value, 'seller challenge')
	exactKeys(raw, ['schema', 'authNetworkId', 'chainId', 'auctionId', 'fundingOperationId', 'sellerActor', 'sellerPaymentPublicKey', 'bidderActor',
		'bidAmount', 'canonicalMintUrl', 'activeSatKeysetId', 'denominationKeyDigest', 'expiresAt'], 'seller challenge')
	if (raw.schema !== 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_CHALLENGE_V1'
		|| !ID.test(String(raw.authNetworkId)) || !ID.test(String(raw.chainId)) || !ID.test(String(raw.auctionId))
		|| !ID.test(String(raw.fundingOperationId)) || !HEX_32.test(String(raw.sellerActor))
		|| !POINT.test(String(raw.sellerPaymentPublicKey)) || String(raw.sellerPaymentPublicKey).slice(2) === raw.sellerActor
		|| !HEX_32.test(String(raw.bidderActor))
		|| raw.sellerActor === raw.bidderActor || !Number.isSafeInteger(raw.bidAmount) || Number(raw.bidAmount) < 1
		|| exactOrigin(String(raw.canonicalMintUrl)) !== raw.canonicalMintUrl || !ID.test(String(raw.activeSatKeysetId))
		|| !HEX_32.test(String(raw.denominationKeyDigest)) || !Number.isSafeInteger(raw.expiresAt)) refuse('seller challenge is malformed')
	return structuredClone(value) as DemoFridaySellerWinnerPlanChallengeV1
}

function exactPlan(value: unknown): DemoFridaySellerWinnerPlanPublicV1 {
	const raw = record(value, 'seller plan')
	exactKeys(raw, ['schema', 'authNetworkId', 'chainId', 'auctionId', 'fundingOperationId', 'sellerActor', 'bidderActor',
		'bidAmount', 'canonicalMintUrl', 'activeSatKeysetId', 'denominationKeyDigest', 'recipientPublicKey', 'recipientPlan', 'expiresAt'], 'seller plan')
	if (raw.schema !== 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_V1' || !ID.test(String(raw.authNetworkId))
		|| !ID.test(String(raw.chainId)) || !ID.test(String(raw.auctionId)) || !ID.test(String(raw.fundingOperationId))
		|| !HEX_32.test(String(raw.sellerActor)) || !HEX_32.test(String(raw.bidderActor)) || raw.sellerActor === raw.bidderActor
		|| !Number.isSafeInteger(raw.bidAmount) || Number(raw.bidAmount) < 1 || exactOrigin(String(raw.canonicalMintUrl)) !== raw.canonicalMintUrl
		|| !ID.test(String(raw.activeSatKeysetId)) || !HEX_32.test(String(raw.denominationKeyDigest))
		|| !POINT.test(String(raw.recipientPublicKey)) || !Number.isSafeInteger(raw.expiresAt)) refuse('seller plan is malformed')
	const recipientPlan = exactWinnerRequest(raw.recipientPlan)
	if (recipientPlan.capability.network !== raw.authNetworkId || recipientPlan.capability.chainId !== raw.chainId
		|| recipientPlan.capability.auctionId !== raw.auctionId || recipientPlan.capability.operationId !== raw.fundingOperationId
		|| recipientPlan.capability.mintUrl !== raw.canonicalMintUrl || recipientPlan.capability.recipientPublicKey !== raw.recipientPublicKey
		|| recipientPlan.outputs.reduce((sum, output) => sum + output.amount, 0) !== raw.bidAmount) refuse('seller plan differs from its recipient request')
	return { ...structuredClone(value) as DemoFridaySellerWinnerPlanPublicV1, recipientPlan: recipientPlan as never }
}

function exactRegistered(value: unknown): DemoFridaySellerPlanRegisteredV1 {
	const raw = record(value, 'registered seller plan')
	exactKeys(raw, ['schema', 'status', 'planDigest', 'plan'], 'registered seller plan')
	const plan = exactPlan(raw.plan)
	if (raw.schema !== 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_REGISTERED_V1' || raw.status !== 'registered'
		|| !HEX_32.test(String(raw.planDigest)) || raw.planDigest !== bytesToHex(sha256(utf8ToBytes(canonical(plan))))) refuse('registered seller plan digest is malformed')
	return { schema: raw.schema, status: raw.status, planDigest: String(raw.planDigest), plan }
}

export function createDemoFridayBrowserTrustedDeploymentHttp(options: { origin: string; fetchImpl?: DemoBrowserFetch }): DemoFridayTrustedBrowserDeploymentPort {
	const post = poster(options)
	return Object.freeze({ async readExact() {
		return exactDeployment(await post('/api/friday/deployment', { schema: 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_READ_V1' }))
	} })
}

export function createDemoFridayBrowserTrustedAuctionFundingHttp(options: { origin: string; fetchImpl?: DemoBrowserFetch }): DemoFridayTrustedAuctionFundingPort {
	const post = poster(options)
	return Object.freeze({ async readExact(request: Parameters<DemoFridayTrustedAuctionFundingPort['readExact']>[0]) {
		if (!ID.test(request.auctionId) || !ID.test(request.fundingOperationId) || !Number.isSafeInteger(request.fullPoolAmount) || request.fullPoolAmount < 1) refuse('auction read request is malformed')
		const result = exactAuction(await post('/api/friday/auction-funding/read', {
			schema: 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_READ_V1', ...request,
		}))
		if (result.auctionId !== request.auctionId || result.winnerRequest.capability.operationId !== request.fundingOperationId
			|| result.winnerRequest.outputs.reduce((sum, output) => sum + output.amount, 0) !== request.fullPoolAmount) refuse('auction read response differs from the exact request')
		return result
	} })
}

/** Bidder-side one-shot intent which authorizes issuing the seller challenge; it carries no bearer proofs. */
export function createDemoFridayBrowserSellerPlanIntentHttp(options: { origin: string; fetchImpl?: DemoBrowserFetch }) {
	const post = poster(options)
	return Object.freeze({ async issueExact(intent: DemoFridaySignedNostrBidV1) {
		return exactChallenge(await post('/api/friday/seller-plan/intent', intent))
	} })
}

export function createDemoFridayBrowserSellerPlanHttp(options: { origin: string; fetchImpl?: DemoBrowserFetch }): DemoFridaySellerPlanServicePort {
	const post = poster(options)
	const identity = (request: { sellerActor: string; auctionId: string; fundingOperationId: string }) => {
		if (!HEX_32.test(request.sellerActor) || !ID.test(request.auctionId) || !ID.test(request.fundingOperationId)) refuse('seller plan request identity is malformed')
		return structuredClone(request)
	}
	return Object.freeze({
		async listPendingExact(sellerActor: string) {
			if (!HEX_32.test(sellerActor)) refuse('seller pending-list identity is malformed')
			const raw = record(await post('/api/friday/seller-plan/pending', {
				schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_PENDING_READ_V1', sellerActor,
			}), 'seller pending-list response')
			exactKeys(raw, ['schema', 'challenges'], 'seller pending-list response')
			if (raw.schema !== 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_PENDING_RESULT_V1'
				|| !Array.isArray(raw.challenges)) refuse('seller pending-list response is malformed')
			return raw.challenges.map(exactChallenge).filter((challenge) => challenge.sellerActor === sellerActor)
		},
		async challengeExact(request: Parameters<DemoFridaySellerPlanServicePort['challengeExact']>[0]) {
			const exact = identity(request)
			const result = exactChallenge(await post('/api/friday/seller-plan/challenge', {
				schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_CHALLENGE_READ_V1', ...exact,
			}))
			if (result.sellerActor !== exact.sellerActor || result.auctionId !== exact.auctionId || result.fundingOperationId !== exact.fundingOperationId) refuse('seller challenge differs from request')
			return result
		},
		async readExact(request: Parameters<DemoFridaySellerPlanServicePort['readExact']>[0]) {
			const exact = identity(request)
			const raw = record(await post('/api/friday/seller-plan/read', {
				schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_READ_V1', ...exact,
			}), 'seller plan read result')
			exactKeys(raw, ['schema', 'registered'], 'seller plan read result')
			if (raw.schema !== 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_READ_RESULT_V1') refuse('seller plan read schema is invalid')
			if (raw.registered === null) return null
			const result = exactRegistered(raw.registered)
			if (result.plan.sellerActor !== exact.sellerActor || result.plan.auctionId !== exact.auctionId
				|| result.plan.fundingOperationId !== exact.fundingOperationId) refuse('registered seller plan differs from request')
			return result
		},
		async registerExact(envelope: DemoFridaySellerWinnerPlanEnvelopeV1) {
			if (envelope.schema !== 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_ENVELOPE_V1' || !HEX_32.test(envelope.planDigest)
				|| envelope.planDigest !== bytesToHex(sha256(utf8ToBytes(canonical(exactPlan(envelope.plan)))))) refuse('seller plan envelope is malformed')
			const result = exactRegistered(await post('/api/friday/seller-plan/register', envelope))
			if (result.planDigest !== envelope.planDigest || canonical(result.plan) !== canonical(envelope.plan)) refuse('registered seller plan differs from submitted envelope')
			return result
		},
	})
}
