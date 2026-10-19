import { describe, expect, test } from "bun:test";
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { HDKey } from "@scure/bip32";

import {
	buildDemoSigAllSecret,
	demoCashuSigAllDigest,
	demoDenominationKeyDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
	demoSigAllPackageDigest,
	createFourOfFourCommitteePort,
	type DemoFrostParticipantPort,
	type DemoParticipantId,
	type DemoSigAllContract,
} from "../../cashu-wrapper/ts/demo-sigall-settlement.ts";
import {
	prepareDemoSigAllRecipientOutputs,
	type DemoRecipientPrivateJournalPort,
	type DemoRecipientPrivateRecord,
} from "../../cashu-wrapper/ts/demo-sigall-recipient.ts";
import type { DemoSigAllRecoveryRecord, DemoSigAllRecoveryStore } from "../../cashu-wrapper/ts/demo-sigall-recovery.ts";
import { proofPoint } from "../../cashu-wrapper/ts/nut-client.ts";
import {
	canonicalIntentV1,
	demoIntentIdentifiers,
	reservationId,
	type DemoSignedEvent,
} from "../ts/demo-auth-bid.ts";
import {
	createBrowserDemoWalletLocalBidApprovalPort,
	executeDemoCertifiedWalletAutomaticClose,
	type DemoBrowserOriginLockManager,
	type DemoBrowserWalletApprovalStorage,
	type DemoWalletLocalBidApproval,
} from "./demo-certified-wallet-adapter.ts";
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
} from "./demo-certified-closure.ts";

const key = (value: number) => value.toString(16).padStart(64, "0");
const publicKey = (privateKey: string) => bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), true));
const xOnly = (privateKey: string) => bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey)));
const sign = (digest: string, privateKey: string) => bytesToHex(schnorr.sign(hexToBytes(digest), hexToBytes(privateKey)));
const digest = (value: string) => bytesToHex(sha256(utf8ToBytes(value)));

const ACTOR_PRIVATE = key(2);
const WALLET_PRIVATE = key(1);
const COMMITTEE_PRIVATE = key(3);
const REFUND_PRIVATE = key(4);
const actorId = xOnly(ACTOR_PRIVATE);
const bidderPublicKey = publicKey(WALLET_PRIVATE);
const committeePublicKey = publicKey(COMMITTEE_PRIVATE);
const refundPublicKey = publicKey(REFUND_PRIVATE);
const network = "a".repeat(64);
const sellerRoot = HDKey.fromMasterSeed(new Uint8Array(32).fill(0x42));
const sellerP2pkXpub = sellerRoot.publicExtendedKey;
const bidderDerivationPath = "m/1/2/3/4/5";
const sellerChild = sellerRoot.derive(bidderDerivationPath);
const recipientPrivateKey = bytesToHex(sellerChild.privateKey!);
const recipientPublicKey = bytesToHex(sellerChild.publicKey!);
const locktime = 2_000_000_000;
const keysetId = "demo-keyset";

class BrowserStorage implements DemoBrowserWalletApprovalStorage {
	readonly values = new Map<string, string>();
	getItem(key: string): string | null { return this.values.get(key) ?? null; }
	setItem(key: string, value: string): void { this.values.set(key, value); }
}

class OriginLocks implements DemoBrowserOriginLockManager {
	calls = 0;
	private tail: Promise<void> = Promise.resolve();
	async request<T>(_name: string, options: { readonly mode: "exclusive" }, run: () => Promise<T>): Promise<T> {
		expect(options.mode).toBe("exclusive"); this.calls += 1;
		const prior = this.tail; let release!: () => void;
		this.tail = new Promise<void>((resolve) => { release = resolve; });
		await prior;
		try { return await run(); }
		finally { release(); }
	}
}

