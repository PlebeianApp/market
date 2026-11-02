import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { getEncodedToken } from '@cashu/coco-core'
import {
	blindMessage, constructUnblindedSignature, createBlindSignature, createDLEQProof, pointFromHex,
} from '@cashu/cashu-ts'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	createDemoFridayBrowserFundingAbortClient,
	demoFridayBrowserAbortPoolDigest,
	type DemoFridayBrowserAbortJournalPort,
	type DemoFridayBrowserAbortRecordV1,
	type DemoFridayBrowserAbortStatusV1,
} from './demo-friday-browser-funding-abort'
import { createDemoFridayBrowserExactEnvelopeBuilder } from './demo-friday-browser-exact-envelope-builder'
import {
	createDemoFridayFundingAbortCapsuleExecutor,
	prepareDemoFridayFundingAbortCapsuleExact,
} from './demo-friday-funding-abort-capsule-executor'
import {
	DemoFundingAbortCapsuleEncryptedSqliteStore,
	DemoSigAllRecoverySqliteStore,
} from './demo-integrated-private-sqlite'
import type { DemoFridayBrowserCocoWallet } from './demo-friday-browser-coco-wallet'
import { createDemoFridayOperationBoundSigning, demoFridayBrowserPublicOperation } from './demo-friday-browser-coco-client'
import {
	createDemoFridayBrowserPaymentOperation,
	type DemoFridayBrowserOperationIdentity,
	type DemoFridayBrowserPaymentOperationV1,
	validateDemoFridayBrowserPaymentOperation,
	validateDemoFridayBrowserPaymentRevision,
} from './demo-friday-browser-payment-state'
import { demoFridayFundingAbortCapsuleDigest } from './demo-friday-funding-abort-capsule'
import {
	claimDemoFridayCommittedAbort,
	demoFridayFundingAbortActorUnsignedEvent,
	demoFridayFundingAbortCommitteeDigest,
	emptyDemoFridayFundingLifecycleState,
	type DemoFridayFundingAbortCertificateV1,
	type DemoFridayFundingAbortNostrEventV1,
	type DemoFridayFundingAbortPinsV1,
} from './demo-friday-funding-pool-lifecycle'
import { verifyDemoFridayPreparedFundingEnvelope } from './demo-friday-prepared-funding'
import {
	buildDemoSigAllSecret,
	demoDenominationKeyDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
} from './demo-sigall-settlement'
import { createDemoFridayPaymentSignerFromSecret } from './poc-demo-browser-signer'
import { proofPoint, type CashuProof } from './nut-client'

const privateKey = (value: number) => hexToBytes(value.toString(16).padStart(64, '0'))
const compressed = (value: number) => bytesToHex(secp256k1.getPublicKey(privateKey(value), true))
const actorSecret = privateKey(1)
const committeeSecret = privateKey(21)
const actor = bytesToHex(schnorr.getPublicKey(actorSecret))
const mintUrl = 'https://172.105.64.142'
const keysetId = '00deadbeefdeadbe'

function signNostr(
	unsigned: Omit<DemoFridayFundingAbortNostrEventV1, 'id' | 'sig'>,
): DemoFridayFundingAbortNostrEventV1 {
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	return { ...structuredClone(unsigned), id, sig: bytesToHex(schnorr.sign(hexToBytes(id), actorSecret)) }
}

function clone<T>(value: T): T { return structuredClone(value) }

