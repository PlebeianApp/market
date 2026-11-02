import { assertDemoFridaySignerContract, demoFridaySignerCometFetch, type DemoFridaySignerContract } from './demo-friday-signer-contract'
/** Participant-local admission authority for the FIPS signer service. */
import { hasValidDleq } from '@cashu/cashu-ts'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import { authenticatedDemoCometState, createLoopbackCometReader } from './demo-comet-displacement-verifier'
import type { DemoAdmissionParticipantPolicyRequestV1 } from './demo-integrated-admission-service'
import { preflightDemoIntegratedAdmission } from './demo-integrated-admission-policy'
import { demoSignerObservationFetch, type DemoSignerPureContext } from './demo-signer-pure-policy'
import type { DemoIntegratedAdmissionMintEvidenceV1 } from './demo-integrated-admission-policy'
import { exactDemoNut07Result } from './demo-nut07-exact'
import { createOriginBoundMintFetch, createPinnedMintTransportFetch } from './coco-rail'
import { CashuMintClient, proofPoint, type CashuProof } from './nut-client'

export interface DemoFipsAdmissionTrustPinsV1 {
	participantId: 1 | 2 | 3 | 4
	network: string
	chainId: string
	validatorsHash: string
	cometRpc: string
	mintUrl: string
	mintTransportUrl: string
}

function digest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(JSON.stringify(value)))) }

async function exactStates(mintUrl: string, refs: string[], fetchImpl: typeof fetch): Promise<Array<{ Y: string; state: string }>> {
	const response = await fetchImpl(`${mintUrl}/v1/checkstate`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Ys: refs }),
	})
	if (!response.ok) throw new Error(`DEMO_FIPS_ADMISSION_MINT: NUT-07 returned HTTP ${response.status}`)
	const exact = exactDemoNut07Result(refs, await response.json())
	return refs.map((Y, index) => ({ Y, state: exact.states[index]! }))
}

