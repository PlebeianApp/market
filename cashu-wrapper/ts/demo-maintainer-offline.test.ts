import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { HDKey } from '@scure/bip32'

import {
	createDemoMaintainerOfflineExecutor,
	demoMaintainerExactTemplateDigest,
	demoMaintainerFederationSessionId,
	demoMaintainerScopeFor,
	demoMaintainerTemplateBundleDigest,
	persistDemoMaintainerTemplatesBeforeAdmission,
	validateDemoMaintainerExactTemplateBundle,
	type DemoMaintainerExactBranchTemplate,
	type DemoMaintainerExactTemplateBundle,
	type DemoMaintainerFinalOutcome,
	type DemoMaintainerOfflineRecord,
	type DemoMaintainerOfflineStore,
} from './demo-maintainer-offline'
import { DemoMaintainerFederationRefusedError, type DemoMaintainerFederationPort } from './demo-maintainer-federation'
import {
	demoIntegratedExecutionRootBindingDigest,
	demoIntegratedProofPoolDigest,
	type DemoIntegratedAuthorityClaim,
	type DemoIntegratedExecutionRootBindingV1,
} from './demo-integrated-authority'
import { DemoIntegratedAuthoritySqliteStore } from './demo-integrated-authority-sqlite'
import { createDemoFridayAuthorizedTerminalQueue } from './demo-friday-authorized-terminal-queue'
import { DemoFridayCoordinatorRollbackAnchorSqlite } from './demo-friday-coordinator-rollback-anchor'
import {
	demoFridayFundingAuthorizationUnsignedEvent,
	demoFridayFundingKeyAuthorizationDigest,
} from './demo-friday-browser-funding-authorization'
import {
	DemoFridayPreparedFundingAdmission,
	DemoFridayFundingReplaySqlite,
	DemoFridayFundingReplayRollbackAnchorSqlite,
	verifyDemoFridayPreparedFundingEnvelope,
} from './demo-friday-prepared-funding'
import { DemoMaintainerEncryptedSqliteStore } from './demo-integrated-private-sqlite'
import { createDemoFridayCoordinatorWorker, DemoFridayCoordinatorSqlite } from './demo-friday-coordinator-runtime'
import { createDemoFridayTerminalExecutorPorts } from './demo-friday-terminal-executor-runtime'
import type { DemoSigAllRecoveryRecord, DemoSigAllRecoveryStore } from './demo-sigall-recovery'
import {
	buildDemoSigAllSecret,
	demoCashuSigAllDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
	type DemoCommitteeParticipant,
	type DemoSigAllMintPort,
} from './demo-sigall-settlement'
import { proofPoint, type BlindedMessage, type BlindedSignature, type CashuProof } from './nut-client'

const scalar = (value: number): string => value.toString(16).padStart(64, '0')
const publicKey = (privateKey: string): string => bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), true))
const sign = (digest: string, privateKey: string): string => bytesToHex(schnorr.sign(hexToBytes(digest), hexToBytes(privateKey)))
const digest = (byte: string): string => byte.repeat(64)

const BIDDER_PRIVATE = scalar(1)
const ACTOR_PRIVATE = scalar(2)
const COMMITTEE_PRIVATE = scalar(3)
const REFUND_PRIVATE = scalar(4)
const BIDDER_PUBLIC = publicKey(BIDDER_PRIVATE)
const ACTOR_ID = publicKey(ACTOR_PRIVATE).slice(2)
const COMMITTEE_PUBLIC = publicKey(COMMITTEE_PRIVATE)
const REFUND_PUBLIC = publicKey(REFUND_PRIVATE)
const SELLER_ROOT = HDKey.fromMasterSeed(new Uint8Array(32).fill(0x42))
const SELLER_XPUB = SELLER_ROOT.publicExtendedKey
const BIDDER_PATH = 'm/1/2/3/4/5'
const SELLER_PRIVATE = bytesToHex(SELLER_ROOT.derive(BIDDER_PATH).privateKey!)
const SELLER_PUBLIC = publicKey(SELLER_PRIVATE)
const LOCKTIME = 2_000_000_000
const PREPARED_AT = 1_999_990_000
const VALID_UNTIL = 1_999_995_000
const CLOSE_TIME = 1_999_995_000
const SETTLEMENT_WINDOW_SECONDS = 1_000
const BEFORE_CUTOFF = 1_999_998_000

const participants = [1, 2, 3, 4].map((identifier) => ({
	identifier: identifier as 1 | 2 | 3 | 4,
	verifyingShare: publicKey(scalar(10 + identifier)),
})) satisfies DemoCommitteeParticipant[]

