import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { HDKey } from '@scure/bip32'

import {
	demoAuthSignerPublicKey,
	signDemoAuthEventId,
} from './index'
import {
	prepareDemoSigAllFunding,
	requestDemoSigAllFundingQuote,
	mintDemoSigAllFundingOutputs,
	type DemoSigAllFundingIntent,
} from './demo-sigall-funding'
import {
	createFourSeparatedFrostProcessPorts,
	type DemoFrostProcessParticipant,
} from './demo-frost-process-boundary'
import {
	validateDemoFrostParticipantPolicy,
	type DemoFrostParticipantPolicyPackage,
} from './demo-frost-participant-policy'
import {
	createFourOfFourCommitteePort,
	demoCashuSigAllDigest,
	demoDenominationKeyDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
	demoSigAllPackageDigest,
	type DemoParticipantId,
	type DemoSigAllContract,
	type DemoSigAllMintPort,
} from './demo-sigall-settlement'
import {
	prepareDemoSigAllRecipientOutputs,
	type DemoRecipientIntent,
	type DemoRecipientKeyset,
	type DemoRecipientPrivateJournalPort,
	type DemoRecipientPrivateRecord,
} from './demo-sigall-recipient'
import type { DemoSigAllRecoveryRecord, DemoSigAllRecoveryStore } from './demo-sigall-recovery'
import {
	blindMessage,
	proofPoint,
	unblindBlindedSignature,
	type BlindedMessage,
	type BlindedSignature,
	type BlindingData,
	type CashuProof,
} from './nut-client'
import { deriveSellerChildPubkey } from './seller-child'

import {
	DEMO_CERTIFIED_CLOSURE_DOMAIN,
	DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA,
	DEMO_CERTIFIED_CLOSURE_SCHEMA,
	computeCertifiedClosureDigest,
	computeCertifiedClosureHistoryRoot,
	type DemoCertifiedClosureCertificateV1,
	type DemoCertifiedClosureHistoryBatchV1,
	type DemoCertifiedClosurePayloadV1,
	type DemoCertifiedClosurePolicy,
} from '../../market-app/plugins/demo-certified-closure'
import {
	createBrowserDemoWalletLocalBidApprovalPort,
	executeDemoCertifiedWalletAutomaticClose,
	type DemoBrowserOriginLockManager,
	type DemoBrowserWalletApprovalStorage,
	type DemoWalletLocalBidApproval,
} from '../../market-app/plugins/demo-certified-wallet-adapter'
import {
	canonicalBidCommand,
	canonicalIntentV1,
	demoIntentIdentifiers,
	parseDemoAuthUiConfig,
	parseDemoFundingApproval,
	reservationId,
	TEST_ONLY_LABEL,
	TEST_UNIT_LABEL,
	type DemoSignedEvent,
	type DemoUnsignedEvent,
} from '../../market-app/ts/demo-auth-bid'

/**
 * Executable offline acceptance only. It proves composition and fail-closed boundaries with local
 * cryptography; it is not live Testnut evidence, independent validator consensus, DKG, or FROST.
 */

const scalarHex = (value: number): string => value.toString(16).padStart(64, '0')
const publicKey = (privateKey: string): string => bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), true))
const xOnly = (privateKey: string): string => demoAuthSignerPublicKey(privateKey)
const signDigest = (digest: string, privateKey: string): string => bytesToHex(schnorr.sign(
	hexToBytes(digest),
	hexToBytes(privateKey),
	new Uint8Array(32),
))
const hash = (value: unknown): string => bytesToHex(sha256(utf8ToBytes(JSON.stringify(value))))

const NETWORK = 'a'.repeat(64)
const CHAIN = 'demo-chain'
const AUCTION = 'auction-1'
const CREATED_AT = 1_900_000_000
const BASE_END = 1_900_000_030
const CLOSE_TIME = 1_900_000_050
const LOCKTIME = BASE_END + 1_920
const NOW_SECONDS = CLOSE_TIME + 1
const MINT = 'https://testnut.cashu.space' as const
const SELLER_ROOT = HDKey.fromMasterSeed(new Uint8Array(32).fill(0x42))
const SELLER_XPUB = SELLER_ROOT.publicExtendedKey
const COMMITTEE_PRIVATE = scalarHex(90)
const COMMITTEE_PUBLIC = publicKey(COMMITTEE_PRIVATE)
const DENOMINATION_PRIVATE: Record<string, string> = {
	'1': scalarHex(101), '2': scalarHex(102), '4': scalarHex(104), '8': scalarHex(108), '16': scalarHex(116),
}
const DENOMINATION_KEYS = Object.fromEntries(Object.entries(DENOMINATION_PRIVATE).map(([amount, key]) => [amount, publicKey(key)]))
const KEYSET_ID = publicKey(scalarHex(120))
const KEYSET: DemoRecipientKeyset = { id: KEYSET_ID, unit: 'sat', keys: DENOMINATION_KEYS }
const MINT_SEAL = {
	mintUrl: MINT,
	mintPublicKey: publicKey(scalarHex(121)),
	serverVersion: 'offline-acceptance/1',
	activeSatKeysetId: KEYSET_ID,
	denominationKeyDigest: demoDenominationKeyDigest(DENOMINATION_KEYS),
	denominationAmounts: [1, 2, 4, 8, 16],
	inputFeePpk: 0,
	nuts: [4, 7, 9, 10, 11, 12],
}