async function buildPreparedOperation(): Promise<{
	operation: DemoFridayBrowserPaymentOperationV1
	lockedToken: string
	proofYs: string[]
}> {
	let next = 5
	const denominationKeys = { '4': compressed(24), '8': compressed(25) }
	const operation = createDemoFridayBrowserPaymentOperation({
		actor, environmentId: 'friday-abort-test', authNetworkId: 'friday-network', chainId: 'friday-chain',
		auctionId: 'auction-1', fundingOperationId: '4'.repeat(64), canonicalMintUrl: mintUrl,
		mintPublicKey: compressed(20), mintServerVersion: 'Nutshell/0.19.2', bidAmount: 12,
		fullPoolAmount: 12, reservedPoolAmount: 12, replacesBidId: '', priorLeaderActor: '',
		winnerRecipientPublicKey: compressed(4), winnerRecipientCapabilityDigest: '0'.repeat(64),
		winnerOutputsDigest: '0'.repeat(64), keysetId,
		denominationKeyDigest: demoDenominationKeyDigest(denominationKeys), denominationAmounts: [4, 8],
		mintNuts: [4, 7, 9, 10, 11, 12], inputFeePpk: 0, committeePublicKey: compressed(21),
		committeeKeysetId: 'committee-1', committeeKeysetVersion: 'version-1', dkgRunId: 'dkg-1',
		publicKeyPackageSha256: '7'.repeat(64), signerRosterDigest: '8'.repeat(64), locktime: 10_000,
	}, (bytes) => { bytes.fill(0); bytes[31] = next++; return bytes })
	const outputs = (base: number) => [
		{ amount: 4, id: operation.keysetId, B_: compressed(base) },
		{ amount: 8, id: operation.keysetId, B_: compressed(base + 1) },
	]
	const request = (role: 'winner_settlement' | 'refund', recipientPublicKey: string,
		recipientSecret: Uint8Array, plannedOutputs: ReturnType<typeof outputs>) => {
		const capability = { schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1' as const,
			network: operation.authNetworkId, chainId: operation.chainId, auctionId: operation.auctionId,
			operationId: operation.fundingOperationId, role, mintUrl, unit: 'sat' as const,
			recipientPublicKey, outputsDigest: demoOutputsDigest(plannedOutputs), signature: '' }
		capability.signature = bytesToHex(schnorr.sign(hexToBytes(demoRecipientCapabilityDigest(capability)), recipientSecret))
		return { capability, outputs: plannedOutputs }
	}
	const winnerRequest = request('winner_settlement', compressed(4), privateKey(4), outputs(30))
	const refundSecret = hexToBytes(operation.refundSecret)
	const refundRequest = request('refund', operation.refundPublicKey, refundSecret, outputs(32))
	operation.winnerRecipientCapabilityDigest = demoRecipientCapabilityDigest(winnerRequest.capability)
	operation.winnerOutputsDigest = demoOutputsDigest(winnerRequest.outputs)
	const proofs: CashuProof[] = [4, 8].map((amount, index) => {
		const secret = buildDemoSigAllSecret({
			nonce: (index === 0 ? '9' : 'a').repeat(64), bidderPublicKey: operation.paymentPublicKey,
			committeePublicKey: operation.lock.committeePubkey, refundPublicKey: operation.refundPublicKey,
			locktime: operation.lock.locktime,
		})
		const mintSecret = privateKey(amount === 4 ? 24 : 25)
		const blinded = blindMessage(utf8ToBytes(secret), BigInt(index + 1))
		const signature = createBlindSignature(blinded.B_, mintSecret, operation.keysetId)
		const dleq = createDLEQProof(blinded.B_, mintSecret)
		const unblinded = constructUnblindedSignature(signature, blinded.r,
			utf8ToBytes(secret), pointFromHex(denominationKeys[String(amount) as '4' | '8']))
		return { amount, id: operation.keysetId, secret, C: unblinded.C.toHex(true),
			dleq: { e: bytesToHex(dleq.e), s: bytesToHex(dleq.s),
				r: blinded.r.toString(16).padStart(64, '0') } }
	}).sort((left, right) => bytesToHex(proofPoint(right).toBytes(true))
		.localeCompare(bytesToHex(proofPoint(left).toBytes(true))))
	const lockedToken = getEncodedToken({ mint: mintUrl, unit: 'sat', proofs } as never)
	const paymentSigner = createDemoFridayPaymentSignerFromSecret(hexToBytes(operation.paymentSecret))
	const refundSigner = createDemoFridayPaymentSignerFromSecret(refundSecret)
	try {
		const refundDelivery = { intent: { schema: 'COCO_DEMO_RECIPIENT_INTENT_V1' as const,
			network: operation.authNetworkId, chainId: operation.chainId, auctionId: operation.auctionId,
			operationId: operation.fundingOperationId, role: 'refund' as const, mintUrl, unit: 'sat' as const,
			recipientPublicKey: operation.refundPublicKey, amounts: [4, 8],
		}, keyset: { id: operation.keysetId, unit: 'sat' as const, keys: denominationKeys } }
		const abortSigning = createDemoFridayOperationBoundSigning({ operation, paymentSigner, refundSigner,
			nostrSigner: { async getPublicKey() { return actor }, async signEvent(unsigned) { return signNostr(unsigned as never) } },
			lockedToken, winnerRequest, refundRequest })
		const builder = createDemoFridayBrowserExactEnvelopeBuilder({ participants: [1, 2, 3, 4].map((identifier) => ({
			identifier: identifier as 1 | 2 | 3 | 4, verifyingShare: compressed(50 + identifier),
		})) as never })
		const capsule = await builder.buildAbortCapsuleExact({
			operation: demoFridayBrowserPublicOperation(operation), lockedToken,
			keyset: refundDelivery.keyset, refundDelivery, refundRequest, signing: abortSigning, nowSeconds: 999,
		})
		const signing = createDemoFridayOperationBoundSigning({ operation, paymentSigner, refundSigner,
			nostrSigner: { async getPublicKey() { return actor }, async signEvent(unsigned) { return signNostr(unsigned as never) } },
			lockedToken, winnerRequest, refundRequest })
		const built = await builder.buildExact({ operation: demoFridayBrowserPublicOperation(operation), lockedToken,
			keyset: refundDelivery.keyset,
			winnerRequest, refundDelivery,
			refundRequest, signing, nowSeconds: 1_000 })
		const verified = verifyDemoFridayPreparedFundingEnvelope(built.envelope, {
			authNetworkId: operation.authNetworkId, chainId: operation.chainId, mintUrl, nowSeconds: 1_000,
		})
		operation.phase = 'envelope_prepared'
		operation.abortCapsule = capsule
		operation.refundDelivery = refundDelivery
		operation.envelope = built.envelope
		operation.fundingAuthorizationEventId = verified.authorization.event.id
		return { operation, lockedToken,
			proofYs: proofs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort() }
	} finally {
		paymentSigner.dispose(); refundSigner.dispose(); refundSecret.fill(0)
	}
}

