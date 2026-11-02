/** Concrete Nostr bid broadcast plus independently authenticated Comet commit/state confirmation. */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	authenticatedDemoCometState,
	exactDemoCometCommit,
	type DemoParticipantConsensusReader,
} from './demo-comet-displacement-verifier'
import type {
	DemoIntegratedAdmissionConsensusCommitV1,
	DemoIntegratedBidConsensusPort,
} from './demo-integrated-admission-service'
import {
	demoIntegratedFundingAnyCanonicalBytes,
	verifyDemoIntegratedFundingReceiptAny,
	type DemoIntegratedFundingReceiptAny,
} from './demo-integrated-admission-receipt-any'
import { verifyDemoIntegratedFundingReceipt, type DemoIntegratedFundingReceiptV2 } from './demo-integrated-funding-receipt'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const BID_KIND = 28641
const WAIT_ATTEMPTS = 120
const WAIT_MS = 100

export interface DemoNostrBidEvent {
	id: string
	pubkey: string
	created_at: number
	kind: typeof BID_KIND
	tags: string[][]
	content: string
	sig: string
}

export interface DemoNostrBidSignerPort {
	getPublicKey(): Promise<string>
	signEvent(event: Omit<DemoNostrBidEvent, 'id' | 'sig'>): Promise<DemoNostrBidEvent>
}

export interface DemoCometBidBroadcastPort {
	broadcastAndWait(tx: Uint8Array): Promise<{ height: number; txHash: string }>
}

export interface DemoCometTxRecoveryPort {
	/** Lookup only; the caller must still authenticate block/commit/application state. */
	recoverExact(txHash: string): Promise<{ height: number; txHash: string } | null>
}

export interface DemoCometBidConsensusOptions {
	reader: DemoParticipantConsensusReader
	broadcaster: DemoCometBidBroadcastPort
	signer: DemoNostrBidSignerPort
	chainId: string
	validatorsHash: string
	nowSeconds(): number
}

function fail(message: string): never { throw new Error(`DEMO_COMET_BID_CONSENSUS: ${message}`) }

function eventId(event: Omit<DemoNostrBidEvent, 'id' | 'sig'>): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))))
}

function exactEvent(value: DemoNostrBidEvent, expected: Omit<DemoNostrBidEvent, 'id' | 'sig'>): DemoNostrBidEvent {
	if (value.id !== eventId(expected) || value.pubkey !== expected.pubkey || value.created_at !== expected.created_at
		|| value.kind !== BID_KIND || JSON.stringify(value.tags) !== JSON.stringify(expected.tags)
		|| value.content !== expected.content || !HEX_64.test(value.sig)
		|| !schnorr.verify(hexToBytes(value.sig), hexToBytes(value.id), hexToBytes(value.pubkey))) {
		fail('Nostr signer returned a mutated or invalid bid event')
	}
	return structuredClone(value)
}

function exactEventInBlock(transactions: Uint8Array[], expected: DemoNostrBidEvent): void {
	let matches = 0
	for (const raw of transactions) {
		let value: unknown
		try { value = JSON.parse(new TextDecoder().decode(raw)) }
		catch { continue }
		if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
		const tx = value as Record<string, unknown>
		if (tx.version === 1 && tx.type === 'event' && JSON.stringify(tx.event) === JSON.stringify(expected)
			&& JSON.stringify(Object.keys(tx).sort()) === JSON.stringify(['event', 'type', 'version'])) matches++
	}
	if (matches !== 1) fail('committed block does not contain one exact signed bid event')
}

function sameSignedReceipt(left: DemoIntegratedFundingReceiptAny, right: DemoIntegratedFundingReceiptAny): boolean {
	const leftExact = verifyDemoIntegratedFundingReceiptAny(left)
	const rightExact = verifyDemoIntegratedFundingReceiptAny(right)
	if (leftExact.schema !== rightExact.schema) return false
	const { committee_signature: leftSignature, participant_policy_digest: leftPolicy, ...leftUnsigned } = leftExact
	const { committee_signature: rightSignature, participant_policy_digest: rightPolicy, ...rightUnsigned } = rightExact
	return leftSignature === rightSignature && leftPolicy === rightPolicy
		&& Buffer.from(demoIntegratedFundingAnyCanonicalBytes(leftUnsigned))
			.equals(Buffer.from(demoIntegratedFundingAnyCanonicalBytes(rightUnsigned)) as Uint8Array)
}