interface OfflineProfile {
	profileId: string
	accountId: string
	storageNamespace: string
	actorPrivate: string
	walletPrivate: string
	refundPrivate: string
	target: number
	state: Map<string, unknown>
	proofs: CashuProof[]
}

const profileInputs: Array<Omit<OfflineProfile, 'state' | 'proofs'>> = [
	{ profileId: 'seller', accountId: 'acct-seller', storageNamespace: 'iso-seller', actorPrivate: scalarHex(1), walletPrivate: scalarHex(11), refundPrivate: scalarHex(21), target: 1 },
	{ profileId: 'initial-bidder', accountId: 'acct-initial', storageNamespace: 'iso-initial', actorPrivate: scalarHex(2), walletPrivate: scalarHex(12), refundPrivate: scalarHex(22), target: 8 },
	{ profileId: 'rebid-winner', accountId: 'acct-rebid', storageNamespace: 'iso-rebid', actorPrivate: scalarHex(3), walletPrivate: scalarHex(13), refundPrivate: scalarHex(23), target: 16 },
	{ profileId: 'standby', accountId: 'acct-standby', storageNamespace: 'iso-standby', actorPrivate: scalarHex(4), walletPrivate: scalarHex(14), refundPrivate: scalarHex(24), target: 4 },
	{ profileId: 'committee-coordinator', accountId: 'acct-committee', storageNamespace: 'iso-committee', actorPrivate: scalarHex(5), walletPrivate: scalarHex(15), refundPrivate: scalarHex(25), target: 2 },
]

function validatedFiveProfileConfig(): ReturnType<typeof parseDemoAuthUiConfig> {
	const profiles = profileInputs.map((profile) => ({
		profileId: profile.profileId,
		accountId: profile.accountId,
		storageNamespace: profile.storageNamespace,
		signerPubkey: xOnly(profile.actorPrivate),
	}))
	const fundingProfiles = profileInputs.map((profile) => ({
		profileId: profile.profileId,
		approvedAmounts: [profile.target],
		fundingQuoteCap: 1,
		mintCompletionCap: 1,
	}))
	const mintSnapshot = {
		mintPublicKey: MINT_SEAL.mintPublicKey,
		serverVersion: MINT_SEAL.serverVersion,
		activeSatKeysetId: KEYSET_ID,
		denominationKeyDigest: MINT_SEAL.denominationKeyDigest,
		inputFeePpk: 0,
		advertisedNuts: [...MINT_SEAL.nuts],
		requiredNuts: [4, 7, 9, 10, 11, 12],
	}
	const approval = parseDemoFundingApproval(JSON.stringify({
		mintUrl: MINT,
		mintSnapshot,
		profiles: fundingProfiles,
	}))
	return parseDemoAuthUiConfig(JSON.stringify({
		schema: 'DemoAuthUiConfigV1',
		bridgeBasePath: '/offline-acceptance',
		profile: 'DEMO_AUTH_V1',
		authNetworkId: NETWORK,
		chainId: CHAIN,
		auctionId: AUCTION,
		mintUrl: MINT,
		mintSnapshot,
		sellerP2pkXpub: SELLER_XPUB,
		baseEnd: BASE_END,
		locktime: LOCKTIME,
		startingBid: 1,
		sessionSubmissionCap: 20,
		testOnlyLabel: TEST_ONLY_LABEL,
		walletUnitLabel: TEST_UNIT_LABEL,
		profiles,
		funding: { enabled: true, profiles: fundingProfiles },
	}), approval)
}

function blindSign(output: BlindedMessage): BlindedSignature {
	const privateKey = DENOMINATION_PRIVATE[String(output.amount)]
	if (privateKey === undefined) throw new Error(`offline-denomination-missing:${output.amount}`)
	const C_ = secp256k1.Point.fromHex(output.B_).multiply(BigInt(`0x${privateKey}`))
	return { amount: output.amount, id: output.id, C_: bytesToHex(C_.toBytes(true)) }
}

function proofIsValid(proof: CashuProof): boolean {
	const privateKey = DENOMINATION_PRIVATE[String(proof.amount)]
	if (privateKey === undefined) return false
	return secp256k1.Point.fromHex(proof.C).equals(proofPoint(proof).multiply(BigInt(`0x${privateKey}`)))
}

