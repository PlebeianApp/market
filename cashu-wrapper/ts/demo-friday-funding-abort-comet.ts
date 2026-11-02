/** Pinned Comet broadcast/recovery/finality adapter for FundingAbortV1. */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import type { DemoCometBidBroadcastPort, DemoCometTxRecoveryPort } from './demo-comet-bid-consensus'
import {
	authenticatedDemoCometState,
	exactDemoCometCommit,
	type DemoParticipantConsensusReader,
} from './demo-comet-displacement-verifier'
import type { DemoFridayPinnedGenesisPort } from './demo-friday-v4-comet-admission'
import type {
	DemoFridayFundingAbortCommitV1,
	DemoFridayFundingAbortConsensusPort,
} from './demo-friday-funding-abort-service'
import {
	claimDemoFridayCommittedAbort,
	emptyDemoFridayFundingLifecycleState,
	type DemoFridayFundingAbortCertificateV1,
	type DemoFridayFundingAbortPinsV1,
} from './demo-friday-funding-pool-lifecycle'

const HEX_32 = /^[0-9a-f]{64}$/
const WAIT_ATTEMPTS = 120
const WAIT_MS = 100
function fail(message: string): never { throw new Error(`DEMO_FRIDAY_FUNDING_ABORT_COMET: ${message}`) }

interface FundingLifecycleState {
	chain_id: string
	funding_lifecycles?: Record<string, {
		schema: string; operationId: string; proofYs: string[]; auctionId: string; actor: string; amount: number
		origin: string; status: string; consensusEventId: string; actorAuthorizationEventId?: string
		committedHeight: number; committedAt: number; reason?: string; abortCertificateDigest?: string
	}>
}

export interface DemoFridayFundingAbortFinalityV1 {
	certificate: DemoFridayFundingAbortCertificateV1
	commit: DemoFridayFundingAbortCommitV1
}

export interface DemoFridayFundingAbortFinalityVerifierPort {
	verifyExact(request: { operationId: string; consensusEventId: string; height: number }): Promise<DemoFridayFundingAbortFinalityV1>
}

function abortEnvelope(raw: Uint8Array): DemoFridayFundingAbortCertificateV1 | null {
	let value: unknown
	try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) }
	catch { return null }
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
	const record = value as Record<string, unknown>
	if (Object.keys(record).sort().join(',') !== 'funding_abort,type,version'
		|| record.version !== 1 || record.type !== 'funding_abort'
		|| record.funding_abort === null || typeof record.funding_abort !== 'object'
		|| Array.isArray(record.funding_abort)) return null
	return structuredClone(record.funding_abort) as DemoFridayFundingAbortCertificateV1
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
	return fail(`commit ${height} did not become available: ${last instanceof Error ? last.message : 'unknown'}`)
}

/**
 * Participant-local reconstruction of one already committed FundingAbortV1.
 * The caller supplies only its immutable consensus lookup identity. The exact
 * certificate bytes, H/H+1/H+2 commits and S/S+1 state are all reread from the
 * signer's pinned loopback Comet RPC before a terminal SIG_ALL share is made.
 */
