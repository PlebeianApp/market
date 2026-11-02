/**
 * Participant-local Comet history adapter for cooperative outbid returns.
 *
 * Each FROST signer runs this against its own loopback Comet RPC. The local
 * node has already verified consensus signatures and application execution;
 * this adapter additionally pins chain/roster identity, requires a 3-signature
 * canonical commit at H/H+1/H+2, reads the deterministic displacement record,
 * authenticates the returned StateView app hash with its next Comet header,
 * and locates the exact replacement transaction in block H. It does not trust
 * a certificate assembled by the coordinator.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	demoIntegratedTiming,
	type DemoCanonicalCommitV1,
	type DemoCertifiedDisplacementV1,
	type DemoCertifiedDisplacementRequestV1,
	type DemoCertifiedDisplacementVerifierPort,
} from './demo-integrated-authority'
import type { DemoIntegratedAdmissionConsensusPort } from './demo-integrated-admission-policy'
import {
	verifyDemoIntegratedFundingReceiptAny,
	type DemoIntegratedFundingReceiptAny,
} from './demo-integrated-admission-receipt-any'

const HEX_32 = /^[0-9a-f]{64}$/
const ACTOR = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
// Three-validator progress can require a view change immediately after the
// fourth validator disappears. Keep the state-authentication wait bounded but
// long enough to span that first degraded-consensus round.
const NEXT_HEADER_ATTEMPTS = 100
const NEXT_HEADER_RETRY_MS = 100

export interface ConsensusBid {
	id: string
	auction_id: string
	bidder: string
	amount: number
	integrated_funding_id: string
	replaces_bid_id: string
}

export interface ConsensusFunding {
	id: string
	auction_id: string
	bid_id: string
	bidder: string
	status: string
	rejection_reason?: string
	receipt: DemoIntegratedFundingReceiptAny
}

interface ConsensusDisplacement {
	id: string
	auction_id: string
	displaced_bid_id: string
	replacement_bid_id: string
	displaced_funding_id: string
	replacement_funding_id: string
	committed_at: number
	original_end_time: number
	certified_end_time: number
}

export interface ConsensusAuction {
	id: string
	seller?: string
	seller_coco_payment_public_key?: string
	funding_mode: string
	status: string
	leader_bid_id?: string
	high_bid?: number
	reserve?: number
	original_end_time?: number
	end_time?: number
	winner?: string
	closed_at?: number
}

export interface DemoCometStateV1 {
	chain_id: string
	height: number
	auctions: Record<string, ConsensusAuction>
	bids: Record<string, ConsensusBid>
	integrated_fundings: Record<string, ConsensusFunding>
	integrated_displacements: Record<string, ConsensusDisplacement>
}

export interface DemoParticipantCommitObservation {
	height: number
	blockTime: number
	blockHash: string
	appHash: string
	validatorsHash: string
	commitSignerAddresses: string[]
}

export interface DemoParticipantBlockObservation {
	height: number
	/** Hash returned by `/block` for these exact bytes; verifiers join it to the canonical `/commit`. */
	blockHash: string
	transactions: Uint8Array[]
}

export interface DemoParticipantStateObservation {
	queryHeight: number
	appHash: string
	/** Exact json.Marshal(State) bytes supplied by the application, not JS reserialization. */
	canonicalStateBytes: Uint8Array
	state: DemoCometStateV1
}

export interface DemoParticipantConsensusReader {
	readChainId(): Promise<string>
	readCommit(height: number): Promise<DemoParticipantCommitObservation>
	readBlock(height: number): Promise<DemoParticipantBlockObservation>
	readCurrentState(): Promise<DemoParticipantStateObservation>
}

export interface DemoCometDisplacementVerifierOptions {
	reader: DemoParticipantConsensusReader
	network: string
	chainId: string
	genesisHash: string
	validatorRosterVersion: string
	validatorsHash: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
}

function fail(message: string): never { throw new Error(`DEMO_COMET_HISTORY: ${message}`) }

function exactText(value: string, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail(`${label} is invalid`)
	return value
}

