import { describe, expect, test } from 'bun:test'
import {
	Amount,
	SigAll,
	signP2PKProof,
	verifyP2PKSpendingConditions,
	type Proof,
	type SerializedBlindedMessage,
} from '@cashu/cashu-ts'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { HDKey } from '@scure/bip32'

import {
	buildDemoSigAllSecret,
	createCashuMintSigAllPort,
	createFourOfFourCommitteePort,
	demoCashuSigAllDigest,
	demoCashuSigAllSource,
	demoDenominationKeyDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
	demoSigAllPackageDigest,
	DemoSigAllRefusedError,
	executeDemoSigAllSwap,
	type DemoFourOfFourCommitteePort,
	type DemoCommitteeAuthorizationRequest,
	type DemoFrostParticipantPort,
	type DemoOperationRootGate,
	type DemoParticipantId,
	type DemoSigAllContract,
	type DemoSigAllMintPort,
} from './demo-sigall-settlement'
import { buildP2PKSecret, type BlindedMessage, type CashuProof } from './nut-client'

const key = (value: number): string => value.toString(16).padStart(64, '0')
const publicKey = (privateKey: string): string => bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), true))
const sign = (digest: string, privateKey: string): string => bytesToHex(schnorr.sign(hexToBytes(digest), hexToBytes(privateKey)))
const oppositeParity = (compressed: string): string => `${compressed.startsWith('02') ? '03' : '02'}${compressed.slice(2)}`
const cashuTsProofs = (inputs: CashuProof[]): Proof[] => inputs.map(({ amount, id, secret, C }) => ({
	amount: Amount.from(amount), id, secret, C,
}))
const cashuTsOutputs = (outputs: BlindedMessage[]): SerializedBlindedMessage[] => outputs.map(({ amount, id, B_ }) => ({
	amount: Amount.from(amount), id, B_,
}))

const BIDDER_PRIVATE = key(1)
const ACTOR_PRIVATE = key(2)
const COMMITTEE_FIXTURE_PRIVATE = key(3)
const REFUND_PRIVATE = key(4)
const BIDDER_PUBLIC = publicKey(BIDDER_PRIVATE)
const ACTOR_ID = publicKey(ACTOR_PRIVATE).slice(2)
const COMMITTEE_PUBLIC = publicKey(COMMITTEE_FIXTURE_PRIVATE)
const REFUND_PUBLIC = publicKey(REFUND_PRIVATE)
const SELLER_ROOT = HDKey.fromMasterSeed(new Uint8Array(32).fill(0x42))
const SELLER_XPUB = SELLER_ROOT.publicExtendedKey
const BIDDER_PATH = 'm/1/2/3/4/5'
const SELLER_CHILD = SELLER_ROOT.derive(BIDDER_PATH)
const RECIPIENT_PRIVATE = bytesToHex(SELLER_CHILD.privateKey!)
const RECIPIENT_PUBLIC = bytesToHex(SELLER_CHILD.publicKey!)

const participants = [1, 2, 3, 4].map((identifier) => ({
	identifier: identifier as DemoParticipantId,
	verifyingShare: publicKey(key(10 + identifier)),
})) as DemoSigAllContract['participants']