export function createDemoFridayFundingAbortFinalityVerifier(options: {
	pins: DemoFridayFundingAbortPinsV1
	validatorsHash: string
	reader: DemoParticipantConsensusReader
}): DemoFridayFundingAbortFinalityVerifierPort {
	if (!HEX_32.test(options.validatorsHash)) fail('validator hash is malformed')
	return Object.freeze({
		async verifyExact(request: { operationId: string; consensusEventId: string; height: number }) {
			if (!/^[A-Za-z0-9_-]{1,160}$/.test(request.operationId)
				|| !HEX_32.test(request.consensusEventId)
				|| !Number.isSafeInteger(request.height) || request.height < 1) fail('abort lookup is malformed')
			const [chainId, block, commitH, commitH1, commitH2, stateResult] = await Promise.all([
				options.reader.readChainId(), options.reader.readBlock(request.height),
				options.reader.readCommit(request.height), options.reader.readCommit(request.height + 1),
				waitCommit(options.reader, request.height + 2),
				authenticatedDemoCometState(options.reader, options.validatorsHash, request.height + 2),
			])
			if (chainId !== options.pins.chainId || block.height !== request.height) fail('chain or abort height differs')
			const commits = [commitH, commitH1, commitH2].map((value, index) =>
				exactDemoCometCommit(value, request.height + index, options.validatorsHash))
			if (block.blockHash !== commits[0]!.blockHash) fail('abort block differs from canonical commit H')
			const matches = block.transactions.flatMap((raw) => {
				const certificate = abortEnvelope(raw)
				if (certificate === null || certificate.operationId !== request.operationId) return []
				try {
					const derived = claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), certificate,
						options.pins, '0'.repeat(64), request.height, commits[0]!.blockTime)
					const record = derived.records[request.operationId]
					return record?.abortCertificateDigest === request.consensusEventId
						? [{ raw, certificate, expected: record }] : []
				} catch { return [] }
			})
			if (matches.length !== 1) fail('canonical block lacks one exact FundingAbort certificate')
			const match = matches[0]!
			const state = stateResult.observation.state as unknown as FundingLifecycleState
			const observed = state.funding_lifecycles?.[request.operationId]
			if (state.chain_id !== options.pins.chainId || observed === undefined
				|| observed.schema !== match.expected.schema || observed.operationId !== match.expected.operationId
				|| JSON.stringify(observed.proofYs) !== JSON.stringify(match.expected.proofYs)
				|| observed.auctionId !== match.expected.auctionId || observed.actor !== match.expected.actor
				|| observed.amount !== match.expected.amount || observed.origin !== 'committed_abort'
				|| observed.status !== 'aborted_return_entitled'
				|| observed.consensusEventId !== request.consensusEventId
				|| observed.actorAuthorizationEventId !== match.certificate.actorAbortEvent.id
				|| observed.committedHeight !== request.height || observed.committedAt !== commits[0]!.blockTime
				|| observed.reason !== match.certificate.abortReason
				|| observed.abortCertificateDigest !== request.consensusEventId) {
				fail('authenticated state lacks the exact committed FundingAbort')
			}
			const transactionHash = bytesToHex(sha256(match.raw))
			const commit: DemoFridayFundingAbortCommitV1 = {
				schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_COMMIT_V1', origin: 'committed_abort',
				operationId: request.operationId, consensusEventId: request.consensusEventId,
				actorAuthorizationEventId: match.certificate.actorAbortEvent.id,
				transactionHash, height: request.height, committedAt: commits[0]!.blockTime,
				abortCertificateDigest: request.consensusEventId,
				transactionBlockHash: commits[0]!.blockHash, successorHeight: commits[1]!.height,
				successorBlockHash: commits[1]!.blockHash, finalityHeight: commits[2]!.height,
				finalityBlockHash: commits[2]!.blockHash, validatorsHash: options.validatorsHash,
				commitSignerAddresses: commitH2.commitSignerAddresses,
				stateHeight: stateResult.observation.queryHeight, stateAppHash: stateResult.observation.appHash,
				stateCommitHeight: stateResult.bindingCommit.height,
				stateCommitAppHash: stateResult.bindingCommit.appHash,
			}
			return {
				certificate: structuredClone(match.certificate),
				commit,
			}
		},
	})
}