async function fundProfiles(): Promise<OfflineProfile[]> {
	const profiles: OfflineProfile[] = profileInputs.map((profile) => ({ ...profile, state: new Map(), proofs: [] }))
	for (const [index, profile] of profiles.entries()) {
		const intent: DemoSigAllFundingIntent = {
			schema: 'COCO_DEMO_SIGALL_FUNDING_INTENT_V1',
			environment: 'test-only',
			operationId: `explicit-offline-funding-${profile.profileId}`,
			mintUrl: MINT,
			unit: 'sat',
			paymentMethod: 'bolt11',
			amount: profile.target,
			mintAdvertisedMinAmount: 1,
			mintAdvertisedMaxAmount: 120,
			approvedMaxAmount: profile.target,
			approvedMaxOutputs: 4,
			createdAt: CREATED_AT,
			locktime: LOCKTIME,
			bidderPublicKey: publicKey(profile.walletPrivate),
			committeePublicKey: COMMITTEE_PUBLIC,
			refundPublicKey: publicKey(profile.refundPrivate),
			mintSeal: MINT_SEAL,
		}
		const prepared = prepareDemoSigAllFunding({
			intent,
			denominationKeys: DENOMINATION_KEYS,
			nextNonce: (outputIndex) => (index * 8 + outputIndex + 1).toString(16).padStart(64, '0'),
			nextBlindingScalar: (outputIndex) => BigInt(index * 8 + outputIndex + 201),
		})
		const quote = await requestDemoSigAllFundingQuote(prepared, {
			async createQuote(request) {
				return {
					schema: 'COCO_DEMO_SIGALL_FUNDING_QUOTE_V1',
					fundingRoot: request.fundingRoot,
					quoteId: `offline-paid-${profile.profileId}`,
					paymentRequest: `offline-test-units-only-${profile.profileId}`,
					mintUrl: MINT,
					unit: 'sat',
					paymentMethod: 'bolt11',
					amount: profile.target,
					state: 'PAID',
				}
			},
		}, CREATED_AT + 1)
		const funded = await mintDemoSigAllFundingOutputs({
			prepared,
			paidQuote: quote,
			mintPort: { async mintExact(request) { return { signatures: request.outputs.map(blindSign) } } },
			proofVerifier: { async verifyExact(request) { return proofIsValid(request.proof) } },
			nowSeconds: CREATED_AT + 2,
		})
		profile.proofs = funded.proofs
		profile.state.set('fundingRoot', funded.fundingRoot)
		profile.state.set('quoteId', funded.quoteId)
	}
	return profiles
}

async function signBidEvent(profile: OfflineProfile, operationId: string, bidId: string, amount: number, proof: CashuProof): Promise<DemoSignedEvent> {
	const ref = bytesToHex(proofPoint(proof).toBytes(true))
	const rid = await reservationId(MINT, ref)
	const content = canonicalBidCommand(operationId, AUCTION, bidId, amount, [{
		amount,
		keysetId: KEYSET_ID,
		amountKey: DENOMINATION_KEYS[String(amount)]!,
		inputFeePpk: 0,
		reservationId: rid,
		active: true,
	}])
	const unsigned: DemoUnsignedEvent = {
		pubkey: xOnly(profile.actorPrivate),
		created_at: CREATED_AT + amount,
		kind: 28642,
		tags: [
			['protocol', 'plebeian-auction-auth-demo'],
			['version', '1'],
			['environment', NETWORK],
			['valid_until', String(CREATED_AT + 300)],
		],
		content,
	}
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content]))))
	return { ...unsigned, id, sig: signDemoAuthEventId(id, profile.actorPrivate) }
}

interface BidFixture {
	profile: OfflineProfile
	path: string
	operationId: string
	bidId: string
	signedBid: DemoSignedEvent
	proof: CashuProof
	proofStateRef: string
	sellerChildPublicKey: string
	sellerChildPrivateKey: string
}

async function makeBid(profile: OfflineProfile, path: string): Promise<BidFixture> {
	const proof = profile.proofs[0]!
	const amount = proof.amount
	const sellerChild = SELLER_ROOT.derive(path)
	const sellerChildPublicKey = bytesToHex(sellerChild.publicKey!)
	const sellerChildPrivateKey = bytesToHex(sellerChild.privateKey!)
	const canonical = canonicalIntentV1({
		authNetworkId: NETWORK,
		actorPubkey: xOnly(profile.actorPrivate),
		auctionId: AUCTION,
		amount,
		mintUrl: MINT,
		sellerP2pkXpub: SELLER_XPUB,
		locktime: LOCKTIME,
		childPubkey: sellerChildPublicKey,
	})
	const identifiers = await demoIntentIdentifiers(canonical)
	const signedBid = await signBidEvent(profile, identifiers.operationId, identifiers.bidId, amount, proof)
	return {
		profile, path,
		operationId: identifiers.operationId,
		bidId: identifiers.bidId,
		signedBid,
		proof,
		proofStateRef: bytesToHex(proofPoint(proof).toBytes(true)),
		sellerChildPublicKey,
		sellerChildPrivateKey,
	}
}

class RecipientJournal implements DemoRecipientPrivateJournalPort<BlindingData> {
	private record: DemoRecipientPrivateRecord<BlindingData> | null = null
	async runExclusive<T>(_scope: string, run: () => Promise<T>): Promise<T> { return run() }
	async load(_scope: string) { return this.record === null ? null : structuredClone(this.record) }
	async savePrepared(_scope: string, record: DemoRecipientPrivateRecord<BlindingData>) { this.record = structuredClone(record) }
	async markImported(_scope: string, requestDigest: string, responseDigest: string) {
		if (this.record === null || this.record.requestDigest !== requestDigest) throw new Error('recipient-journal-conflict')
		this.record.importedResponseDigest = responseDigest
	}
}