function fixtureContract(role: 'winner_settlement' | 'refund' = 'winner_settlement'): DemoSigAllContract {
	const activeKeysetId = 'demo-keyset'
	const denominationKeys = { '1': publicKey(key(90)), '2': publicKey(key(91)), '4': publicKey(key(92)), '8': publicKey(key(93)) }
	const secretA = buildDemoSigAllSecret({
		nonce: 'a5'.repeat(32),
		bidderPublicKey: BIDDER_PUBLIC,
		committeePublicKey: COMMITTEE_PUBLIC,
		locktime: 2_000_000_000,
		refundPublicKey: REFUND_PUBLIC,
	})
	const secretB = buildDemoSigAllSecret({
		nonce: 'a6'.repeat(32),
		bidderPublicKey: BIDDER_PUBLIC,
		committeePublicKey: COMMITTEE_PUBLIC,
		locktime: 2_000_000_000,
		refundPublicKey: REFUND_PUBLIC,
	})
	const inputs: CashuProof[] = [
		{ amount: 4, id: activeKeysetId, secret: secretA, C: publicKey(key(20)) },
		{ amount: 8, id: activeKeysetId, secret: secretB, C: publicKey(key(21)) },
	]
	const outputs: BlindedMessage[] = role === 'winner_settlement'
		? [
			{ amount: 4, id: activeKeysetId, B_: publicKey(key(30)) },
			{ amount: 8, id: activeKeysetId, B_: publicKey(key(31)) },
		]
		: [{ amount: 12, id: activeKeysetId, B_: publicKey(key(32)) }]
	const recipientPrivate = role === 'refund' ? REFUND_PRIVATE : RECIPIENT_PRIVATE
	const recipientPublic = role === 'refund' ? REFUND_PUBLIC : RECIPIENT_PUBLIC
	const capabilityBase = {
		schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1' as const,
		network: 'demo-testnet',
		chainId: 'demo-chain',
		auctionId: 'auction-1',
		operationId: role === 'winner_settlement' ? 'settle-bid-9' : 'refund-bid-7',
		role,
		mintUrl: 'https://testnut.example',
		unit: 'sat',
		recipientPublicKey: recipientPublic,
		outputsDigest: demoOutputsDigest(outputs),
		signature: '00'.repeat(64),
	}
	const recipientCapability = {
		...capabilityBase,
		signature: sign(demoRecipientCapabilityDigest(capabilityBase), recipientPrivate),
	}
	const contract: DemoSigAllContract = {
		schema: 'COCO_DEMO_SIGALL_CONTRACT_V1',
		network: capabilityBase.network,
		chainId: capabilityBase.chainId,
		auctionId: capabilityBase.auctionId,
		operationId: capabilityBase.operationId,
		bidId: role === 'winner_settlement' ? 'bid-9' : 'bid-7',
		bidEventId: role === 'winner_settlement' ? '99'.repeat(32) : '77'.repeat(32),
		bidderActorId: ACTOR_ID,
		role,
		outcomeHeight: 42,
		appStateHash: '55'.repeat(32),
		amount: 12,
		inputFee: 0,
		mintUrl: capabilityBase.mintUrl,
		unit: capabilityBase.unit,
		sellerP2pkXpub: SELLER_XPUB,
		bidderDerivationPath: BIDDER_PATH,
		recipientPublicKey: recipientPublic,
		mintSeal: {
			mintUrl: capabilityBase.mintUrl,
			mintPublicKey: publicKey(key(89)),
			serverVersion: 'test-mint/1',
			activeSatKeysetId: activeKeysetId,
			denominationKeyDigest: demoDenominationKeyDigest(denominationKeys),
			denominationAmounts: [1, 2, 4, 8],
			inputFeePpk: 0,
			nuts: [4, 7, 10, 11],
		},
		inputs,
		outputs,
		bidderPublicKey: BIDDER_PUBLIC,
		committeePublicKey: COMMITTEE_PUBLIC,
		committeeKeysetId: 'demo-four-of-four-keyset',
		committeeKeysetVersion: '1',
		threshold: 4,
		participants: participants.map((participant) => ({ ...participant })) as DemoSigAllContract['participants'],
		recipientCapability,
		approval: {
			schema: 'COCO_DEMO_SIGALL_BIDDER_APPROVAL_V1',
			packageDigest: '00'.repeat(32),
			cashuSigAllDigest: '00'.repeat(32),
			actorPackageSignature: '00'.repeat(64),
			packageSignature: '00'.repeat(64),
			cashuSignature: '00'.repeat(64),
		},
	}
	const packageDigest = demoSigAllPackageDigest(contract)
	const cashuSigAllDigest = demoCashuSigAllDigest(inputs, outputs)
	contract.approval = {
		schema: 'COCO_DEMO_SIGALL_BIDDER_APPROVAL_V1',
		packageDigest,
		cashuSigAllDigest,
		actorPackageSignature: sign(packageDigest, ACTOR_PRIVATE),
		packageSignature: sign(packageDigest, BIDDER_PRIVATE),
		cashuSignature: sign(cashuSigAllDigest, BIDDER_PRIVATE),
	}
	return contract
}

function authorizeContract(contract: DemoSigAllContract, recipientPrivate = RECIPIENT_PRIVATE): DemoSigAllContract {
	contract.recipientCapability = {
		...contract.recipientCapability,
		outputsDigest: demoOutputsDigest(contract.outputs),
		signature: '00'.repeat(64),
	}
	contract.recipientCapability.signature = sign(demoRecipientCapabilityDigest(contract.recipientCapability), recipientPrivate)
	const packageDigest = demoSigAllPackageDigest(contract)
	const cashuSigAllDigest = demoCashuSigAllDigest(contract.inputs, contract.outputs)
	contract.approval = {
		...contract.approval,
		packageDigest,
		cashuSigAllDigest,
		actorPackageSignature: sign(packageDigest, ACTOR_PRIVATE),
		packageSignature: sign(packageDigest, BIDDER_PRIVATE),
		cashuSignature: sign(cashuSigAllDigest, BIDDER_PRIVATE),
	}
	return contract
}

function feeBoundaryContract(inputFeePpk: number, inputCount: number, claimedFee?: number): DemoSigAllContract {
	const contract = fixtureContract()
	const exactFee = Math.ceil((inputFeePpk * inputCount) / 1000)
	const inputFee = claimedFee ?? exactFee
	contract.amount = inputCount
	contract.inputFee = inputFee
	contract.mintSeal.inputFeePpk = inputFeePpk
	contract.mintSeal.denominationAmounts = [...new Set([1, 1 + inputFee, inputCount])].sort((left, right) => left - right)
	contract.inputs = Array.from({ length: inputCount }, (_, index) => ({
		amount: index === 0 ? 1 + inputFee : 1,
		id: contract.mintSeal.activeSatKeysetId,
		secret: buildDemoSigAllSecret({
			nonce: (index + 1).toString(16).padStart(64, '0'),
			bidderPublicKey: BIDDER_PUBLIC,
			committeePublicKey: COMMITTEE_PUBLIC,
			locktime: 2_000_000_000,
			refundPublicKey: REFUND_PUBLIC,
		}),
		C: publicKey(key(100 + index)),
	}))
	contract.outputs = [{
		amount: inputCount,
		id: contract.mintSeal.activeSatKeysetId,
		B_: publicKey(key(200 + inputCount)),
	}]
	return authorizeContract(contract)
}