function exactBranch(role: 'winner_settlement' | 'refund'): DemoMaintainerExactBranchTemplate {
	const inputs: CashuProof[] = [4, 8].map((amount, index) => ({
		amount,
		id: 'keyset-1',
		secret: buildDemoSigAllSecret({
			nonce: `${index + 1}`.padStart(64, '0'),
			bidderPublicKey: BIDDER_PUBLIC,
			committeePublicKey: COMMITTEE_PUBLIC,
			refundPublicKey: REFUND_PUBLIC,
			locktime: LOCKTIME,
		}),
		C: publicKey(scalar(30 + index)),
	}))
	const outputs: BlindedMessage[] = role === 'winner_settlement'
		? [{ amount: 4, id: 'keyset-1', B_: publicKey(scalar(40)) }, { amount: 8, id: 'keyset-1', B_: publicKey(scalar(41)) }]
		: [{ amount: 12, id: 'keyset-1', B_: publicKey(scalar(42)) }]
	const recipientPublicKey = role === 'winner_settlement' ? SELLER_PUBLIC : REFUND_PUBLIC
	const recipientPrivate = role === 'winner_settlement' ? SELLER_PRIVATE : REFUND_PRIVATE
	const capabilityBase = {
		schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1' as const,
		network: digest('a'),
		chainId: 'demo-chain',
		auctionId: 'auction-1',
		operationId: 'operation-1',
		role,
		mintUrl: 'https://testnut.example',
		unit: 'sat',
		recipientPublicKey,
		outputsDigest: demoOutputsDigest(outputs),
		signature: '00'.repeat(64),
	}
	const recipientCapability = {
		...capabilityBase,
		signature: sign(demoRecipientCapabilityDigest(capabilityBase), recipientPrivate),
	}
	const cashuSigAllDigest = demoCashuSigAllDigest(inputs, outputs)
	const branch: DemoMaintainerExactBranchTemplate = {
		schema: 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V1',
		role,
		network: capabilityBase.network,
		chainId: capabilityBase.chainId,
		auctionId: capabilityBase.auctionId,
		operationId: capabilityBase.operationId,
		bidId: 'bid-1',
		bidEventId: digest('b'),
		bidderActorId: ACTOR_ID,
		amount: 12,
		inputFee: 0,
		mintUrl: capabilityBase.mintUrl,
		unit: 'sat',
		locktime: LOCKTIME,
		validUntil: VALID_UNTIL,
		closeTime: CLOSE_TIME,
		settlementWindowSeconds: SETTLEMENT_WINDOW_SECONDS,
		sellerP2pkXpub: SELLER_XPUB,
		bidderDerivationPath: BIDDER_PATH,
		recipientPublicKey,
		bidderPublicKey: BIDDER_PUBLIC,
		refundPublicKey: REFUND_PUBLIC,
		committeePublicKey: COMMITTEE_PUBLIC,
		committeeKeysetId: 'candidate-3-of-4',
		committeeKeysetVersion: 'not-activated',
		threshold: 3,
		participants: participants.map((participant) => ({ ...participant })),
		mintSeal: {
			mintUrl: capabilityBase.mintUrl,
			mintPublicKey: publicKey(scalar(80)),
			serverVersion: 'offline-only/1',
			activeSatKeysetId: 'keyset-1',
			denominationKeyDigest: digest('c'),
			denominationAmounts: [1, 2, 4, 8, 12],
			inputFeePpk: 0,
			nuts: [4, 7, 9, 10, 11],
		},
		inputs,
		outputs,
		recipientCapability,
		templateDigest: digest('0'),
		cashuSigAllDigest,
		bidderMainSignature: sign(cashuSigAllDigest, BIDDER_PRIVATE),
		...(role === 'refund' ? { refundSignature: sign(cashuSigAllDigest, REFUND_PRIVATE) } : {}),
	}
	branch.templateDigest = demoMaintainerExactTemplateDigest(branch)
	return branch
}

function bundle(): DemoMaintainerExactTemplateBundle {
	const winner = exactBranch('winner_settlement')
	const refund = exactBranch('refund')
	const value: DemoMaintainerExactTemplateBundle = {
		schema: 'COCO_DEMO_MAINTAINER_TEMPLATE_BUNDLE_V1',
		preparedAt: PREPARED_AT,
		winner,
		refund,
		actorWinnerAuthorization: {
			actorId: winner.bidderActorId, packageDigest: winner.templateDigest,
			signature: sign(winner.templateDigest, ACTOR_PRIVATE),
		},
		actorReturnAuthorization: {
			actorId: winner.bidderActorId, packageDigest: refund.templateDigest,
			signature: sign(refund.templateDigest, ACTOR_PRIVATE),
		},
		bundleDigest: digest('0'),
		actorBundleSignature: '00'.repeat(64),
		bidderBundleSignature: '00'.repeat(64),
	}
	value.bundleDigest = demoMaintainerTemplateBundleDigest(value)
	value.actorBundleSignature = sign(value.bundleDigest, ACTOR_PRIVATE)
	value.bidderBundleSignature = sign(value.bundleDigest, BIDDER_PRIVATE)
	return value
}

function resignBundle(value: DemoMaintainerExactTemplateBundle, actorPrivate = ACTOR_PRIVATE): void {
	value.winner.templateDigest = demoMaintainerExactTemplateDigest(value.winner)
	value.refund.templateDigest = demoMaintainerExactTemplateDigest(value.refund)
	const directPaymentKey = value.winner.schema === 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V2'
	value.actorWinnerAuthorization = directPaymentKey ? {
		schema: 'COCO_DEMO_PAYMENT_KEY_PACKAGE_AUTHORIZATION_V1',
		paymentPublicKey: value.winner.bidderPublicKey, packageDigest: value.winner.templateDigest,
		signature: sign(value.winner.templateDigest, BIDDER_PRIVATE),
	} : {
		actorId: value.winner.bidderActorId, packageDigest: value.winner.templateDigest,
		signature: sign(value.winner.templateDigest, actorPrivate),
	}
	value.actorReturnAuthorization = directPaymentKey ? {
		schema: 'COCO_DEMO_PAYMENT_KEY_PACKAGE_AUTHORIZATION_V1',
		paymentPublicKey: value.winner.bidderPublicKey, packageDigest: value.refund.templateDigest,
		signature: sign(value.refund.templateDigest, BIDDER_PRIVATE),
	} : {
		actorId: value.winner.bidderActorId, packageDigest: value.refund.templateDigest,
		signature: sign(value.refund.templateDigest, actorPrivate),
	}
	value.bundleDigest = demoMaintainerTemplateBundleDigest(value)
	value.actorBundleSignature = sign(value.bundleDigest, directPaymentKey ? BIDDER_PRIVATE : actorPrivate)
	value.bidderBundleSignature = sign(value.bundleDigest, BIDDER_PRIVATE)
}

function directSellerBundle(): DemoMaintainerExactTemplateBundle {
	const value = bundle()
	for (const branch of [value.winner, value.refund]) {
		branch.schema = 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V2'
		delete branch.sellerP2pkXpub
		delete branch.bidderDerivationPath
		branch.sellerPaymentPublicKey = SELLER_PUBLIC
	}
	resignBundle(value)
	return value
}

