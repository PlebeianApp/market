import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { HDKey } from '@scure/bip32'

import type { CommittedAuctionBatchV2, CommittedBidEntryV1 } from '../../market-app/plugins/committed-bid-consumer'
import {
	DEMO_PAYMENT_CONSENSUS_HANDOFF_SCHEMA,
	DEMO_PAYMENT_CONSENSUS_RECEIPT_SCHEMA,
	DEMO_PAYMENT_POST_LOCKTIME_RACE,
	DemoOfflinePaymentCoordinator,
	createBrowserDemoPaymentPersistence,
	type DemoPaymentConsensusHandoff,
	type DemoPaymentLockManager,
	type DemoPaymentStorageArea,
} from '../../market-app/plugins/demo-payment-coordinator'
import type { DemoSignedEvent, DemoUnsignedEvent } from '../../market-app/ts/demo-auth-bid'

import {
	createDemoMaintainerOfflineExecutor,
	demoMaintainerExactTemplateDigest,
	demoMaintainerFederationSessionId,
	demoMaintainerTemplateBundleDigest,
	persistDemoMaintainerTemplatesBeforeAdmission,
	type DemoMaintainerExactBranchTemplate,
	type DemoMaintainerExactTemplateBundle,
	type DemoMaintainerFinalOutcome,
	type DemoMaintainerExpectedDisposition,
	type DemoMaintainerOfflineRecord,
	type DemoMaintainerOfflineStore,
} from './demo-maintainer-offline'
import { DemoMaintainerFederationRefusedError, type DemoMaintainerFederationPort } from './demo-maintainer-federation'
import type { DemoSigAllRecoveryRecord, DemoSigAllRecoveryStore } from './demo-sigall-recovery'
import {
	buildDemoSigAllSecret,
	demoCashuSigAllDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
	type DemoCommitteeParticipant,
	type DemoSigAllMintPort,
} from './demo-sigall-settlement'
import type { BlindedMessage, BlindedSignature, CashuProof } from './nut-client'

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
	value.bundleDigest = demoMaintainerTemplateBundleDigest(value)
	value.actorBundleSignature = sign(value.bundleDigest, actorPrivate)
	value.bidderBundleSignature = sign(value.bundleDigest, BIDDER_PRIVATE)
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