async function waitCommit(reader: DemoParticipantConsensusReader, height: number) {
	let last: unknown
	for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt++) {
		try { return await reader.readCommit(height) }
		catch (error) {
			last = error
			if (attempt + 1 < WAIT_ATTEMPTS) await new Promise<void>((resolve) => setTimeout(resolve, WAIT_MS))
		}
	}
	return fail(`commit ${height} did not become available: ${last instanceof Error ? last.message : 'unknown error'}`)
}

export function createDemoCometBidConsensus(options: DemoCometBidConsensusOptions): DemoIntegratedBidConsensusPort {
	if (options.chainId.length === 0 || !HEX_32.test(options.validatorsHash)) fail('chain or validator pins are malformed')
	return Object.freeze({
		async broadcastAndConfirm(input: DemoIntegratedFundingReceiptV2): Promise<DemoIntegratedAdmissionConsensusCommitV1> {
			const receipt = verifyDemoIntegratedFundingReceipt(input)
			if (await options.reader.readChainId() !== options.chainId) fail('local Comet node reports another chain')
			const actor = await options.signer.getPublicKey()
			if (actor !== receipt.bidder || !HEX_32.test(actor)) fail('active Nostr signer differs from admitted bidder')
			const createdAt = options.nowSeconds()
			if (!Number.isSafeInteger(createdAt) || createdAt < 1) fail('bid signer clock is malformed')
			const unsigned = {
				pubkey: actor, created_at: createdAt, kind: BID_KIND, tags: [],
				content: JSON.stringify({
					auction_id: receipt.auction_id, amount: receipt.bid_amount,
					replaces_bid_id: receipt.replaces_bid_id, integrated_funding: receipt,
				}),
			} satisfies Omit<DemoNostrBidEvent, 'id' | 'sig'>
			const event = exactEvent(await options.signer.signEvent(structuredClone(unsigned)), unsigned)
			const tx = new TextEncoder().encode(JSON.stringify({ version: 1, type: 'event', event }))
			const broadcast = await options.broadcaster.broadcastAndWait(tx)
			if (!Number.isSafeInteger(broadcast.height) || broadcast.height < 1 || !HEX_32.test(broadcast.txHash)) {
				fail('broadcast result is malformed')
			}
			const expectedTxHash = bytesToHex(sha256(tx))
			if (broadcast.txHash !== expectedTxHash) fail('broadcast result names another transaction')
			const h = broadcast.height
			// Comet reports the tip's seen commit as non-canonical until the next
			// block carries it. Wait for H+2 to become canonical first; H and H+1
			// are necessarily historical/canonical at that point. This avoids three
			// concurrent polling loops hammering the one loopback RPC while the
			// validators are advancing through a slow round.
			const commitH2 = await waitCommit(options.reader, h + 2)
			const [commitH, commitH1, block] = await Promise.all([
				options.reader.readCommit(h), options.reader.readCommit(h + 1), options.reader.readBlock(h),
			])
			if (block.height !== h) fail('broadcast block height differs from committed height')
			exactEventInBlock(block.transactions, event)
			const commits = [commitH, commitH1, commitH2]
				.map((value, index) => exactDemoCometCommit(value, h + index, options.validatorsHash))
			if (block.blockHash !== commits[0]!.blockHash) fail('broadcast block bytes are not joined to canonical commit')
			const stateResult = await authenticatedDemoCometState(options.reader, options.validatorsHash, h + 2)
			const state = stateResult.observation.state
			const auction = state.auctions?.[receipt.auction_id]
			const bid = state.bids?.[event.id]
			const funding = state.integrated_fundings?.[receipt.funding_operation_id]
			const mismatches = [
				[state.chain_id !== options.chainId, 'chain'], [auction === undefined, 'auction'],
				[bid === undefined, 'bid'], [bid?.id !== event.id, 'bid.id'],
				[bid?.auction_id !== receipt.auction_id, 'bid.auction'], [bid?.bidder !== actor, 'bid.bidder'],
				[bid?.amount !== receipt.bid_amount, 'bid.amount'],
				[bid?.integrated_funding_id !== receipt.funding_operation_id, 'bid.funding'],
				[funding === undefined, 'funding'], [funding?.id !== receipt.funding_operation_id, 'funding.id'],
				[funding?.bid_id !== event.id, 'funding.bid'], [funding?.auction_id !== receipt.auction_id, 'funding.auction'],
				[funding?.bidder !== actor, 'funding.bidder'],
				[funding === undefined || !sameSignedReceipt(funding.receipt, receipt), 'funding.receipt'],
			].filter(([failed]) => failed).map(([, field]) => field)
			if (mismatches.length > 0) {
				fail(`authenticated post-commit state differs at ${mismatches.join(',')}`)
			}
			let disposition: DemoIntegratedAdmissionConsensusCommitV1['disposition']
			if (funding.status === 'active' && auction.leader_bid_id === event.id && auction.status === 'open') {
				disposition = { kind: 'active' }
			} else if (funding.status === 'outbid_return_entitled' || funding.status === 'superseded') {
				const matches = Object.values(state.integrated_displacements ?? {}).filter((entry) =>
					entry.auction_id === receipt.auction_id && entry.displaced_bid_id === event.id
					&& entry.displaced_funding_id === receipt.funding_operation_id)
				if (matches.length !== 1 || !HEX_32.test(matches[0]!.replacement_bid_id)) {
					fail('committed nonleader funding lacks one immutable successor displacement')
				}
				disposition = funding.status === 'outbid_return_entitled'
					? { kind: 'displaced', branch: 'outbid_return', successorBidId: matches[0]!.replacement_bid_id }
					: { kind: 'superseded', successorBidId: matches[0]!.replacement_bid_id }
			} else if (funding.status === 'payout_entitled' && auction.status === 'closed'
				&& auction.leader_bid_id === event.id && auction.winner === actor) {
				disposition = { kind: 'terminal', branch: 'winner_payout' }
			} else if (funding.status === 'release_entitled' && auction.status === 'closed'
				&& auction.leader_bid_id === event.id && (auction.winner ?? '') === '') {
				disposition = { kind: 'terminal', branch: 'reserve_unmet_return' }
			} else {
				fail('committed funding has no exact active, displaced, superseded, or terminal disposition')
			}
			return {
				schema: 'COCO_DEMO_INTEGRATED_ADMISSION_COMMIT_V1', height: h,
				stateHeight: stateResult.observation.queryHeight,
				stateBindingHeight: stateResult.bindingCommit.height,
				appStateHash: stateResult.observation.appHash, bidId: event.id,
				fundingOperationId: receipt.funding_operation_id, disposition, receipt,
				broadcastTxHash: broadcast.txHash, commits: commits as DemoIntegratedAdmissionConsensusCommitV1['commits'],
			}
		},
	})
}