function preparedFundingEnvelope(value = bundle()) {
	const terms = {
		schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1' as const,
		authNetworkId: value.winner.network, chainId: value.winner.chainId,
		auctionId: value.winner.auctionId, amount: value.winner.amount, mintUrl: value.winner.mintUrl,
		paymentPublicKey: value.winner.bidderPublicKey, refundPublicKey: value.winner.refundPublicKey,
		fundingOperationId: value.winner.operationId, bundleDigest: value.bundleDigest,
		returnPackageDigest: value.refund.templateDigest,
		returnCashuSigAllDigest: value.refund.cashuSigAllDigest,
		bidderReturnSignature: value.refund.bidderMainSignature, expiresAt: PREPARED_AT + 200,
	}
	const keyDigest = demoFridayFundingKeyAuthorizationDigest(ACTOR_ID, terms)
	const unsigned = demoFridayFundingAuthorizationUnsignedEvent(ACTOR_ID, PREPARED_AT, {
		...terms,
		paymentKeyAuthorizationSignature: sign(keyDigest, BIDDER_PRIVATE),
		refundKeyAuthorizationSignature: sign(keyDigest, REFUND_PRIVATE),
	})
	const id = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	return {
		schema: 'PLEBEIAN_FRIDAY_PREPARED_FUNDING_ENVELOPE_V1' as const,
		authorization: { ...unsigned, id, sig: sign(id, ACTOR_PRIVATE) }, bundle: value,
	}
}

function outcome(role: 'winner_settlement' | 'refund' = 'winner_settlement'): DemoMaintainerFinalOutcome {
	return {
		schema: 'COCO_DEMO_MAINTAINER_FINAL_OUTCOME_V1',
		network: digest('a'),
		chainId: 'demo-chain',
		auctionId: 'auction-1',
		operationId: 'operation-1',
		bidId: 'bid-1',
		bidEventId: digest('b'),
		bidderActorId: ACTOR_ID,
		role,
		amount: 12,
		outcomeHeight: 42,
		appStateHash: digest('d'),
		policyPackageDigest: digest('e'),
		closureEvidenceDigest: digest('f'),
		signedBidEvidenceDigest: digest('1'),
		committeeLockedProofsDigest: digest('2'),
	}
}

function offlineStore(
	rows = new Map<string, DemoMaintainerOfflineRecord>(),
	nowSeconds: () => number = () => PREPARED_AT,
): DemoMaintainerOfflineStore & { rows: Map<string, DemoMaintainerOfflineRecord> } {
	const clone = (record: DemoMaintainerOfflineRecord) => structuredClone(record)
	return {
		rows,
		async persistPrepared(scope, exact, options) {
			const admittedAt = nowSeconds()
			if (admittedAt > options.notAfter) throw new Error('admission deadline passed')
			const existing = rows.get(scope)
			if (existing !== undefined && JSON.stringify(existing.bundle) !== JSON.stringify(exact)) throw new Error('bundle conflict')
			if (existing === undefined) rows.set(scope, {
				bundle: structuredClone(exact),
				admission: {
					schema: 'COCO_DEMO_MAINTAINER_ADMISSION_RECEIPT_V1',
					bundleDigest: exact.bundleDigest,
					admittedAt,
					notAfter: options.notAfter,
				},
			})
			return clone(rows.get(scope)!)
		},
		async loadExact(scope, bundleDigest) {
			const held = rows.get(scope)
			if (held === undefined || held.bundle.bundleDigest !== bundleDigest) return null
			return clone(held)
		},
		async bindOutcome(scope, bundleDigest, selection) {
			const held = rows.get(scope)
			if (held === undefined || held.bundle.bundleDigest !== bundleDigest) throw new Error('missing bundle')
			if (held.selection !== undefined && JSON.stringify(held.selection) !== JSON.stringify(selection)) throw new Error('outcome conflict')
			held.selection ??= structuredClone(selection)
			return clone(held)
		},
		async reserveFederationAttempt(scope, bundleDigest, selectionRoot, excludeParticipantId) {
			const held = rows.get(scope)
			if (held === undefined || held.bundle.bundleDigest !== bundleDigest || held.selection?.selectionRoot !== selectionRoot) throw new Error('selection conflict')
			const attemptNumber = (held.federationAttempts?.length ?? 0) + 1
			const attempt = {
				schema: 'COCO_DEMO_MAINTAINER_FEDERATION_ATTEMPT_V1' as const,
				attemptNumber,
				sessionId: demoMaintainerFederationSessionId(selectionRoot, attemptNumber),
				...(excludeParticipantId === undefined ? {} : { excludeParticipantId }),
			}
			held.federationAttempts = [...(held.federationAttempts ?? []), structuredClone(attempt)]
			return structuredClone(attempt)
		},
		async saveAuthorization(scope, bundleDigest, selectionRoot, authorization) {
			const held = rows.get(scope)
			if (held === undefined || held.bundle.bundleDigest !== bundleDigest || held.selection?.selectionRoot !== selectionRoot) throw new Error('selection conflict')
			if (held.authorization !== undefined && JSON.stringify(held.authorization) !== JSON.stringify(authorization)) throw new Error('authorization conflict')
			held.authorization ??= structuredClone(authorization)
			return clone(held)
		},
	}
}

function recoveryStore(rows = new Map<string, DemoSigAllRecoveryRecord>()): DemoSigAllRecoveryStore & { rows: Map<string, DemoSigAllRecoveryRecord> } {
	return {
		rows,
		async createOrGet(record) {
			const held = rows.get(record.scope)
			if (held !== undefined) return { record: structuredClone(held), created: false }
			rows.set(record.scope, structuredClone(record))
			return { record: structuredClone(record), created: true }
		},
		async read(scope) { return rows.has(scope) ? structuredClone(rows.get(scope)!) : null },
		async compareAndSwap(scope, expectedRevision, next) {
			const held = rows.get(scope)
			if (held === undefined || held.revision !== expectedRevision || next.revision !== expectedRevision + 1) return false
			rows.set(scope, structuredClone(next))
			return true
		},
	}
}

function federation(
	subset: [1 | 2 | 3 | 4, 1 | 2 | 3 | 4, 1 | 2 | 3 | 4] = [1, 2, 3],
	frostOperationRoot?: string,
): DemoMaintainerFederationPort {
	return {
		async authorize(request) {
			return {
				schema: 'COCO_DEMO_MAINTAINER_FEDERATION_AUTHORIZATION_V1',
				threshold: 3,
				participantIds: subset,
				sessionId: request.sessionId,
				packageDigest: request.packageDigest,
				cashuSigAllDigest: request.cashuSigAllDigest,
				committeeKeysetId: request.committeeKeysetId,
				committeeKeysetVersion: request.committeeKeysetVersion,
				transcriptHash: digest('3'),
				signature: sign(request.cashuSigAllDigest, COMMITTEE_PRIVATE),
				...(frostOperationRoot === undefined ? {} : { frostOperationRoot }),
			}
		},
	}
}