class PrivateJournal implements DemoRecipientPrivateJournalPort<string> {
	private record: DemoRecipientPrivateRecord<string> | null = null;
	async runExclusive<T>(_scope: string, run: () => Promise<T>): Promise<T> { return run(); }
	async load(_scope: string): Promise<DemoRecipientPrivateRecord<string> | null> { return this.record === null ? null : structuredClone(this.record); }
	async savePrepared(_scope: string, record: DemoRecipientPrivateRecord<string>): Promise<void> { this.record = structuredClone(record); }
	async markImported(_scope: string, requestDigest: string, responseDigest: string): Promise<void> {
		if (this.record === null || this.record.requestDigest !== requestDigest) throw new Error("journal conflict");
		this.record.importedResponseDigest = responseDigest;
	}
}

function durableStore(rows = new Map<string, DemoSigAllRecoveryRecord>()): DemoSigAllRecoveryStore {
	return {
		async createOrGet(record) {
			const existing = rows.get(record.scope);
			if (existing !== undefined) return { record: structuredClone(existing), created: false };
			rows.set(record.scope, structuredClone(record));
			return { record: structuredClone(record), created: true };
		},
		async read(scope) { const existing = rows.get(scope); return existing === undefined ? null : structuredClone(existing); },
		async compareAndSwap(scope, expectedRevision, next) {
			const existing = rows.get(scope);
			if (existing === undefined || existing.revision !== expectedRevision || next.revision !== expectedRevision + 1) return false;
			rows.set(scope, structuredClone(next)); return true;
		},
	};
}

async function signedEvent(content: string, operationId: string, bidId: string): Promise<DemoSignedEvent> {
	const event = {
		pubkey: actorId,
		created_at: 1_900_000_000,
		kind: 28642,
		tags: [
			["protocol", "plebeian-auction-auth-demo"],
			["version", "1"],
			["environment", network],
			["valid_until", "1900000300"],
		] as const,
		content,
	};
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))));
	void operationId; void bidId;
	return { ...event, id, sig: sign(id, ACTOR_PRIVATE) };
}

