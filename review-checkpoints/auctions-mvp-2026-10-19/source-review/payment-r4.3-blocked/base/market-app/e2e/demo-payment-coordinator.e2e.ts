import { expect, test } from "bun:test";

import { demoAuthSignerPublicKey, signDemoAuthEventId } from "../../cashu-wrapper/ts/index.ts";
import type { DemoMaintainerOfflineRecoveryResult, DemoMaintainerOfflineSuccess } from "../../cashu-wrapper/ts/demo-maintainer-offline.ts";
import { deriveSellerChildPubkey } from "../../cashu-wrapper/ts/seller-child.ts";
import type { CommittedAuctionBatchV2, CommittedBidEntryV1 } from "../plugins/committed-bid-consumer.ts";
import {
	DEMO_PAYMENT_CONSENSUS_HANDOFF_SCHEMA,
	DEMO_PAYMENT_CONSENSUS_RECEIPT_SCHEMA,
	DEMO_PAYMENT_MAX_BATCH_UTF8_BYTES,
	DEMO_PAYMENT_POST_LOCKTIME_RACE,
	DemoOfflinePaymentCoordinator,
	createBrowserDemoPaymentPersistence,
	createDemoPaymentApproval,
	verifyDemoPaymentConsensusHandoff,
	type DemoPaymentConsensusEvidencePort,
	type DemoPaymentConsensusHandoff,
	type DemoPaymentLockManager,
	type DemoPaymentOfflineExecutorPort,
	type DemoPaymentOfflineIdentityPort,
	type DemoPaymentRawSignedBidPort,
	type DemoPaymentStorageArea,
} from "../plugins/demo-payment-coordinator.ts";
import type { DemoBidIntentRecord } from "../plugins/demo-auth-bid-store.ts";
import {
	TEST_ONLY_LABEL,
	TEST_UNIT_LABEL,
	type DemoAuthUiConfig,
	type DemoSignedEvent,
	type DemoUnsignedEvent,
} from "../ts/demo-auth-bid.ts";

class Area implements DemoPaymentStorageArea {
	values = new Map<string, string>();
	getItem(key: string) { return this.values.get(key) ?? null; }
	setItem(key: string, value: string) { this.values.set(key, value); }
}

class Locks implements DemoPaymentLockManager {
	private readonly tails = new Map<string, Promise<void>>();
	async request<T>(name: string, _options: { readonly mode: "exclusive" }, callback: () => Promise<T>): Promise<T> {
		const prior = this.tails.get(name) ?? Promise.resolve();
		let release!: () => void;
		this.tails.set(name, new Promise<void>((resolve) => { release = resolve; }));
		await prior;
		try { return await callback(); } finally { release(); }
	}
}

const NETWORK = "a".repeat(64);
const CHAIN = "demo-chain";
const AUCTION = "auction-1";
const EVIDENCE_DIGEST = "e".repeat(64);
const privateKeys = ["1".repeat(64), "2".repeat(64)] as const;
const actorIds = privateKeys.map(demoAuthSignerPublicKey);
const SELLER_XPUB = "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";
const SELLER_PATH = "m/0/1/2/3/4";
const hash = async (value: string): Promise<string> => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function sign(secret: string, event: DemoUnsignedEvent): Promise<DemoSignedEvent> {
	const id = await hash(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]));
	return { ...event, id, sig: signDemoAuthEventId(id, secret) };
}

async function signedBid(index: number, amount: number): Promise<{ event: DemoSignedEvent; entry: CommittedBidEntryV1 }> {
	const operationId = `operation-${index + 1}`;
	const bidId = `bid-${index + 1}`;
	const event = await sign(privateKeys[index]!, {
		pubkey: actorIds[index]!, created_at: 1_900_000_000 + index, kind: 28642,
		tags: [["protocol", "plebeian-auction-auth-demo"], ["version", "1"], ["environment", NETWORK], ["valid_until", "1900000300"]],
		content: JSON.stringify({ version: 1, type: "bid", operation_id: operationId, auction_id: AUCTION, bid_id: bidId, amount, reservations: [{ reservation_id: String(index + 3).repeat(64), amount }] }),
	});
	return { event, entry: { actor_id: event.pubkey, operation_id: operationId, auction_id: AUCTION, bid_id: bidId, event_id: event.id, amount, displaced_refund_eligible: false } };
}