function mintSignatures(selected: DemoMaintainerExactBranchTemplate): BlindedSignature[] {
	return selected.outputs.map((output, index) => ({ amount: output.amount, id: output.id, C_: publicKey(scalar(90 + index)) }))
}

async function prepared(
	selectedOutcome = outcome(),
	stores = { offline: offlineStore(), recovery: recoveryStore() },
	options: {
		mint?: DemoSigAllMintPort
		federation?: DemoMaintainerFederationPort
		nowSeconds?: () => number
		failRecipientOnce?: boolean
	} = {},
) {
	const exactBundle = bundle()
	const identity = await persistDemoMaintainerTemplatesBeforeAdmission({ bundle: exactBundle, store: stores.offline, nowSeconds: () => PREPARED_AT })
	let mintCalls = 0
	let imports = 0
	let failRecipient = options.failRecipientOnce ?? false
	const responses = new Map<string, BlindedSignature[]>()
	const mint: DemoSigAllMintPort = options.mint ?? {
		async swapExact(request) {
			mintCalls += 1
			const branch = request.packageDigest === exactBundle.winner.templateDigest ? exactBundle.winner : exactBundle.refund
			const signatures = mintSignatures(branch)
			responses.set(request.packageDigest, signatures)
			return { signatures }
		},
	}
	const recovery = {
		async reconcileExact(query: { operationRoot: string }) {
			const exact = responses.get(query.operationRoot)
			return exact === undefined ? { status: 'indeterminate' as const, reasonCode: 'not-found' } : { status: 'completed' as const, signatures: structuredClone(exact) }
		},
	}
	const terminalResponse = {
		async restoreCompleted(query: { operationRoot: string }) {
			const exact = responses.get(query.operationRoot)
			return exact === undefined ? null : { signatures: structuredClone(exact) }
		},
	}
	const recipient = {
		async deliverExact() {
			if (failRecipient) { failRecipient = false; throw new Error('recipient process crashed before import') }
			const alreadyImported = imports > 0
			imports += alreadyImported ? 0 : 1
			return { imported: true as const, alreadyImported }
		},
	}
	const executor = createDemoMaintainerOfflineExecutor({
		store: stores.offline,
		outcomes: { async readExact() { return structuredClone(selectedOutcome) } },
		federation: options.federation ?? federation(),
		recoveryStore: stores.recovery,
		mint,
		recovery,
		terminalResponse,
		recipient,
		now: () => 100,
		nowSeconds: options.nowSeconds ?? (() => BEFORE_CUTOFF),
	})
	return {
		exactBundle, identity, executor, stores, responses,
		ports: { mint, recovery, terminalResponse, recipient },
		counts: { get mintCalls() { return mintCalls }, get imports() { return imports } },
	}
}