function decodeTransaction(raw: Uint8Array): { event: { id: string; pubkey: string; kind: number; content: string } } | null {
	let value: unknown
	try { value = JSON.parse(new TextDecoder().decode(raw)) }
	catch { return null }
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
	const tx = value as Record<string, unknown>
	if (tx.type !== 'event' || tx.event === null || typeof tx.event !== 'object' || Array.isArray(tx.event)) return null
	const event = tx.event as Record<string, unknown>
	if (!HEX_32.test(String(event.id ?? '')) || !ACTOR.test(String(event.pubkey ?? ''))
		|| typeof event.kind !== 'number' || !Number.isSafeInteger(event.kind) || typeof event.content !== 'string') return null
	return { event: { id: String(event.id), pubkey: String(event.pubkey), kind: Number(event.kind), content: event.content } }
}

function replacementInBlock(block: DemoParticipantBlockObservation, auctionId: string, expectedBidId: string): {
	eventId: string
	actorId: string
	amount: number
	replacesBidId: string
	fundingOperationId: string
} {
	const matches: ReturnType<typeof decodeTransaction>[] = []
	for (const raw of block.transactions) {
		const tx = decodeTransaction(raw)
		if (tx?.event.kind !== 28641 || tx.event.id !== expectedBidId) continue
		matches.push(tx)
	}
	if (matches.length !== 1 || matches[0] === null) fail('displacement block does not contain one exact replacement bid')
	const event = matches[0]!.event
	let content: unknown
	try { content = JSON.parse(event.content) }
	catch { return fail('replacement bid content is not JSON') }
	if (content === null || typeof content !== 'object' || Array.isArray(content)) fail('replacement bid content is malformed')
	const bid = content as Record<string, unknown>
	const funding = bid.integrated_funding
	if (bid.auction_id !== auctionId || typeof bid.amount !== 'number' || !Number.isSafeInteger(bid.amount)
		|| typeof bid.replaces_bid_id !== 'string' || funding === null || typeof funding !== 'object' || Array.isArray(funding)) {
		fail('replacement bid is not an integrated exact-replacement transaction')
	}
	const operationId = (funding as Record<string, unknown>).funding_operation_id
	if (!ID.test(String(operationId ?? ''))) fail('replacement funding operation is invalid')
	return {
		eventId: event.id, actorId: event.pubkey, amount: Number(bid.amount),
		replacesBidId: bid.replaces_bid_id, fundingOperationId: String(operationId),
	}
}

export function exactDemoCometCommit(value: DemoParticipantCommitObservation, height: number, validatorsHash: string): DemoCanonicalCommitV1 {
	if (value.height !== height || !Number.isSafeInteger(value.blockTime) || value.blockTime < 1
		|| !HEX_32.test(value.blockHash) || !HEX_32.test(value.appHash)
		|| value.validatorsHash !== validatorsHash
		|| new Set(value.commitSignerAddresses).size < 3
		|| value.commitSignerAddresses.some((address) => !/^[0-9A-F]{40}$/.test(address))) {
		fail(`commit ${height} is not a pinned canonical quorum observation`)
	}
	return { height, blockTime: value.blockTime, blockHash: value.blockHash, appHash: value.appHash }
}