function expectedDisposition(value: DemoMaintainerFinalOutcome): DemoMaintainerExpectedDisposition {
	return {
		schema: 'COCO_DEMO_MAINTAINER_EXPECTED_DISPOSITION_V1',
		network: value.network,
		chainId: value.chainId,
		auctionId: value.auctionId,
		operationId: value.operationId,
		bidId: value.bidId,
		bidEventId: value.bidEventId,
		bidderActorId: value.bidderActorId,
		role: value.role,
		amount: value.amount,
		outcomeHeight: value.outcomeHeight,
		appStateHash: value.appStateHash,
		closureEvidenceDigest: value.closureEvidenceDigest,
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

function federation(subset: [1 | 2 | 3 | 4, 1 | 2 | 3 | 4, 1 | 2 | 3 | 4] = [1, 2, 3]): DemoMaintainerFederationPort {
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
	const executor = createDemoMaintainerOfflineExecutor({
		store: stores.offline,
		outcomes: { async readExact() { return structuredClone(selectedOutcome) } },
		federation: options.federation ?? federation(),
		recoveryStore: stores.recovery,
		mint,
		recovery: {
			async reconcileExact(query) {
				const exact = responses.get(query.operationRoot)
				return exact === undefined ? { status: 'indeterminate' as const, reasonCode: 'not-found' } : { status: 'completed' as const, signatures: structuredClone(exact) }
			},
		},
		terminalResponse: {
			async restoreCompleted(query) {
				const exact = responses.get(query.operationRoot)
				return exact === undefined ? null : { signatures: structuredClone(exact) }
			},
		},
		recipient: {
			async deliverExact() {
				if (failRecipient) { failRecipient = false; throw new Error('recipient process crashed before import') }
				const alreadyImported = imports > 0
				imports += alreadyImported ? 0 : 1
				return { imported: true, alreadyImported }
			},
		},
		now: () => 100,
		nowSeconds: options.nowSeconds ?? (() => BEFORE_CUTOFF),
	})
	return {
		exactBundle,
		identity,
		expectation: expectedDisposition(selectedOutcome),
		executor,
		stores,
		responses,
		counts: { get mintCalls() { return mintCalls }, get imports() { return imports } },
	}
}

class CoordinatorArea implements DemoPaymentStorageArea {
	readonly values = new Map<string, string>()
	getItem(key: string) { return this.values.get(key) ?? null }
	setItem(key: string, value: string) { this.values.set(key, value) }
}

class CoordinatorLocks implements DemoPaymentLockManager {
	private readonly tails = new Map<string, Promise<void>>()
	async request<T>(name: string, _options: { readonly mode: 'exclusive' }, callback: () => Promise<T>): Promise<T> {
		const prior = this.tails.get(name) ?? Promise.resolve()
		let release!: () => void
		this.tails.set(name, new Promise<void>((resolve) => { release = resolve }))
		await prior
		try { return await callback() } finally { release() }
	}
}

function coordinatorBundle(input: { operationId: string; bidId: string; eventId: string; nonceBase: number }): DemoMaintainerExactTemplateBundle {
	const value = bundle()
	const lockedInputs = value.winner.inputs.map((proof, index) => ({
		...proof,
		secret: buildDemoSigAllSecret({
			nonce: scalar(input.nonceBase + index),
			bidderPublicKey: BIDDER_PUBLIC,
			committeePublicKey: COMMITTEE_PUBLIC,
			refundPublicKey: REFUND_PUBLIC,
			locktime: LOCKTIME,
		}),
		C: publicKey(scalar(input.nonceBase + 20 + index)),
	}))
	for (const branch of [value.winner, value.refund]) {
		branch.operationId = input.operationId
		branch.bidId = input.bidId
		branch.bidEventId = input.eventId
		branch.inputs = structuredClone(lockedInputs)
		branch.outputs = branch.outputs.map((output, index) => ({
			...output,
			B_: publicKey(scalar(input.nonceBase + (branch.role === 'winner_settlement' ? 40 : 50) + index)),
		}))
		const capabilityBase = {
			...branch.recipientCapability,
			operationId: input.operationId,
			outputsDigest: demoOutputsDigest(branch.outputs),
			signature: '00'.repeat(64),
		}
		branch.recipientCapability = {
			...capabilityBase,
			signature: sign(demoRecipientCapabilityDigest(capabilityBase), branch.role === 'winner_settlement' ? SELLER_PRIVATE : REFUND_PRIVATE),
		}
		branch.cashuSigAllDigest = demoCashuSigAllDigest(branch.inputs, branch.outputs)
		branch.bidderMainSignature = sign(branch.cashuSigAllDigest, BIDDER_PRIVATE)
		if (branch.role === 'refund') branch.refundSignature = sign(branch.cashuSigAllDigest, REFUND_PRIVATE)
	}
	resignBundle(value)
	return value
}

async function coordinatorSignedBid(index: number): Promise<{ event: DemoSignedEvent; entry: CommittedBidEntryV1 }> {
	const operationId = `coordinator-operation-${index + 1}`
	const bidId = `coordinator-bid-${index + 1}`
	const unsigned: DemoUnsignedEvent = {
		pubkey: ACTOR_ID,
		created_at: PREPARED_AT + index,
		kind: 28642,
		tags: [
			['protocol', 'plebeian-auction-auth-demo'],
			['version', '1'],
			['environment', digest('a')],
			['valid_until', String(VALID_UNTIL)],
		],
		content: JSON.stringify({
			version: 1,
			type: 'bid',
			operation_id: operationId,
			auction_id: 'auction-1',
			bid_id: bidId,
			amount: 12,
			reservations: [{ reservation_id: String(index + 5).repeat(64), amount: 12 }],
		}),
	}
	const eventId = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content]))))
	const event: DemoSignedEvent = { ...unsigned, id: eventId, sig: sign(eventId, ACTOR_PRIVATE) }
	return {
		event,
		entry: {
			actor_id: event.pubkey,
			operation_id: operationId,
			auction_id: 'auction-1',
			bid_id: bidId,
			event_id: event.id,
			amount: 12,
			displaced_refund_eligible: false,
		},
	}
}