describe('whole-device-offline exact-template maintainer executor', () => {
	test('accepts a V2 direct Coco seller recipient and rejects a redirected winner', () => {
		const exact = directSellerBundle()
		expect(validateDemoMaintainerExactTemplateBundle(exact, PREPARED_AT, true).winner)
			.toMatchObject({ schema: 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V2', sellerPaymentPublicKey: SELLER_PUBLIC,
				recipientPublicKey: SELLER_PUBLIC })
		const redirected = structuredClone(exact)
		redirected.winner.sellerPaymentPublicKey = publicKey(scalar(91))
		resignBundle(redirected)
		expect(() => validateDemoMaintainerExactTemplateBundle(redirected, PREPARED_AT, true)).toThrow(/redirects/)
	})

	test('recomputes and binds the complete prepared package to browser authorization', () => {
		const exact = preparedFundingEnvelope()
		const verified = verifyDemoFridayPreparedFundingEnvelope(exact, {
			authNetworkId: exact.bundle.winner.network, chainId: exact.bundle.winner.chainId,
			mintUrl: exact.bundle.winner.mintUrl, nowSeconds: PREPARED_AT + 1,
		})
		expect(verified.bundle.bundleDigest).toBe(exact.bundle.bundleDigest)
		expect(verified.scope).toBe(demoMaintainerScopeFor(exact.bundle.winner))

		const changed = structuredClone(exact)
		changed.bundle.refund.outputs[0]!.B_ = publicKey(scalar(98))
		changed.bundle.refund.cashuSigAllDigest = demoCashuSigAllDigest(
			changed.bundle.refund.inputs, changed.bundle.refund.outputs,
		)
		changed.bundle.refund.templateDigest = demoMaintainerExactTemplateDigest(changed.bundle.refund)
		changed.bundle.bundleDigest = demoMaintainerTemplateBundleDigest(changed.bundle)
		expect(() => verifyDemoFridayPreparedFundingEnvelope(changed, {
			authNetworkId: exact.bundle.winner.network, chainId: exact.bundle.winner.chainId,
			mintUrl: exact.bundle.winner.mintUrl, nowSeconds: PREPARED_AT + 1,
		})).toThrow()
	})

	test('durably consumes event, operation, bundle and scope as one replay identity', () => {
		const exact = preparedFundingEnvelope()
		const verified = verifyDemoFridayPreparedFundingEnvelope(exact, {
			authNetworkId: exact.bundle.winner.network, chainId: exact.bundle.winner.chainId,
			mintUrl: exact.bundle.winner.mintUrl, nowSeconds: PREPARED_AT + 1,
		})
		const db = new Database(':memory:')
		try {
			const store = new DemoFridayFundingReplaySqlite(db)
			const claimed = store.claimExact(verified)
			expect(store.claimExact(verified)).toEqual(claimed)
			expect(store.readByOperationExact(claimed.fundingOperationId)).toEqual(claimed)
			expect(store.transitionExact(claimed.eventId, 'claimed', 'stored')).toMatchObject({ phase: 'stored', revision: 1 })
			const commit = {
				schema: 'PLEBEIAN_FRIDAY_FUNDING_ADMISSION_COMMIT_V1' as const,
				eventId: claimed.eventId, bidEventId: digest('5'), fundingOperationId: claimed.fundingOperationId,
				bundleDigest: claimed.bundleDigest, scope: claimed.scope,
				receiptDigest: digest('6'), transactionHash: digest('7'), committedHeight: 42, disposition: 'active' as const,
			}
			expect(store.admitExact(commit)).toMatchObject({ phase: 'admitted', revision: 2, admission: commit })
			expect(store.admitExact(commit)).toMatchObject({ phase: 'admitted', revision: 2, admission: commit })
			const conflict = structuredClone(verified)
			conflict.authorization.event.id = digest('9')
			expect(() => store.claimExact(conflict)).toThrow(/already consumed/)
			expect(() => store.transitionExact(claimed.eventId, 'claimed', 'quarantined')).toThrow(/terminal/)
		} finally { db.close(false) }
	})

	test('composes replay ownership, encrypted exact-package availability and an independent rollback anchor', async () => {
		const exact = preparedFundingEnvelope()
		const replayDb = new Database(':memory:')
		const privateDb = new Database(':memory:')
		const anchorDb = new Database(':memory:')
		try {
			const replay = new DemoFridayFundingReplaySqlite(replayDb, 'friday-blue')
			const anchor = new DemoFridayFundingReplayRollbackAnchorSqlite(anchorDb, true)
			const privateStore = new DemoMaintainerEncryptedSqliteStore(privateDb, new Uint8Array(32).fill(7), () => PREPARED_AT + 1)
			const admission = new DemoFridayPreparedFundingAdmission({
				pins: {
					authNetworkId: exact.bundle.winner.network, chainId: exact.bundle.winner.chainId,
					mintUrl: exact.bundle.winner.mintUrl, nowSeconds: () => PREPARED_AT + 1,
				},
				replay, anchor, privateStore,
				registeredWinner: { async assertRegisteredWinnerExact(request) {
					expect(request.auctionId).toBe(exact.bundle.winner.auctionId)
					expect(request.fundingOperationId).toBe(exact.bundle.winner.operationId)
					expect(request.bidderActor).toBe(exact.authorization.pubkey)
					expect(request.winnerRequest.outputs).toEqual(exact.bundle.winner.outputs)
				} },
			})
			const prepared = await admission.prepareExact(exact)
			expect(prepared.replay).toMatchObject({ phase: 'stored', revision: 1 })
			expect((await admission.readStoredByOperationExact(prepared.replay.fundingOperationId)).stored.bundle)
				.toEqual(exact.bundle)
			expect((await privateStore.loadExact(prepared.identity.scope, prepared.identity.bundleDigest))?.bundle)
				.toEqual(exact.bundle)
			expect((await admission.prepareExact(exact)).replay.phase).toBe('stored')
			const commit = {
				schema: 'PLEBEIAN_FRIDAY_FUNDING_ADMISSION_COMMIT_V1' as const,
				eventId: prepared.replay.eventId, bidEventId: digest('5'),
				fundingOperationId: prepared.replay.fundingOperationId,
				bundleDigest: prepared.replay.bundleDigest, scope: prepared.replay.scope,
				receiptDigest: digest('6'), transactionHash: digest('7'), committedHeight: 42, disposition: 'active' as const,
			}
			expect(admission.markAdmittedExact(commit)).toMatchObject({ phase: 'admitted', revision: 2, admission: commit })
			expect((await admission.prepareExact(exact)).replay.phase).toBe('admitted')
			expect(() => admission.markAdmittedExact({ ...commit, receiptDigest: digest('8') })).toThrow(/changed/)

			const old = replay.anchorSnapshot()
			const replacedDb = new Database(':memory:')
			try {
				const secondReplay = new DemoFridayFundingReplaySqlite(replacedDb, 'friday-blue')
				expect(() => anchor.observeExact(secondReplay.anchorSnapshot())).toThrow(/replaced/)
			} finally { replacedDb.close(false) }
			expect(old.globalRevision).toBe(3)
		} finally { anchorDb.close(false); privateDb.close(false); replayDb.close(false) }
	})

	test('durably prepares exact threshold authorization before any mint effect and reuses it for execution', async () => {
		let federationCalls = 0
		const countedFederation: DemoMaintainerFederationPort = {
			async authorize(request, context) {
				federationCalls += 1
				return federation().authorize(request, context)
			},
		}
		const run = await prepared(outcome(), { offline: offlineStore(), recovery: recoveryStore() }, { federation: countedFederation })
		const receipt = await run.executor.prepareExact(run.identity)
		expect(receipt).toMatchObject({
			schema: 'COCO_DEMO_MAINTAINER_PREPARED_AUTHORIZATION_V1', scope: run.identity.scope,
			bundleDigest: run.identity.bundleDigest, operationId: 'operation-1', role: 'winner_settlement',
		})
		expect(receipt.authorizationDigest).toMatch(/^[0-9a-f]{64}$/)
		expect(run.counts.mintCalls).toBe(0)
		expect(federationCalls).toBe(1)
		const result = await run.executor.executeExact(run.identity)
		expect(result.status).toBe('settled')
		expect(run.counts.mintCalls).toBe(1)
		expect(federationCalls).toBe(1)
	}, 15_000)

	test('moves one authenticated prepared outbid return through the persistent queue and exact executor', async () => {
		const frostOperationRoot = digest('2')
		const run = await prepared(
			outcome('refund'),
			{ offline: offlineStore(), recovery: recoveryStore() },
			{ federation: federation([1, 2, 3], frostOperationRoot) },
		)
		const refund = run.exactBundle.refund
		const integratedIdentity = {
			...run.identity, expectedRole: 'refund' as const,
			expectedOperationId: refund.operationId, expectedOperationRoot: refund.templateDigest,
			expectedFrostOperationRoot: frostOperationRoot,
		}
		const preparedAuthorization = await run.executor.prepareExact(integratedIdentity)
		const proofStateRefs = refund.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
		const authorityClaim: DemoIntegratedAuthorityClaim = {
			schema: 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1', operationId: refund.operationId,
			operationRoot: refund.templateDigest, network: refund.network, chainId: refund.chainId,
			auctionId: refund.auctionId, displacedBidId: refund.bidId, replacementBidId: 'bid-2',
			displacementHeight: 42, templateDigest: refund.templateDigest,
			cashuSigAllDigest: refund.cashuSigAllDigest, outputsDigest: demoOutputsDigest(refund.outputs),
			proofStateRefs, poolAmount: refund.amount, admissionOperationId: refund.operationId,
			admissionReceiptDigest: digest('5'), committeeKeysetId: refund.committeeKeysetId,
			committeeKeysetVersion: refund.committeeKeysetVersion, dkgRunId: 'dkg-1',
			publicKeyPackageSha256: digest('6'), signerRosterDigest: digest('7'),
			status: 'outbid_return_pending',
		}
		const stableBinding: Omit<DemoIntegratedExecutionRootBindingV1, 'bindingDigest'> = {
			schema: 'COCO_DEMO_INTEGRATED_EXECUTION_ROOT_BINDING_V1', operationId: authorityClaim.operationId,
			authorityOperationRoot: authorityClaim.operationRoot,
			frostOperationRoot,
			network: authorityClaim.network, chainId: authorityClaim.chainId, auctionId: authorityClaim.auctionId,
			displacedBidId: authorityClaim.displacedBidId, replacementBidId: authorityClaim.replacementBidId,
			displacementHeight: authorityClaim.displacementHeight, templateDigest: authorityClaim.templateDigest,
			cashuSigAllDigest: authorityClaim.cashuSigAllDigest, outputsDigest: authorityClaim.outputsDigest,
			proofPoolDigest: demoIntegratedProofPoolDigest(authorityClaim.proofStateRefs), poolAmount: authorityClaim.poolAmount,
			admissionReceiptDigest: authorityClaim.admissionReceiptDigest,
			committeeKeysetId: authorityClaim.committeeKeysetId,
			committeeKeysetVersion: authorityClaim.committeeKeysetVersion, dkgRunId: authorityClaim.dkgRunId,
			publicKeyPackageSha256: authorityClaim.publicKeyPackageSha256,
			signerRosterDigest: authorityClaim.signerRosterDigest,
			processRosterDigest: digest('8'), policyPackageDigest: digest('9'),
		}
		const executionBinding: DemoIntegratedExecutionRootBindingV1 = {
			...stableBinding, bindingDigest: demoIntegratedExecutionRootBindingDigest(stableBinding),
		}
		const authorityDb = new Database(':memory:', { strict: true })
		const coordinatorDb = new Database(':memory:', { strict: true })
		const anchorDb = new Database(':memory:', { strict: true })
		try {
			const authorityStore = new DemoIntegratedAuthoritySqliteStore(authorityDb)
			const coordinatorStore = new DemoFridayCoordinatorSqlite(coordinatorDb, 'friday-unit-vertical-v1')
			await authorityStore.claimOutbidReturn(authorityClaim)
			await authorityStore.bindExecutionRoot(executionBinding)
			const rollbackAnchor = new DemoFridayCoordinatorRollbackAnchorSqlite(anchorDb, true)
			rollbackAnchor.observeExact(coordinatorStore.anchorSnapshot())
			const queue = createDemoFridayAuthorizedTerminalQueue({
				authorityStore, coordinatorStore, rollbackAnchor, preparedReader: run.executor,
			})
			const queued = await queue.enqueuePrepared({
				branch: 'outbid_return', recipientActorId: digest('a'), claim: authorityClaim, executionBinding,
				offlineIdentity: integratedIdentity, prepared: preparedAuthorization,
			})
			expect(queued.phase).toBe('queued')
			expect(run.counts.mintCalls).toBe(0)
			const terminalPorts = createDemoFridayTerminalExecutorPorts({
				authorityStore, offlineStore: run.stores.offline, recoveryStore: run.stores.recovery,
				mint: run.ports.mint, recovery: run.ports.recovery,
				terminalResponse: run.ports.terminalResponse,
				recipientFor() { return run.ports.recipient },
				now: () => 100, nowSeconds: () => BEFORE_CUTOFF,
			})
			const completed = await createDemoFridayCoordinatorWorker(coordinatorStore, terminalPorts).runExact(run.identity.scope)
			expect(completed).toMatchObject({ phase: 'completed', attempts: 1, branch: 'outbid_return' })
			expect(run.counts).toMatchObject({ mintCalls: 1, imports: 1 })
			expect(await authorityStore.readLifecycle(refund.operationId))
				.toMatchObject({ status: 'recipient_imported' })
		} finally {
			anchorDb.close(false)
			coordinatorDb.close(false)
			authorityDb.close(false)
		}
	}, 15_000)

	test('persists both exact pre-signed branches before admission and settles after the bidder device is absent', async () => {
		const run = await prepared()
		const serialized = JSON.stringify([...run.stores.offline.rows.values()])
		expect(serialized).not.toContain('privateKey')
		expect(serialized).not.toContain('recipientOpening')
		const result = await run.executor.executeExact(run.identity)
		expect(result).toMatchObject({ status: 'settled', deliverySource: 'mint_response', recipient: { imported: true } })
		expect(run.counts.mintCalls).toBe(1)
		expect(run.counts.imports).toBe(1)
	}, 15_000)

	test('restart after recipient failure restores the exact terminal response without a second mint spend', async () => {
		const stores = { offline: offlineStore(), recovery: recoveryStore() }
		const first = await prepared(outcome(), stores, { failRecipientOnce: true })
		await expect(first.executor.executeExact(first.identity)).rejects.toThrow('recipient process crashed')
		let secondMintCalls = 0
		let imports = 0
		const reconstructed = createDemoMaintainerOfflineExecutor({
			store: stores.offline,
			outcomes: { async readExact() { throw new Error('must reuse durable outcome') } },
			federation: { async authorize() { throw new Error('must reuse durable authorization') } },
			recoveryStore: stores.recovery,
			mint: { async swapExact() { secondMintCalls += 1; throw new Error('must not submit twice') } },
			recovery: { async reconcileExact() { return { status: 'indeterminate', reasonCode: 'unused' } } },
			terminalResponse: {
				async restoreCompleted(query) {
					const signatures = first.responses.get(query.operationRoot)
					return signatures === undefined ? null : { signatures: structuredClone(signatures) }
				},
			},
			recipient: { async deliverExact() { imports += 1; return { imported: true, alreadyImported: false } } },
			now: () => 101,
			nowSeconds: () => LOCKTIME + 1,
		})
		const restored = await reconstructed.executeExact(first.identity)
		expect(restored).toMatchObject({ status: 'settled', deliverySource: 'terminal_restore' })
		expect(first.counts.mintCalls).toBe(1)
		expect(secondMintCalls).toBe(0)
		expect(imports).toBe(1)
	}, 15_000)

	test('lost mint response becomes ambiguous and exact recovery imports once after reconstruction', async () => {
		const stores = { offline: offlineStore(), recovery: recoveryStore() }
		const exactBundle = bundle()
		let calls = 0
		let committed: BlindedSignature[] = []
		const run = await prepared(outcome(), stores, {
			mint: {
				async swapExact(request) {
					calls += 1
					const branch = request.packageDigest === exactBundle.winner.templateDigest ? exactBundle.winner : exactBundle.refund
					committed = mintSignatures(branch)
					throw new Error('response lost after commit')
				},
			},
		})
		await expect(run.executor.executeExact(run.identity)).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_AMBIGUOUS' })
		const reconstructed = createDemoMaintainerOfflineExecutor({
			store: stores.offline,
			outcomes: { async readExact() { throw new Error('durable selection must avoid outcome re-read') } },
			federation: { async authorize() { throw new Error('durable authorization must avoid re-signing') } },
			recoveryStore: stores.recovery,
			mint: { async swapExact() { throw new Error('must not resubmit') } },
			recovery: { async reconcileExact() { return { status: 'completed', signatures: structuredClone(committed) } } },
			terminalResponse: { async restoreCompleted() { return { signatures: structuredClone(committed) } } },
			recipient: { async deliverExact() { return { imported: true, alreadyImported: false } } },
			now: () => 101,
			nowSeconds: () => BEFORE_CUTOFF,
		})
		const recovered = await reconstructed.recoverExact(run.identity)
		expect(recovered).toMatchObject({ status: 'settled', deliverySource: 'exact_recovery' })
		expect(calls).toBe(1)
	}, 15_000)

	test('rejects stale admission, cross-auction outcome, and conflicting winner/refund selection', async () => {
		const stale = bundle()
		stale.preparedAt = VALID_UNTIL + 1
		stale.bundleDigest = demoMaintainerTemplateBundleDigest(stale)
		stale.actorBundleSignature = sign(stale.bundleDigest, ACTOR_PRIVATE)
		stale.bidderBundleSignature = sign(stale.bundleDigest, BIDDER_PRIVATE)
		await expect(persistDemoMaintainerTemplatesBeforeAdmission({ bundle: stale, store: offlineStore(), nowSeconds: () => stale.preparedAt })).rejects.toMatchObject({ code: 'DEMO_MAINTAINER_BUNDLE_EXPIRED' })

		const signedBeforeExpiry = bundle()
		await expect(persistDemoMaintainerTemplatesBeforeAdmission({
			bundle: signedBeforeExpiry,
			store: offlineStore(),
			nowSeconds: () => VALID_UNTIL + 1,
		})).rejects.toMatchObject({ code: 'DEMO_MAINTAINER_BUNDLE_EXPIRED' })

		const delayedRows = new Map<string, DemoMaintainerOfflineRecord>()
		await expect(persistDemoMaintainerTemplatesBeforeAdmission({
			bundle: bundle(),
			store: offlineStore(delayedRows, () => VALID_UNTIL + 1),
			nowSeconds: () => PREPARED_AT,
		})).rejects.toThrow('admission deadline passed')
		expect(delayedRows.size).toBe(0)

		const wrong = outcome()
		wrong.auctionId = 'auction-2'
		const cross = await prepared(wrong)
		await expect(cross.executor.executeExact(cross.identity)).rejects.toMatchObject({ code: 'DEMO_MAINTAINER_OUTCOME' })

		const shared = offlineStore()
		const run = await prepared(outcome(), { offline: shared, recovery: recoveryStore() })
		await run.executor.executeExact(run.identity)
		const held = shared.rows.get(run.identity.scope)!
		const alternate = structuredClone(held.selection!)
		alternate.outcome = outcome('refund')
		alternate.templateDigest = held.bundle.refund.templateDigest
		alternate.selectionRoot = digest('9')
		await expect(shared.bindOutcome(run.identity.scope, run.identity.bundleDigest, alternate)).rejects.toThrow('outcome conflict')
	}, 15_000)

	test('rejects an impossible close window, actor/payment key reuse, and control-character scope fields', async () => {
		const impossible = bundle()
		for (const branch of [impossible.winner, impossible.refund]) {
			branch.closeTime = LOCKTIME - 301
			branch.validUntil = LOCKTIME - 1
			branch.settlementWindowSeconds = 300
		}
		resignBundle(impossible)
		await expect(persistDemoMaintainerTemplatesBeforeAdmission({
			bundle: impossible, store: offlineStore(), nowSeconds: () => PREPARED_AT,
		})).rejects.toMatchObject({ code: 'DEMO_MAINTAINER_TEMPLATE' })

		const reused = bundle()
		for (const branch of [reused.winner, reused.refund]) branch.bidderActorId = BIDDER_PUBLIC.slice(2)
		resignBundle(reused, BIDDER_PRIVATE)
		await expect(persistDemoMaintainerTemplatesBeforeAdmission({
			bundle: reused, store: offlineStore(), nowSeconds: () => PREPARED_AT,
		})).rejects.toMatchObject({ code: 'DEMO_MAINTAINER_TEMPLATE_IDENTITY' })

		const recipientReused = bundle()
		for (const branch of [recipientReused.winner, recipientReused.refund]) branch.bidderActorId = SELLER_PUBLIC.slice(2)
		resignBundle(recipientReused, SELLER_PRIVATE)
		await expect(persistDemoMaintainerTemplatesBeforeAdmission({
			bundle: recipientReused, store: offlineStore(), nowSeconds: () => PREPARED_AT,
		})).rejects.toMatchObject({ code: 'DEMO_MAINTAINER_TEMPLATE_IDENTITY' })

		const framed = bundle()
		for (const branch of [framed.winner, framed.refund]) branch.auctionId = 'auction\u0000collision'
		resignBundle(framed)
		await expect(persistDemoMaintainerTemplatesBeforeAdmission({
			bundle: framed, store: offlineStore(), nowSeconds: () => PREPARED_AT,
		})).rejects.toMatchObject({ code: 'DEMO_MAINTAINER_TEMPLATE' })
	})

	test('durably advances fresh FROST sessions and preserves signer exclusion across reconstruction', async () => {
		const stores = { offline: offlineStore(), recovery: recoveryStore() }
		const sessions: string[] = []
		let calls = 0
		const firstFederation: DemoMaintainerFederationPort = {
			async authorize(request, options) {
				sessions.push(request.sessionId)
				calls += 1
				if (calls === 1) throw new DemoMaintainerFederationRefusedError(
					'DEMO_MAINTAINER_FRESH_SESSION_REQUIRED', 'participant 2 failed round two', [2],
				)
				expect(options?.excludeParticipantId).toBe(2)
				throw new Error('executor crashed after the excluded fresh session was reserved')
			},
		}
		const first = await prepared(outcome(), stores, { federation: firstFederation })
		await expect(first.executor.executeExact(first.identity)).rejects.toThrow('executor crashed')
		expect(stores.offline.rows.get(first.identity.scope)?.federationAttempts).toHaveLength(2)

		let mintCalls = 0
		const reconstructed = createDemoMaintainerOfflineExecutor({
			store: stores.offline,
			outcomes: { async readExact() { throw new Error('must reuse durable selection') } },
			federation: {
				async authorize(request, options) {
					sessions.push(request.sessionId)
					expect(options?.excludeParticipantId).toBe(2)
					return federation([1, 3, 4]).authorize(request)
				},
			},
			recoveryStore: stores.recovery,
			mint: {
				async swapExact() {
					mintCalls += 1
					return { signatures: mintSignatures(first.exactBundle.winner) }
				},
			},
			recovery: { async reconcileExact() { return { status: 'indeterminate', reasonCode: 'unused' } } },
			terminalResponse: { async restoreCompleted() { return null } },
			recipient: { async deliverExact() { return { imported: true, alreadyImported: false } } },
			nowSeconds: () => BEFORE_CUTOFF,
		})
		await expect(reconstructed.executeExact(first.identity)).resolves.toMatchObject({ status: 'settled' })
		expect(new Set(sessions).size).toBe(3)
		expect(stores.offline.rows.get(first.identity.scope)?.federationAttempts?.map(({ sessionId }, index) =>
			sessionId === demoMaintainerFederationSessionId(stores.offline.rows.get(first.identity.scope)!.selection!.selectionRoot, index + 1),
		)).toEqual([true, true, true])
		expect(mintCalls).toBe(1)
	}, 15_000)

	test('rejects a changed payout output even when the attacker recomputes public digests', async () => {
		const tampered = bundle()
		tampered.winner.outputs[0]!.B_ = publicKey(scalar(99))
		tampered.winner.cashuSigAllDigest = demoCashuSigAllDigest(tampered.winner.inputs, tampered.winner.outputs)
		tampered.winner.templateDigest = demoMaintainerExactTemplateDigest(tampered.winner)
		tampered.bundleDigest = demoMaintainerTemplateBundleDigest(tampered)
		await expect(persistDemoMaintainerTemplatesBeforeAdmission({
			bundle: tampered,
			store: offlineStore(),
			nowSeconds: () => PREPARED_AT,
		})).rejects.toMatchObject({ code: 'DEMO_MAINTAINER_TEMPLATE_RECIPIENT' })
	})

	test('one terminal operation replays idempotently with one mint spend and one recipient import', async () => {
		const run = await prepared()
		await run.executor.executeExact(run.identity)
		const replay = await run.executor.executeExact(run.identity)
		expect(replay).toMatchObject({ deliverySource: 'terminal_restore', recipient: { alreadyImported: true } })
		expect(run.counts.mintCalls).toBe(1)
		expect(run.counts.imports).toBe(1)
	})

	test('captures the bearer mint port before asynchronous outcome and authorization work', async () => {
		let originalCalls = 0
		const mint: DemoSigAllMintPort = {
			async swapExact(request) {
				originalCalls += 1
				return {
					signatures: request.outputs.map((output, index) => ({
						amount: output.amount,
						id: output.id,
						C_: publicKey(scalar(110 + index)),
					})),
				}
			},
		}
		const run = await prepared(outcome(), undefined, { mint })
		mint.swapExact = async () => { throw new Error('substituted mint port') }
		await expect(run.executor.executeExact(run.identity)).resolves.toMatchObject({ status: 'settled' })
		expect(originalCalls).toBe(1)
	})

	test('post-locktime loser uses only the exact pre-signed REFUND path; winner MAIN cannot originate late', async () => {
		const loser = await prepared(outcome('refund'), undefined, { nowSeconds: () => LOCKTIME + 1 })
		const refund = await loser.executor.executeExact(loser.identity)
		expect(refund.status).toBe('refunded')
		expect(loser.stores.offline.rows.get(loser.identity.scope)?.authorization).toBeUndefined()

		const winner = await prepared(outcome('winner_settlement'), undefined, { nowSeconds: () => LOCKTIME + 1 })
		await expect(winner.executor.executeExact(winner.identity)).rejects.toMatchObject({ code: 'DEMO_MAINTAINER_CUTOFF' })
		expect(winner.counts.mintCalls).toBe(0)
	})

	test('a MAIN admitted before cutoff may finish after locktime but never switches to REFUND locally', async () => {
		let seconds = BEFORE_CUTOFF
		let enterMint!: () => void
		let releaseMint!: () => void
		const entered = new Promise<void>((resolve) => { enterMint = resolve })
		const released = new Promise<void>((resolve) => { releaseMint = resolve })
		let mintCalls = 0
		const run = await prepared(outcome('winner_settlement'), undefined, {
			nowSeconds: () => seconds,
			mint: {
				async swapExact(request) {
					mintCalls += 1
					enterMint()
					await released
					return { signatures: mintSignatures(request.packageDigest === run.exactBundle.winner.templateDigest ? run.exactBundle.winner : run.exactBundle.refund) }
				},
			},
		})
		const executing = run.executor.executeExact(run.identity)
		await entered
		seconds = LOCKTIME + 1
		releaseMint()
		await expect(executing).resolves.toMatchObject({ status: 'settled', deliverySource: 'mint_response' })
		expect(mintCalls).toBe(1)
		expect(run.stores.offline.rows.get(run.identity.scope)?.selection?.outcome.role).toBe('winner_settlement')
	}, 15_000)
})