function recoveryStore(rows = new Map<string, DemoSigAllRecoveryRecord>()): DemoSigAllRecoveryStore {
	return {
		async createOrGet(record) {
			const existing = rows.get(record.scope)
			if (existing !== undefined) return { record: structuredClone(existing), created: false }
			rows.set(record.scope, structuredClone(record)); return { record: structuredClone(record), created: true }
		},
		async read(scope) { const found = rows.get(scope); return found === undefined ? null : structuredClone(found) },
		async compareAndSwap(scope, expectedRevision, next) {
			const current = rows.get(scope)
			if (current === undefined || current.revision !== expectedRevision || next.revision !== expectedRevision + 1) return false
			rows.set(scope, structuredClone(next)); return true
		},
	}
}

async function recipientFor(options: {
	bid: BidFixture
	role: 'winner_settlement' | 'refund'
	recipientPrivate: string
	walletReceipts: Array<{ operationId: string; role: string; proofs: CashuProof[] }>
}) {
	const recipientPublicKey = publicKey(options.recipientPrivate)
	const intent: DemoRecipientIntent = {
		schema: 'COCO_DEMO_RECIPIENT_INTENT_V1', network: NETWORK, chainId: CHAIN, auctionId: AUCTION,
		operationId: options.bid.operationId, role: options.role, mintUrl: MINT, unit: 'sat', recipientPublicKey,
		amounts: [options.bid.proof.amount],
	}
	const journal = new RecipientJournal()
	const roleBinding = {
		async assertWinnerRecipient(binding: { recipientPublicKey: string }) {
			if (options.role !== 'winner_settlement' || binding.recipientPublicKey !== options.bid.sellerChildPublicKey) throw new Error('winner-role-binding')
		},
		async assertRefundRecipient(binding: { recipientPublicKey: string }) {
			if (options.role !== 'refund' || binding.recipientPublicKey !== publicKey(options.bid.profile.refundPrivate)) throw new Error('refund-role-binding')
		},
	}
	const request = await prepareDemoSigAllRecipientOutputs({
		intent,
		keyset: KEYSET,
		roleBinding,
		signer: { async signCapability(value) { return signDigest(value.digest, options.recipientPrivate) } },
		outputFactory: {
			async createRecipientOwnedOutput(value) {
				const opening = blindMessage(`offline-recipient-${value.operationId}-${value.index}`, BigInt(400 + value.amount))
				return { message: { amount: value.amount, id: value.keysetId, B_: opening.B_ }, privateOpeningRef: opening }
			},
		},
		journal,
	})
	return {
		request,
		ports: {
			intent, keyset: KEYSET, roleBinding, journal,
			unblinder: {
				async unblindExact(value: { signatures: BlindedSignature[]; privateOpeningRefs: BlindingData[] }) {
					return value.signatures.map((signature, index) => unblindBlindedSignature(signature, value.privateOpeningRefs[index]!, DENOMINATION_KEYS[String(signature.amount)]!))
				},
			},
			verifier: {
				async verifyExact(value: { unblindedRef: CashuProof[] }) {
					if (!value.unblindedRef.every(proofIsValid)) throw new Error('recipient-proof-invalid')
					return value.unblindedRef.map((proof) => ({ ...proof }))
				},
			},
			wallet: {
				async importVerified(value: { operationId: string; role: string; verifiedRef: CashuProof[] }) {
					options.walletReceipts.push({ operationId: value.operationId, role: value.role, proofs: value.verifiedRef.map((proof) => ({ ...proof })) })
				},
			},
		},
	}
}

