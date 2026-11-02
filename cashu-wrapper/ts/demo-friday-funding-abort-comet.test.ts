import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import type { DemoParticipantConsensusReader } from './demo-comet-displacement-verifier'
import {
	createDemoFridayFundingAbortComet,
	createDemoFridayFundingAbortFinalityVerifier,
} from './demo-friday-funding-abort-comet'
import {
	claimDemoFridayCommittedAbort,
	demoFridayFundingAbortActorUnsignedEvent,
	demoFridayFundingAbortCommitteeDigest,
	emptyDemoFridayFundingLifecycleState,
	type DemoFridayFundingAbortCertificateV1,
	type DemoFridayFundingAbortPinsV1,
} from './demo-friday-funding-pool-lifecycle'

const H = 40
const hex = (value: string) => value.repeat(64).slice(0, 64)
const secret = (value: string) => value.padStart(64, '0')
const xonly = (value: string) => bytesToHex(schnorr.getPublicKey(hexToBytes(secret(value))))
const compressed = (value: string) => `02${xonly(value)}`
const sign = (value: string, key: string) => bytesToHex(schnorr.sign(hexToBytes(value), hexToBytes(secret(key))))
const pins: DemoFridayFundingAbortPinsV1 = {
	authNetworkId: 'friday-demo', chainId: 'friday-chain', genesisSha256: hex('a'),
	mintUrl: 'https://172.105.64.142', activeKeysetId: 'zero-fee', committeePublicKey: compressed('4'),
	committeeKeysetId: 'committee-1', committeeKeysetVersion: '1', dkgRunId: 'dkg-1',
	publicKeyPackageSha256: hex('b'), signerRosterDigest: hex('c'),
}

function certificate(): DemoFridayFundingAbortCertificateV1 {
	const actorTerms = {
		schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_V1' as const, ...pins, auctionId: 'auction-1',
		operationId: 'funding-1', actor: xonly('1'), amount: 2_500,
		proofYs: [compressed('5'), compressed('6')].sort(), poolDigest: hex('d'),
		nut11LockPublicKeys: [compressed('2'), compressed('4')] as [string, string], locktime: 9_400,
		paymentPublicKey: compressed('2'), refundPublicKey: compressed('3'), returnPackageDigest: hex('e'),
		returnCashuSigAllDigest: hex('f'), bidderReturnSignature: sign(hex('f'), '2'),
		fundingAuthorizationEventId: hex('7'), abortNotBefore: 1_000, abortExpiresAt: 5_200,
		abortReason: 'prebroadcast_service_failure' as const,
	}
	const unsignedEvent = demoFridayFundingAbortActorUnsignedEvent(actorTerms, 1_100)
	const id = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
		0, unsignedEvent.pubkey, unsignedEvent.created_at, unsignedEvent.kind, unsignedEvent.tags, unsignedEvent.content,
	]))))
	const actorAbortEvent = { ...unsignedEvent, id, sig: sign(id, '1') }
	const participantPolicyDigest = hex('8')
	const unsigned = { ...actorTerms, participantPolicyDigest, actorAbortEvent }
	return { ...unsigned, committeeAbortSignature: sign(demoFridayFundingAbortCommitteeDigest(unsigned), '4') }
}

