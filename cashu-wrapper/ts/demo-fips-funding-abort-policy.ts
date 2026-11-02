import { assertDemoFridaySignerContract, demoFridaySignerCometFetch, type DemoFridaySignerContract } from './demo-friday-signer-contract'
/** Concrete signer-local FundingAbort policy over loopback Comet and pinned mint transport. */
import { hasValidDleq } from '@cashu/cashu-ts'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { createOriginBoundMintFetch, createPinnedMintTransportFetch } from './coco-rail'
import { authenticatedDemoCometState, createLoopbackCometReader } from './demo-comet-displacement-verifier'
import { preflightDemoFundingAbortParticipantPolicy, finalizeDemoFundingAbortPolicyEvidence, type DemoFundingAbortParticipantPolicyRequestV1, type DemoFundingAbortPolicyOptions } from './demo-funding-abort-participant-policy'
import { demoSignerObservationFetch, type DemoSignerPureContext } from './demo-signer-pure-policy'
import { exactDemoNut07Result } from './demo-nut07-exact'
import { CashuMintClient, type CashuProof } from './nut-client'

export interface DemoFipsFundingAbortTrustPinsV1 {
	participantId: 1 | 2 | 3 | 4
	authNetworkId: string
	chainId: string
	genesisSha256: string
	validatorsHash: string
	cometRpc: string
	mintUrl: string
	mintTransportUrl: string
	activeKeysetId: string
	committeePublicKey: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
}

function digest(label: string, values: unknown[], bytes?: Uint8Array): string {
	return bytesToHex(sha256(bytes === undefined
		? utf8ToBytes(JSON.stringify([label, ...values]))
		: concatBytes(utf8ToBytes(label), bytes, utf8ToBytes(JSON.stringify(values)))))
}