async function contractFor(options: {
	bid: BidFixture
	role: 'winner_settlement' | 'refund'
	recipientPrivate: string
	walletReceipts: Array<{ operationId: string; role: string; proofs: CashuProof[] }>
}) {
	const recipient = await recipientFor(options)
	const participants = [1, 2, 3, 4].map((identifier) => ({
		identifier: identifier as DemoParticipantId,
		verifyingShare: publicKey(scalarHex(150 + identifier)),
	})) as DemoSigAllContract['participants']
	const contract: DemoSigAllContract = {
		schema: 'COCO_DEMO_SIGALL_CONTRACT_V1', network: NETWORK, chainId: CHAIN, auctionId: AUCTION,
		operationId: options.bid.operationId, bidId: options.bid.bidId, bidEventId: options.bid.signedBid.id,
		bidderActorId: options.bid.signedBid.pubkey, role: options.role, outcomeHeight: 5, appStateHash: 'e'.repeat(64),
		amount: options.bid.proof.amount, inputFee: 0, mintUrl: MINT, unit: 'sat', sellerP2pkXpub: SELLER_XPUB,
		bidderDerivationPath: options.bid.path, recipientPublicKey: publicKey(options.recipientPrivate), mintSeal: MINT_SEAL,
		inputs: [{ ...options.bid.proof }], outputs: recipient.request.outputs.map((output) => ({ ...output })),
		bidderPublicKey: publicKey(options.bid.profile.walletPrivate), committeePublicKey: COMMITTEE_PUBLIC,
		committeeKeysetId: 'offline-four-process-keyset', committeeKeysetVersion: '1', threshold: 4, participants,
		recipientCapability: { ...recipient.request.capability },
		approval: {
			schema: 'COCO_DEMO_SIGALL_BIDDER_APPROVAL_V1', packageDigest: '00'.repeat(32), cashuSigAllDigest: '00'.repeat(32),
			actorPackageSignature: '00'.repeat(64), packageSignature: '00'.repeat(64), cashuSignature: '00'.repeat(64),
		},
	}
	const packageDigest = demoSigAllPackageDigest(contract)
	const cashuDigest = demoCashuSigAllDigest(contract.inputs, contract.outputs)
	contract.approval = {
		schema: 'COCO_DEMO_SIGALL_BIDDER_APPROVAL_V1', packageDigest, cashuSigAllDigest: cashuDigest,
		actorPackageSignature: signDemoAuthEventId(packageDigest, options.bid.profile.actorPrivate),
		packageSignature: signDemoAuthEventId(packageDigest, options.bid.profile.walletPrivate),
		cashuSignature: signDemoAuthEventId(cashuDigest, options.bid.profile.walletPrivate),
	}
	const rid = await reservationId(MINT, options.bid.proofStateRef)
	const approval: DemoWalletLocalBidApproval = {
		schema: 'COCO_DEMO_WALLET_LOCAL_BID_APPROVAL_V1', custodyBoundary: 'bidder-wallet-local', signedBid: options.bid.signedBid,
		operationId: options.bid.operationId, bidId: options.bid.bidId, bidEventId: options.bid.signedBid.id,
		bidderActorId: options.bid.signedBid.pubkey, bidderPublicKey: publicKey(options.bid.profile.walletPrivate),
		refundPublicKey: publicKey(options.bid.profile.refundPrivate),
		amount: options.bid.proof.amount, inputFee: 0, locktime: LOCKTIME, sellerP2pkXpub: SELLER_XPUB,
		sellerChildPublicKey: options.bid.sellerChildPublicKey,
		reservations: [{ reservationId: rid, principalAmount: options.bid.proof.amount, proofStateRef: options.bid.proofStateRef }],
		inputAmounts: [options.bid.proof.amount], packageDigest, cashuSigAllDigest: cashuDigest,
		recipientCapabilityDigest: demoRecipientCapabilityDigest(contract.recipientCapability), outputsDigest: demoOutputsDigest(contract.outputs),
	}
	return { contract, approval, recipient: recipient.ports }
}