async function approvalFixture(): Promise<{ config: DemoAuthUiConfig; record: DemoBidIntentRecord }> {
	const childPubkey = deriveSellerChildPubkey(SELLER_XPUB, SELLER_PATH);
	const unsignedEvent: DemoUnsignedEvent = {
		pubkey: actorIds[0]!, created_at: 1_900_000_000, kind: 28642,
		tags: [["protocol", "plebeian-auction-auth-demo"], ["version", "1"], ["environment", NETWORK], ["valid_until", "1900000300"]],
		content: JSON.stringify({ version: 1, type: "bid", operation_id: "operation-approval", auction_id: AUCTION, bid_id: "bid-approval", amount: 13, reservations: [{ reservation_id: "3".repeat(64), amount: 13 }] }),
	};
	const signedEvent = await sign(privateKeys[0], unsignedEvent);
	const config: DemoAuthUiConfig = {
		schema: "DemoAuthUiConfigV1", bridgeBasePath: "/v1/demo-auth", profile: "DEMO_AUTH_V1",
		authNetworkId: NETWORK, chainId: CHAIN, auctionId: AUCTION, mintUrl: "https://testnut.cashu.space",
		mintSnapshot: {
			mintPublicKey: `03${"b".repeat(64)}`, serverVersion: "offline-fixture/1",
			activeSatKeysetId: `01${"c".repeat(64)}`, denominationKeyDigest: "d".repeat(64), inputFeePpk: 0,
			advertisedNuts: [4, 7, 9, 10, 11, 12], requiredNuts: [4, 7, 9, 10, 11, 12],
		},
		sellerP2pkXpub: SELLER_XPUB, baseEnd: 1_900_000_100, locktime: 1_900_002_020,
		startingBid: 1, sessionSubmissionCap: 1, testOnlyLabel: TEST_ONLY_LABEL, walletUnitLabel: TEST_UNIT_LABEL,
		profiles: [{ profileId: "bidder", accountId: "account", storageNamespace: "bidder", signerPubkey: actorIds[0]! }],
		funding: { enabled: false, usable: false, disabledReason: "offline-fixture", profiles: [] },
	};
	const record: DemoBidIntentRecord = {
		schema: "DemoAuthBidIntentV1", profileId: "bidder", auctionId: AUCTION,
		operationId: "operation-approval", bidId: "bid-approval", intentDigest: "4".repeat(64),
		canonicalIntent: "offline-approval-fixture", amount: 13, observedHeight: 1,
		childPubkey, path: SELLER_PATH, state: "submitted", unsignedEvent, signedEvent,
		submissionAttempted: true, revision: 1, checksum: "5".repeat(64),
	};
	return { config, record };
}

async function fixture() {
	const first = await signedBid(0, 13);
	const winner = await signedBid(1, 17);
	const batches: CommittedAuctionBatchV2[] = [
		{ schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: NETWORK, chain_id: CHAIN, height: 1, pbts_seconds: 101, app_hash: "1".repeat(64), bids: [first.entry], closures: [] },
		{ schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: NETWORK, chain_id: CHAIN, height: 2, pbts_seconds: 102, app_hash: "2".repeat(64), bids: [winner.entry], closures: [] },
		{ schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: NETWORK, chain_id: CHAIN, height: 3, pbts_seconds: 103, app_hash: "3".repeat(64), bids: [], closures: [{ auth_network_id: NETWORK, chain_id: CHAIN, auction_id: AUCTION, height: 3, pbts_seconds: 103, effective_end: 103, app_hash: "3".repeat(64), close_outcome: "winner", winner_bid_id: winner.entry.bid_id, winner_actor_id: winner.entry.actor_id, winner_operation_id: winner.entry.operation_id, amount: winner.entry.amount }] },
	];
	const handoff: DemoPaymentConsensusHandoff = { schema: DEMO_PAYMENT_CONSENSUS_HANDOFF_SCHEMA, authNetworkId: NETWORK, chainId: CHAIN, closureHeight: 3, canonicalBatchBytes: batches.map((batch) => JSON.stringify(batch)) };
	return { first, winner, batches, handoff, events: new Map([[first.event.id, first.event], [winner.event.id, winner.event]]) };
}

function success(operationId: string, status: "settled" | "refunded"): DemoMaintainerOfflineSuccess {
	return {
		status, deliverySource: "mint_response", selectionRoot: "5".repeat(64),
		terminal: { schema: "COCO_DEMO_SIGALL_TERMINAL_V1", requestDigest: "6".repeat(64), responseDigest: "7".repeat(64), outputCount: 1, amountTotal: operationId === "operation-2" ? 17 : 13, keysetIds: ["keyset-1"], source: "mint_response", completedAt: 200 },
		recipient: { imported: true, alreadyImported: false },
	};
}