async function realCoordinatorFixture(options: { staleWinnerOutcome?: boolean } = {}) {
	const loser = await coordinatorSignedBid(0)
	const winner = await coordinatorSignedBid(1)
	const entries = [loser, winner]
	const batches: CommittedAuctionBatchV2[] = [
		{ schema: 'CommittedAuctionBatchV2', auth_profile: 'DEMO_AUTH_V1', auth_network_id: digest('a'), chain_id: 'demo-chain', height: 1, pbts_seconds: CLOSE_TIME - 2, app_hash: digest('1'), bids: [loser.entry], closures: [] },
		{ schema: 'CommittedAuctionBatchV2', auth_profile: 'DEMO_AUTH_V1', auth_network_id: digest('a'), chain_id: 'demo-chain', height: 2, pbts_seconds: CLOSE_TIME - 1, app_hash: digest('2'), bids: [winner.entry], closures: [] },
		{ schema: 'CommittedAuctionBatchV2', auth_profile: 'DEMO_AUTH_V1', auth_network_id: digest('a'), chain_id: 'demo-chain', height: 3, pbts_seconds: CLOSE_TIME, app_hash: digest('3'), bids: [], closures: [{
			auth_network_id: digest('a'), chain_id: 'demo-chain', auction_id: 'auction-1', height: 3,
			pbts_seconds: CLOSE_TIME, effective_end: CLOSE_TIME, app_hash: digest('3'), close_outcome: 'winner',
			winner_bid_id: winner.entry.bid_id, winner_actor_id: winner.entry.actor_id,
			winner_operation_id: winner.entry.operation_id, amount: winner.entry.amount,
		}] },
	]
	const handoff: DemoPaymentConsensusHandoff = {
		schema: DEMO_PAYMENT_CONSENSUS_HANDOFF_SCHEMA,
		authNetworkId: digest('a'),
		chainId: 'demo-chain',
		closureHeight: 3,
		canonicalBatchBytes: batches.map((batch) => JSON.stringify(batch)),
	}
	const stores = { offline: offlineStore(), recovery: recoveryStore() }
	const identities = new Map<string, Awaited<ReturnType<typeof persistDemoMaintainerTemplatesBeforeAdmission>>>()
	const outcomes = new Map<string, DemoMaintainerFinalOutcome>()
	const branches = new Map<string, DemoMaintainerExactBranchTemplate>()
	for (const [index, item] of entries.entries()) {
		const exact = coordinatorBundle({
			operationId: item.entry.operation_id,
			bidId: item.entry.bid_id,
			eventId: item.entry.event_id,
			nonceBase: 200 + index * 100,
		})
		const identity = await persistDemoMaintainerTemplatesBeforeAdmission({ bundle: exact, store: stores.offline, nowSeconds: () => PREPARED_AT })
		identities.set(item.entry.operation_id, identity)
		branches.set(exact.winner.templateDigest, exact.winner)
		branches.set(exact.refund.templateDigest, exact.refund)
		const role = item === winner ? 'winner_settlement' : 'refund'
		outcomes.set(identity.scope, {
			schema: 'COCO_DEMO_MAINTAINER_FINAL_OUTCOME_V1',
			network: digest('a'),
			chainId: 'demo-chain',
			auctionId: 'auction-1',
			operationId: item.entry.operation_id,
			bidId: item.entry.bid_id,
			bidEventId: item.entry.event_id,
			bidderActorId: item.entry.actor_id,
			role,
			amount: item.entry.amount,
			outcomeHeight: 3,
			appStateHash: options.staleWinnerOutcome && role === 'winner_settlement' ? digest('4') : digest('3'),
			policyPackageDigest: digest(index === 0 ? '6' : '7'),
			closureEvidenceDigest: digest('e'),
			signedBidEvidenceDigest: digest(index === 0 ? '8' : '9'),
			committeeLockedProofsDigest: digest(index === 0 ? 'a' : 'b'),
		})
	}
	let seconds = BEFORE_CUTOFF
	const federationCalls = new Map<string, number>()
	const mintCalls = new Map<string, number>()
	const imports = new Map<string, number>()
	const responses = new Map<string, BlindedSignature[]>()
	const events = new Map(entries.map(({ event }) => [event.id, event]))
	const area = new CoordinatorArea()
	const add = (counts: Map<string, number>, operationId: string) => counts.set(operationId, (counts.get(operationId) ?? 0) + 1)
	const operationForPackage = (packageDigest: string) => {
		const branch = branches.get(packageDigest)
		if (branch === undefined) throw new Error('unknown package')
		return branch
	}
	const buildCoordinator = () => {
		const executor = createDemoMaintainerOfflineExecutor({
			store: stores.offline,
			outcomes: { async readExact(identity) { return structuredClone(outcomes.get(identity.scope) ?? null) } },
			federation: {
				async authorize(request) {
					const branch = operationForPackage(request.packageDigest)
					add(federationCalls, branch.operationId)
					return {
						schema: 'COCO_DEMO_MAINTAINER_FEDERATION_AUTHORIZATION_V1', threshold: 3,
						participantIds: [1, 2, 3], sessionId: request.sessionId,
						packageDigest: request.packageDigest, cashuSigAllDigest: request.cashuSigAllDigest,
						committeeKeysetId: request.committeeKeysetId, committeeKeysetVersion: request.committeeKeysetVersion,
						transcriptHash: digest('c'), signature: sign(request.cashuSigAllDigest, COMMITTEE_PRIVATE),
					}
				},
			},
			recoveryStore: stores.recovery,
			mint: {
				async swapExact(request) {
					const branch = operationForPackage(request.packageDigest)
					add(mintCalls, request.operationId)
					const signatures = mintSignatures(branch)
					responses.set(request.packageDigest, signatures)
					return { signatures: structuredClone(signatures) }
				},
			},
			recovery: {
				async reconcileExact(query) {
					const signatures = responses.get(query.operationRoot)
					return signatures === undefined
						? { status: 'indeterminate' as const, reasonCode: 'not-found' }
						: { status: 'completed' as const, signatures: structuredClone(signatures) }
				},
			},
			terminalResponse: {
				async restoreCompleted(query) {
					const signatures = responses.get(query.operationRoot)
					return signatures === undefined ? null : { signatures: structuredClone(signatures) }
				},
			},
			recipient: {
				async deliverExact(request) {
					const alreadyImported = (imports.get(request.operationId) ?? 0) > 0
					if (!alreadyImported) add(imports, request.operationId)
					return { imported: true, alreadyImported }
				},
			},
			now: () => 100,
			nowSeconds: () => seconds,
		})
		return new DemoOfflinePaymentCoordinator(
			createBrowserDemoPaymentPersistence({ localStorage: area, lockManager: new CoordinatorLocks() }),
			{
				async verifyExact(request) {
					return {
						schema: DEMO_PAYMENT_CONSENSUS_RECEIPT_SCHEMA,
						authNetworkId: request.authNetworkId,
						chainId: request.chainId,
						authenticatedStartHeight: 1,
						authenticatedThroughHeight: request.closureHeight + 1,
						canonicalSuccessorCommitHeight: request.closureHeight + 1,
						successorObservedHeight: request.closureHeight + 2,
						canonicalBatchSetDigest: request.canonicalBatchSetDigest,
						evidenceDigest: digest('e'),
					}
				},
			},
			{ async readExact(request) { return structuredClone(events.get(request.eventId) ?? null) } },
			{ async readExact(request) { return structuredClone(identities.get(request.operationId) ?? null) } },
			executor,
			{ authNetworkId: digest('a'), chainId: 'demo-chain', auctionId: 'auction-1' },
		)
	}
	return {
		loserOperationId: loser.entry.operation_id,
		winnerOperationId: winner.entry.operation_id,
		handoff,
		buildCoordinator,
		setSeconds(value: number) { seconds = value },
		counts: {
			federation(operationId: string) { return federationCalls.get(operationId) ?? 0 },
			mint(operationId: string) { return mintCalls.get(operationId) ?? 0 },
			imports(operationId: string) { return imports.get(operationId) ?? 0 },
		},
	}
}