function policyFor(contract: DemoSigAllContract, evidenceDigest: string): DemoFrostParticipantPolicyPackage {
	const locktime = LOCKTIME
	return {
		schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_V1', network: contract.network, chainId: contract.chainId,
		auctionId: contract.auctionId, operationId: contract.operationId, bidId: contract.bidId,
		bidEventId: contract.bidEventId, bidderActorId: contract.bidderActorId, role: contract.role,
		outcomeHeight: contract.outcomeHeight, appStateHash: contract.appStateHash, amount: contract.amount,
		inputFee: contract.inputFee, inputFeePpk: 0, mintUrl: contract.mintUrl, unit: 'sat', activeKeysetId: KEYSET_ID,
		locktime, bidderPublicKey: contract.bidderPublicKey, committeePublicKey: contract.committeePublicKey,
		sellerRecipientPublicKey: deriveSellerChildPubkey(contract.sellerP2pkXpub, contract.bidderDerivationPath),
		recipientPublicKey: contract.recipientPublicKey,
		deposits: contract.inputs.map((input) => ({ proofStateRef: bytesToHex(proofPoint(input).toBytes(true)), amount: input.amount, keysetId: input.id })),
		committeeLockedProofs: contract.inputs.map(({ amount, id, secret, C }) => ({ amount, id, secret, C })),
		outputs: contract.outputs.map((output) => ({ ...output })), packageDigest: demoSigAllPackageDigest(contract),
		cashuSigAllDigest: demoCashuSigAllDigest(contract.inputs, contract.outputs),
		actorPackageAuthorization: { actorId: contract.bidderActorId, packageDigest: demoSigAllPackageDigest(contract), signature: contract.approval.actorPackageSignature },
		recipientCapability: { ...contract.recipientCapability },
		certifiedClosure: { evidenceDigest, evidence: { schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V1', source: 'participant-local' } },
		signedBid: { evidenceDigest: hash(contract.bidEventId), evidence: { schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_SIGNED_BID_EVIDENCE_V1', source: 'participant-local' } },
	}
}

function committeeFor(contract: DemoSigAllContract, evidenceDigest: string, withheld: DemoParticipantId | null = null) {
	const policy = policyFor(contract, evidenceDigest)
	const participants = [1, 2, 3, 4].map((numericId): DemoFrostProcessParticipant => {
		const participantId = numericId as DemoParticipantId
		const enrollment = {
			participantId,
			processIdentity: `offline-frost-process-${participantId}`,
			stateDirectory: `/tmp/coco-offline-frost-${participantId}`,
			verifyingShare: contract.participants[participantId - 1].verifyingShare,
		}
		const peer = { ...enrollment, processInstanceId: `offline-boot-${participantId}`, restartCounter: 0 }
		return {
			enrollment,
			transport: {
				async roundOne(request: Parameters<DemoFrostProcessParticipant['transport']['roundOne']>[0]) {
					const policyEvidence = await validateDemoFrostParticipantPolicy({
						policy: request.policy,
						expectedPackageDigest: request.binding.packageDigest,
						expectedCashuSigAllDigest: request.binding.digest,
						ports: {
							closureVerifier: { async verifyAndDerive() { return {
								evidenceDigest: request.policy.certifiedClosure.evidenceDigest, network: request.policy.network,
								chainId: request.policy.chainId, auctionId: request.policy.auctionId, operationId: request.policy.operationId,
								bidId: request.policy.bidId, bidEventId: request.policy.bidEventId, bidderActorId: request.policy.bidderActorId,
								role: request.policy.role, outcomeHeight: request.policy.outcomeHeight, appStateHash: request.policy.appStateHash,
								amount: request.policy.amount, locktime: request.policy.locktime,
								proofStateRefs: request.policy.deposits.map((deposit) => deposit.proofStateRef), recipientPublicKey: request.policy.recipientPublicKey,
							} } },
							signedBidVerifier: { async verifyAndDerive() { return {
								evidenceDigest: request.policy.signedBid.evidenceDigest, network: request.policy.network,
								chainId: request.policy.chainId, auctionId: request.policy.auctionId, operationId: request.policy.operationId,
								bidId: request.policy.bidId, bidEventId: request.policy.bidEventId, bidderActorId: request.policy.bidderActorId,
								amount: request.policy.amount, locktime: request.policy.locktime, bidderPublicKey: request.policy.bidderPublicKey,
								sellerRecipientPublicKey: request.policy.sellerRecipientPublicKey, deposits: request.policy.deposits.map((deposit) => ({ ...deposit })),
							} } },
							proofUse: { async assertExclusive() {} },
						},
					})
					return {
						peer,
						message: {
							schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_RESPONSE_V1' as const,
							binding: { ...request.binding }, policyEvidence,
							commitment: { hiding: publicKey(scalarHex(200 + participantId)), binding: publicKey(scalarHex(210 + participantId)) },
						},
					}
				},
				async roundTwo(request: Parameters<DemoFrostProcessParticipant['transport']['roundTwo']>[0]) {
					if (withheld === participantId) throw new Error(`participant ${participantId} withheld`)
					return {
						peer,
						message: {
							schema: 'COCO_DEMO_FROST_PROCESS_ROUND_TWO_RESPONSE_V1' as const,
							binding: { ...request.binding }, transcriptHash: request.transcriptHash,
							signatureShare: scalarHex(220 + participantId),
						},
					}
				},
			},
		}
	}) as [DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant]
	const processPorts = createFourSeparatedFrostProcessPorts({
		committeeKeysetId: contract.committeeKeysetId,
		committeeKeysetVersion: contract.committeeKeysetVersion,
		requestTimeoutMs: 500,
		policy,
		participants,
	})
	return createFourOfFourCommitteePort(processPorts, {
		async aggregate(request) { return { transcriptHash: request.transcriptHash, signature: signDigest(request.digest, COMMITTEE_PRIVATE) } },
	})
}

async function closureEvidence(initial: BidFixture, rebid: BidFixture) {
	const validators = [1, 2, 3, 4].map((id) => ({ validatorId: `validator-${id}`, privateKey: scalarHex(240 + id), publicKey: publicKey(scalarHex(240 + id)) }))
	const policy: DemoCertifiedClosurePolicy = {
		authNetworkId: NETWORK, chainId: CHAIN, auctionId: AUCTION, sellerP2pkXpub: SELLER_XPUB,
		baseEndHeight: 3, baseEndTime: BASE_END, minimumSettlementWindowSeconds: 300,
		validatorRosterVersion: 'offline-roster-v1', validators: validators.map(({ validatorId, publicKey }) => ({ validatorId, publicKey })),
	}
	const bidEntry = (bid: BidFixture, displaced: boolean) => ({
		auction_id: AUCTION, bid_id: bid.bidId, operation_id: bid.operationId, event_id: bid.signedBid.id,
		actor_id: bid.signedBid.pubkey, amount: bid.proof.amount, bidder_cashu_public_key: publicKey(bid.profile.walletPrivate),
		locktime: LOCKTIME, proof_state_refs: [bid.proofStateRef], displaced_refund_eligible: displaced,
		seller_child_public_key: bid.sellerChildPublicKey,
	})
	const history: DemoCertifiedClosureHistoryBatchV1[] = [
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: NETWORK, chain_id: CHAIN, height: 1, block_time: CREATED_AT + 10, app_hash: 'b'.repeat(64), bids: [bidEntry(initial, true)] },
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: NETWORK, chain_id: CHAIN, height: 2, block_time: CREATED_AT + 20, app_hash: 'c'.repeat(64), bids: [] },
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: NETWORK, chain_id: CHAIN, height: 3, block_time: BASE_END, app_hash: 'd'.repeat(64), bids: [bidEntry(rebid, false)] },
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: NETWORK, chain_id: CHAIN, height: 4, block_time: CREATED_AT + 40, app_hash: 'd'.repeat(64), bids: [] },
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: NETWORK, chain_id: CHAIN, height: 5, block_time: CLOSE_TIME, app_hash: 'e'.repeat(64), bids: [] },
	]
	const payload: DemoCertifiedClosurePayloadV1 = {
		schema: DEMO_CERTIFIED_CLOSURE_SCHEMA, domain: DEMO_CERTIFIED_CLOSURE_DOMAIN, auth_network_id: NETWORK,
		chain_id: CHAIN, auction_id: AUCTION, seller_p2pk_xpub: SELLER_XPUB, base_end_height: 3, base_end_time: BASE_END,
		effective_end_height: 4, effective_end_time: CREATED_AT + 40, close_height: 5, close_time: CLOSE_TIME,
		history_start_height: 1, history_end_height: 5, history_root: await computeCertifiedClosureHistoryRoot(history),
		outcome: 'winner', winner_bid_id: rebid.bidId, winner_operation_id: rebid.operationId,
		winner_event_id: rebid.signedBid.id, winner_actor_id: rebid.signedBid.pubkey, winner_amount: rebid.proof.amount,
		app_hash: 'e'.repeat(64), validator_roster_version: policy.validatorRosterVersion,
		validator_roster: validators.map(({ validatorId, publicKey }) => ({ validator_id: validatorId, public_key: publicKey })),
	}
	const certificateDigest = await computeCertifiedClosureDigest(payload)
	const certificate: DemoCertifiedClosureCertificateV1 = {
		...payload,
		certificate_digest: certificateDigest,
		signatures: validators.map(({ validatorId, privateKey, publicKey }) => ({
			validator_id: validatorId, public_key: publicKey, signature: signDigest(certificateDigest, privateKey),
		})),
	}
	return {
		certificateDigest,
		port: {
			async readExact(request: { outcomeHeight: number; appStateHash: string }) {
				if (request.outcomeHeight !== 5 || request.appStateHash !== 'e'.repeat(64)) return null
				return {
					certificate, history, policy,
					signatureVerifier: {
						verifyExact(value: { validatorId: string; publicKey: string; digest: string; signature: string }) {
							const validator = validators.find((candidate) => candidate.validatorId === value.validatorId && candidate.publicKey === value.publicKey)
							return validator !== undefined && schnorr.verify(hexToBytes(value.signature), hexToBytes(value.digest), hexToBytes(value.publicKey.slice(2)))
						},
					},
				}
			},
		},
	}
}