function upperHex(value: unknown, bytes: number, label: string): string {
	if (typeof value !== 'string' || !new RegExp(`^[0-9A-F]{${bytes * 2}}$`).test(value)) fail(`${label} is not Comet uppercase hex`)
	return value.toLowerCase()
}

function safeRpcDiagnostic(value: unknown): string {
	if (typeof value !== 'string') return ''
	return value
		.replace(/[0-9a-fA-F]{48,}/g, '[hex-redacted]')
		.replace(/[A-Za-z0-9+/]{64,}={0,2}/g, '[base64-redacted]')
		.replace(/[^\x20-\x7e]/g, '?')
		.slice(0, 320)
}

/** Loopback-only Comet RPC broadcaster. No remote endpoint is accepted. */
export function createLoopbackCometBidBroadcaster(
	endpoint = 'http://127.0.0.1:26657',
	fetchImpl: typeof fetch = fetch,
): DemoCometBidBroadcastPort {
	const base = new URL(endpoint)
	if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !/^[1-9][0-9]{0,4}$/.test(base.port)
		|| Number(base.port) > 65535 || base.pathname !== '/' || base.username !== '' || base.password !== ''
		|| base.search !== '' || base.hash !== '') fail('broadcaster must use an exact credential-free 127.0.0.1 Comet RPC')
	return Object.freeze({
		async broadcastAndWait(tx: Uint8Array) {
			const url = new URL('/broadcast_tx_commit', base)
			// Comet v1's REST parameter decoder treats quoted strings as their
			// literal bytes. Use its explicit 0x byte-slice form so ABCI receives
			// the exact JSON transaction rather than base64 text.
			url.searchParams.set('tx', `0x${Buffer.from(tx).toString('hex')}`)
			const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
			const text = await response.text()
			let envelope: Record<string, any>
			try { envelope = JSON.parse(text) as Record<string, any> }
			catch { envelope = {} }
			if (!response.ok) {
				// Never echo RPC data: malformed-request diagnostics can contain the
				// encoded transaction and its bearer-proof secrets. Code/message are
				// sufficient to distinguish HTTP/RPC framing from ABCI rejection.
				const code = typeof envelope.error?.code === 'number' ? ` code ${envelope.error.code}` : ''
				const message = typeof envelope.error?.message === 'string'
					? ` ${envelope.error.message.slice(0, 160).replace(/[^\x20-\x7e]/g, '?')}` : ''
				const data = safeRpcDiagnostic(envelope.error?.data)
				fail(`broadcast RPC returned HTTP ${response.status}${code}${message}${data.length > 0 ? `: ${data}` : ''}`)
			}
			const result = envelope.result
			if (envelope.error !== undefined || result === null || typeof result !== 'object'
				|| Number(result.check_tx?.code ?? 1) !== 0 || Number(result.deliver_tx?.code ?? result.tx_result?.code ?? 1) !== 0) {
				fail('Comet rejected the exact signed bid transaction')
			}
			const height = Number(result.height)
			if (!Number.isSafeInteger(height) || height < 1) fail('broadcast height is malformed')
			return { height, txHash: upperHex(result.hash, 32, 'transaction hash') }
		},
	})
}