export async function authenticatedDemoCometState(
	reader: DemoParticipantConsensusReader,
	validatorsHash: string,
	minimumHeight: number,
 signal?: AbortSignal,
): Promise<{ observation: DemoParticipantStateObservation; bindingCommit: DemoCanonicalCommitV1 }> {
	if (signal?.aborted) throw new Error('Comet health observation aborted')
 const observation = await reader.readCurrentState()
 if (signal?.aborted) throw new Error('Comet health observation aborted')
	if (!Number.isSafeInteger(observation.queryHeight) || observation.queryHeight < minimumHeight
		|| observation.state.height !== observation.queryHeight || !HEX_32.test(observation.appHash)) {
		fail('ABCI state height/app-hash observation is malformed or predates required history')
	}
	if (!(observation.canonicalStateBytes instanceof Uint8Array) || observation.canonicalStateBytes.length === 0) {
		fail('ABCI state response omitted exact canonical Go state bytes')
	}
	let canonicalState: unknown
	try { canonicalState = JSON.parse(new TextDecoder().decode(observation.canonicalStateBytes)) }
	catch { return fail('ABCI canonical state bytes are not JSON') }
	if (JSON.stringify(canonicalState) !== JSON.stringify(observation.state)) {
		fail('ABCI canonical state bytes differ structurally from the returned state')
	}
	const derivedStateAppHash = bytesToHex(sha256(observation.canonicalStateBytes))
	if (derivedStateAppHash !== observation.appHash) {
		fail('ABCI state bytes do not derive the advertised application hash')
	}
	let binding: DemoParticipantCommitObservation | undefined
	let lastError: unknown
	for (let attempt = 0; attempt < NEXT_HEADER_ATTEMPTS; attempt++) {
  if (signal?.aborted) throw new Error('Comet health observation aborted')
		try {
			binding = await reader.readCommit(observation.queryHeight + 1)
			break
		} catch (error) {
			lastError = error
			if (attempt + 1 < NEXT_HEADER_ATTEMPTS) {
				await new Promise<void>((resolve, reject) => {
     const finish = () => { signal?.removeEventListener('abort', abort); resolve() }
     const timer = setTimeout(finish, NEXT_HEADER_RETRY_MS)
     const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Comet health observation aborted')) }
     if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true })
    })
			}
		}
	}
	if (binding === undefined) {
		fail(`next Comet header did not become available: ${lastError instanceof Error ? lastError.message : 'unknown RPC error'}`)
	}
	const bindingCommit = exactDemoCometCommit(binding, observation.queryHeight + 1, validatorsHash)
	if (bindingCommit.appHash !== observation.appHash) {
		fail('ABCI state app hash is not authenticated by the next Comet header')
	}
	return { observation, bindingCommit }
}