async function fixture() {
	const input = {
		amount: 12,
		id: keysetId,
		secret: buildDemoSigAllSecret({ nonce: "a5".repeat(32), bidderPublicKey, committeePublicKey, locktime, refundPublicKey }),
		C: publicKey(key(20)),
	};
	const proofStateRefs = [bytesToHex(proofPoint(input).toBytes(true))];
	const childPubkey = recipientPublicKey;
	const canonicalIntent = canonicalIntentV1({ authNetworkId: network, actorPubkey: actorId, auctionId: "auction-1", amount: 12, mintUrl: "https://testnut.example", sellerP2pkXpub, locktime, childPubkey });
	const identifiers = await demoIntentIdentifiers(canonicalIntent);
	const reservation = await reservationId("https://testnut.example", proofStateRefs[0]!);
	const content = JSON.stringify({ version: 1, type: "bid", operation_id: identifiers.operationId, auction_id: "auction-1", bid_id: identifiers.bidId, amount: 12, reservations: [{ reservation_id: reservation, amount: 12 }] });
	const bidEvent = await signedEvent(content, identifiers.operationId, identifiers.bidId);
	const denominationKeys = { "12": publicKey(key(90)) };
	const recipientIntent = {
		schema: "COCO_DEMO_RECIPIENT_INTENT_V1" as const,
		network, chainId: "demo-chain", auctionId: "auction-1", operationId: identifiers.operationId,
		role: "winner_settlement" as const, mintUrl: "https://testnut.example", unit: "sat", recipientPublicKey, amounts: [12],
	};
	const recipientKeyset = { id: keysetId, unit: "sat", keys: denominationKeys };
	const journal = new PrivateJournal();
	const metrics = { committeeCalls: 0, mintCalls: 0, walletImports: 0, winnerBindings: 0, refundBindings: 0 };
	const prepared = await prepareDemoSigAllRecipientOutputs({
		intent: recipientIntent,
		keyset: recipientKeyset,
		roleBinding: {
			async assertWinnerRecipient() { metrics.winnerBindings += 1; },
			async assertRefundRecipient() { metrics.refundBindings += 1; },
		},
		signer: { async signCapability(request) { return sign(request.digest, recipientPrivateKey); } },
		outputFactory: { async createRecipientOwnedOutput(request) { return { message: { amount: request.amount, id: request.keysetId, B_: publicKey(key(30 + request.index)) }, privateOpeningRef: `opening-${request.index}` }; } },
		journal,
	});
	const outputs = prepared.outputs;
	const recipientCapability = prepared.capability;
	const participants = [1, 2, 3, 4].map((identifier) => ({ identifier, verifyingShare: publicKey(key(10 + identifier)) })) as DemoSigAllContract["participants"];
	const contract: DemoSigAllContract = {
		schema: "COCO_DEMO_SIGALL_CONTRACT_V1",
		network,
		chainId: "demo-chain",
		auctionId: "auction-1",
		operationId: identifiers.operationId,
		bidId: identifiers.bidId,
		bidEventId: bidEvent.id,
		bidderActorId: actorId,
		role: "winner_settlement",
		outcomeHeight: 42,
		appStateHash: "5".repeat(64),
		amount: 12,
		inputFee: 0,
		mintUrl: "https://testnut.example",
		unit: "sat",
		sellerP2pkXpub,
		bidderDerivationPath,
		recipientPublicKey,
		mintSeal: { mintUrl: "https://testnut.example", mintPublicKey: publicKey(key(89)), serverVersion: "test/1", activeSatKeysetId: keysetId, denominationKeyDigest: demoDenominationKeyDigest(denominationKeys), denominationAmounts: [12], inputFeePpk: 0, nuts: [4, 7, 10, 11] },
		inputs: [input],
		outputs,
		bidderPublicKey,
		committeePublicKey,
		committeeKeysetId: "committee-keyset",
		committeeKeysetVersion: "1",
		threshold: 4,
		participants,
		recipientCapability,
		approval: { schema: "COCO_DEMO_SIGALL_BIDDER_APPROVAL_V1", packageDigest: "0".repeat(64), cashuSigAllDigest: "0".repeat(64), actorPackageSignature: "0".repeat(128), packageSignature: "0".repeat(128), cashuSignature: "0".repeat(128) },
	};
	const packageDigest = demoSigAllPackageDigest(contract);
	const cashuSigAllDigest = demoCashuSigAllDigest(contract.inputs, contract.outputs);
	contract.approval = {
		schema: "COCO_DEMO_SIGALL_BIDDER_APPROVAL_V1",
		packageDigest,
		cashuSigAllDigest,
		actorPackageSignature: sign(packageDigest, ACTOR_PRIVATE),
		packageSignature: sign(packageDigest, WALLET_PRIVATE),
		cashuSignature: sign(cashuSigAllDigest, WALLET_PRIVATE),
	};
	const approval: DemoWalletLocalBidApproval = {
		schema: "COCO_DEMO_WALLET_LOCAL_BID_APPROVAL_V1",
		custodyBoundary: "bidder-wallet-local",
		signedBid: bidEvent,
		operationId: contract.operationId,
		bidId: contract.bidId,
		bidEventId: contract.bidEventId,
		bidderActorId: contract.bidderActorId,
		bidderPublicKey: contract.bidderPublicKey,
		refundPublicKey,
		amount: contract.amount,
		inputFee: contract.inputFee,
		locktime,
		sellerP2pkXpub,
		sellerChildPublicKey: recipientPublicKey,
		reservations: [{ reservationId: reservation, principalAmount: 12, proofStateRef: proofStateRefs[0]! }],
		inputAmounts: [12],
		packageDigest,
		cashuSigAllDigest,
		recipientCapabilityDigest: demoRecipientCapabilityDigest(contract.recipientCapability),
		outputsDigest: demoOutputsDigest(contract.outputs),
	};
	const participantPorts = participants.map((participant): DemoFrostParticipantPort => ({
		participantId: participant.identifier,
		verifyingShare: participant.verifyingShare,
		async roundOne(request) {
			metrics.committeeCalls += 1;
			return { participantId: participant.identifier, sessionId: request.sessionId, digest: request.digest, hiding: publicKey(key(30 + participant.identifier)), binding: publicKey(key(40 + participant.identifier)) };
		},
		async roundTwo(request) {
			metrics.committeeCalls += 1;
			return { participantId: participant.identifier, sessionId: request.sessionId, digest: request.digest, transcriptHash: request.transcriptHash, share: key(50 + participant.identifier) };
		},
	}));
	const execution = {
		committee: createFourOfFourCommitteePort(participantPorts, { async aggregate(request) { return { transcriptHash: request.transcriptHash, signature: sign(request.digest, COMMITTEE_PRIVATE) }; } }),
		operationGate: { async runExclusive<T>(_scope: string, _root: string, run: () => Promise<T>): Promise<T> { return run(); } },
		mint: { async swapExact() { metrics.mintCalls += 1; return { signatures: [{ amount: 12, id: keysetId, C_: publicKey(key(95)) }] }; } },
		recoveryStore: durableStore(),
		terminalResponse: { async restoreCompleted() { throw new Error("not a replay"); } },
		recipient: {
			intent: recipientIntent,
			keyset: recipientKeyset,
			roleBinding: {
				async assertWinnerRecipient() { metrics.winnerBindings += 1; },
				async assertRefundRecipient() { metrics.refundBindings += 1; },
			},
			unblinder: { async unblindExact() { return { opaqueUnblinded: true }; } },
			verifier: { async verifyExact() { return { opaqueVerified: true }; } },
			wallet: { async importVerified() { metrics.walletImports += 1; } },
			journal,
		},
		now: () => 1_900_000_000_000,
		nowSeconds: () => 1_900_000_100,
	};
	return { contract, approval, proofStateRefs, execution, metrics };
}