function harness(options: { mutateState?: boolean; omitTransaction?: boolean } = {}) {
	const cert = certificate()
	const raw = new TextEncoder().encode(JSON.stringify({ version: 1, type: 'funding_abort', funding_abort: cert }))
	const txHash = bytesToHex(sha256(raw))
	const derived = claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), cert, pins,
		'0'.repeat(64), H, 1_201).records[cert.operationId]!
	const record = {
		...derived, consensusEventId: derived.abortCertificateDigest!,
		actorAuthorizationEventId: cert.actorAbortEvent.id,
		...(options.mutateState ? { proofYs: [compressed('7')] } : {}),
	}
	const state = {
		chain_id: pins.chainId, height: H + 2, auctions: {}, bids: {}, integrated_fundings: {},
		integrated_displacements: {}, funding_lifecycles: { [cert.operationId]: record },
	}
	const stateBytes = new TextEncoder().encode(JSON.stringify(state))
	const stateHash = bytesToHex(sha256(stateBytes))
	const validatorsHash = hex('9')
	const reader: DemoParticipantConsensusReader = {
		async readChainId() { return pins.chainId },
		async readBlock(height) { return { height, blockHash: height.toString(16).padStart(64, '0'),
			transactions: options.omitTransaction ? [] : [raw] } },
		async readCommit(height) { return { height, blockTime: 1_201,
			blockHash: height.toString(16).padStart(64, '0'), appHash: height === H + 3 ? stateHash : hex('1'),
			validatorsHash, commitSignerAddresses: ['A'.repeat(40), 'B'.repeat(40), 'C'.repeat(40)] } },
		async readCurrentState() { return { queryHeight: H + 2, appHash: stateHash,
			canonicalStateBytes: stateBytes, state: state as never } },
	}
	const adapter = createDemoFridayFundingAbortComet({ pins, validatorsHash, reader,
		genesis: { async readExact() { return { schema: 'PLEBEIAN_FRIDAY_PINNED_GENESIS_IDENTITY_V1',
			chainId: pins.chainId, genesisSha256: pins.genesisSha256 } } },
		broadcaster: { async broadcastAndWait() { return { height: H, txHash } } },
		recovery: { async recoverExact(value) { return value === txHash ? { height: H, txHash } : null } },
	})
	const finality = createDemoFridayFundingAbortFinalityVerifier({ pins, validatorsHash, reader })
	return { adapter, finality, cert, raw, txHash }
}

describe('FundingAbortV1 pinned Comet adapter', () => {
	test('binds exact transaction, H/H+1/H+2 and authenticated lifecycle state', async () => {
		const value = harness()
		await expect(value.adapter.broadcastExact(value.raw)).resolves.toEqual({ height: H, transactionHash: value.txHash })
		await expect(value.adapter.recoverExact(value.txHash)).resolves.toEqual({ height: H, transactionHash: value.txHash })
		await expect(value.adapter.confirmExact({ certificate: value.cert, transaction: value.raw,
			transactionHash: value.txHash, height: H })).resolves.toMatchObject({
			origin: 'committed_abort', height: H, finalityHeight: H + 2,
			actorAuthorizationEventId: value.cert.actorAbortEvent.id,
		})
	})

	test('rejects missing transaction or mutated authenticated lifecycle state', async () => {
		const missing = harness({ omitTransaction: true })
		await expect(missing.adapter.confirmExact({ certificate: missing.cert, transaction: missing.raw,
			transactionHash: missing.txHash, height: H })).rejects.toThrow(/one exact abort transaction/)
		const mutated = harness({ mutateState: true })
		await expect(mutated.adapter.confirmExact({ certificate: mutated.cert, transaction: mutated.raw,
			transactionHash: mutated.txHash, height: H })).rejects.toThrow(/exact committed abort/)
	})

	test('reconstructs terminal authority only from the exact committed abort identity', async () => {
		const value = harness()
		const derived = claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), value.cert, pins,
			'0'.repeat(64), H, 1_201).records[value.cert.operationId]!
		await expect(value.finality.verifyExact({ operationId: value.cert.operationId,
			consensusEventId: derived.abortCertificateDigest!, height: H })).resolves.toMatchObject({
			certificate: { operationId: value.cert.operationId },
			commit: { origin: 'committed_abort', height: H, finalityHeight: H + 2 },
		})
		await expect(value.finality.verifyExact({ operationId: 'funding-other',
			consensusEventId: derived.abortCertificateDigest!, height: H })).rejects.toThrow(/lacks one exact/)
		await expect(value.finality.verifyExact({ operationId: value.cert.operationId,
			consensusEventId: hex('0'), height: H })).rejects.toThrow(/lacks one exact/)
	})
})