function dispositionMint(counter: { calls: number }): DemoSigAllMintPort {
	return { async swapExact(request) { counter.calls += 1; return { signatures: request.outputs.map(blindSign) } } }
}

const gate = { async runExclusive<T>(_scope: string, _root: string, run: () => Promise<T>): Promise<T> { return run() } }

class AcceptanceBrowserStorage implements DemoBrowserWalletApprovalStorage {
	readonly values = new Map<string, string>()
	getItem(key: string): string | null { return this.values.get(key) ?? null }
	setItem(key: string, value: string): void { this.values.set(key, value) }
}

class AcceptanceOriginLocks implements DemoBrowserOriginLockManager {
	private tail: Promise<void> = Promise.resolve()
	async request<T>(_name: string, options: { readonly mode: 'exclusive' }, run: () => Promise<T>): Promise<T> {
		if (options.mode !== 'exclusive') throw new Error('acceptance-lock-not-exclusive')
		const prior = this.tail
		let release!: () => void
		this.tail = new Promise<void>((resolve) => { release = resolve })
		await prior
		try { return await run() } finally { release() }
	}
}

describe('offline Coco SIG_ALL acceptance (not live mint, DKG, FROST, or consensus evidence)', () => {
	test('five isolated funded profiles, signed bid/rebid, certified automatic close, seller payout, and loser refund', async () => {
		const config = validatedFiveProfileConfig()
		const profiles = await fundProfiles()
		expect(config.funding.usable).toBe(true)
		expect(config.profiles).toHaveLength(5)
		expect(new Set(profiles.map((profile) => profile.state)).size).toBe(5)
		expect(profiles.map((profile) => profile.target)).toEqual([1, 8, 16, 4, 2])
		expect(profiles.every((profile) => profile.proofs.every(proofIsValid))).toBe(true)

		const initial = await makeBid(profiles[1]!, 'm/1/2/3/4/1')
		const rebid = await makeBid(profiles[2]!, 'm/1/2/3/4/2')
		expect(initial.signedBid.sig).toHaveLength(128)
		expect(rebid.signedBid.sig).toHaveLength(128)
		expect(rebid.proof.amount).toBeGreaterThan(initial.proof.amount)
		const closure = await closureEvidence(initial, rebid)

		const sellerImports: Array<{ operationId: string; role: string; proofs: CashuProof[] }> = []
		const loserImports: Array<{ operationId: string; role: string; proofs: CashuProof[] }> = []
		const winner = await contractFor({ bid: rebid, role: 'winner_settlement', recipientPrivate: rebid.sellerChildPrivateKey, walletReceipts: sellerImports })
		const loser = await contractFor({ bid: initial, role: 'refund', recipientPrivate: initial.profile.refundPrivate, walletReceipts: loserImports })
		const mintCounter = { calls: 0 }
		const interactiveWinnerWalletAvailable = false
		const approvalStorage = new AcceptanceBrowserStorage()
		const approvalLocks = new AcceptanceOriginLocks()
		const approvalWriter = createBrowserDemoWalletLocalBidApprovalPort({
			storage: approvalStorage,
			locks: approvalLocks,
			subtle: crypto.subtle,
		})
		await approvalWriter.persistApprovedBid({
			network: NETWORK,
			chainId: CHAIN,
			auctionId: AUCTION,
			approval: winner.approval,
		})
		const reconstructedWinnerApproval = createBrowserDemoWalletLocalBidApprovalPort({
			storage: approvalStorage,
			locks: approvalLocks,
			subtle: crypto.subtle,
		})
		expect(interactiveWinnerWalletAvailable).toBe(false)

		const winnerResult = await executeDemoCertifiedWalletAutomaticClose({
			contract: winner.contract,
			proofStateRefs: [rebid.proofStateRef],
			automaticClose: closure.port,
			walletLocal: reconstructedWinnerApproval,
			execution: {
				committee: committeeFor(winner.contract, closure.certificateDigest), operationGate: gate,
				mint: dispositionMint(mintCounter), recoveryStore: recoveryStore(),
				terminalResponse: { async restoreCompleted(query) { return { signatures: query.blindedOutputs.map(blindSign) } } },
				recipient: winner.recipient, now: () => 1, nowSeconds: () => NOW_SECONDS,
			},
		})
		expect(winnerResult.recipient).toMatchObject({ role: 'winner_settlement', imported: true, amount: 16 })
		expect(sellerImports).toHaveLength(1)
		expect(sellerImports[0]?.proofs.every(proofIsValid)).toBe(true)
		expect(sellerImports[0]?.operationId).toBe(rebid.operationId)
		expect(approvalStorage.values.size).toBe(1)

		const loserResult = await executeDemoCertifiedWalletAutomaticClose({
			contract: loser.contract,
			proofStateRefs: [initial.proofStateRef],
			automaticClose: closure.port,
			walletLocal: { async readApprovedBid() { return loser.approval } },
			execution: {
				committee: committeeFor(loser.contract, closure.certificateDigest), operationGate: gate,
				mint: dispositionMint(mintCounter), recoveryStore: recoveryStore(),
				terminalResponse: { async restoreCompleted(query) { return { signatures: query.blindedOutputs.map(blindSign) } } },
				recipient: loser.recipient, now: () => 2, nowSeconds: () => NOW_SECONDS,
			},
		})
		expect(loserResult.recipient).toMatchObject({ role: 'refund', imported: true, amount: 8 })
		expect(loserImports).toHaveLength(1)
		expect(loserImports[0]?.proofs.every(proofIsValid)).toBe(true)
		expect(mintCounter.calls).toBe(2)
	})

	test('withholding one isolated participant blocks the exact winner before any mint call', async () => {
		const profiles = await fundProfiles()
		const initial = await makeBid(profiles[1]!, 'm/1/2/3/4/1')
		const rebid = await makeBid(profiles[2]!, 'm/1/2/3/4/2')
		const closure = await closureEvidence(initial, rebid)
		const sellerImports: Array<{ operationId: string; role: string; proofs: CashuProof[] }> = []
		const winner = await contractFor({ bid: rebid, role: 'winner_settlement', recipientPrivate: rebid.sellerChildPrivateKey, walletReceipts: sellerImports })
		const mintCounter = { calls: 0 }
		await expect(executeDemoCertifiedWalletAutomaticClose({
			contract: winner.contract,
			proofStateRefs: [rebid.proofStateRef],
			automaticClose: closure.port,
			walletLocal: { async readApprovedBid() { return winner.approval } },
			execution: {
				committee: committeeFor(winner.contract, closure.certificateDigest, 4), operationGate: gate,
				mint: dispositionMint(mintCounter), recoveryStore: recoveryStore(),
				terminalResponse: { async restoreCompleted() { return null } }, recipient: winner.recipient,
				now: () => 3, nowSeconds: () => NOW_SECONDS,
			},
		})).rejects.toThrow('FOUR_OF_FOUR_UNAVAILABLE')
		expect(mintCounter.calls).toBe(0)
		expect(sellerImports).toHaveLength(0)
	})
})