export function createDemoCometDisplacementVerifier(
	options: DemoCometDisplacementVerifierOptions,
): DemoCertifiedDisplacementVerifierPort {
	const pins = {
		network: exactText(options.network, 'network'), chainId: exactText(options.chainId, 'chainId'),
		genesisHash: options.genesisHash, validatorRosterVersion: exactText(options.validatorRosterVersion, 'validatorRosterVersion'),
		validatorsHash: options.validatorsHash, committeeKeysetId: exactText(options.committeeKeysetId, 'committeeKeysetId'),
		committeeKeysetVersion: exactText(options.committeeKeysetVersion, 'committeeKeysetVersion'),
		dkgRunId: exactText(options.dkgRunId, 'dkgRunId'), publicKeyPackageSha256: options.publicKeyPackageSha256,
		signerRosterDigest: options.signerRosterDigest,
	}
	if (!HEX_32.test(pins.genesisHash) || !HEX_32.test(pins.validatorsHash)
		|| !HEX_32.test(pins.publicKeyPackageSha256) || !HEX_32.test(pins.signerRosterDigest)) {
		fail('genesis, validator-roster, or DKG binding hash is invalid')
	}
	const reader = options.reader
	return Object.freeze({
		async verifyAndDerive(request: DemoCertifiedDisplacementRequestV1): Promise<DemoCertifiedDisplacementV1> {
			if (request.network !== pins.network || request.chainId !== pins.chainId || request.genesisHash !== pins.genesisHash
				|| request.validatorRosterVersion !== pins.validatorRosterVersion || !ID.test(request.auctionId)
				|| !HEX_32.test(request.replacementBidEventId)
				|| !Number.isSafeInteger(request.displacementHeight) || request.displacementHeight < 1) {
				fail('request differs from participant-local network pins')
			}
			if (await reader.readChainId() !== pins.chainId) fail('local Comet node reports another chain')
			const [stateResult, block, ...commitObservations] = await Promise.all([
				authenticatedDemoCometState(reader, pins.validatorsHash, request.displacementHeight + 2), reader.readBlock(request.displacementHeight),
				...([0, 1, 2] as const).map((offset) => reader.readCommit(request.displacementHeight + offset)),
			])
			const state = stateResult.observation.state
			if (state.chain_id !== pins.chainId || block.height !== request.displacementHeight) fail('local application or block height differs from pins')
			if (block.blockHash !== commitObservations[0]?.blockHash) fail('replacement block bytes are not joined to canonical commit')
			const displacement = state.integrated_displacements?.[request.replacementBidEventId]
			if (displacement === undefined || displacement.auction_id !== request.auctionId
				|| displacement.committed_at !== commitObservations[0]?.blockTime) {
				fail('local state does not identify the requested displacement at the requested height/time')
			}
			const replacementTx = replacementInBlock(block, request.auctionId, displacement.replacement_bid_id)
			if (replacementTx.replacesBidId !== displacement.displaced_bid_id
				|| replacementTx.fundingOperationId !== displacement.replacement_funding_id) {
				fail('raw replacement transaction differs from the deterministic displacement record')
			}
			const displacedBid = state.bids[displacement.displaced_bid_id]
			const replacementBid = state.bids[displacement.replacement_bid_id]
			const displacedFunding = state.integrated_fundings[displacement.displaced_funding_id]
			const replacementFunding = state.integrated_fundings[displacement.replacement_funding_id]
			if (displacedBid === undefined || replacementBid === undefined || displacedFunding === undefined || replacementFunding === undefined
				|| displacedBid.auction_id !== request.auctionId || replacementBid.auction_id !== request.auctionId
				|| replacementBid.replaces_bid_id !== displacedBid.id || replacementBid.id !== replacementTx.eventId
				|| replacementBid.bidder !== replacementTx.actorId || replacementBid.amount !== replacementTx.amount
				|| displacedBid.integrated_funding_id !== displacedFunding.id
				|| replacementBid.integrated_funding_id !== replacementFunding.id
				|| displacedFunding.status !== 'outbid_return_entitled') {
				fail('local deterministic state does not prove the exact displaced and replacement bids')
			}
			let receipt: DemoIntegratedFundingReceiptAny
			try { receipt = verifyDemoIntegratedFundingReceiptAny(displacedFunding.receipt) }
			catch (error) { return fail(error instanceof Error ? error.message : 'displaced admission receipt is invalid') }
			if (!Number.isSafeInteger(receipt.pool_amount) || receipt.pool_amount < 1
				|| !Array.isArray(receipt.proof_state_refs) || receipt.proof_state_refs.length === 0
				|| receipt.input_fee_ppk !== 0 || !ID.test(receipt.active_keyset_id)
				|| receipt.funding_operation_id !== displacedFunding.id || receipt.auction_id !== request.auctionId
				|| receipt.bidder !== displacedBid.bidder || receipt.bid_amount !== displacedBid.amount
				|| receipt.committee_keyset_id !== pins.committeeKeysetId
				|| receipt.committee_keyset_version !== pins.committeeKeysetVersion
				|| receipt.dkg_run_id !== pins.dkgRunId
				|| receipt.public_key_package_sha256 !== pins.publicKeyPackageSha256
				|| receipt.signer_roster_digest !== pins.signerRosterDigest) {
				fail('displaced funding manifest is malformed')
			}
			const commits = commitObservations.map((value, index) => exactDemoCometCommit(value, request.displacementHeight + index, pins.validatorsHash)) as DemoCertifiedDisplacementV1['commits']
			return {
				schema: 'COCO_DEMO_CERTIFIED_DISPLACEMENT_V1', network: pins.network, chainId: pins.chainId,
				genesisHash: pins.genesisHash, validatorRosterVersion: pins.validatorRosterVersion,
				auctionId: request.auctionId, displacedBidId: displacedBid.id, displacedBidEventId: displacedBid.id,
				displacedBidderActorId: displacedBid.bidder, displacedFundingOperationId: displacedFunding.id,
				replacementBidId: replacementBid.id,
				replacementBidEventId: replacementBid.id, replacementBidderActorId: replacementBid.bidder,
				replacementAmount: replacementBid.amount, displacedPoolAmount: receipt.pool_amount,
				proofStateRefs: [...receipt.proof_state_refs], activeKeysetId: receipt.active_keyset_id,
				inputFeePpk: 0, admittedFundingReceipt: receipt,
				timing: demoIntegratedTiming(displacement.original_end_time, displacement.certified_end_time),
				commits, displacementState: {
					// Current state S is authenticated by S+1. H/H+1/H+2 above
					// authenticate the replacement transaction and finality only.
					stateHeight: stateResult.observation.queryHeight,
					stateAppHash: stateResult.observation.appHash,
					bindingCommit: stateResult.bindingCommit,
				},
			}
		},
	})
}