/** Recover a possibly accepted transaction without ever broadcasting it again. */
export function createLoopbackCometTxRecovery(
	endpoint = 'http://127.0.0.1:26657',
	fetchImpl: typeof fetch = fetch,
): DemoCometTxRecoveryPort {
	const base = new URL(endpoint)
	if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !/^[1-9][0-9]{0,4}$/.test(base.port)
		|| Number(base.port) > 65535 || base.pathname !== '/' || base.username !== '' || base.password !== ''
		|| base.search !== '' || base.hash !== '') fail('transaction recovery must use an exact credential-free 127.0.0.1 Comet RPC')
	return Object.freeze({
		async recoverExact(txHash: string) {
			if (!HEX_32.test(txHash)) fail('recovery transaction hash is malformed')
			const url = new URL('/tx', base)
			url.searchParams.set('hash', `0x${txHash}`)
			url.searchParams.set('prove', 'false')
			const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
			const text = await response.text()
			let envelope: Record<string, any>
			try { envelope = JSON.parse(text) as Record<string, any> }
			catch { return fail('transaction recovery RPC returned non-JSON') }
			if (envelope.error !== undefined) {
				const diagnostic = safeRpcDiagnostic(envelope.error?.data ?? envelope.error?.message).toLowerCase()
				if ((envelope.error?.code === -32603 || response.status === 404) && diagnostic.includes('not found')) return null
				fail('transaction recovery RPC returned an unexpected error')
			}
			if (!response.ok || envelope.result === null || typeof envelope.result !== 'object') {
				fail('transaction recovery RPC response is malformed')
			}
			const resultHash = upperHex(envelope.result.hash, 32, 'recovered transaction hash')
			const height = Number(envelope.result.height)
			if (resultHash !== txHash || !Number.isSafeInteger(height) || height < 1
				|| typeof envelope.result.tx !== 'string' || Number(envelope.result.tx_result?.code ?? 1) !== 0) {
				fail('recovered transaction identity or result is malformed')
			}
			if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(envelope.result.tx)) {
				fail('recovered transaction bytes are not canonical base64')
			}
			let tx: Uint8Array
			try {
				const decoded = Buffer.from(envelope.result.tx, 'base64')
				if (decoded.toString('base64') !== envelope.result.tx) fail('recovered transaction bytes are not canonical base64')
				tx = Uint8Array.from(decoded)
			} catch { return fail('recovered transaction bytes are malformed') }
			if (tx.length === 0 || bytesToHex(sha256(tx)) !== txHash) fail('recovered transaction bytes differ from its hash')
			return { height, txHash: resultHash }
		},
	})
}
