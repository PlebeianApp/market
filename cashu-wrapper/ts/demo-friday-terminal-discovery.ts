/** Authenticated Comet outcome discovery feeding the fixed terminal resolver. */
import {
	createDemoCometDisplacementVerifier,
	type DemoParticipantConsensusReader,
} from './demo-comet-displacement-verifier'
import { createDemoCometCloseVerifier } from './demo-comet-close-verifier'
import type { DemoFridayPreparedFundingAdmission } from './demo-friday-prepared-funding'
import {
	demoFridayTerminalDescriptorDigest,
	DemoFridayTerminalDescriptorSqlite,
	type DemoFridayTerminalNetworkPinsV1,
} from './demo-friday-fixed-terminal-resolver'
import {
	DemoFridayTrustedTerminalSqlite,
	type DemoFridayTrustedTerminalReferenceV1,
} from './demo-friday-authority-runtime'

const HEX_32 = /^[0-9a-f]{64}$/
/** One bounded page per drain pass; progress is durable in the descriptor DB. */
const TERMINAL_SCAN_BLOCK_BUDGET = 256

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_TERMINAL_DISCOVERY: ${message}`) }

function transactionAt(raw: Uint8Array): { type: string; eventId?: string; auctionId?: string } | null {
	let value: unknown
	try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) }
	catch { return null }
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
	const tx = value as Record<string, unknown>
	if (tx.version !== 1 || typeof tx.type !== 'string') return null
	if (tx.type === 'close' && typeof tx.auction_id === 'string'
		&& Object.keys(tx).sort().join(',') === 'auction_id,type,version') return { type: 'close', auctionId: tx.auction_id }
	if (tx.type !== 'event' || tx.event === null || typeof tx.event !== 'object' || Array.isArray(tx.event)) return null
	const event = tx.event as Record<string, unknown>
	return typeof event.id === 'string' && HEX_32.test(event.id) ? { type: 'event', eventId: event.id } : null
}

export class DemoFridayAuthenticatedTerminalDiscovery {
	readonly #displacement
	readonly #close
	constructor(private readonly options: {
		reader: DemoParticipantConsensusReader
		pins: DemoFridayTerminalNetworkPinsV1
		prepared: Pick<DemoFridayPreparedFundingAdmission, 'listAdmittedExact' | 'readStoredExact'>
		descriptors: DemoFridayTerminalDescriptorSqlite
		source: DemoFridayTrustedTerminalSqlite
	}) {
		this.#displacement = createDemoCometDisplacementVerifier({ reader: options.reader, ...options.pins })
		this.#close = createDemoCometCloseVerifier({ reader: options.reader, ...options.pins })
	}

	async discoverExact(): Promise<number> {
		const observation = await this.options.reader.readCurrentState()
		if (observation.state.chain_id !== this.options.pins.chainId
			|| observation.state.height !== observation.queryHeight) fail('current state differs from fixed chain')
		let created = 0
		let scanBudget = TERMINAL_SCAN_BLOCK_BUDGET
		for (const replay of this.options.prepared.listAdmittedExact()) {
			const funding = observation.state.integrated_fundings?.[replay.fundingOperationId]
			if (funding === undefined || funding.receipt === undefined) continue
			const held = await this.options.prepared.readStoredExact(replay.eventId)
			const auctionId = held.stored.bundle.winner.auctionId
			let branch: 'outbid_return' | 'rejected_return' | 'winner_payout' | 'reserve_unmet_return'
			let eventHeight: number
			let eventId: string
			if (replay.admission?.disposition === 'rejected_return') {
				if (funding.status !== 'rejected_return_entitled' || funding.bid_id !== replay.admission.bidEventId
					|| funding.rejection_reason !== replay.admission.rejectionReason
					|| observation.state.bids?.[replay.admission.bidEventId] !== undefined) {
					fail('rejected replay differs from authenticated rejection state')
				}
				branch = 'rejected_return'
				eventHeight = replay.admission.committedHeight
				eventId = replay.admission.bidEventId
			} else if (funding.status === 'outbid_return_entitled') {
				const matches = Object.values(observation.state.integrated_displacements ?? {}).filter((entry) =>
					entry.auction_id === auctionId && entry.displaced_funding_id === replay.fundingOperationId)
				if (matches.length !== 1 || !HEX_32.test(matches[0]!.replacement_bid_id)) fail('outbid funding lacks one replacement')
				eventId = matches[0]!.replacement_bid_id
				if (scanBudget === 0) break
				const scan = await this.options.descriptors.scanHistoryPageExact({
					request: {
						fundingOperationId: replay.fundingOperationId, admissionEventId: replay.eventId,
						kind: 'event', targetId: eventId, startHeight: replay.admission!.committedHeight + 1,
						observedEndHeight: observation.queryHeight,
					}, maxBlocks: scanBudget,
					readBlock: async (height) => this.options.reader.readBlock(height),
					matches: (raw) => {
						const tx = transactionAt(raw)
						return tx?.type === 'event' && tx.eventId === eventId
					},
				})
				scanBudget -= scan.scannedBlocks
				if (!scan.complete || scan.foundHeight === undefined) continue
				eventHeight = scan.foundHeight
				const certificate = await this.#displacement.verifyAndDerive({
					network: this.options.pins.network, chainId: this.options.pins.chainId,
					genesisHash: this.options.pins.genesisHash,
					validatorRosterVersion: this.options.pins.validatorRosterVersion,
					auctionId, displacementHeight: eventHeight, replacementBidEventId: eventId,
				})
				if (certificate.displacedFundingOperationId !== replay.fundingOperationId) fail('displacement belongs to another funding operation')
				branch = 'outbid_return'
			} else if (funding.status === 'payout_entitled' || funding.status === 'release_entitled') {
				if (scanBudget === 0) break
				const scan = await this.options.descriptors.scanHistoryPageExact({
					request: {
						fundingOperationId: replay.fundingOperationId, admissionEventId: replay.eventId,
						kind: 'close', targetId: auctionId, startHeight: replay.admission!.committedHeight,
						observedEndHeight: observation.queryHeight,
					}, maxBlocks: scanBudget,
					readBlock: async (height) => this.options.reader.readBlock(height),
					matches: (raw) => {
						const tx = transactionAt(raw)
						return tx?.type === 'close' && tx.auctionId === auctionId
					},
				})
				scanBudget -= scan.scannedBlocks
				if (!scan.complete || scan.foundHeight === undefined) continue
				eventHeight = scan.foundHeight
				const certificate = await this.#close.verifyAndDerive({
					network: this.options.pins.network, chainId: this.options.pins.chainId,
					genesisHash: this.options.pins.genesisHash,
					validatorRosterVersion: this.options.pins.validatorRosterVersion,
					auctionId, closeHeight: eventHeight,
				})
				if (certificate.fundingOperationId !== replay.fundingOperationId) fail('close belongs to another funding operation')
				branch = certificate.cause === 'winner' ? 'winner_payout' : 'reserve_unmet_return'
				eventId = certificate.commits[0].blockHash
			} else continue
			const descriptor = {
				schema: 'PLEBEIAN_FRIDAY_TERMINAL_DESCRIPTOR_V1' as const,
				reference: `terminal-${replay.eventId.slice(0, 32)}`, branch, auctionId,
				fundingOperationId: replay.fundingOperationId, scope: replay.scope,
				bundleDigest: replay.bundleDigest, eventHeight, eventId,
			}
			const reference: DemoFridayTrustedTerminalReferenceV1 = this.options.descriptors.persistAuthenticatedExact(descriptor)
			if (reference.identityDigest !== demoFridayTerminalDescriptorDigest(descriptor)) fail('descriptor digest changed before enqueue')
			this.options.source.enqueueAuthenticatedExact(reference)
			created++
		}
		return created
	}
}

/** Discovery is internal and fail-closed; no browser can submit a terminal descriptor. */
export class DemoFridayDiscoveringTerminalSource {
	constructor(
		private readonly source: DemoFridayTrustedTerminalSqlite,
		private readonly discovery: DemoFridayAuthenticatedTerminalDiscovery,
	) {}

	async nextExact() {
		await this.discovery.discoverExact()
		return this.source.nextExact()
	}
	markQueuedExact(...args: Parameters<DemoFridayTrustedTerminalSqlite['markQueuedExact']>) { return this.source.markQueuedExact(...args) }
	markExpiredExact(...args: Parameters<DemoFridayTrustedTerminalSqlite['markExpiredExact']>) { return this.source.markExpiredExact(...args) }
	recoverInterruptedExact(): number { return this.source.recoverInterruptedExact() }
	pendingCount(): number { return this.source.pendingCount() }
}