/** Read the pre-admission leader from the signer's own consensus application. */
export function createDemoCometAdmissionConsensus(
	reader: DemoParticipantConsensusReader,
	pins: { network: string; chainId: string; validatorsHash: string },
): DemoIntegratedAdmissionConsensusPort {
	const network = exactText(pins.network, 'network')
	const chainId = exactText(pins.chainId, 'chainId')
	if (!HEX_32.test(pins.validatorsHash)) fail('validator roster hash is invalid')
	return Object.freeze({
		async readCommittedLeader(request: { network: string; chainId: string; auctionId: string }) {
			if (request.network !== network || request.chainId !== chainId || !ID.test(request.auctionId)
				|| await reader.readChainId() !== chainId) {
				fail('admission request differs from participant-local network pins')
			}
			const stateResult = await authenticatedDemoCometState(reader, pins.validatorsHash, 1)
			const state = stateResult.observation.state
			const auction = state.auctions?.[request.auctionId]
			if (state.chain_id !== chainId || auction === undefined || auction.id !== request.auctionId
				|| auction.funding_mode !== 'threshold_sigall_v1' || auction.status !== 'open') {
				fail('participant-local state does not contain the requested open threshold auction')
			}
			const leaderBidId = auction.leader_bid_id ?? ''
			const sellerPaymentPublicKey = auction.seller_coco_payment_public_key ?? ''
			if (!Number.isSafeInteger(state.height) || state.height < 1
				|| (leaderBidId !== '' && !HEX_32.test(leaderBidId))
				|| !/^(?:02|03)[0-9a-f]{64}$/.test(sellerPaymentPublicKey)) {
				fail('participant-local leader, seller payment key, or height is malformed')
			}
			return {
				leaderBidId, sellerPaymentPublicKey, height: state.height,
				evidenceDigest: bytesToHex(sha256(utf8ToBytes(JSON.stringify([
					'COCO_DEMO_ADMISSION_CONSENSUS_EVIDENCE_V1', chainId, state.height, stateResult.observation.appHash,
					stateResult.bindingCommit.height, stateResult.bindingCommit.blockHash, request.auctionId, leaderBidId,
					sellerPaymentPublicKey,
				])))),
			}
		},
	})
}

function cometHex(value: unknown, label: string, bytes: number): string {
	if (typeof value !== 'string' || !new RegExp(`^[0-9A-F]{${bytes * 2}}$`).test(value)) {
		fail(`${label} is not exact uppercase Comet HexBytes`)
	}
	return value.toLowerCase()
}

async function rpcJson(fetchImpl: typeof fetch, url: URL): Promise<Record<string, any>> {
	const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
	if (!response.ok) fail(`local Comet RPC returned HTTP ${response.status}`)
	const envelope = await response.json() as Record<string, unknown>
	if (envelope.error !== undefined || envelope.result === null || typeof envelope.result !== 'object') fail('local Comet RPC returned an error envelope')
	return envelope.result as Record<string, any>
}