export function assertDemoFipsFundingAbortPins(contract: DemoFridaySignerContract, pins: Omit<DemoFipsFundingAbortTrustPinsV1, 'activeKeysetId'>): void {
	assertDemoFridaySignerContract(contract, pins)
	const publicMint = /^https:\/\/[^/?#]+$/.test(pins.mintUrl)
	if (![1, 2, 3, 4].includes(pins.participantId) || !/^[0-9a-f]{64}$/.test(pins.genesisSha256)
		|| !/^[0-9a-f]{64}$/.test(pins.validatorsHash)
		|| !/^http:\/\/\[(?:fc|fd)[0-9a-f:]+\]:(?:3338|3438)$/i.test(pins.mintTransportUrl)
		|| (!publicMint && pins.mintUrl !== pins.mintTransportUrl)) {
		throw new Error('DEMO_FIPS_ABORT_PINS: participant, Comet, or mint pins are malformed')
	}
}

export function createDemoFipsFundingAbortParticipant(options: {
	contract: DemoFridaySignerContract
	pins: DemoFipsFundingAbortTrustPinsV1
	proofUse: { claimAdmissionProofs(claims: Array<{ proofRef: string; network: string; chainId: string;
		auctionId: string; operationId: string }>): void }
	fetchImpl?: typeof fetch
}) {
	assertDemoFipsFundingAbortPins(options.contract, options.pins)
	const pins = Object.freeze({ ...options.pins })
	const claims = new WeakMap<object, { request: DemoFundingAbortParticipantPolicyRequestV1; claim: { operationId: string; auctionId: string; proofYs: string[]; poolDigest: string } }>()
	const buildReadPorts = (context?: DemoSignerPureContext): Omit<DemoFundingAbortPolicyOptions, 'proofUse'> => {
	const readFetch = context ? demoSignerObservationFetch(context.signal, options.fetchImpl ?? fetch) : options.fetchImpl ?? fetch
	const mintFetch = pins.mintUrl === pins.mintTransportUrl
		? createOriginBoundMintFetch(pins.mintUrl, readFetch, { allowFipsUlaHttp: true })
		: createPinnedMintTransportFetch(pins.mintUrl, pins.mintTransportUrl, readFetch)
	const cometFetch = demoFridaySignerCometFetch(options.contract, options.fetchImpl ?? fetch)
	const reader = createLoopbackCometReader(pins.cometRpc, context ? demoSignerObservationFetch(context.signal, cometFetch) : cometFetch)
	return {
		participantId: pins.participantId,
		pins: {
			authNetworkId: pins.authNetworkId, chainId: pins.chainId, genesisSha256: pins.genesisSha256,
			mintUrl: pins.mintUrl, activeKeysetId: pins.activeKeysetId,
			committeePublicKey: pins.committeePublicKey, committeeKeysetId: pins.committeeKeysetId,
			committeeKeysetVersion: pins.committeeKeysetVersion, dkgRunId: pins.dkgRunId,
			publicKeyPackageSha256: pins.publicKeyPackageSha256, signerRosterDigest: pins.signerRosterDigest,
		},
		consensus: {
			async readExact(request) {
				const chainId = await reader.readChainId()
				const authenticated = await authenticatedDemoCometState(reader, pins.validatorsHash, 1)
				if (chainId !== pins.chainId || authenticated.observation.state.chain_id !== pins.chainId) {
					throw new Error('DEMO_FIPS_ABORT_CONSENSUS: chain differs from enrollment')
				}
				const lifecycle = (authenticated.observation.state as unknown as { funding_lifecycles?: Record<string, {
					auctionId: string; origin: string
				}> }).funding_lifecycles?.[request.operationId]
				assertDemoFundingAbortNoCommittedLifecycle(lifecycle, context)
				return { origin: 'none' as const, evidenceDigest: digest('COCO_DEMO_FIPS_ABORT_CONSENSUS_V1', [
					pins.authNetworkId, pins.chainId, pins.genesisSha256, pins.validatorsHash, pins.participantId,
					request.operationId, request.auctionId, authenticated.observation.queryHeight,
					authenticated.observation.appHash,
				], authenticated.observation.canonicalStateBytes) }
			},
		},
		mint: {
			async verifyExact(request) {
				if (request.template.mintUrl !== pins.mintUrl) {
					throw new Error('DEMO_FIPS_ABORT_MINT: return package names another mint or keyset')
				}
				const client = new CashuMintClient({ mintUrl: pins.mintUrl, fetchImpl: mintFetch })
				const active = (await client.keysets()).keysets.filter((entry) => entry.unit === 'sat' && entry.active)
				if (active.length !== 1 || active[0]!.id !== pins.activeKeysetId || (active[0]!.input_fee_ppk ?? 0) !== 0) {
					context?.refuse('MINT_BINDING'); throw new Error('DEMO_FIPS_ABORT_MINT: active zero-fee keyset differs')
				}
				const keyset = (await client.keys(pins.activeKeysetId)).keysets.find((entry) => entry.id === pins.activeKeysetId && entry.unit === 'sat')
				if (keyset === undefined || request.template.inputs.some((proof: CashuProof) => proof.id !== pins.activeKeysetId
					|| !hasValidDleq(proof as never, keyset as never, { require: true }))) {
					throw new Error('DEMO_FIPS_ABORT_MINT: DLEQ/keyset binding failed')
				}
				const response = await mintFetch(`${pins.mintUrl}/v1/checkstate`, { method: 'POST',
					headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Ys: request.proofYs }) })
				if (!response.ok) throw new Error(`DEMO_FIPS_ABORT_MINT: NUT-07 returned ${response.status}`)
				const checked = exactDemoNut07Result(request.proofYs, await response.json())
				if (checked.states.some((state) => state !== 'UNSPENT')) { context?.refuse('MINT_SPENT'); throw new Error('DEMO_FIPS_ABORT_MINT: proof is not UNSPENT') }
				const proofStates = request.proofYs.map((proofY) => ({ proofY, state: 'UNSPENT' as const }))
				return { activeKeysetId: pins.activeKeysetId, proofStates,
					evidenceDigest: digest('COCO_DEMO_FIPS_ABORT_MINT_V1', [pins.participantId, pins.mintUrl,
						pins.activeKeysetId, request.proofYs, checked.states]) }
			},
		},
	}
	}
	const preflightExact = async (request: DemoFundingAbortParticipantPolicyRequestV1, context?: DemoSignerPureContext) => {
		const exact = structuredClone(request)
		const ready = await preflightDemoFundingAbortParticipantPolicy(buildReadPorts(context), exact, context)
		const proofDigest = digest('COCO_DEMO_FIPS_ABORT_PROOF_USE_V1', [pins.participantId, ready.proofClaim.operationId, ready.proofClaim.poolDigest, ready.proofClaim.proofYs])
		const evidence = finalizeDemoFundingAbortPolicyEvidence(ready, proofDigest)
		claims.set(evidence, { request: exact, claim: ready.proofClaim }); return evidence
	}
	const claimExact = async (prepared: Awaited<ReturnType<typeof preflightExact>>, signal?: AbortSignal) => {
		const stage = claims.get(prepared)
		if (!stage || signal?.aborted || Math.floor(Date.now() / 1000) > stage.request.actorTerms.abortExpiresAt) throw new Error('ABORT_EFFECT_SCOPE_OR_TIME_CHANGED')
		options.proofUse.claimAdmissionProofs(stage.claim.proofYs.map((proofRef) => ({ proofRef, network: pins.authNetworkId,
			chainId: pins.chainId, auctionId: stage.claim.auctionId, operationId: stage.claim.operationId })))
		return structuredClone(prepared)
	}
	return { participantId: pins.participantId, preflightExact, claimExact,
		async validateExact(request: DemoFundingAbortParticipantPolicyRequestV1) { return claimExact(await preflightExact(request)) },
	}
}

/** Called only after the participant authenticates its pinned Comet state. */
export function assertDemoFundingAbortNoCommittedLifecycle(lifecycle: unknown, context?: DemoSignerPureContext): void {
	if (lifecycle !== undefined) {
		context?.refuse('ABORT_LIFECYCLE')
		throw new Error('DEMO_FIPS_ABORT_CONSENSUS: operation already has a committed lifecycle')
	}
}
