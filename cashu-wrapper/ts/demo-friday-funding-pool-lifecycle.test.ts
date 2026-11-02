import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	claimDemoFridayCommittedAbort, claimDemoFridayCommittedBid,
	demoFridayFundingAbortActorUnsignedEvent, demoFridayFundingAbortCommitteeDigest,
	emptyDemoFridayFundingLifecycleState,
	type DemoFridayFundingAbortCertificateV1, type DemoFridayFundingAbortPinsV1,
} from './demo-friday-funding-pool-lifecycle'

const actorSecret = '1'.padStart(64, '0')
const paymentSecret = '2'.padStart(64, '0')
const refundSecret = '3'.padStart(64, '0')
const committeeSecret = '4'.padStart(64, '0')
const proofSecrets = ['5'.padStart(64, '0'), '6'.padStart(64, '0')]
const compressed = (secret: string) => `02${bytesToHex(schnorr.getPublicKey(hexToBytes(secret)))}`
const xonly = (secret: string) => bytesToHex(schnorr.getPublicKey(hexToBytes(secret)))
const sign = (digest: string, secret: string) => bytesToHex(schnorr.sign(hexToBytes(digest), hexToBytes(secret)))
const hex = (value: string) => value.repeat(64).slice(0, 64)

const pins: DemoFridayFundingAbortPinsV1 = {
	authNetworkId: 'friday-demo', chainId: 'friday-chain', genesisSha256: hex('a'),
	mintUrl: 'https://172.105.64.142', activeKeysetId: 'zero-fee',
	committeePublicKey: compressed(committeeSecret), committeeKeysetId: 'committee-1',
	committeeKeysetVersion: '1', dkgRunId: 'dkg-1', publicKeyPackageSha256: hex('b'),
	signerRosterDigest: hex('c'),
}

function signedCertificate(overrides: Partial<DemoFridayFundingAbortCertificateV1> = {}): DemoFridayFundingAbortCertificateV1 {
	const actorUnsigned = {
		schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_V1' as const,
		authNetworkId: pins.authNetworkId, chainId: pins.chainId, genesisSha256: pins.genesisSha256,
		auctionId: 'auction-1', operationId: 'funding-1', actor: xonly(actorSecret), mintUrl: pins.mintUrl,
		activeKeysetId: pins.activeKeysetId, amount: 2_500, proofYs: proofSecrets.map(compressed).sort(),
		poolDigest: hex('d'), nut11LockPublicKeys: [compressed(paymentSecret), compressed(committeeSecret)] as [string, string],
		locktime: 9_400, paymentPublicKey: compressed(paymentSecret), refundPublicKey: compressed(refundSecret),
		committeePublicKey: pins.committeePublicKey, returnPackageDigest: hex('e'),
		returnCashuSigAllDigest: hex('f'), bidderReturnSignature: sign(hex('f'), paymentSecret),
		fundingAuthorizationEventId: hex('7'), abortNotBefore: 1_000, abortExpiresAt: 5_200,
		abortReason: 'prebroadcast_service_failure' as const, committeeKeysetId: pins.committeeKeysetId,
		committeeKeysetVersion: pins.committeeKeysetVersion, dkgRunId: pins.dkgRunId,
		publicKeyPackageSha256: pins.publicKeyPackageSha256, signerRosterDigest: pins.signerRosterDigest,
	}
	const actorFields = { ...actorUnsigned, ...Object.fromEntries(Object.entries(overrides)
		.filter(([key]) => !['participantPolicyDigest', 'actorAbortEvent', 'committeeAbortSignature'].includes(key))) }
	const participantPolicyDigest = overrides.participantPolicyDigest ?? hex('8')
	const actorUnsignedEvent = demoFridayFundingAbortActorUnsignedEvent(actorFields, 900)
	const actorEventId = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
		0, actorUnsignedEvent.pubkey, actorUnsignedEvent.created_at, actorUnsignedEvent.kind,
		actorUnsignedEvent.tags, actorUnsignedEvent.content,
	]))))
	const actorAbortEvent = overrides.actorAbortEvent ?? {
		...actorUnsignedEvent, id: actorEventId, sig: sign(actorEventId, actorSecret),
	}
	const committeeUnsigned = { ...actorFields, participantPolicyDigest, actorAbortEvent }
	return {
		...committeeUnsigned,
		committeeAbortSignature: overrides.committeeAbortSignature
			?? sign(demoFridayFundingAbortCommitteeDigest(committeeUnsigned), committeeSecret),
	} as DemoFridayFundingAbortCertificateV1
}