export function assertDemoFipsAdmissionPins(contract: DemoFridaySignerContract, pins: DemoFipsAdmissionTrustPinsV1): void {
	assertDemoFridaySignerContract(contract, pins)
	const publicMint = /^https:\/\/[^/?#]+$/.test(pins.mintUrl)
	if (![1, 2, 3, 4].includes(pins.participantId) || pins.network.length === 0 || pins.chainId.length === 0
		|| !/^[0-9a-f]{64}$/.test(pins.validatorsHash)
		|| !/^http:\/\/\[(?:fc|fd)[0-9a-f:]+\]:(?:3338|3438)$/i.test(pins.mintTransportUrl)
		|| (!publicMint && pins.mintUrl !== pins.mintTransportUrl)) {
		throw new Error('DEMO_FIPS_ADMISSION_PINS: participant, Comet, or mint trust pins are malformed')
	}
}

export function createDemoFipsAdmissionParticipant(options: {
	contract: DemoFridaySignerContract
	pins: DemoFipsAdmissionTrustPinsV1
	proofUse: {
		claimAdmissionProofs(claims: Array<{
			proofRef: string; network: string; chainId: string; auctionId: string; operationId: string
		}>): void
	}
	fetchImpl?: typeof fetch
}) {
	assertDemoFipsAdmissionPins(options.contract, options.pins)
	const pins = Object.freeze({ ...options.pins })
	const claims = new WeakMap<object, { request: DemoAdmissionParticipantPolicyRequestV1; claim: Parameters<typeof options.proofUse.claimAdmissionProofs>[0] }>()
	const buildReadPorts = (context?: DemoSignerPureContext): Pick<Parameters<typeof preflightDemoIntegratedAdmission>[0], 'participantId' | 'consensus' | 'mintVerifier'> => {
	const readFetch = context ? demoSignerObservationFetch(context.signal, options.fetchImpl ?? fetch) : options.fetchImpl ?? fetch
	const observedMintFetch = pins.mintUrl === pins.mintTransportUrl
		? createOriginBoundMintFetch(pins.mintUrl, readFetch, { allowFipsUlaHttp: true })
		: createPinnedMintTransportFetch(pins.mintUrl, pins.mintTransportUrl, readFetch)
	const cometFetch = demoFridaySignerCometFetch(options.contract, options.fetchImpl ?? fetch)
	const reader = createLoopbackCometReader(pins.cometRpc, context ? demoSignerObservationFetch(context.signal, cometFetch) : cometFetch)
	return {
		participantId: pins.participantId,
		consensus: {
			async readCommittedLeader(request) {
				if (request.network !== pins.network || request.chainId !== pins.chainId) {
					context?.refuse('ADMISSION_BINDING'); throw new Error('DEMO_FIPS_ADMISSION_CONSENSUS: request differs from enrolled chain')
				}
				const chainId = await reader.readChainId()
				if (chainId !== pins.chainId) throw new Error('DEMO_FIPS_ADMISSION_CONSENSUS: node chain differs from enrollment')
				const authenticated = await authenticatedDemoCometState(reader, pins.validatorsHash, 1)
				if (authenticated.observation.state.chain_id !== pins.chainId) throw new Error('DEMO_FIPS_ADMISSION_CONSENSUS: state chain differs from enrollment')
				const auction = authenticated.observation.state.auctions?.[request.auctionId]
				const sellerPaymentPublicKey = auction?.seller_coco_payment_public_key ?? ''
				return {
					leaderBidId: auction?.leader_bid_id ?? '', sellerPaymentPublicKey,
					height: authenticated.observation.queryHeight,
					evidenceDigest: digest([
						'COCO_DEMO_FIPS_ADMISSION_CONSENSUS_V1', pins.network, pins.chainId, pins.validatorsHash,
						pins.participantId, request.auctionId, authenticated.observation.queryHeight,
						authenticated.observation.appHash, auction?.leader_bid_id ?? '', sellerPaymentPublicKey,
					]),
				}
			},
		},
		mintVerifier: {
			async verifyAndDerive(request): Promise<DemoIntegratedAdmissionMintEvidenceV1> {
				if (request.mintUrl !== pins.mintUrl) { context?.refuse('MINT_BINDING'); throw new Error('DEMO_FIPS_ADMISSION_MINT: receipt names another mint') }
				const client = new CashuMintClient({ mintUrl: pins.mintUrl, fetchImpl: observedMintFetch })
				const active = (await client.keysets()).keysets.filter((entry) => entry.unit === 'sat' && entry.active)
				if (active.length !== 1 || active[0]!.id !== request.activeKeysetId || (active[0]!.input_fee_ppk ?? 0) !== 0) {
					context?.refuse('MINT_BINDING'); throw new Error('DEMO_FIPS_ADMISSION_MINT: active zero-fee keyset differs from receipt')
				}
				const keyset = (await client.keys(request.activeKeysetId)).keysets
					.find((entry) => entry.id === request.activeKeysetId && entry.unit === 'sat')
				if (keyset === undefined || request.inputs.some((proof) => proof.id !== request.activeKeysetId
					|| !hasValidDleq(proof as never, keyset as never, { require: true }))) {
					throw new Error('DEMO_FIPS_ADMISSION_MINT: input DLEQ/keyset binding failed')
				}
				const refs = request.inputs.map((proof: CashuProof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
				const states = await exactStates(pins.mintUrl, refs, observedMintFetch)
				if (states.length !== refs.length || states.some(({ state }) => state !== 'UNSPENT')) {
					context?.refuse('MINT_SPENT'); throw new Error('DEMO_FIPS_ADMISSION_MINT: full pool is not uniquely UNSPENT')
				}
				return {
					schema: 'COCO_DEMO_INTEGRATED_ADMISSION_MINT_EVIDENCE_V1',
					evidenceDigest: digest(['COCO_DEMO_FIPS_ADMISSION_MINT_V1', pins.participantId, pins.mintUrl, request.activeKeysetId, refs, states]),
					mintUrl: pins.mintUrl, activeKeysetId: request.activeKeysetId, inputFeePpk: 0,
					inputTotal: request.inputs.reduce((sum, proof) => sum + proof.amount, 0),
					proofStates: refs.map((proofStateRef) => ({ proofStateRef, state: 'UNSPENT' as const })),
				}
			},
		},
	}
	}
	const preflightExact = async (request: DemoAdmissionParticipantPolicyRequestV1, context?: DemoSignerPureContext) => {
		const exact = structuredClone(request)
		const ready = await preflightDemoIntegratedAdmission({ ...exact, ...buildReadPorts(context), context })
		const claim = ready.proofClaim.proofStateRefs.map((proofRef) => ({ proofRef, network: ready.proofClaim.network,
			chainId: ready.proofClaim.chainId, auctionId: ready.proofClaim.auctionId, operationId: ready.proofClaim.fundingOperationId }))
		const evidence = { ...ready.evidence, proofUseEvidenceDigest: digest(['COCO_DEMO_FIPS_ADMISSION_PROOF_USE_V1', pins.participantId, ready.proofClaim]) }
		claims.set(evidence, { request: exact, claim }); return evidence
	}
	const claimExact = async (prepared: Awaited<ReturnType<typeof preflightExact>>, signal?: AbortSignal) => {
		const stage = claims.get(prepared)
		if (!stage || signal?.aborted || Math.floor(Date.now() / 1000) > stage.request.receipt.expires_at) throw new Error('ADMISSION_EFFECT_SCOPE_OR_TIME_CHANGED')
		options.proofUse.claimAdmissionProofs(stage.claim)
		return structuredClone(prepared)
	}
	return { participantId: pins.participantId, preflightExact, claimExact,
		async validateExact(request: DemoAdmissionParticipantPolicyRequestV1) { return claimExact(await preflightExact(request)) },
	}
}