async function harness(lifecycle?: { runWalletExclusive: import('./demo-friday-browser-payment-state').DemoFridayBrowserPaymentStatePort['runWalletExclusive']; dispose(): Promise<void> }) {
	const { operation, lockedToken, proofYs } = await buildPreparedOperation()
	const identity: DemoFridayBrowserOperationIdentity = { actor, environmentId: operation.environmentId,
		fundingOperationId: operation.fundingOperationId }
	const pins: DemoFridayFundingAbortPinsV1 = {
		authNetworkId: operation.authNetworkId, chainId: operation.chainId, genesisSha256: '6'.repeat(64),
		mintUrl, activeKeysetId: operation.keysetId, committeePublicKey: operation.lock.committeePubkey,
		committeeKeysetId: operation.committeeKeysetId, committeeKeysetVersion: operation.committeeKeysetVersion,
		dkgRunId: operation.dkgRunId, publicKeyPackageSha256: operation.publicKeyPackageSha256,
		signerRosterDigest: operation.signerRosterDigest,
	}
	const refund = operation.abortCapsule!.refund
	const terms = {
		schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_V1' as const, authNetworkId: pins.authNetworkId,
		chainId: pins.chainId, genesisSha256: pins.genesisSha256, auctionId: operation.auctionId,
		operationId: operation.fundingOperationId, actor, mintUrl, activeKeysetId: operation.keysetId,
		amount: operation.fullPoolAmount, proofYs, poolDigest: demoFridayBrowserAbortPoolDigest({
			mintUrl, keysetId: operation.keysetId, amount: operation.fullPoolAmount, proofYs,
		}), nut11LockPublicKeys: [operation.paymentPublicKey, operation.lock.committeePubkey] as [string, string],
		locktime: operation.lock.locktime, paymentPublicKey: operation.paymentPublicKey,
		refundPublicKey: operation.refundPublicKey, committeePublicKey: operation.lock.committeePubkey,
		returnPackageDigest: refund.templateDigest, returnCashuSigAllDigest: refund.cashuSigAllDigest,
		bidderReturnSignature: refund.bidderMainSignature,
		fundingAuthorizationEventId: operation.abortCapsule!.capsuleDigest, abortNotBefore: 1_000,
		abortExpiresAt: 1_200, abortReason: 'prebroadcast_client_abandonment' as const,
		committeeKeysetId: operation.committeeKeysetId, committeeKeysetVersion: operation.committeeKeysetVersion,
		dkgRunId: operation.dkgRunId, publicKeyPackageSha256: operation.publicKeyPackageSha256,
		signerRosterDigest: operation.signerRosterDigest,
	}
	let record: DemoFridayBrowserAbortRecordV1 | null = null
	const journal: DemoFridayBrowserAbortJournalPort = {
		async runExclusive(_identity, run) { return run() },
		async loadExact() { return record === null ? null : clone(record) },
		async saveExact(next, expectedRevision) {
			expect(record?.revision ?? null).toBe(expectedRevision)
			record = clone(next)
		},
	}
	let signed: DemoFridayFundingAbortNostrEventV1 | undefined
	const makeCommitted = (): DemoFridayBrowserAbortStatusV1 => {
		if (signed === undefined) throw new Error('event not signed')
		const certificate: DemoFridayFundingAbortCertificateV1 = { ...clone(terms), participantPolicyDigest: '9'.repeat(64),
			actorAbortEvent: clone(signed), committeeAbortSignature: '' }
		const { committeeAbortSignature: _signature, ...committeeUnsigned } = certificate
		certificate.committeeAbortSignature = bytesToHex(schnorr.sign(
			hexToBytes(demoFridayFundingAbortCommitteeDigest(committeeUnsigned)), committeeSecret))
		const lifecycle = claimDemoFridayCommittedAbort(emptyDemoFridayFundingLifecycleState(), certificate,
			pins, '0'.repeat(64), 42, 1_100)
		const lifecycleEventId = lifecycle.records[operation.fundingOperationId]!.abortCertificateDigest!
		return { schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_STATUS_V1',
			preparationId: '5'.repeat(64), actor, fundingOperationId: operation.fundingOperationId,
			status: 'COMMITTED_ABORT', certificate,
			finality: { schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_FINALITY_V1',
				actorAuthorizationEventId: signed.id, lifecycleEventId,
				transactionHash: 'a'.repeat(64), committedHeight: 42, committedAt: 1_100,
				appHash: 'b'.repeat(64), blockHash: 'c'.repeat(64), commitSignatures: 3 },
			proofStates: proofYs.map((proofY) => ({ proofY, state: 'UNSPENT' as const })),
		}
	}
	let status: DemoFridayBrowserAbortStatusV1 = { schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_STATUS_V1',
		preparationId: '5'.repeat(64), actor, fundingOperationId: operation.fundingOperationId, status: 'PENDING' }
	let throwRequest = false
	let commitOnRequest = false
	let importReceipt = true
	let operationLockHeld = false
	let walletLockHeld = false
	let requestCalls = 0, importCalls = 0, discovered = 0
	const client = createDemoFridayBrowserFundingAbortClient({ pins,
		state: {
			async loadOperation() { return clone(operation) },
			async runWalletExclusive(_identity, run) {
				if (lifecycle !== undefined) return lifecycle.runWalletExclusive(_identity, run)
				expect(walletLockHeld).toBe(false)
				walletLockHeld = true
				try { return await run() } finally { walletLockHeld = false }
			},
		},
		journal: {
			...journal,
			async runExclusive(_identity, run) {
				expect(operationLockHeld).toBe(false)
				operationLockHeld = true
				try { return await run() } finally { operationLockHeld = false }
			},
		},
		discovery: { async assertRetainedExact() { discovered++ }, async markImportedExact() {} },
		walletFactory: { async openExact() { return {
			async recoverThresholdFunding() { return { operationId: operation.fundingOperationId,
				token: lockedToken, state: 'pending' as const, amount: operation.fullPoolAmount, keysetId } },
			async dispose() { await lifecycle?.dispose() },
		} as unknown as DemoFridayBrowserCocoWallet } },
		nostrSigner: { async getPublicKey() { return actor }, async signEvent(unsigned) {
			signed = signNostr(unsigned); return clone(signed)
		} },
		authority: {
			async registerCapsuleExact(capsule) { return { capsuleDigest: capsule.capsuleDigest } },
			async prepareExact() { return { schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_PREPARATION_V1',
				preparationId: '5'.repeat(64), terms: clone(terms) } },
			async requestAbortExact(request) { requestCalls++; signed = clone(request.actorAbortEvent)
				if (throwRequest) throw new Error('response lost')
				if (commitOnRequest) status = makeCommitted()
				return clone(status) },
			async readExact() { return clone(status) },
		},
		returns: { async importReturnExact() {
			expect(operationLockHeld).toBe(false)
			importCalls++; return importReceipt ? {
			schema: 'COCO_DEMO_RECIPIENT_IMPORT_RECEIPT_V1', operationId: operation.fundingOperationId,
			role: 'refund', recipientPublicKey: operation.refundPublicKey, amount: operation.fullPoolAmount,
			proofCount: proofYs.length, imported: true, alreadyImported: importCalls > 1,
		} : null } }, nowSeconds: () => 1_050,
	})
	return { client, identity, operation, proofYs, get record() { return record },
		makeCommitted, setStatus(next: DemoFridayBrowserAbortStatusV1) { status = clone(next) },
		seedSignedWithoutSubmit() {
			const preparation = { schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_PREPARATION_V1' as const,
				preparationId: '5'.repeat(64), terms: clone(terms) }
			signed = signNostr(demoFridayFundingAbortActorUnsignedEvent(preparation.terms, 1_050))
			record = { schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_RECORD_V1', revision: 0,
				...identity, phase: 'signed', preparation, actorAbortEvent: clone(signed) }
		},
		setCommitOnRequest(value: boolean) { commitOnRequest = value },
		setThrowRequest(value: boolean) { throwRequest = value }, setImport(value: boolean) { importReceipt = value },
		counts: () => ({ requestCalls, importCalls, discovered }),
	}
}