/** Build the only supported reader: the participant's own loopback Comet RPC. */
export function createLoopbackCometReader(endpoint = 'http://127.0.0.1:26657', fetchImpl: typeof fetch = fetch): DemoParticipantConsensusReader {
	const base = new URL(endpoint)
	if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !/^[1-9][0-9]{0,4}$/.test(base.port)
		|| Number(base.port) > 65535 || base.pathname !== '/' || base.username !== '' || base.password !== ''
		|| base.search !== '' || base.hash !== '') {
		fail('participant Comet RPC must be an exact credential-free 127.0.0.1 HTTP endpoint')
	}
	return Object.freeze({
		async readChainId() {
			const result = await rpcJson(fetchImpl, new URL('/status', base))
			return exactText(String(result.node_info?.network ?? ''), 'local chain id')
		},
		async readCommit(height: number) {
			const url = new URL('/commit', base); url.searchParams.set('height', String(height))
			const result = await rpcJson(fetchImpl, url)
			if (result.canonical !== true) fail(`commit ${height} is not canonical`)
			const header = result.signed_header?.header
			const commit = result.signed_header?.commit
			if (header === undefined || commit === undefined || String(header.height) !== String(height)) fail(`commit ${height} is malformed`)
			return {
				height, blockTime: Math.floor(Date.parse(String(header.time)) / 1000),
				blockHash: cometHex(commit.block_id?.hash, 'block hash', 32), appHash: cometHex(header.app_hash, 'app hash', 32),
				validatorsHash: cometHex(header.validators_hash, 'validators hash', 32),
				commitSignerAddresses: (commit.signatures as any[] ?? [])
					.filter((signature) => Number(signature.block_id_flag) === 2)
					.map((signature) => cometHex(signature.validator_address, 'validator address', 20).toUpperCase()),
			}
		},
		async readBlock(height: number) {
			const url = new URL('/block', base); url.searchParams.set('height', String(height))
			const result = await rpcJson(fetchImpl, url)
			if (String(result.block?.header?.height) !== String(height)) fail(`block ${height} is malformed`)
			return {
				height, blockHash: cometHex(result.block_id?.hash, 'block hash', 32),
				transactions: (result.block?.data?.txs ?? []).map((value: string) => Uint8Array.from(Buffer.from(value, 'base64'))),
			}
		},
		async readCurrentState() {
			const url = new URL('/abci_query', base); url.searchParams.set('path', '"/state"')
			const result = await rpcJson(fetchImpl, url)
			if (Number(result.response?.code ?? 1) !== 0 || typeof result.response?.value !== 'string') fail('local state query failed')
			const view = JSON.parse(Buffer.from(result.response.value, 'base64').toString('utf8')) as {
				state?: unknown; app_hash?: unknown; canonical_state?: unknown
			}
			const queryHeight = Number(result.response.height)
			if (view === null || typeof view !== 'object' || view.state === null || typeof view.state !== 'object'
				|| !Number.isSafeInteger(queryHeight) || queryHeight < 1 || !HEX_32.test(String(view.app_hash ?? ''))
				|| typeof view.canonical_state !== 'string') {
				fail('local state view is malformed')
			}
			const canonicalStateBytes = Uint8Array.from(Buffer.from(view.canonical_state, 'base64'))
			if (canonicalStateBytes.length === 0 || Buffer.from(canonicalStateBytes).toString('base64') !== view.canonical_state) {
				fail('local canonical state bytes are not strict base64')
			}
			return { queryHeight, appHash: String(view.app_hash), canonicalStateBytes, state: view.state as DemoCometStateV1 }
		},
	})
}

/** App-only reader for the independently pinned non-voting full observer.
 * Comet performs actual consensus verification and local ABCI replay. This
 * guard never turns a remote JSON endpoint into a trusted consensus reader.
 */
export function createPinnedObserverCometReader(options: {
	chainId: string
	nodeId: string
	fetchImpl?: typeof fetch
}): DemoParticipantConsensusReader {
	if (!/^[a-z0-9._-]{1,50}$/.test(options.chainId) || !/^[0-9a-f]{40}$/.test(options.nodeId)) fail('observer independent chain/node pins invalid')
	const transport = options.fetchImpl ?? fetch
	const fetchImpl = (async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input))
		if (url.origin !== 'http://127.0.0.1:27657' || url.username || url.password) fail('observer RPC escaped exact loopback')
		const response = await transport(input, { ...init, redirect: 'manual' })
		if (response.redirected || response.status >= 300 && response.status < 400
			|| response.url && new URL(response.url).origin !== url.origin) fail('observer RPC redirect refused')
		return response
	}) as typeof fetch
	const reader = createLoopbackCometReader('http://127.0.0.1:27657', fetchImpl)
	async function current(): Promise<void> {
		const status = await rpcJson(fetchImpl, new URL('http://127.0.0.1:27657/status'))
		if (status.node_info?.network !== options.chainId || status.node_info?.id !== options.nodeId
			|| status.sync_info?.catching_up !== false || !/^[1-9][0-9]*$/.test(String(status.sync_info?.latest_block_height))
			|| String(status.validator_info?.voting_power) !== '0') fail('observer unpinned, voting or catching up')
	}
	return Object.freeze({
		async readChainId() { await current(); return options.chainId },
		async readCommit(height: number) { await current(); return reader.readCommit(height) },
		async readBlock(height: number) { await current(); return reader.readBlock(height) },
		async readCurrentState() { await current(); return reader.readCurrentState() },
	})
}