export function createDemoFridayFundingAbortComet(options: {
	pins: DemoFridayFundingAbortPinsV1
	validatorsHash: string
	reader: DemoParticipantConsensusReader
	genesis: DemoFridayPinnedGenesisPort
	broadcaster: DemoCometBidBroadcastPort
	recovery: DemoCometTxRecoveryPort
}): DemoFridayFundingAbortConsensusPort {
	if (!HEX_32.test(options.validatorsHash)) fail('validator hash is malformed')
	return Object.freeze({
		async broadcastExact(transaction: Uint8Array) {
			const expectedHash = bytesToHex(sha256(transaction))
			const result = await options.broadcaster.broadcastAndWait(transaction)
			if (result.txHash !== expectedHash || !Number.isSafeInteger(result.height) || result.height < 1) {
				fail('broadcast result differs from exact transaction')
			}
			return { height: result.height, transactionHash: result.txHash }
		},
		async recoverExact(transactionHash: string) {
			if (!HEX_32.test(transactionHash)) fail('recovery transaction hash is malformed')
			const result = await options.recovery.recoverExact(transactionHash)
			if (result === null) return null
			if (result.txHash !== transactionHash || !Number.isSafeInteger(result.height) || result.height < 1) {
				fail('recovery returned another transaction')
			}
			return { height: result.height, transactionHash: result.txHash }
		},
		async confirmExact(input: Parameters<DemoFridayFundingAbortConsensusPort['confirmExact']>[0]):
			Promise<DemoFridayFundingAbortCommitV1> {
			if (bytesToHex(sha256(input.transaction)) !== input.transactionHash
				|| !Number.isSafeInteger(input.height) || input.height < 1) fail('confirmation input is malformed')
			const [genesis, chainId, commitH2] = await Promise.all([
				options.genesis.readExact(), options.reader.readChainId(), waitCommit(options.reader, input.height + 2),
			])
			if (genesis.chainId !== options.pins.chainId || genesis.genesisSha256 !== options.pins.genesisSha256
				|| chainId !== options.pins.chainId) fail('chain or genesis differs from persisted abort pins')
			const [block, commitH, commitH1, stateResult] = await Promise.all([
				options.reader.readBlock(input.height), options.reader.readCommit(input.height),
				options.reader.readCommit(input.height + 1),
				authenticatedDemoCometState(options.reader, options.validatorsHash, input.height + 2),
			])
			if (block.height !== input.height) fail('transaction block height differs')
			const matching = block.transactions.filter((raw) => bytesToHex(sha256(raw)) === input.transactionHash
				&& Buffer.from(raw).equals(Buffer.from(input.transaction)))
			if (matching.length !== 1) fail('block does not contain one exact abort transaction')
			const commits = [commitH, commitH1, commitH2].map((value, index) =>
				exactDemoCometCommit(value, input.height + index, options.validatorsHash))
			if (block.blockHash !== commits[0]!.blockHash) fail('transaction bytes are not joined to canonical commit H')
			const derived = claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), input.certificate,
				options.pins, '0'.repeat(64), input.height, commits[0]!.blockTime)
			const expected = derived.records[input.certificate.operationId]!
			const state = stateResult.observation.state as unknown as FundingLifecycleState
			const observed = state.funding_lifecycles?.[input.certificate.operationId]
			if (state.chain_id !== options.pins.chainId || observed === undefined
				|| observed.schema !== expected.schema || observed.operationId !== expected.operationId
				|| JSON.stringify(observed.proofYs) !== JSON.stringify(expected.proofYs)
				|| observed.auctionId !== expected.auctionId || observed.actor !== expected.actor
				|| observed.amount !== expected.amount || observed.origin !== 'committed_abort'
				|| observed.status !== 'aborted_return_entitled'
				|| observed.consensusEventId !== expected.abortCertificateDigest
				|| observed.actorAuthorizationEventId !== input.certificate.actorAbortEvent.id
				|| observed.committedHeight !== input.height || observed.committedAt !== commits[0]!.blockTime
				|| observed.reason !== input.certificate.abortReason
				|| observed.abortCertificateDigest !== expected.abortCertificateDigest) {
				fail('authenticated application state lacks the exact committed abort')
			}
			const confirmed: DemoFridayFundingAbortCommitV1 = {
				schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_COMMIT_V1', origin: 'committed_abort',
				operationId: input.certificate.operationId, consensusEventId: expected.abortCertificateDigest!,
				actorAuthorizationEventId: input.certificate.actorAbortEvent.id,
				transactionHash: input.transactionHash, height: input.height, committedAt: commits[0]!.blockTime,
				abortCertificateDigest: expected.abortCertificateDigest!, transactionBlockHash: commits[0]!.blockHash,
				successorHeight: commits[1]!.height, successorBlockHash: commits[1]!.blockHash,
				finalityHeight: commits[2]!.height, finalityBlockHash: commits[2]!.blockHash,
				validatorsHash: options.validatorsHash, commitSignerAddresses: commitH2.commitSignerAddresses,
				stateHeight: stateResult.observation.queryHeight, stateAppHash: stateResult.observation.appHash,
				stateCommitHeight: stateResult.bindingCommit.height,
				stateCommitAppHash: stateResult.bindingCommit.appHash,
			}
			return confirmed
		},
	})
}