async function coordinator(options: {
	readonly events: Map<string, DemoSignedEvent>;
	readonly badReceipt?: boolean;
	readonly recoverResult?: DemoMaintainerOfflineRecoveryResult;
	readonly calls?: Array<{ operationId: string; role: string; mode: string }>;
}): Promise<DemoOfflinePaymentCoordinator> {
	const consensus: DemoPaymentConsensusEvidencePort = {
		async verifyExact(request) {
			return {
				schema: DEMO_PAYMENT_CONSENSUS_RECEIPT_SCHEMA, authNetworkId: request.authNetworkId, chainId: request.chainId,
				authenticatedStartHeight: 1, authenticatedThroughHeight: request.closureHeight + 1,
				canonicalSuccessorCommitHeight: request.closureHeight + 1,
				successorObservedHeight: request.closureHeight + (options.badReceipt ? 1 : 2),
				canonicalBatchSetDigest: request.canonicalBatchSetDigest, evidenceDigest: EVIDENCE_DIGEST,
			};
		},
	};
	const signedBids: DemoPaymentRawSignedBidPort = { async readExact(request) { return structuredClone(options.events.get(request.eventId) ?? null); } };
	const roles = new Map<string, "winner_settlement" | "refund">();
	const identities: DemoPaymentOfflineIdentityPort = {
		async readExact(request) {
			roles.set(request.operationId, request.expectedRole);
			options.calls?.push({ operationId: request.operationId, role: request.expectedRole, mode: "identity" });
			return { scope: `scope-${request.operationId}`, bundleDigest: request.operationId === "operation-2" ? "b".repeat(64) : "c".repeat(64) };
		},
	};
	const executor: DemoPaymentOfflineExecutorPort = {
		async executeExact(identity) {
			const operationId = identity.scope.slice("scope-".length);
			const role = roles.get(operationId)!;
			options.calls?.push({ operationId, role, mode: "execute" });
			return success(operationId, role === "winner_settlement" ? "settled" : "refunded");
		},
		async recoverExact(identity) {
			const operationId = identity.scope.slice("scope-".length);
			const role = roles.get(operationId)!;
			options.calls?.push({ operationId, role, mode: "recover" });
			return options.recoverResult ?? success(operationId, role === "winner_settlement" ? "settled" : "refunded");
		},
	};
	return new DemoOfflinePaymentCoordinator(
		createBrowserDemoPaymentPersistence({ localStorage: new Area(), lockManager: new Locks() }),
		consensus, signedBids, identities, executor,
		{ authNetworkId: NETWORK, chainId: CHAIN, auctionId: AUCTION },
	);
}

test("accepted consensus handoff joins raw signed events then delegates winner/refund to the offline executor", async () => {
	const value = await fixture();
	const calls: Array<{ operationId: string; role: string; mode: string }> = [];
	const selected = await coordinator({ events: value.events, calls });
	const result = await selected.processExactHandoff(value.handoff);
	expect(result).toEqual({ paid: ["operation-2"], refunded: ["operation-1"], pendingDispositions: [], pendingRecovery: [], consensusEvidenceDigest: EVIDENCE_DIGEST, postLocktimeRace: DEMO_PAYMENT_POST_LOCKTIME_RACE });
	expect(calls).toEqual([
		{ operationId: "operation-2", role: "winner_settlement", mode: "identity" }, { operationId: "operation-2", role: "winner_settlement", mode: "execute" },
		{ operationId: "operation-1", role: "refund", mode: "identity" }, { operationId: "operation-1", role: "refund", mode: "execute" },
	]);
	await expect(selected.processBatches(value.batches)).rejects.toThrow("consensus-handoff-required");
});

test("fails closed unless H+1 is authenticated from a canonical commit observed at H+2", async () => {
	const value = await fixture();
	const calls: Array<{ operationId: string; role: string; mode: string }> = [];
	await expect((await coordinator({ events: value.events, badReceipt: true, calls })).processExactHandoff(value.handoff)).rejects.toThrow("consensus-receipt-mismatch");
	expect(calls).toEqual([]);
});

test("rejects noncanonical batch bytes and a raw signed-event substitution before payment execution", async () => {
	const value = await fixture();
	const spaced = { ...value.handoff, canonicalBatchBytes: [` ${value.handoff.canonicalBatchBytes[0]}`, ...value.handoff.canonicalBatchBytes.slice(1)] };
	await expect((await coordinator({ events: value.events })).processExactHandoff(spaced)).rejects.toThrow("canonical-batch-noncanonical");

	const changedEvents = new Map(value.events);
	const event = structuredClone(value.first.event);
	(event as { content: string }).content = event.content.replace('"amount":13', '"amount":14');
	changedEvents.set(event.id, event);
	await expect((await coordinator({ events: changedEvents })).processExactHandoff(value.handoff)).rejects.toThrow("raw-signed-bid-join-mismatch");
});