describe('Friday browser Coco FundingAbortV1 recovery', () => {
	test('fully validates and freezes the independent abort capsule and refund delivery across revisions', async () => {
		const { operation } = await buildPreparedOperation()
		expect(validateDemoFridayBrowserPaymentOperation(operation).abortCapsule?.capsuleDigest)
			.toBe(operation.abortCapsule?.capsuleDigest)
		const malformed = clone(operation)
		malformed.abortCapsule!.refund.inputs[0]!.dleq!.e = '0'.repeat(64)
		expect(() => validateDemoFridayBrowserPaymentOperation(malformed)).toThrow(/valid independent exact abort/)

		const changedCapsule = clone(operation)
		changedCapsule.revision++
		changedCapsule.abortCapsule!.createdAt++
		changedCapsule.abortCapsule!.capsuleDigest = demoFridayFundingAbortCapsuleDigest({
			schema: changedCapsule.abortCapsule!.schema,
			createdAt: changedCapsule.abortCapsule!.createdAt,
			refund: changedCapsule.abortCapsule!.refund,
			actorReturnAuthorization: changedCapsule.abortCapsule!.actorReturnAuthorization,
		})
		expect(() => validateDemoFridayBrowserPaymentRevision(operation, changedCapsule, operation.revision))
			.toThrow(/immutable terms changed/)

		const changedDelivery = clone(operation)
		changedDelivery.revision++
		changedDelivery.refundDelivery!.intent.amounts.reverse()
		expect(() => validateDemoFridayBrowserPaymentRevision(operation, changedDelivery, operation.revision))
			.toThrow(/immutable terms changed/)
	})

	test('durably authorizes and executes the independent capsule without a synthetic winner bundle', async () => {
		const { operation } = await buildPreparedOperation()
		const capsule = operation.abortCapsule!
		const database = new Database(':memory:', { create: true, strict: true })
		const key = new Uint8Array(32); key.fill(7)
		const capsules = new DemoFundingAbortCapsuleEncryptedSqliteStore(database, key)
		await capsules.persistExact(capsule)
		const refund = capsule.refund
		const claim = { schema: 'COCO_DEMO_INTEGRATED_TERMINAL_AUTHORITY_CLAIM_V2',
			operationId: refund.operationId, operationRoot: refund.templateDigest, network: refund.network,
			chainId: refund.chainId, auctionId: refund.auctionId, bidId: refund.operationId, successorBidId: '',
			cause: 'funding_abort', role: 'refund', outcomeHeight: 42, outcomeStateHash: '1'.repeat(64),
			outcomeEvidenceDigest: '2'.repeat(64), templateDigest: refund.templateDigest,
			cashuSigAllDigest: refund.cashuSigAllDigest, outputsDigest: demoOutputsDigest(refund.outputs),
			proofStateRefs: operation.abortCapsule!.refund.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort(),
			poolAmount: refund.amount, admissionOperationId: refund.operationId,
			admissionReceiptDigest: '3'.repeat(64), committeeKeysetId: refund.committeeKeysetId,
			committeeKeysetVersion: refund.committeeKeysetVersion, dkgRunId: operation.dkgRunId,
			publicKeyPackageSha256: operation.publicKeyPackageSha256,
			signerRosterDigest: operation.signerRosterDigest, status: 'terminal_pending',
		} as const
		const frostOperationRoot = '4'.repeat(64)
		const binding = { operationId: refund.operationId, authorityOperationRoot: refund.templateDigest,
			frostOperationRoot, bindingDigest: '5'.repeat(64) } as never
		const request = { schema: 'COCO_DEMO_FROST_REQUEST_V1', threshold: 3, sessionId: '6'.repeat(64),
			packageDigest: refund.templateDigest, cashuSigAllDigest: refund.cashuSigAllDigest,
			committeePublicKey: refund.committeePublicKey, committeeKeysetId: refund.committeeKeysetId,
			committeeKeysetVersion: refund.committeeKeysetVersion, participants: refund.participants,
			policyPackageDigest: '7'.repeat(64), closureEvidenceDigest: '8'.repeat(64),
			signedBidEvidenceDigest: '9'.repeat(64), committeeLockedProofsDigest: 'a'.repeat(64),
		} as const
		const authorization = { schema: 'COCO_DEMO_MAINTAINER_FEDERATION_AUTHORIZATION_V1', threshold: 3,
			participantIds: [1, 2, 3] as [1, 2, 3], sessionId: request.sessionId,
			packageDigest: request.packageDigest, cashuSigAllDigest: request.cashuSigAllDigest,
			committeeKeysetId: request.committeeKeysetId, committeeKeysetVersion: request.committeeKeysetVersion,
			transcriptHash: 'b'.repeat(64),
			signature: bytesToHex(schnorr.sign(hexToBytes(request.cashuSigAllDigest), committeeSecret)),
			frostOperationRoot,
		} as const
		const prepared = await prepareDemoFridayFundingAbortCapsuleExact({ claim: claim as never,
			executionBinding: binding, capsules, terminalStore: capsules,
			federation: { async authorize() { return structuredClone(authorization) } }, request: request as never })
		const recoveryStore = new DemoSigAllRecoverySqliteStore(database)
		let swaps = 0, imports = 0
		const executor = createDemoFridayFundingAbortCapsuleExecutor({ capsules, terminalStore: capsules,
			recoveryStore, mint: { async swapExact(value) { swaps++; expect(value.operationId).toBe(refund.operationId)
				expect(value.inputs[0]!.witness).toContain(authorization.signature)
				return { signatures: value.outputs.map((output, index) => ({
					amount: output.amount, id: output.id, C_: compressed(80 + index),
				})) } } },
			recovery: { async reconcileExact() { throw new Error('not used') } },
			terminalResponse: { async restoreCompleted() { throw new Error('not used') } },
			recipientActorId: actor, recipientFor() { return { async deliverExact(value) { imports++
				expect(value.templateDigest).toBe(refund.templateDigest)
				return { imported: true as const, alreadyImported: false } } } },
			now: () => 1_000, nowSeconds: () => 1_000,
		})
		expect(await executor.readPreparedExact(prepared.identity)).toEqual(prepared.prepared)
		const result = await executor.executeExact(prepared.identity)
		expect(result.status).toBe('refunded')
		expect({ swaps, imports }).toEqual({ swaps: 1, imports: 1 })
		database.close(false); key.fill(0)
	})

	test('imports one exact refund only after validator-confirmed abort and replays the receipt', async () => {
		const run = await harness()
		run.setCommitOnRequest(true)
		const first = await run.client.requestExact(run.identity, 'prebroadcast_client_abandonment')
		expect(first.status).toBe('COMMITTED_ABORT')
		expect(first.status === 'COMMITTED_ABORT' && first.imported).toBe(true)
		expect(run.record?.actorAbortEvent.kind).toBe(28_650)
		const replay = await run.client.recoverExact(run.identity)
		expect(replay.status === 'COMMITTED_ABORT' && replay.imported && replay.replay).toBe(true)
		expect(run.counts()).toEqual({ requestCalls: 1, importCalls: 1, discovered: 2 })
	})

	test('keeps a lost broadcast response unavailable across restart until exact committed finality appears', async () => {
		const run = await harness()
		run.setThrowRequest(true)
		expect(await run.client.requestExact(run.identity, 'prebroadcast_client_abandonment'))
			.toEqual({ status: 'UNAVAILABLE', reason: 'UNKNOWN' })
		expect(run.record?.phase).toBe('broadcast_unknown')
		run.setThrowRequest(false)
		run.setStatus(run.makeCommitted())
		const recovered = await run.client.recoverExact(run.identity)
		expect(recovered.status === 'COMMITTED_ABORT' && recovered.imported).toBe(true)
		expect(run.counts().requestCalls).toBe(1)
	})

	test('submits the identical durable signed cancellation after a crash before the first request', async () => {
		const run = await harness()
		run.seedSignedWithoutSubmit()
		expect(run.counts().requestCalls).toBe(0)
		run.setCommitOnRequest(true)
		const recovered = await run.client.recoverExact(run.identity)
		expect(recovered.status === 'COMMITTED_ABORT' && recovered.imported).toBe(true)
		expect(run.counts().requestCalls).toBe(1)
		expect(run.record?.phase).toBe('imported')
	})

	test('does not infer cancellation from pending, unknown, or spent proof state', async () => {
		for (const unavailable of ['PENDING', 'UNKNOWN', 'SPENT'] as const) {
			const run = await harness()
			run.setStatus({ schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_STATUS_V1',
				preparationId: '5'.repeat(64), actor, fundingOperationId: run.operation.fundingOperationId,
				status: unavailable })
			expect(await run.client.requestExact(run.identity, 'prebroadcast_client_abandonment'))
				.toEqual({ status: 'UNAVAILABLE', reason: unavailable })
			expect(run.counts().importCalls).toBe(0)
		}
	})

	test('accepts uniformly SPENT inputs only after committed abort and exact return delivery', async () => {
		const run = await harness()
		expect(await run.client.requestExact(run.identity, 'prebroadcast_client_abandonment'))
			.toEqual({ status: 'UNAVAILABLE', reason: 'PENDING' })
		const committed = run.makeCommitted()
		if (committed.status !== 'COMMITTED_ABORT') throw new Error('fixture')
		committed.proofStates = committed.proofStates.map(({ proofY }) => ({ proofY, state: 'SPENT' }))
		run.setStatus(committed)
		const recovered = await run.client.recoverExact(run.identity)
		expect(recovered.status === 'COMMITTED_ABORT' && recovered.imported).toBe(true)
		expect(run.counts().importCalls).toBe(1)
	})

	test('rejects mutated finality and resumes an interrupted once-only import', async () => {
		const mutated = await harness()
		expect(await mutated.client.requestExact(mutated.identity, 'prebroadcast_client_abandonment'))
			.toEqual({ status: 'UNAVAILABLE', reason: 'PENDING' })
		const bad = mutated.makeCommitted()
		if (bad.status !== 'COMMITTED_ABORT') throw new Error('fixture')
		bad.finality.actorAuthorizationEventId = 'd'.repeat(64)
		mutated.setStatus(bad)
		await expect(mutated.client.recoverExact(mutated.identity))
			.rejects.toThrow('changed the prepared actor authorization')
		expect(mutated.counts().importCalls).toBe(0)

		const interrupted = await harness()
		interrupted.setCommitOnRequest(true)
		interrupted.setImport(false)
		expect(await interrupted.client.requestExact(interrupted.identity, 'prebroadcast_client_abandonment'))
			.toEqual({ status: 'COMMITTED_ABORT', imported: false })
		expect(interrupted.record?.phase).toBe('committed_abort')
		interrupted.setImport(true)
		const recovered = await interrupted.client.recoverExact(interrupted.identity)
		expect(recovered.status === 'COMMITTED_ABORT' && recovered.imported).toBe(true)
		expect(interrupted.counts().importCalls).toBe(2)
	})

	test('rejects a changed locked pool before NIP-07 signing or broadcast', async () => {
		const run = await harness()
		run.operation.fullPoolAmount = 13
		await expect(run.client.requestExact(run.identity, 'prebroadcast_client_abandonment'))
			.rejects.toThrow('locked pool amount differs')
		expect(run.counts()).toEqual({ requestCalls: 0, importCalls: 0, discovered: 1 })
	})
})


test('P2 abort preparation disposal failure retains the production common lease without signing a replacement',async()=>{
 const {createDemoFridayBrowserPaymentState}=await import('./demo-friday-browser-payment-state')
 let tail=Promise.resolve(),disposals=0
 const locks={request<T>(_name:string,_options:unknown,run:()=>Promise<T>):Promise<T>{const previous=tail;let release!:()=>void;tail=new Promise<void>(r=>{release=r});return previous.then(run).finally(release)}}
 const tab=()=>createDemoFridayBrowserPaymentState({indexedDB:{} as IDBFactory,locks})
 const run=await harness({runWalletExclusive:tab().runWalletExclusive,async dispose(){disposals++;throw new Error('abort cleanup unconfirmed')}})
 await expect(run.client.requestExact(run.identity,'prebroadcast_client_abandonment')).rejects.toThrow(/DRAIN_UNCONFIRMED/)
 expect(disposals).toBe(1);expect(run.counts().requestCalls).toBe(0);let next=false
 await expect(tab().runWalletExclusive(run.identity,async()=>{next=true})).rejects.toThrow(/DRAIN_UNCONFIRMED/);expect(next).toBe(false)
})