function directCommittee(): DemoFourOfFourCommitteePort {
	const participantPorts = [1, 2, 3, 4].map((identifier): DemoFrostParticipantPort => ({
		participantId: identifier as DemoParticipantId,
		verifyingShare: participants[identifier - 1].verifyingShare,
		async roundOne(request) {
			return {
				participantId: identifier as DemoParticipantId,
				sessionId: request.sessionId,
				digest: request.digest,
				hiding: publicKey(key(50 + identifier)),
				binding: publicKey(key(60 + identifier)),
			}
		},
		async roundTwo(request) {
			return {
				participantId: identifier as DemoParticipantId,
				sessionId: request.sessionId,
				digest: request.digest,
				transcriptHash: request.transcriptHash,
				share: identifier.toString(16).padStart(64, '0'),
			}
		},
	}))
	return createFourOfFourCommitteePort(participantPorts, {
		async aggregate(request) {
			return {
				transcriptHash: request.transcriptHash,
				signature: sign(request.digest, COMMITTEE_FIXTURE_PRIVATE),
			}
		},
	})
}

function passthroughGate(onRun?: () => void): DemoOperationRootGate {
	return {
		async runExclusive(_scope, _root, run) {
			onRun?.()
			return run()
		},
	}
}

describe('demo SIG_ALL settlement compatibility', () => {
	test('matches cashu-ts 5.0.0-rc.4 and enforces the exact pre-locktime bidder-plus-committee message', () => {
		const contract = fixtureContract()
		const source = demoCashuSigAllSource(contract.inputs, contract.outputs)
		const libraryInputs = cashuTsProofs(contract.inputs)
		const libraryOutputs = cashuTsOutputs(contract.outputs)
		const libraryDigests = SigAll.computeDigests(libraryInputs, libraryOutputs)
		expect(libraryDigests.current).toBe(contract.approval.cashuSigAllDigest)
		expect(libraryDigests.current).toBe(demoCashuSigAllDigest(contract.inputs, contract.outputs))

		const bidderOnly = signP2PKProof(libraryInputs[0], BIDDER_PRIVATE, source)
		expect(verifyP2PKSpendingConditions(bidderOnly, undefined, source)).toMatchObject({
			success: false,
			path: 'FAILED',
			lockState: 'ACTIVE',
		})
		const exactWitness = signP2PKProof(bidderOnly, COMMITTEE_FIXTURE_PRIVATE, source)
		expect(verifyP2PKSpendingConditions(exactWitness, undefined, source)).toMatchObject({
			success: true,
			path: 'MAIN',
			lockState: 'ACTIVE',
		})

		const redirectedOutputs = contract.outputs.map((output, index) => index === 0
			? { ...output, B_: publicKey(key(33)) }
			: { ...output })
		const redirectedSource = demoCashuSigAllSource(contract.inputs, redirectedOutputs)
		expect(SigAll.computeDigests(libraryInputs, cashuTsOutputs(redirectedOutputs)).current).not.toBe(libraryDigests.current)
		expect(verifyP2PKSpendingConditions(exactWitness, undefined, redirectedSource)).toMatchObject({
			success: false,
			path: 'FAILED',
		})

		const changedInputs = contract.inputs.map((input, index) => index === 0
			? { ...input, C: publicKey(key(34)) }
			: { ...input })
		expect(SigAll.computeDigests(cashuTsProofs(changedInputs), libraryOutputs).current).not.toBe(libraryDigests.current)
	})

	test('cashu-ts 5.0.0-rc.4 separates the main and refund keys but does not commit refund destination', () => {
		const secret = buildDemoSigAllSecret({
			nonce: 'b5'.repeat(32),
			bidderPublicKey: BIDDER_PUBLIC,
			committeePublicKey: COMMITTEE_PUBLIC,
			locktime: 1,
			refundPublicKey: REFUND_PUBLIC,
		})
		const proof = { amount: 4, id: 'demo-keyset', secret, C: publicKey(key(35)) }
		const sellerBoundOutputs = [{ amount: 4, id: 'demo-keyset', B_: publicKey(key(36)) }]
		const source = demoCashuSigAllSource([proof], sellerBoundOutputs)
		const libraryProof = cashuTsProofs([proof])[0]
		const mainKeyOnly = signP2PKProof(libraryProof, BIDDER_PRIVATE, source)
		expect(verifyP2PKSpendingConditions(mainKeyOnly, undefined, source)).toMatchObject({
			success: false,
			path: 'FAILED',
			lockState: 'EXPIRED',
		})
		const bidderRefund = signP2PKProof(libraryProof, REFUND_PRIVATE, source)
		expect(verifyP2PKSpendingConditions(bidderRefund, undefined, source)).toMatchObject({
			success: true,
			path: 'REFUND',
			lockState: 'EXPIRED',
		})

		const committeeOnly = signP2PKProof(libraryProof, COMMITTEE_FIXTURE_PRIVATE, source)
		expect(verifyP2PKSpendingConditions(committeeOnly, undefined, source)).toMatchObject({
			success: false,
			path: 'FAILED',
			lockState: 'EXPIRED',
		})
		const fullMain = signP2PKProof(mainKeyOnly, COMMITTEE_FIXTURE_PRIVATE, source)
		expect(verifyP2PKSpendingConditions(fullMain, undefined, source)).toMatchObject({
			success: true,
			path: 'MAIN',
			lockState: 'EXPIRED',
		})
		const redirectedSource = demoCashuSigAllSource([proof], [
			{ ...sellerBoundOutputs[0], B_: publicKey(key(37)) },
		])
		expect(verifyP2PKSpendingConditions(bidderRefund, undefined, redirectedSource)).toMatchObject({
			success: false,
			path: 'FAILED',
		})
		const newlySignedRedirect = signP2PKProof(libraryProof, REFUND_PRIVATE, redirectedSource)
		expect(verifyP2PKSpendingConditions(newlySignedRedirect, undefined, redirectedSource)).toMatchObject({
			success: true,
			path: 'REFUND',
			lockState: 'EXPIRED',
		})
	})

	test('retains the independently generated public M4 digest as historical evidence but rejects its reused refund key', () => {
		const bidder = '02d76d81ad6114719989960dedfe77b46b0d68bd315779da90d52b85a988245eb6'
		const committee = '020f1a01d40a9b15e48c57e0d15a41ef680f2551913489606bf0a1037fcc17c501'
		const secret = '["P2PK",{"nonce":"a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5","data":"02d76d81ad6114719989960dedfe77b46b0d68bd315779da90d52b85a988245eb6","tags":[["pubkeys","020f1a01d40a9b15e48c57e0d15a41ef680f2551913489606bf0a1037fcc17c501"],["n_sigs","2"],["sigflag","SIG_ALL"],["locktime","2000000000"],["refund","02d76d81ad6114719989960dedfe77b46b0d68bd315779da90d52b85a988245eb6"]]}]'
		expect(secret).toBe('["P2PK",{"nonce":"a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5","data":"02d76d81ad6114719989960dedfe77b46b0d68bd315779da90d52b85a988245eb6","tags":[["pubkeys","020f1a01d40a9b15e48c57e0d15a41ef680f2551913489606bf0a1037fcc17c501"],["n_sigs","2"],["sigflag","SIG_ALL"],["locktime","2000000000"],["refund","02d76d81ad6114719989960dedfe77b46b0d68bd315779da90d52b85a988245eb6"]]}]')
		const inputs: CashuProof[] = [
			{ amount: 4, id: 'test-input-keyset-a', secret, C: `02${'11'.repeat(32)}` },
			{ amount: 8, id: 'test-input-keyset-b', secret, C: `03${'22'.repeat(32)}` },
		]
		const outputs: BlindedMessage[] = [
			{ amount: 5, id: 'test-output-keyset-a', B_: `02${'33'.repeat(32)}` },
			{ amount: 7, id: 'test-output-keyset-b', B_: `03${'44'.repeat(32)}` },
		]
		expect(demoCashuSigAllDigest(inputs, outputs)).toBe('c896a7e065b0c3a28d6600a13ae3e1497aff0c8efe8d20d75d8f8541e43751b6')
		expect(() => buildDemoSigAllSecret({
			nonce: 'a5'.repeat(32),
			bidderPublicKey: bidder,
			committeePublicKey: oppositeParity(bidder),
			locktime: 2_000_000_000,
			refundPublicKey: REFUND_PUBLIC,
		})).toThrow(/DEMO_SIGALL_SIGNER_KEY_REUSE/)
		expect(() => buildDemoSigAllSecret({
			nonce: 'a5'.repeat(32),
			bidderPublicKey: bidder,
			committeePublicKey: committee,
			locktime: 2_000_000_000,
			refundPublicKey: bidder,
		})).toThrow(/DEMO_SIGALL_REFUND_KEY_REUSE/)
	})

	test('submits exact bidder-plus-committee witnesses only after recipient, bidder, and four-party evidence pass', async () => {
		const contract = fixtureContract()
		let request: Parameters<DemoSigAllMintPort['swapExact']>[0] | undefined
		const mint: DemoSigAllMintPort = {
			async swapExact(value) {
				request = value
				return { signatures: value.outputs.map((output, index) => ({ amount: output.amount, id: output.id, C_: publicKey(key(40 + index)) })) }
			},
		}
		let gateRuns = 0
		const result = await executeDemoSigAllSwap({
			contract,
			committee: directCommittee(),
			mint,
			operationGate: passthroughGate(() => { gateRuns += 1 }),
		})
		expect(result.signatures).toHaveLength(2)
		expect(gateRuns).toBe(1)
		expect(request?.recipientCapabilityDigest).toBe(demoRecipientCapabilityDigest(contract.recipientCapability))
		expect(request?.inputs).toHaveLength(2)
		const witness = JSON.parse(request!.inputs[0].witness!) as { signatures: string[] }
		expect(witness.signatures).toHaveLength(2)
		expect(witness.signatures[0]).toBe(contract.approval.cashuSignature)
		expect(witness.signatures[1]).not.toBe(contract.approval.cashuSignature)
		expect(request!.inputs[1].witness).toBeUndefined()
	})

	test('snapshots the wallet-local contract before any async gate can mutate the caller value', async () => {
		const contract = fixtureContract()
		const originalOperationId = contract.operationId
		let submittedOperationId = ''
		await executeDemoSigAllSwap({
			contract,
			committee: directCommittee(),
			mint: {
				async swapExact(request) {
					submittedOperationId = request.operationId
					return { signatures: request.outputs.map((output, index) => ({ amount: output.amount, id: output.id, C_: publicKey(key(40 + index)) })) }
				},
			},
			operationGate: passthroughGate(() => {
				contract.operationId = 'mutated-after-validation'
				contract.inputs[0].secret = 'mutated-bearer-secret'
			}),
		})
		expect(submittedOperationId).toBe(originalOperationId)
	})

	test('binds committee, mint, and operation-gate callables before asynchronous gates', async () => {
		const contract = fixtureContract()
		const committee = directCommittee()
		let committeeCalls = 0
		const originalAuthorize = committee.authorize.bind(committee)
		committee.authorize = async (request) => {
			committeeCalls += 1
			return originalAuthorize(request)
		}
		let mintCalls = 0
		const mint: DemoSigAllMintPort = {
			async swapExact(request) {
				mintCalls += 1
				return { signatures: request.outputs.map((output, index) => ({ amount: output.amount, id: output.id, C_: publicKey(key(40 + index)) })) }
			},
		}
		let gateCalls = 0
		const gate: DemoOperationRootGate = {
			async runExclusive(_scope, _root, run) {
				gateCalls += 1
				committee.authorize = async () => { throw new Error('substituted committee port') }
				mint.swapExact = async () => { throw new Error('substituted mint port') }
				gate.runExclusive = async () => { throw new Error('substituted operation gate') }
				return run()
			},
		}
		await expect(executeDemoSigAllSwap({ contract, committee, mint, operationGate: gate }))
			.resolves.toHaveProperty('signatures.length', 2)
		expect({ committeeCalls, mintCalls, gateCalls }).toEqual({ committeeCalls: 1, mintCalls: 1, gateCalls: 1 })
	})

	test('snapshots each accessor-backed port object exactly once before validation or awaits', async () => {
		const contract = fixtureContract()
		const committee = directCommittee()
		const mint: DemoSigAllMintPort = {
			async swapExact(request) {
				return { signatures: request.outputs.map((output, index) => ({ amount: output.amount, id: output.id, C_: publicKey(key(40 + index)) })) }
			},
		}
		const gate = passthroughGate()
		let committeeReads = 0
		let mintReads = 0
		let gateReads = 0
		const options = {
			contract,
			get committee() { committeeReads += 1; return committee },
			get mint() { mintReads += 1; return mint },
			get operationGate() { gateReads += 1; return gate },
		}
		await expect(executeDemoSigAllSwap(options)).resolves.toHaveProperty('signatures.length', 2)
		expect({ committeeReads, mintReads, gateReads }).toEqual({ committeeReads: 1, mintReads: 1, gateReads: 1 })
	})

	test('rechecks the 60-second settlement cutoff after the gate and after committee authorization', async () => {
		const contract = fixtureContract()
		let mintCalls = 0
		let clock = [1_999_999_939, 1_999_999_940]
		await expect(executeDemoSigAllSwap({
			contract,
			committee: directCommittee(),
			mint: { async swapExact() { mintCalls += 1; return { signatures: [] } } },
			operationGate: passthroughGate(),
			nowSeconds: () => clock.shift() ?? 1_999_999_940,
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_SETTLEMENT_CUTOFF' })
		clock = [1_999_999_939, 1_999_999_939, 1_999_999_940]
		await expect(executeDemoSigAllSwap({
			contract,
			committee: directCommittee(),
			mint: { async swapExact() { mintCalls += 1; return { signatures: [] } } },
			operationGate: passthroughGate(),
			nowSeconds: () => clock.shift() ?? 1_999_999_940,
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_SETTLEMENT_CUTOFF' })
		expect(mintCalls).toBe(0)
	})

	test('rejects the existing R4 SIG_INPUTS shape before committee or mint execution', async () => {
		const contract = fixtureContract()
		const incompatible = buildP2PKSecret(contract.bidderPublicKey, {
			nonce: 'a5'.repeat(32),
			sigflag: 'SIG_INPUTS',
			refundPubkey: contract.committeePublicKey,
			locktime: 2_000_000_000,
		})
		contract.inputs = contract.inputs.map((input, index) => ({ ...input, secret: index === 0 ? incompatible : buildP2PKSecret(contract.bidderPublicKey, {
			nonce: 'a6'.repeat(32), sigflag: 'SIG_INPUTS', refundPubkey: contract.committeePublicKey, locktime: 2_000_000_000,
		}) }))
		let mintCalls = 0
		await expect(executeDemoSigAllSwap({
			contract,
			committee: directCommittee(),
			mint: { async swapExact() { mintCalls += 1; return { signatures: [] } } },
			operationGate: passthroughGate(),
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_EXISTING_LOCK_INCOMPATIBLE' })
		expect(mintCalls).toBe(0)
	})

	test('output mutation breaks both recipient binding and bidder approval before the operation gate', async () => {
		const contract = fixtureContract()
		contract.outputs[0] = { ...contract.outputs[0], B_: publicKey(key(33)) }
		let gateRuns = 0
		let mintCalls = 0
		await expect(executeDemoSigAllSwap({
			contract,
			committee: directCommittee(),
			mint: { async swapExact() { mintCalls += 1; return { signatures: [] } } },
			operationGate: passthroughGate(() => { gateRuns += 1 }),
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECIPIENT_OUTPUTS' })
		expect(gateRuns).toBe(0)
		expect(mintCalls).toBe(0)
	})

	test('requires distinct accepted-bid actor and wallet spend-key approvals', async () => {
		let gateRuns = 0
		const run = async (contract: DemoSigAllContract) => executeDemoSigAllSwap({
			contract,
			committee: directCommittee(),
			mint: { async swapExact() { throw new Error('mint must not run') } },
			operationGate: passthroughGate(() => { gateRuns += 1 }),
		})
		const actorSignedByWallet = fixtureContract()
		actorSignedByWallet.approval.actorPackageSignature = sign(actorSignedByWallet.approval.packageDigest, BIDDER_PRIVATE)
		await expect(run(actorSignedByWallet)).rejects.toMatchObject({ code: 'DEMO_SIGALL_ACTOR_APPROVAL_SIGNATURE' })

		const walletPackageSignedByActor = fixtureContract()
		walletPackageSignedByActor.approval.packageSignature = sign(walletPackageSignedByActor.approval.packageDigest, ACTOR_PRIVATE)
		await expect(run(walletPackageSignedByActor)).rejects.toMatchObject({ code: 'DEMO_SIGALL_APPROVAL_SIGNATURE' })

		const cashuSignedByActor = fixtureContract()
		cashuSignedByActor.approval.cashuSignature = sign(cashuSignedByActor.approval.cashuSigAllDigest, ACTOR_PRIVATE)
		await expect(run(cashuSignedByActor)).rejects.toMatchObject({ code: 'DEMO_SIGALL_BIDDER_WITNESS' })

		const oneKeyForActorAndWallet = fixtureContract()
		oneKeyForActorAndWallet.bidderActorId = BIDDER_PUBLIC.slice(2)
		const sameKeyPackageDigest = demoSigAllPackageDigest(oneKeyForActorAndWallet)
		oneKeyForActorAndWallet.approval = {
			...oneKeyForActorAndWallet.approval,
			packageDigest: sameKeyPackageDigest,
			actorPackageSignature: sign(sameKeyPackageDigest, BIDDER_PRIVATE),
			packageSignature: sign(sameKeyPackageDigest, BIDDER_PRIVATE),
		}
		await expect(run(oneKeyForActorAndWallet)).rejects.toMatchObject({ code: 'DEMO_SIGALL_ACTOR_WALLET_KEY_REUSE' })

		for (const [paymentPrivate, paymentPublic] of [
			[COMMITTEE_FIXTURE_PRIVATE, COMMITTEE_PUBLIC],
			[REFUND_PRIVATE, REFUND_PUBLIC],
			[RECIPIENT_PRIVATE, RECIPIENT_PUBLIC],
		] as const) {
			const reused = fixtureContract()
			reused.bidderActorId = paymentPublic.slice(2)
			const packageDigest = demoSigAllPackageDigest(reused)
			reused.approval = {
				...reused.approval,
				packageDigest,
				actorPackageSignature: sign(packageDigest, paymentPrivate),
				packageSignature: sign(packageDigest, BIDDER_PRIVATE),
			}
			await expect(run(reused)).rejects.toMatchObject({ code: 'DEMO_SIGALL_ACTOR_WALLET_KEY_REUSE' })
		}
		expect(gateRuns).toBe(0)
	})

	test('uses exact ceil aggregate-ppk fees at 0, 1, 999, 1000, and 1001 boundaries', async () => {
		for (const [inputFeePpk, inputCount, expectedFee] of [
			[0, 2, 0],
			[1, 1, 1],
			[37, 27, 1],
			[100, 10, 1],
			[77, 13, 2],
		] as const) {
			const contract = feeBoundaryContract(inputFeePpk, inputCount)
			expect(contract.inputFee).toBe(expectedFee)
			await expect(executeDemoSigAllSwap({
				contract,
				committee: directCommittee(),
				mint: { async swapExact(value) { return { signatures: value.outputs.map((output) => ({ ...output, C_: publicKey(key(250)) })) } } },
				operationGate: passthroughGate(),
			})).resolves.toMatchObject({ signatures: [{ amount: inputCount }] })
		}

		for (const [inputFeePpk, inputCount, wrongFee] of [[100, 10, 2], [77, 13, 1]] as const) {
			await expect(executeDemoSigAllSwap({
				contract: feeBoundaryContract(inputFeePpk, inputCount, wrongFee),
				committee: directCommittee(),
				mint: { async swapExact() { throw new Error('mint must not run') } },
				operationGate: passthroughGate(),
			})).rejects.toMatchObject({ code: 'DEMO_SIGALL_BALANCE' })
		}
	})

	test('documents that raw SIG_ALL omits output keyset id while the application package binds it', () => {
		const contract = fixtureContract()
		const alternate = structuredClone(contract)
		alternate.outputs = alternate.outputs.map((output) => ({ ...output, id: 'other-active-sat-keyset' }))
		expect(demoCashuSigAllDigest(alternate.inputs, alternate.outputs)).toBe(contract.approval.cashuSigAllDigest)
		expect(demoSigAllPackageDigest(alternate)).not.toBe(contract.approval.packageDigest)
	})

	test('rejects opposite-parity reuse of the bidder x-coordinate as the committee signer before the gate', async () => {
		const contract = fixtureContract()
		contract.committeePublicKey = oppositeParity(contract.bidderPublicKey)
		let gateRuns = 0
		let mintCalls = 0
		await expect(executeDemoSigAllSwap({
			contract,
			committee: directCommittee(),
			mint: { async swapExact() { mintCalls += 1; return { signatures: [] } } },
			operationGate: passthroughGate(() => { gateRuns += 1 }),
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_SIGNER_KEY_REUSE' })
		expect(gateRuns).toBe(0)
		expect(mintCalls).toBe(0)
	})

	test('requires four distinct verifying-share x-coordinates before the gate', async () => {
		const contract = fixtureContract()
		contract.participants[1] = {
			...contract.participants[1],
			verifyingShare: oppositeParity(contract.participants[0].verifyingShare),
		}
		let gateRuns = 0
		let mintCalls = 0
		await expect(executeDemoSigAllSwap({
			contract,
			committee: directCommittee(),
			mint: { async swapExact() { mintCalls += 1; return { signatures: [] } } },
			operationGate: passthroughGate(() => { gateRuns += 1 }),
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_NOT_FOUR_OF_FOUR' })
		expect(gateRuns).toBe(0)
		expect(mintCalls).toBe(0)

		const duplicatePorts = [1, 2, 3, 4].map((identifier): DemoFrostParticipantPort => ({
			participantId: identifier as DemoParticipantId,
			verifyingShare: identifier === 2
				? oppositeParity(participants[0].verifyingShare)
				: participants[identifier - 1].verifyingShare,
			async roundOne() { throw new Error('must not run') },
			async roundTwo() { throw new Error('must not run') },
		}))
		expect(() => createFourOfFourCommitteePort(duplicatePorts, {
			async aggregate() { throw new Error('must not aggregate') },
		})).toThrow(/DEMO_SIGALL_NOT_FOUR_OF_FOUR/)
	})

	test('rejects a non-sat contract before the operation gate or mint', async () => {
		const contract = fixtureContract()
		contract.unit = 'usd'
		let gateRuns = 0
		let mintCalls = 0
		await expect(executeDemoSigAllSwap({
			contract,
			committee: directCommittee(),
			mint: { async swapExact() { mintCalls += 1; return { signatures: [] } } },
			operationGate: passthroughGate(() => { gateRuns += 1 }),
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_UNIT' })
		expect(gateRuns).toBe(0)
		expect(mintCalls).toBe(0)
	})

	test('winner and refund recipients are derived from the signed bid semantics before signing or mint I/O', async () => {
		const winner = fixtureContract('winner_settlement')
		winner.recipientPublicKey = BIDDER_PUBLIC
		let mintCalls = 0
		await expect(executeDemoSigAllSwap({
			contract: winner,
			committee: directCommittee(),
			mint: { async swapExact() { mintCalls += 1; return { signatures: [] } } },
			operationGate: passthroughGate(),
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_SELLER_RECIPIENT' })

		const refund = fixtureContract('refund')
		refund.recipientPublicKey = RECIPIENT_PUBLIC
		await expect(executeDemoSigAllSwap({
			contract: refund,
			committee: directCommittee(),
			mint: { async swapExact() { mintCalls += 1; return { signatures: [] } } },
			operationGate: passthroughGate(),
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_REFUND_RECIPIENT' })
		expect(mintCalls).toBe(0)
	})

	test('a committee result claiming only three participants cannot reach the mint', async () => {
		const contract = fixtureContract('refund')
		let mintCalls = 0
		await expect(executeDemoSigAllSwap({
			contract,
			committee: {
				async authorize(request: DemoCommitteeAuthorizationRequest) {
					return {
						schema: 'COCO_DEMO_FROST_AUTHORIZATION_V1',
						sessionId: request.sessionId,
						packageDigest: request.packageDigest,
						cashuSigAllDigest: request.cashuSigAllDigest,
						committeeKeysetId: request.committeeKeysetId,
						committeeKeysetVersion: request.committeeKeysetVersion,
						participantIds: [1, 2, 3] as unknown as [1, 2, 3, 4],
						transcriptHash: '77'.repeat(32),
						signature: sign(request.cashuSigAllDigest, COMMITTEE_FIXTURE_PRIVATE),
					}
				},
			} as unknown as DemoFourOfFourCommitteePort,
			mint: { async swapExact() { mintCalls += 1; return { signatures: [] } } },
			operationGate: passthroughGate(),
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_NOT_FOUR_OF_FOUR' })
		expect(mintCalls).toBe(0)
	})

	test('duplicate proof secrets are refused even when SIG_ALL data and tags match', async () => {
		const contract = fixtureContract()
		contract.inputs[1] = { ...contract.inputs[1], secret: contract.inputs[0].secret }
		let mintCalls = 0
		await expect(executeDemoSigAllSwap({
			contract,
			committee: directCommittee(),
			mint: { async swapExact() { mintCalls += 1; return { signatures: [] } } },
			operationGate: passthroughGate(),
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_DUPLICATE_PROOF_SECRET' })
		expect(mintCalls).toBe(0)
	})

	test('one withheld round-two participant blocks aggregation and mint spend', async () => {
		const contract = fixtureContract()
		let aggregateCalls = 0
		let mintCalls = 0
		const participantPorts = [1, 2, 3, 4].map((identifier): DemoFrostParticipantPort => ({
			participantId: identifier as DemoParticipantId,
			verifyingShare: participants[identifier - 1].verifyingShare,
			async roundOne(request) {
				return {
					participantId: identifier as DemoParticipantId,
					sessionId: request.sessionId,
					digest: request.digest,
					hiding: publicKey(key(50 + identifier)),
					binding: publicKey(key(60 + identifier)),
				}
			},
			async roundTwo(request) {
				if (identifier === 4) throw new Error('validator 4 withheld')
				return {
					participantId: identifier as DemoParticipantId,
					sessionId: request.sessionId,
					digest: request.digest,
					transcriptHash: request.transcriptHash,
					share: identifier.toString(16).padStart(64, '0'),
				}
			},
		}))
		const committee = createFourOfFourCommitteePort(participantPorts, {
			async aggregate() {
				aggregateCalls += 1
				throw new Error('must not aggregate')
			},
		})
		await expect(executeDemoSigAllSwap({
			contract,
			committee,
			mint: { async swapExact() { mintCalls += 1; return { signatures: [] } } },
			operationGate: passthroughGate(),
		})).rejects.toMatchObject({
			code: 'DEMO_SIGALL_FOUR_OF_FOUR_UNAVAILABLE',
			message: expect.stringContaining('validator 4 withheld'),
		})
		expect(aggregateCalls).toBe(0)
		expect(mintCalls).toBe(0)
	})

	test('duplicate public commitments or scalar shares cannot reach aggregation or mint spend', async () => {
		for (const duplicate of ['commitment', 'share'] as const) {
			const contract = fixtureContract()
			let aggregateCalls = 0
			let mintCalls = 0
			const participantPorts = [1, 2, 3, 4].map((identifier): DemoFrostParticipantPort => ({
				participantId: identifier as DemoParticipantId,
				verifyingShare: participants[identifier - 1].verifyingShare,
				async roundOne(request) {
					return {
						participantId: identifier as DemoParticipantId,
						sessionId: request.sessionId,
						digest: request.digest,
						hiding: duplicate === 'commitment' && identifier === 2
							? oppositeParity(publicKey(key(51)))
							: publicKey(key(50 + identifier)),
						binding: publicKey(key(60 + identifier)),
					}
				},
				async roundTwo(request) {
					return {
						participantId: identifier as DemoParticipantId,
						sessionId: request.sessionId,
						digest: request.digest,
						transcriptHash: request.transcriptHash,
						share: (duplicate === 'share' ? 1 : identifier).toString(16).padStart(64, '0'),
					}
				},
			}))
			const committee = createFourOfFourCommitteePort(participantPorts, {
				async aggregate() {
					aggregateCalls += 1
					throw new Error('must not aggregate')
				},
			})
			await expect(executeDemoSigAllSwap({
				contract,
				committee,
				mint: { async swapExact() { mintCalls += 1; return { signatures: [] } } },
				operationGate: passthroughGate(),
			})).rejects.toMatchObject({ code: duplicate === 'commitment' ? 'DEMO_SIGALL_FROST_TRANSCRIPT' : 'DEMO_SIGALL_FROST_SHARE' })
			expect(aggregateCalls).toBe(0)
			expect(mintCalls).toBe(0)
		}
	})

	test('the concrete mint adapter pins origin and emits the SIG_ALL witness on only the first input', async () => {
		const seen: Array<{ url: string; body?: Record<string, unknown> }> = []
		let nut11Supported = true
		let expireDuringPreflight = false
		let mintClock = 1_999_999_900
		const port = createCashuMintSigAllPort({
			mintUrl: 'https://testnut.example',
			nowSeconds: () => mintClock,
			fetchImpl: (async (input, init) => {
				const url = String(input)
				const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as Record<string, unknown>
				seen.push({ url, body })
				let responseBody: unknown
				if (url.endsWith('/v1/info')) responseBody = {
					pubkey: publicKey(key(89)),
					version: 'test-mint/1',
					nuts: {
						'4': { disabled: false, methods: [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 1_000 }] },
						'7': { supported: true },
						'10': { supported: true },
						'11': { supported: nut11Supported },
					},
				}
				else if (url.endsWith('/v1/keysets')) responseBody = { keysets: [{ id: 'demo-keyset', unit: 'sat', active: true, input_fee_ppk: 0 }] }
				else if (url.endsWith('/v1/keys/demo-keyset')) {
					if (expireDuringPreflight) mintClock = 1_999_999_940
					responseBody = { keysets: [{ id: 'demo-keyset', unit: 'sat', keys: { '1': publicKey(key(90)), '2': publicKey(key(91)), '4': publicKey(key(92)), '8': publicKey(key(93)) } }] }
				}
				else {
					const outputs = body!.outputs as BlindedMessage[]
					responseBody = { signatures: outputs.map((output, index) => ({ amount: output.amount, id: output.id, C_: publicKey(key(70 + index)) })) }
				}
				const response = new Response(JSON.stringify(responseBody), { status: 200 })
				Object.defineProperty(response, 'url', { value: String(input) })
				return response
			}) as typeof fetch,
		})
		const contract = fixtureContract()
		await executeDemoSigAllSwap({
			contract,
			committee: directCommittee(),
			mint: port,
			operationGate: passthroughGate(),
		})
		expect(seen).toHaveLength(4)
		expect(seen[3].url).toBe('https://testnut.example/v1/swap')
		const inputs = seen[3].body!.inputs as CashuProof[]
		expect(inputs).toHaveLength(2)
		expect(typeof inputs[0].witness).toBe('string')
		expect(inputs.slice(1).every((input) => input.witness === undefined)).toBe(true)

		nut11Supported = false
		await expect(executeDemoSigAllSwap({
			contract: fixtureContract(),
			committee: directCommittee(),
			mint: port,
			operationGate: passthroughGate(),
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_MINT_DRIFT' })
		expect(seen).toHaveLength(7)

		await expect(port.swapExact({
			schema: 'COCO_DEMO_SIGALL_SWAP_V1',
			mintUrl: 'https://redirected.example',
			operationId: 'x',
			locktime: 2_000_000_000,
			packageDigest: '00'.repeat(32),
			cashuSigAllDigest: '00'.repeat(32),
			recipientCapabilityDigest: '00'.repeat(32),
			mintSeal: contract.mintSeal,
			inputs: [],
			outputs: [],
		})).rejects.toBeInstanceOf(DemoSigAllRefusedError)
		expect(seen).toHaveLength(7)

		nut11Supported = true
		expireDuringPreflight = true
		mintClock = 1_999_999_900
		await expect(executeDemoSigAllSwap({
			contract: fixtureContract(),
			committee: directCommittee(),
			mint: port,
			operationGate: passthroughGate(),
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_SETTLEMENT_CUTOFF' })
		expect(seen).toHaveLength(10)
		expect(seen.some((request, index) => index >= 7 && request.url.endsWith('/v1/swap'))).toBe(false)
	})
})