test("unknown-response recovery is explicit and does not become a success claim", async () => {
	const value = await fixture();
	const selected = await coordinator({ events: value.events, recoverResult: { status: "indeterminate", reasonCode: "mint-response-unknown" } });
	const result = await selected.recoverExactHandoff(value.handoff);
	expect(result.paid).toEqual([]);
	expect(result.refunded).toEqual([]);
	expect(result.pendingDispositions).toEqual([]);
	expect(result.pendingRecovery).toEqual([
		{ operationId: "operation-2", status: "indeterminate" },
		{ operationId: "operation-1", status: "indeterminate" },
	]);
	expect(result.postLocktimeRace).toBe("mint-first-spend-remains-authoritative");
});

test("a changed closure cannot replace the durable authority after exact execution", async () => {
	const value = await fixture();
	const selected = await coordinator({ events: value.events });
	await selected.processExactHandoff(value.handoff);
	const alteredBytes = [...value.handoff.canonicalBatchBytes];
	const last = JSON.parse(alteredBytes[2]!) as CommittedAuctionBatchV2;
	(last.closures[0] as { app_hash: string }).app_hash = "4".repeat(64);
	(last as { app_hash: string }).app_hash = "4".repeat(64);
	alteredBytes[2] = JSON.stringify(last);
	const altered: DemoPaymentConsensusHandoff = { ...value.handoff, canonicalBatchBytes: alteredBytes };
	await expect(selected.processExactHandoff(altered)).rejects.toThrow("alternate-operation-root");
});

test("rejects an oversized canonical batch before parsing or consensus verification", async () => {
	let verifierCalls = 0;
	const handoff: DemoPaymentConsensusHandoff = {
		schema: DEMO_PAYMENT_CONSENSUS_HANDOFF_SCHEMA,
		authNetworkId: NETWORK,
		chainId: CHAIN,
		closureHeight: 1,
		canonicalBatchBytes: ["x".repeat(DEMO_PAYMENT_MAX_BATCH_UTF8_BYTES + 1)],
	};
	await expect(verifyDemoPaymentConsensusHandoff(handoff, { authNetworkId: NETWORK, chainId: CHAIN, auctionId: AUCTION }, {
		async verifyExact() { verifierCalls += 1; throw new Error("must not verify"); },
	})).rejects.toThrow("canonical-batch-limit");
	expect(verifierCalls).toBe(0);
});

test("rejects an oversized aggregate handoff before parsing or consensus verification", async () => {
	let verifierCalls = 0;
	const batchCount = 65;
	const handoff: DemoPaymentConsensusHandoff = {
		schema: DEMO_PAYMENT_CONSENSUS_HANDOFF_SCHEMA,
		authNetworkId: NETWORK,
		chainId: CHAIN,
		closureHeight: batchCount,
		canonicalBatchBytes: Array.from({ length: batchCount }, () => "x".repeat(DEMO_PAYMENT_MAX_BATCH_UTF8_BYTES)),
	};
	await expect(verifyDemoPaymentConsensusHandoff(handoff, { authNetworkId: NETWORK, chainId: CHAIN, auctionId: AUCTION }, {
		async verifyExact() { verifierCalls += 1; throw new Error("must not verify"); },
	})).rejects.toThrow("consensus-handoff-limit");
	expect(verifierCalls).toBe(0);
});

test("new V1 approval creation rejects non-printable Unicode before signing", async () => {
	const base = await approvalFixture();
	const rejected = [
		["U+2028", "\u2028"],
		["U+2029", "\u2029"],
		["lone high surrogate", "\uD800"],
		["lone low surrogate", "\uDC00"],
		["U+FFFD", "\uFFFD"],
		["valid surrogate pair", "\uD83D\uDE00"],
		["space", " "],
		["over 160 bytes", "a".repeat(161)],
	] as const;
	for (const [label, value] of rejected) {
		let signerCalls = 0;
		await expect(createDemoPaymentApproval({
			config: { ...base.config, chainId: `chain${value}` },
			record: base.record,
			conditionFingerprint: "f".repeat(64),
			signer: { async signEvent(event) { signerCalls += 1; return sign(privateKeys[0], event); } },
		})).rejects.toThrow("demo-payment-approval-text-invalid");
		expect(signerCalls, label).toBe(0);
	}
});

test("new V1 approval creation preserves printable ASCII metacharacters exactly", async () => {
	const base = await approvalFixture();
	const printable = "chain&<>\"\\";
	let captured: DemoUnsignedEvent | null = null;
	const approval = await createDemoPaymentApproval({
		config: { ...base.config, chainId: printable },
		record: base.record,
		conditionFingerprint: "f".repeat(64),
		signer: {
			async signEvent(event) {
				captured = structuredClone(event);
				return sign(privateKeys[0], event);
			},
		},
	});
	expect(approval.chainId).toBe(printable);
	expect(captured).not.toBeNull();
	expect((JSON.parse(captured!.content) as { chain_id: string }).chain_id).toBe(printable);
});