const bidClaim = (operationId = 'funding-1', proofYs = proofSecrets.map(compressed).sort()) => ({
	schema: 'PLEBEIAN_FRIDAY_COMMITTED_BID_CLAIM_V1' as const, operationId, proofYs,
	auctionId: 'auction-1', actor: xonly(actorSecret), amount: 2_500, eventId: hex('1'), status: 'active' as const,
})

describe('inert FundingAbortV1 consensus contract', () => {
	test('abort-first permanently excludes a delayed pre-signed bid', () => {
		const aborted = claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), signedCertificate(), pins,
			hex('2'), 40, 1_200)
		expect(aborted.records['funding-1']).toMatchObject({ origin: 'committed_abort',
			status: 'aborted_return_entitled', reason: 'prebroadcast_service_failure' })
		expect(() => claimDemoFridayCommittedBid(aborted, bidClaim(), 41, 1_201)).toThrow(/already has a committed/)
	})

	test('bid-first rejects abort and proof aliases remain globally excluded across operations', () => {
		const admitted = claimDemoFridayCommittedBid(emptyDemoFridayFundingLifecycleState(), bidClaim(), 40, 1_200)
		expect(() => claimDemoFridayCommittedAbort(admitted, signedCertificate(), pins, hex('2'), 41, 1_201))
			.toThrow(/already has a committed/)
		const alias = signedCertificate({ operationId: 'funding-2' })
		expect(() => claimDemoFridayCommittedAbort(admitted, alias, pins, hex('3'), 41, 1_201))
			.toThrow(/proof already belongs/)
		expect(() => claimDemoFridayCommittedBid(emptyDemoFridayFundingLifecycleState(),
			{ ...bidClaim(), status: 'other' } as never, 40, 1_200)).toThrow(/status|fields differ/)
		expect(() => claimDemoFridayCommittedBid(emptyDemoFridayFundingLifecycleState(),
			{ ...bidClaim(), unexpected: true } as never, 40, 1_200)).toThrow(/fields differ/)
	})

	test('rejects mutation, wrong deployment, expiry and wrong NUT-11 roles', () => {
		expect(() => claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(),
			{ ...signedCertificate(), amount: 2_501 }, pins, hex('2'), 40, 1_200)).toThrow(/actor did not authorize/)
		expect(() => claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), signedCertificate(),
			{ ...pins, genesisSha256: hex('0') }, hex('2'), 40, 1_200)).toThrow(/fixed deployment/)
		expect(() => claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), signedCertificate(),
			pins, hex('2'), 40, 5_201)).toThrow(/validity/)
		const wrongLock = signedCertificate({ nut11LockPublicKeys: [compressed(refundSecret), compressed(committeeSecret)] })
		expect(() => claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), wrongLock,
			pins, hex('2'), 40, 1_200)).toThrow(/NUT-11/)
	})

	test('rejects cross-domain signatures and altered roster or participant policy', () => {
		const certificate = signedCertificate()
		expect(() => claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), {
			...certificate, committeeAbortSignature: certificate.actorAbortEvent.sig,
		}, pins, hex('2'), 40, 1_200)).toThrow(/committee did not authorize/)
		expect(() => claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), {
			...certificate, signerRosterDigest: hex('0'),
		}, pins, hex('2'), 40, 1_200)).toThrow(/fixed deployment/)
		expect(() => claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), {
			...certificate, participantPolicyDigest: hex('9'),
		}, pins, hex('2'), 40, 1_200)).toThrow(/committee did not authorize/)
	})
})