async function certifiedEvidence(f: Awaited<ReturnType<typeof fixture>>) {
	const validators = [40, 41, 42, 43].map((privateKey, index) => ({
		validatorId: `validator-${index + 1}`,
		publicKey: publicKey(key(privateKey)),
	}));
	const acceptedBid = {
		auction_id: f.contract.auctionId,
		bid_id: f.contract.bidId,
		operation_id: f.contract.operationId,
		event_id: f.contract.bidEventId,
		actor_id: f.contract.bidderActorId,
		amount: f.contract.amount,
		bidder_cashu_public_key: f.contract.bidderPublicKey,
		locktime,
		proof_state_refs: [...f.proofStateRefs].sort(),
		displaced_refund_eligible: false,
		seller_child_public_key: f.contract.recipientPublicKey,
	};
	const closeHeight = f.contract.outcomeHeight;
	const baseEndHeight = closeHeight - 1;
	const baseTime = 1_900_000_000;
	const history = Array.from({ length: closeHeight }, (_, index) => {
		const height = index + 1;
		return {
			schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA,
			auth_network_id: f.contract.network,
			chain_id: f.contract.chainId,
			height,
			block_time: baseTime + height,
			app_hash: height === closeHeight ? f.contract.appStateHash : height.toString(16).padStart(64, "0"),
			bids: height === 1 ? [acceptedBid] : [],
		};
	}) satisfies DemoCertifiedClosureHistoryBatchV1[];
	const policy = {
		authNetworkId: f.contract.network,
		chainId: f.contract.chainId,
		auctionId: f.contract.auctionId,
		sellerP2pkXpub: f.contract.sellerP2pkXpub,
		baseEndHeight,
		baseEndTime: baseTime + baseEndHeight,
		minimumSettlementWindowSeconds: 300,
		validatorRosterVersion: "demo-roster-v1",
		validators,
	} satisfies DemoCertifiedClosurePolicy;
	const payload = {
		schema: DEMO_CERTIFIED_CLOSURE_SCHEMA,
		domain: DEMO_CERTIFIED_CLOSURE_DOMAIN,
		auth_network_id: f.contract.network,
		chain_id: f.contract.chainId,
		auction_id: f.contract.auctionId,
		seller_p2pk_xpub: f.contract.sellerP2pkXpub,
		base_end_height: baseEndHeight,
		base_end_time: baseTime + baseEndHeight,
		effective_end_height: closeHeight,
		effective_end_time: baseTime + closeHeight,
		close_height: closeHeight,
		close_time: baseTime + closeHeight,
		history_start_height: 1,
		history_end_height: closeHeight,
		history_root: await computeCertifiedClosureHistoryRoot(history),
		outcome: "winner",
		winner_bid_id: f.contract.bidId,
		winner_operation_id: f.contract.operationId,
		winner_event_id: f.contract.bidEventId,
		winner_actor_id: f.contract.bidderActorId,
		winner_amount: f.contract.amount,
		app_hash: f.contract.appStateHash,
		validator_roster_version: policy.validatorRosterVersion,
		validator_roster: validators.map((validator) => ({ validator_id: validator.validatorId, public_key: validator.publicKey })),
	} satisfies DemoCertifiedClosurePayloadV1;
	const certificateDigest = await computeCertifiedClosureDigest(payload);
	const certificate = {
		...payload,
		certificate_digest: certificateDigest,
		signatures: validators.map((validator) => ({
			validator_id: validator.validatorId,
			public_key: validator.publicKey,
			signature: certificateDigest.repeat(2),
		})),
	} satisfies DemoCertifiedClosureCertificateV1;
	return {
		certificate,
		history,
		policy,
		// Test-only deterministic verifier: this fixture is not evidence of consensus or a live DKG.
		signatureVerifier: { async verifyExact(request: { digest: string; signature: string }) { return request.signature === request.digest.repeat(2); } },
	};
}