describe('whole-device-offline exact-template maintainer executor', () => {
	test('persists both exact pre-signed branches before admission and settles after the bidder device is absent', async () => {
		const run = await prepared()
		const serialized = JSON.stringify([...run.stores.offline.rows.values()])
		expect(serialized).not.toContain('privateKey')
		expect(serialized).not.toContain('recipientOpening')
		const result = await run.executor.executeExact(run.identity, run.expectation)
		expect(result).toMatchObject({ status: 'settled', deliverySource: 'mint_response', recipient: { imported: true } })
		expect(run.counts.mintCalls).toBe(1)
		expect(run.counts.imports).toBe(1)
	}, 15_000)

	test('restart after recipient failure restores the exact terminal response without a second mint spend', async () => {
		const stores = { offline: offlineStore(), recovery: recoveryStore() }
		const first = await prepared(outcome(), stores, { failRecipientOnce: true })
		await expect(first.executor.executeExact(first.identity, first.expectation)).rejects.toThrow('recipient process crashed')
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
		const restored = await reconstructed.executeExact(first.identity, first.expectation)
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
		await expect(run.executor.executeExact(run.identity, run.expectation)).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_AMBIGUOUS' })
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
		const recovered = await reconstructed.recoverExact(run.identity, run.expectation)
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
		await expect(cross.executor.executeExact(cross.identity, cross.expectation)).rejects.toMatchObject({ code: 'DEMO_MAINTAINER_OUTCOME' })

		const shared = offlineStore()
		const run = await prepared(outcome(), { offline: shared, recovery: recoveryStore() })
		await run.executor.executeExact(run.identity, run.expectation)
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
			branch.closeTime = LOCKTIME - 61
			branch.validUntil = LOCKTIME - 1
			branch.settlementWindowSeconds = 60
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
		await expect(first.executor.executeExact(first.identity, first.expectation)).rejects.toThrow('executor crashed')
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
		await expect(reconstructed.executeExact(first.identity, first.expectation)).resolves.toMatchObject({ status: 'settled' })
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
		await run.executor.executeExact(run.identity, run.expectation)
		const replay = await run.executor.executeExact(run.identity, run.expectation)
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
		await expect(run.executor.executeExact(run.identity, run.expectation)).resolves.toMatchObject({ status: 'settled' })
		expect(originalCalls).toBe(1)
	})

	test('post-locktime loser uses only the exact pre-signed REFUND path; winner MAIN cannot originate late', async () => {
		const loser = await prepared(outcome('refund'), undefined, { nowSeconds: () => LOCKTIME + 1 })
		const refund = await loser.executor.executeExact(loser.identity, loser.expectation)
		expect(refund.status).toBe('refunded')
		expect(loser.stores.offline.rows.get(loser.identity.scope)?.authorization).toBeUndefined()

		const winner = await prepared(outcome('winner_settlement'), undefined, { nowSeconds: () => LOCKTIME + 1 })
		await expect(winner.executor.executeExact(winner.identity, winner.expectation)).rejects.toMatchObject({ code: 'DEMO_MAINTAINER_CUTOFF' })
		expect(winner.counts.mintCalls).toBe(0)
	})

	test('omits unresolved early return and defers every pre-locktime loser refund without FROST or mint I/O', async () => {
		const loser = await prepared(outcome('refund'), undefined, { nowSeconds: () => BEFORE_CUTOFF })
		await expect(loser.executor.executeExact(loser.identity, loser.expectation)).resolves.toMatchObject({
			status: 'deferred', reason: 'refund_not_yet_eligible', eligibleAt: LOCKTIME,
		})
		expect(loser.stores.offline.rows.get(loser.identity.scope)?.authorization).toBeUndefined()
		expect(loser.counts.mintCalls).toBe(0)
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
		const executing = run.executor.executeExact(run.identity, run.expectation)
		await entered
		seconds = LOCKTIME + 1
		releaseMint()
		await expect(executing).resolves.toMatchObject({ status: 'settled', deliverySource: 'mint_response' })
		expect(mintCalls).toBe(1)
		expect(run.stores.offline.rows.get(run.identity.scope)?.selection?.outcome.role).toBe('winner_settlement')
	}, 15_000)

	test('real coordinator executes the winner while deferring an early loser, then restarts and refunds exactly once after locktime', async () => {
		const run = await realCoordinatorFixture()
		const first = await run.buildCoordinator().processExactHandoff(run.handoff)
		expect(first).toEqual({
			paid: [run.winnerOperationId],
			refunded: [],
			pendingDispositions: [{
				operationId: run.loserOperationId,
				role: 'refund',
				status: 'refund_not_yet_eligible',
				eligibleAt: LOCKTIME,
			}],
			pendingRecovery: [],
			consensusEvidenceDigest: digest('e'),
			postLocktimeRace: DEMO_PAYMENT_POST_LOCKTIME_RACE,
		})
		expect(run.counts.federation(run.winnerOperationId)).toBe(1)
		expect(run.counts.mint(run.winnerOperationId)).toBe(1)
		expect(run.counts.imports(run.winnerOperationId)).toBe(1)
		expect(run.counts.federation(run.loserOperationId)).toBe(0)
		expect(run.counts.mint(run.loserOperationId)).toBe(0)
		expect(run.counts.imports(run.loserOperationId)).toBe(0)

		const restartedBeforeLocktime = await run.buildCoordinator().processExactHandoff(run.handoff)
		expect(restartedBeforeLocktime.paid).toEqual([run.winnerOperationId])
		expect(restartedBeforeLocktime.refunded).toEqual([])
		expect(restartedBeforeLocktime.pendingDispositions).toHaveLength(1)
		expect(run.counts.federation(run.winnerOperationId)).toBe(1)
		expect(run.counts.mint(run.winnerOperationId)).toBe(1)
		expect(run.counts.imports(run.winnerOperationId)).toBe(1)

		run.setSeconds(LOCKTIME + 1)
		const postLocktime = await run.buildCoordinator().processExactHandoff(run.handoff)
		expect(postLocktime.paid).toEqual([run.winnerOperationId])
		expect(postLocktime.refunded).toEqual([run.loserOperationId])
		expect(postLocktime.pendingDispositions).toEqual([])
		expect(postLocktime.pendingRecovery).toEqual([])
		expect(run.counts.federation(run.winnerOperationId)).toBe(1)
		expect(run.counts.mint(run.winnerOperationId)).toBe(1)
		expect(run.counts.federation(run.loserOperationId)).toBe(0)
		expect(run.counts.mint(run.loserOperationId)).toBe(1)
		expect(run.counts.imports(run.loserOperationId)).toBe(1)

		const idempotent = await run.buildCoordinator().processExactHandoff(run.handoff)
		expect(idempotent.paid).toEqual([run.winnerOperationId])
		expect(idempotent.refunded).toEqual([run.loserOperationId])
		expect(run.counts.federation(run.winnerOperationId)).toBe(1)
		expect(run.counts.mint(run.winnerOperationId)).toBe(1)
		expect(run.counts.federation(run.loserOperationId)).toBe(0)
		expect(run.counts.mint(run.loserOperationId)).toBe(1)
		expect(run.counts.imports(run.loserOperationId)).toBe(1)
	}, 90_000)

	test('real coordinator stale outcome mismatch is rejected before FROST, mint, or recipient effects', async () => {
		const run = await realCoordinatorFixture({ staleWinnerOutcome: true })
		await expect(run.buildCoordinator().processExactHandoff(run.handoff)).rejects.toMatchObject({
			code: 'DEMO_MAINTAINER_EXPECTED_DISPOSITION_MISMATCH',
		})
		for (const operationId of [run.winnerOperationId, run.loserOperationId]) {
			expect(run.counts.federation(operationId)).toBe(0)
			expect(run.counts.mint(operationId)).toBe(0)
			expect(run.counts.imports(operationId)).toBe(0)
		}
	}, 30_000)
})