async function runWith(f: Awaited<ReturnType<typeof fixture>>, overrides: {
	approval?: DemoWalletLocalBidApproval;
	contract?: DemoSigAllContract;
	execution?: Awaited<ReturnType<typeof fixture>>["execution"];
	automaticClose?: { readExact(request: unknown): Promise<Awaited<ReturnType<typeof certifiedEvidence>> | null> };
	walletLocal?: { readApprovedBid(request: unknown): Promise<DemoWalletLocalBidApproval | null> };
} = {}) {
	const contract = overrides.contract ?? f.contract;
	const approval = overrides.approval ?? f.approval;
	return executeDemoCertifiedWalletAutomaticClose({
		contract,
		proofStateRefs: f.proofStateRefs,
		walletLocal: overrides.walletLocal ?? { async readApprovedBid() { return structuredClone(approval); } },
		automaticClose: overrides.automaticClose ?? { async readExact() { return certifiedEvidence(f); } },
		execution: overrides.execution ?? f.execution,
	});
}

describe("certified wallet automatic-close adapter", () => {
	test("uses durable preapproval while the winner's interactive signer is offline, invokes close, and hands recipient-private ports to disposition", async () => {
		const f = await fixture();
		const storage = new BrowserStorage(); const locks = new OriginLocks();
		const writer = createBrowserDemoWalletLocalBidApprovalPort({ storage, locks, subtle: crypto.subtle });
		await writer.persistApprovedBid({ network, chainId: "demo-chain", auctionId: "auction-1", approval: f.approval });
		const serialized = [...storage.values.values()][0]!;
		expect(serialized).not.toContain(f.contract.inputs[0]!.secret);
		expect(serialized).not.toContain("privateOpeningRef");
		expect(serialized).not.toContain("bearer");
		// Reconstruct the browser adapter from the same durable origin storage. No signer is available.
		const reconstructed = createBrowserDemoWalletLocalBidApprovalPort({ storage, locks, subtle: crypto.subtle });
		let closeCalls = 0;
		const result = await runWith(f, {
			walletLocal: reconstructed,
			automaticClose: { async readExact(request) { closeCalls += 1; expect(request).toEqual({ network, chainId: "demo-chain", auctionId: "auction-1", outcomeHeight: 42, appStateHash: "5".repeat(64) }); return certifiedEvidence(f); } },
		});
		expect(result).toMatchObject({ deliverySource: "submitted", recipient: { imported: true, alreadyImported: false, operationId: f.contract.operationId } });
		expect(closeCalls).toBe(1); expect(locks.calls).toBeGreaterThanOrEqual(2);
		expect(f.metrics).toMatchObject({ committeeCalls: 8, mintCalls: 1, walletImports: 1 });
	});

	test("durable approval storage rejects checksum corruption and non-exact identity reads", async () => {
		const f = await fixture(); const storage = new BrowserStorage(); const locks = new OriginLocks();
		const writer = createBrowserDemoWalletLocalBidApprovalPort({ storage, locks, subtle: crypto.subtle });
		await expect(writer.persistApprovedBid({
			network, chainId: "demo-chain", auctionId: "auction-1",
			approval: { ...structuredClone(f.approval), sellerP2pkXpub: sellerRoot.privateExtendedKey },
		})).rejects.toThrow("seller-binding-invalid");
		expect(storage.values.size).toBe(0);
		await writer.persistApprovedBid({ network, chainId: "demo-chain", auctionId: "auction-1", approval: f.approval });
		const reader = createBrowserDemoWalletLocalBidApprovalPort({ storage, locks, subtle: crypto.subtle });
		await expect(reader.readApprovedBid({
			network, chainId: "demo-chain", auctionId: "auction-1", operationId: f.contract.operationId,
			bidId: f.contract.bidId, bidEventId: f.contract.bidEventId, packageDigest: "e".repeat(64),
			cashuSigAllDigest: f.approval.cashuSigAllDigest, proofStateRefs: f.proofStateRefs,
		})).rejects.toThrow("durable-identity-mismatch");
		const [storedKey, raw] = [...storage.values.entries()][0]!;
		const parsed = JSON.parse(raw) as { checksum: string };
		storage.setItem(storedKey, JSON.stringify({ ...parsed, checksum: "f".repeat(64) }));
		let closeCalls = 0;
		await expect(runWith(f, { walletLocal: reader, automaticClose: { async readExact() { closeCalls += 1; return certifiedEvidence(f); } } })).rejects.toThrow("durable-checksum-invalid");
		expect(closeCalls).toBe(0); expect(f.metrics).toMatchObject({ committeeCalls: 0, mintCalls: 0, walletImports: 0 });
	});

	test("rejects a changed signed bid before automatic-close, committee, mint, or recipient import", async () => {
		const f = await fixture(); let closeCalls = 0;
		const approval = { ...structuredClone(f.approval), signedBid: { ...f.approval.signedBid, content: f.approval.signedBid.content.replace('"amount":12', '"amount":13') } };
		await expect(runWith(f, { approval, automaticClose: { async readExact() { closeCalls += 1; return certifiedEvidence(f); } } })).rejects.toThrow();
		expect(closeCalls).toBe(0); expect(f.metrics).toMatchObject({ committeeCalls: 0, mintCalls: 0, walletImports: 0 });
	});

	test("rejects changed deposit identity and changed outputs", async () => {
		const f = await fixture();
		const deposit = { ...structuredClone(f.approval), reservations: [{ ...f.approval.reservations[0]!, proofStateRef: publicKey(key(99)) }] };
		await expect(runWith(f, { approval: deposit })).rejects.toThrow("deposit-proof-mismatch");
		const changedContract = structuredClone(f.contract); changedContract.outputs = [{ ...changedContract.outputs[0]!, B_: publicKey(key(31)) }];
		await expect(runWith(f, { contract: changedContract })).rejects.toThrow("approval-scope-mismatch");
	});

	test("rejects cross-bid reuse even when a local source returns the other bid record", async () => {
		const f = await fixture(); const changedContract = structuredClone(f.contract); changedContract.operationId = `${f.contract.operationId}-other`;
		await expect(runWith(f, { contract: changedContract })).rejects.toThrow("approval-scope-mismatch");
		const changedApproval = { ...structuredClone(f.approval), bidEventId: "f".repeat(64) };
		await expect(runWith(f, { approval: changedApproval })).rejects.toThrow("approval-scope-mismatch");
		const changedPackage = { ...structuredClone(f.approval), packageDigest: "e".repeat(64) };
		await expect(runWith(f, { approval: changedPackage })).rejects.toThrow("approval-scope-mismatch");
	});

	test("rejects unauthenticated automatic-close evidence before committee, mint, or recipient import", async () => {
		const f = await fixture(); const evidence = await certifiedEvidence(f);
		await expect(runWith(f, {
			automaticClose: { async readExact() { return { ...evidence, signatureVerifier: { async verifyExact() { return false; } } }; } },
		})).rejects.toThrow("certified-closure-signature-invalid");
		expect(f.metrics).toMatchObject({ committeeCalls: 0, mintCalls: 0, walletImports: 0 });
	});

	test("unavailable seller recipient process fails closed before wallet, close, committee, or mint work", async () => {
		const f = await fixture(); let walletCalls = 0; let closeCalls = 0;
		await expect(executeDemoCertifiedWalletAutomaticClose({
			contract: f.contract, proofStateRefs: f.proofStateRefs,
			walletLocal: { async readApprovedBid() { walletCalls += 1; return f.approval; } },
			automaticClose: { async readExact() { closeCalls += 1; return certifiedEvidence(f); } },
			execution: { ...f.execution, recipient: undefined } as never,
		})).rejects.toThrow("recipient-process-unavailable");
		expect({ walletCalls, closeCalls }).toEqual({ walletCalls: 0, closeCalls: 0 });
		expect(f.metrics).toMatchObject({ committeeCalls: 0, mintCalls: 0, walletImports: 0 });
	});

	test("captures recipient custody methods before an awaited wallet source can substitute them", async () => {
		const f = await fixture(); let release!: () => void; let substitutedImports = 0;
		const waiting = new Promise<void>((resolve) => { release = resolve; });
		const run = executeDemoCertifiedWalletAutomaticClose({
			contract: f.contract, proofStateRefs: f.proofStateRefs,
			walletLocal: { async readApprovedBid() { await waiting; return f.approval; } },
			automaticClose: { async readExact() { return certifiedEvidence(f); } },
			execution: f.execution,
		});
		f.execution.recipient.wallet.importVerified = async () => { substitutedImports += 1; };
		release(); await run;
		expect(f.metrics.walletImports).toBe(1); expect(substitutedImports).toBe(0);
	});

	test("rejects a local approval locktime or per-proof principal that differs from the Cashu input", async () => {
		const f = await fixture();
		await expect(runWith(f, { approval: { ...structuredClone(f.approval), locktime: locktime - 1 } })).rejects.toThrow("locktime-mismatch");
		await expect(runWith(f, { approval: { ...structuredClone(f.approval), reservations: [{ ...f.approval.reservations[0]!, principalAmount: 13 }] } })).rejects.toThrow("deposit-amount-mismatch");
		expect(f.metrics).toMatchObject({ committeeCalls: 0, mintCalls: 0, walletImports: 0 });
	});

	test("missing concrete close, wallet, or recipient backends fails closed", async () => {
		const f = await fixture();
		expect(() => createBrowserDemoWalletLocalBidApprovalPort({ storage: new BrowserStorage(), subtle: crypto.subtle })).toThrow("durable-backend-unavailable");
		expect(() => createBrowserDemoWalletLocalBidApprovalPort({ locks: new OriginLocks(), subtle: crypto.subtle })).toThrow("durable-backend-unavailable");
		await expect(executeDemoCertifiedWalletAutomaticClose({ contract: f.contract, proofStateRefs: f.proofStateRefs, execution: f.execution, walletLocal: undefined, automaticClose: { async readExact() { return certifiedEvidence(f); } } })).rejects.toThrow("local-source-unavailable");
		await expect(executeDemoCertifiedWalletAutomaticClose({ contract: f.contract, proofStateRefs: f.proofStateRefs, execution: f.execution, walletLocal: { async readApprovedBid() { return f.approval; } }, automaticClose: undefined })).rejects.toThrow("close-source-unavailable");
	});
});
