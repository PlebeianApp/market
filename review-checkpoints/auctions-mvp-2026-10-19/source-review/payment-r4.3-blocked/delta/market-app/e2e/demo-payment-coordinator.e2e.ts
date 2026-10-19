import { expect, test } from "bun:test";

import { demoAuthSignerPublicKey, signDemoAuthEventId } from "../../cashu-wrapper/ts/index.ts";
import { demoMaintainerFederationSessionId, type DemoMaintainerOfflineRecoveryResult, type DemoMaintainerOfflineSuccess } from "../../cashu-wrapper/ts/demo-maintainer-offline.ts";
import { deriveSellerChildPubkey } from "../../cashu-wrapper/ts/seller-child.ts";
import type { CommittedAuctionBatchV2, CommittedBidEntryV1 } from "../plugins/committed-bid-consumer.ts";
import {
	DEMO_PAYMENT_CONSENSUS_HANDOFF_SCHEMA,
	DEMO_PAYMENT_CONSENSUS_RECEIPT_SCHEMA,
	DEMO_PAYMENT_MAX_BATCH_UTF8_BYTES,
	DEMO_PAYMENT_POST_LOCKTIME_RACE,
	DemoOfflinePaymentCoordinator,
	advanceDemoPaymentVerificationV2,
	buildDemoPaymentCompletionV2,
	createBrowserDemoPaymentPersistence,
	createDemoPaymentApproval,
	deriveDemoPaymentDispositionsV2,
	deriveDemoPaymentOperationMembershipV2,
	reserveDemoMainSessionBeforeCutoffV2,
	verifyDemoPaymentApprovalSetV2,
	verifyDemoPaymentApprovalV2,
	verifyDemoPaymentConsensusHandoff,
	type DemoAuthenticatedPaymentCommitmentsV2,
	type DemoCommittedAuctionHistoryChunkV2,
	type DemoCommittedAuctionHistoryOpenV2,
	type DemoMainSessionReservationPortV2,
	type DemoPaymentApprovalSnapshotOpenV2,
	type DemoPaymentApprovalV2,
	type DemoPaymentConsensusEvidencePort,
	type DemoPaymentConsensusHandoff,
	type DemoPaymentLockManager,
	type DemoPaymentOfflineExecutorPort,
	type DemoPaymentOfflineIdentityPort,
	type DemoPaymentRawSignedBidPort,
	type DemoPaymentStorageArea,
	type DemoPaymentVerificationCheckpointV2,
	type DemoPaymentVerificationStoreV2,
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

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);
const hexBytes = (value: string): Uint8Array => Uint8Array.from({ length: value.length / 2 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
const uint64 = (value: number): Uint8Array => {
	const out = new Uint8Array(8); let held = BigInt(value);
	for (let index = 7; index >= 0; index -= 1) { out[index] = Number(held & 255n); held >>= 8n; }
	return out;
};
const hashParts = async (...parts: Uint8Array[]): Promise<string> => {
	const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0; for (const part of parts) { joined.set(part, offset); offset += part.length; }
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", joined as BufferSource))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

async function approvalV2Fixture(overrides: Partial<DemoPaymentApprovalV2> = {}): Promise<DemoPaymentApprovalV2> {
	const base: DemoPaymentApprovalV2 = {
		schema: "DemoPaymentApprovalV2", authNetworkId: NETWORK, chainId: CHAIN, auctionId: AUCTION,
		operationId: "operation-v2", bidId: "bid-v2", bidEventId: "3".repeat(64), bidderActorId: actorIds[0]!,
		bidderCashuPublicKey: `02${"b".repeat(64)}`, refundCashuPublicKey: `03${"c".repeat(64)}`,
		refundKeyVersion: "separate-cashu-refund-key-v1", amount: 21, mintUrl: "https://mint.example",
		sellerP2pkXpub: SELLER_XPUB, sellerDerivationPath: SELLER_PATH,
		sellerRecipientPublicKey: deriveSellerChildPubkey(SELLER_XPUB, SELLER_PATH),
		conditionFingerprint: "5".repeat(64), winnerPackageDigest: "6".repeat(64), refundPackageDigest: "7".repeat(64),
		closeTime: 1_900_000_100, settlementWindowSeconds: 60, validUntil: 1_900_000_100, locktime: 1_900_000_300,
		approvalLifetimePolicyVersion: "terminal-bound-exact-operation-v1", approvalCreatedAt: 1_900_000_000,
		approvalEventId: "0".repeat(64), approvalSignature: "0".repeat(128),
	};
	const value = { ...base, ...overrides };
	const content = JSON.stringify({
		schema: value.schema, auth_network_id: value.authNetworkId, chain_id: value.chainId, auction_id: value.auctionId,
		operation_id: value.operationId, bid_id: value.bidId, bid_event_id: value.bidEventId,
		bidder_cashu_public_key: value.bidderCashuPublicKey, refund_cashu_public_key: value.refundCashuPublicKey,
		refund_key_version: value.refundKeyVersion, amount: value.amount, mint_url: value.mintUrl,
		seller_p2pk_xpub: value.sellerP2pkXpub, seller_derivation_path: value.sellerDerivationPath,
		seller_recipient_public_key: value.sellerRecipientPublicKey, condition_fingerprint: value.conditionFingerprint,
		winner_package_digest: value.winnerPackageDigest, refund_package_digest: value.refundPackageDigest,
		close_time: value.closeTime, settlement_window_seconds: value.settlementWindowSeconds, valid_until: value.validUntil,
		locktime: value.locktime, approval_lifetime_policy_version: value.approvalLifetimePolicyVersion,
	});
	const event = await sign(privateKeys[0], {
		pubkey: value.bidderActorId, created_at: value.approvalCreatedAt, kind: 28643,
		tags: [["protocol", "plebeian-auction-fake-ecash-payment"], ["version", "2"], ["environment", value.authNetworkId], ["bid_event", value.bidEventId]], content,
	});
	return { ...value, approvalEventId: event.id, approvalSignature: event.sig };
}

test("ApprovalV2 validates exact signed bytes, distinct roles, lifetime, and the five-field membership join", async () => {
	const approval = await approvalV2Fixture();
	const keyRoles = { committeePublicKey: `02${"d".repeat(64)}`, validatorPublicKeys: [`03${"e".repeat(64)}`] };
	const verified = await verifyDemoPaymentApprovalV2(approval, keyRoles);
	expect(verified.approval.schema).toBe("DemoPaymentApprovalV2");
	expect(verified.approvalDigest).toMatch(/^[0-9a-f]{64}$/);
	const membership = {
		members: [{ operationId: approval.operationId, bidId: approval.bidId, bidEventId: approval.bidEventId, bidderActorId: approval.bidderActorId, amount: approval.amount, committedHeight: 7, committedEntryIndex: 1 }],
		operationMembershipSha256: "9".repeat(64),
	};
	const set = await verifyDemoPaymentApprovalSetV2({ approvals: [approval], membership, expected: { authNetworkId: NETWORK, chainId: CHAIN, auctionId: AUCTION }, keyRoles });
	expect(set.approvals).toHaveLength(1);
	expect(set.verifiedApprovalSetSha256).toMatch(/^[0-9a-f]{64}$/);
	await expect(verifyDemoPaymentApprovalV2(await approvalV2Fixture({ bidderCashuPublicKey: `02${actorIds[0]}` }), keyRoles)).rejects.toThrow("role-key-alias");
	await expect(verifyDemoPaymentApprovalSetV2({ approvals: [approval], membership: { ...membership, members: [{ ...membership.members[0]!, committedEntryIndex: 0, amount: 22 }] }, expected: { authNetworkId: NETWORK, chainId: CHAIN, auctionId: AUCTION }, keyRoles })).rejects.toThrow("approval-member-join");
});

test("membership preserves the original bids-array index before auction filtering and exact dispositions", async () => {
	const batches: CommittedAuctionBatchV2[] = Array.from({ length: 7 }, (_, index) => ({
		schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: NETWORK, chain_id: "chain-test",
		height: index + 1, pbts_seconds: 100 + index, app_hash: String(index + 1).repeat(64).slice(0, 64), bids: [], closures: [],
	}));
	batches[6] = { ...batches[6]!, bids: [
		{ actor_id: "1".repeat(64), operation_id: "op-other", auction_id: "auction-other", bid_id: "bid-other", event_id: "2".repeat(64), amount: 999, displaced_refund_eligible: false },
		{ actor_id: "4".repeat(64), operation_id: "op-target", auction_id: "auction-target", bid_id: "bid-target", event_id: "3".repeat(64), amount: 2100, displaced_refund_eligible: false },
	] };
	const expected = { authNetworkId: NETWORK, chainId: "chain-test", auctionId: "auction-target" };
	const membership = await deriveDemoPaymentOperationMembershipV2(batches, expected, 8);
	expect(membership.members[0]?.committedEntryIndex).toBe(1);
	expect(membership.operationMembershipSha256).toBe("52089e597ea98ecf4909cd27921bd5f784c95b99e1c05d5586946269d19215a0");
	const shifted = structuredClone(batches); shifted[6] = { ...shifted[6]!, bids: [shifted[6]!.bids[1]!] };
	expect((await deriveDemoPaymentOperationMembershipV2(shifted, expected, 8)).operationMembershipSha256).toBe("42001860425171f37e04d69c44eb305813636f62c2d0229804be93270cbf0f08");
	const reserve = deriveDemoPaymentDispositionsV2(membership, { auth_network_id: NETWORK, chain_id: "chain-test", auction_id: "auction-target", height: 8, pbts_seconds: 108, effective_end: 108, app_hash: "8".repeat(64), close_outcome: "reserve_not_met", winner_bid_id: "", winner_actor_id: "", winner_operation_id: "", amount: 0 });
	expect(reserve.map(({ role }) => role)).toEqual(["refund"]);
});

test("completion identity exact-matches all four durable journal digests and is restart-stable", async () => {
	const requestDigest = "1".repeat(64); const responseDigest = "2".repeat(64); const recipientRequestDigest = "3".repeat(64); const recipientResponseDigest = "4".repeat(64);
	const idempotencyKey = await hash(`COCO_DEMO_RECIPIENT_IMPORT_V1\0${recipientRequestDigest}`);
	const options = {
		evidenceDigest: "5".repeat(64), selectionRoot: "6".repeat(64), templateDigest: "7".repeat(64), bundleDigest: "8".repeat(64),
		operationId: "operation-v2", role: "winner_settlement" as const, recipientPublicKey: `02${"9".repeat(64)}`, amount: 21, proofCount: 2,
		mintRequestDigest: requestDigest, mintResponseDigest: responseDigest, recipientRequestDigest, recipientResponseDigest,
		mintJournal: { requestDigest, responseDigest, outputCount: 2, amountTotal: 21, source: "exact_recovery" as const, completedAt: 1234 },
		recipientJournal: { schema: "DemoRecipientImportCompletionV2" as const, operationId: "operation-v2", role: "winner_settlement" as const,
			recipientPublicKey: `02${"9".repeat(64)}`, amount: 21, proofCount: 2, recipientRequestDigest, recipientResponseDigest, recipientImportIdempotencyKey: idempotencyKey, imported: true as const },
		deliverySource: "terminal_restore" as const, alreadyImported: true, observedAt: 9999,
	};
	const first = await buildDemoPaymentCompletionV2(options);
	const replay = await buildDemoPaymentCompletionV2({ ...options, deliverySource: "gate_replay", observedAt: 10001 });
	expect(replay.completion).toEqual(first.completion);
	expect(replay.completionDigest).toBe(first.completionDigest);
	await expect(buildDemoPaymentCompletionV2({ ...options, recipientResponseDigest: "a".repeat(64) })).rejects.toThrow("completion-journal-mismatch");
});

test("atomic MAIN reservation rejects cutoff and clock rollback while racing sessions remain unique", async () => {
	let seconds = 100; let floor = 0; let attempt = 0;
	const port: DemoMainSessionReservationPortV2 = {
		async reserveMainSessionBeforeCutoff(request) {
			if (seconds < floor) throw new Error("clock-rollback");
			if (seconds >= request.cutoffSeconds) throw new Error("cutoff");
			floor = seconds; attempt += 1;
			return { schema: "DemoMainSessionReservationV2", clockPolicyVersion: request.clockPolicyVersion, clockId: request.expectedClockId,
				observedSeconds: seconds, attemptNumber: attempt, sessionId: demoMaintainerFederationSessionId(request.selectionRoot, attempt) };
		},
	};
	const request = { scope: "scope-v2", bundleDigest: "b".repeat(64), selectionRoot: "c".repeat(64), cutoffSeconds: 120, expectedClockId: "executor-clock-1", clockPolicyVersion: "durable-monotonic-executor-seconds-v1" as const };
	const reservations = await Promise.all([reserveDemoMainSessionBeforeCutoffV2(port, request), reserveDemoMainSessionBeforeCutoffV2(port, request)]);
	expect(reservations.map(({ attemptNumber }) => attemptNumber)).toEqual([1, 2]);
	expect(new Set(reservations.map(({ sessionId }) => sessionId)).size).toBe(2);
	seconds = 99;
	await expect(reserveDemoMainSessionBeforeCutoffV2(port, request)).rejects.toThrow("clock-rollback");
	seconds = 120;
	await expect(reserveDemoMainSessionBeforeCutoffV2(port, request)).rejects.toThrow("cutoff");
});

test("bounded V2 verification advances exactly one immutable history chunk per invocation", async () => {
	const batches: CommittedAuctionBatchV2[] = [
		{ schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: NETWORK, chain_id: CHAIN, height: 1, pbts_seconds: 101, app_hash: "1".repeat(64), bids: [], closures: [] },
		{ schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: NETWORK, chain_id: CHAIN, height: 2, pbts_seconds: 102, app_hash: "2".repeat(64), bids: [], closures: [{ auth_network_id: NETWORK, chain_id: CHAIN, auction_id: AUCTION, height: 2, pbts_seconds: 102, effective_end: 102, app_hash: "2".repeat(64), close_outcome: "no_bids", winner_bid_id: "", winner_actor_id: "", winner_operation_id: "", amount: 0 }] },
	];
	const zero = "0".repeat(64); const marker = "synthetic-storage-r4";
	const chunks: DemoCommittedAuctionHistoryChunkV2[] = [];
	let previous = zero;
	for (const [index, batch] of batches.entries()) {
		const provisional: DemoCommittedAuctionHistoryChunkV2 = { schema: "DemoCommittedAuctionHistoryChunkV2", immutableStorageMarker: marker, storageRootSha256: zero, index, firstHeight: index + 1, lastHeight: index + 1, previousChunkDigest: previous, batches: [batch], chunkDigest: zero };
		const body = JSON.stringify({ schema: provisional.schema, immutableStorageMarker: provisional.immutableStorageMarker, index: provisional.index, firstHeight: provisional.firstHeight, lastHeight: provisional.lastHeight, batches: provisional.batches });
		const chunkDigest = await hashParts(utf8("COCO_DEMO_COMMITTED_AUCTION_HISTORY_CHUNK_V2\0"), hexBytes(previous), uint64(index), utf8(body));
		chunks.push({ ...provisional, chunkDigest }); previous = chunkDigest;
	}
	const historyDigest = await hash(JSON.stringify(batches));
	const membershipDigest = await hash(`COCO_DEMO_PAYMENT_OPERATION_MEMBERSHIP_V2\0[]`);
	const approvalDigest = await hash(`COCO_DEMO_PAYMENT_APPROVAL_SET_V2\0[]`);
	const rootDescriptor = { schema: "DemoCommittedAuctionHistoryOpenV2", authNetworkId: NETWORK, chainId: CHAIN, firstHeight: 1, throughHeight: 2,
		throughAppHash: batches[1]!.app_hash, immutableStorageMarker: marker, chunkCount: 2, batchCount: 2, packingPolicy: "greedy-contiguous-height-v1",
		maxBatchesPerChunk: 64, maxCanonicalBatchUtf8Bytes: 65536, maxCanonicalBatchArrayUtf8BytesPerChunk: 4194304, finalChunkDigest: previous,
		canonicalBatchHistorySha256: historyDigest };
	const storageRoot = await hash(`COCO_DEMO_COMMITTED_AUCTION_HISTORY_ROOT_V2\0${JSON.stringify(rootDescriptor)}`);
	for (let index = 0; index < chunks.length; index += 1) chunks[index] = { ...chunks[index]!, storageRootSha256: storageRoot };
	const open: DemoCommittedAuctionHistoryOpenV2 = { ...rootDescriptor, schema: "DemoCommittedAuctionHistoryOpenV2", packingPolicy: "greedy-contiguous-height-v1", firstHeight: 1, maxBatchesPerChunk: 64, maxCanonicalBatchUtf8Bytes: 65536, maxCanonicalBatchArrayUtf8BytesPerChunk: 4194304, storageRootSha256: storageRoot };
	const snapshotDescriptor = { schema: "DemoPaymentApprovalSnapshotOpenV2" as const, snapshotMarker: "synthetic-approvals-r4", authNetworkId: NETWORK, chainId: CHAIN, auctionId: AUCTION,
		operationMembershipSha256: membershipDigest, recordCount: 0, pageCount: 0, maxRecordsPerPage: 64 as const, maxCanonicalApprovalBytesPerRecord: 8192 as const,
		maxCanonicalApprovalArrayBytesPerPage: 524353 as const, finalPageDigest: zero, verifiedApprovalSetSha256: approvalDigest };
	const snapshot: DemoPaymentApprovalSnapshotOpenV2 = { ...snapshotDescriptor, snapshotRootSha256: await hash(`COCO_DEMO_PAYMENT_APPROVAL_SNAPSHOT_ROOT_V2\0${JSON.stringify(snapshotDescriptor)}`) };
	class VerificationStore implements DemoPaymentVerificationStoreV2 {
		checkpoint: DemoPaymentVerificationCheckpointV2 | null = null;
		async createOrGet(initial: DemoPaymentVerificationCheckpointV2) { this.checkpoint ??= structuredClone(initial); return structuredClone(this.checkpoint); }
		async compareAndSwap(request: { expectedRevision: number; next: DemoPaymentVerificationCheckpointV2; appendMembers: readonly never[]; appendApprovalKeys: readonly string[] }) {
			if (this.checkpoint?.revision !== request.expectedRevision || request.appendMembers.length !== 0 || request.appendApprovalKeys.length !== 0) return false;
			this.checkpoint = structuredClone(request.next); return true;
		}
		async readMemberByOperation() { return null; }
		async findMember() { return null; }
		async hasMemberConflict() { return false; }
	}
	const store = new VerificationStore();
	const expected: DemoAuthenticatedPaymentCommitmentsV2 = { schema: "DemoAuthenticatedPaymentCommitmentsV2", authNetworkId: NETWORK, chainId: CHAIN, auctionId: AUCTION,
		closureHeight: 2, closureAppHash: batches[1]!.app_hash, immutableStorageMarker: marker, storageRootSha256: storageRoot,
		operationMembershipSha256: membershipDigest, operationCount: 0, approvalCount: 0, canonicalBatchHistorySha256: historyDigest, verifiedApprovalSetSha256: approvalDigest };
	const common = { expected, keyRoles: { committeePublicKey: `02${"d".repeat(64)}` }, storageAuthority: { schema: "DemoPaymentStorageAuthorityV2" as const, mode: "synthetic_fixture" as const, fixtureDigest: "f".repeat(64) }, store,
		history: { async open() { return structuredClone(open); }, async readChunk(request: { index: number }) { return structuredClone(chunks[request.index] ?? null); } },
		approvals: { async openExact() { return structuredClone(snapshot); }, async readPage() { throw new Error("empty snapshot has no page"); } } };
	await expect(advanceDemoPaymentVerificationV2({ ...common, storageAuthority: { ...common.storageAuthority, fixtureDigest: "unaccepted" } })).rejects.toThrow("storage-adapter-unaccepted");
	await expect(advanceDemoPaymentVerificationV2({ ...common, storageAuthority: { schema: "DemoPaymentStorageAuthorityV2", mode: "accepted_sealed", handoffSeal: "e".repeat(64) } })).rejects.toThrow("storage-adapter-unaccepted");
	expect(await advanceDemoPaymentVerificationV2(common)).toMatchObject({ status: "verification_pending", phase: "history" });
	expect(store.checkpoint?.nextChunkIndex).toBe(1);
	expect(await advanceDemoPaymentVerificationV2(common)).toMatchObject({ status: "ready", productionReady: false });
	expect(store.checkpoint?.nextChunkIndex).toBe(2);
});

test("bounded V2 verification processes one approval page in a later invocation", async () => {
	const approval = await approvalV2Fixture();
	const entry: CommittedBidEntryV1 = { actor_id: approval.bidderActorId, operation_id: approval.operationId, auction_id: AUCTION, bid_id: approval.bidId, event_id: approval.bidEventId, amount: approval.amount, displaced_refund_eligible: false };
	const batches: CommittedAuctionBatchV2[] = [
		{ schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: NETWORK, chain_id: CHAIN, height: 1, pbts_seconds: 101, app_hash: "1".repeat(64), bids: [entry], closures: [] },
		{ schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: NETWORK, chain_id: CHAIN, height: 2, pbts_seconds: 102, app_hash: "2".repeat(64), bids: [], closures: [{ auth_network_id: NETWORK, chain_id: CHAIN, auction_id: AUCTION, height: 2, pbts_seconds: 102, effective_end: 102, app_hash: "2".repeat(64), close_outcome: "winner", winner_bid_id: approval.bidId, winner_actor_id: approval.bidderActorId, winner_operation_id: approval.operationId, amount: approval.amount }] },
	];
	const member = { operationId: approval.operationId, bidId: approval.bidId, bidEventId: approval.bidEventId, bidderActorId: approval.bidderActorId, amount: approval.amount, committedHeight: 1, committedEntryIndex: 0 };
	const membershipDigest = await hash(`COCO_DEMO_PAYMENT_OPERATION_MEMBERSHIP_V2\0${JSON.stringify([member])}`);
	const approvalDigest = await hash(`COCO_DEMO_PAYMENT_APPROVAL_SET_V2\0${JSON.stringify([approval])}`);
	const historyDigest = await hash(JSON.stringify(batches)); const zero = "0".repeat(64); const marker = "synthetic-storage-approval-r4";
	const provisional: DemoCommittedAuctionHistoryChunkV2 = { schema: "DemoCommittedAuctionHistoryChunkV2", immutableStorageMarker: marker, storageRootSha256: zero, index: 0, firstHeight: 1, lastHeight: 2, previousChunkDigest: zero, batches, chunkDigest: zero };
	const chunkBody = JSON.stringify({ schema: provisional.schema, immutableStorageMarker: marker, index: 0, firstHeight: 1, lastHeight: 2, batches });
	const chunkDigest = await hashParts(utf8("COCO_DEMO_COMMITTED_AUCTION_HISTORY_CHUNK_V2\0"), hexBytes(zero), uint64(0), utf8(chunkBody));
	const rootDescriptor = { schema: "DemoCommittedAuctionHistoryOpenV2", authNetworkId: NETWORK, chainId: CHAIN, firstHeight: 1, throughHeight: 2,
		throughAppHash: batches[1]!.app_hash, immutableStorageMarker: marker, chunkCount: 1, batchCount: 2, packingPolicy: "greedy-contiguous-height-v1",
		maxBatchesPerChunk: 64, maxCanonicalBatchUtf8Bytes: 65536, maxCanonicalBatchArrayUtf8BytesPerChunk: 4194304, finalChunkDigest: chunkDigest, canonicalBatchHistorySha256: historyDigest };
	const storageRoot = await hash(`COCO_DEMO_COMMITTED_AUCTION_HISTORY_ROOT_V2\0${JSON.stringify(rootDescriptor)}`);
	const chunk: DemoCommittedAuctionHistoryChunkV2 = { ...provisional, storageRootSha256: storageRoot, chunkDigest };
	const open: DemoCommittedAuctionHistoryOpenV2 = { ...rootDescriptor, schema: "DemoCommittedAuctionHistoryOpenV2", firstHeight: 1, packingPolicy: "greedy-contiguous-height-v1", maxBatchesPerChunk: 64, maxCanonicalBatchUtf8Bytes: 65536, maxCanonicalBatchArrayUtf8BytesPerChunk: 4194304, storageRootSha256: storageRoot };
	const pageBody = JSON.stringify({ schema: "DemoPaymentApprovalSnapshotPageV2", snapshotMarker: "synthetic-approval-page-r4", pageIndex: 0, records: [approval], cumulativeRecordCount: 1, eof: true });
	const pageDigest = await hashParts(utf8("COCO_DEMO_PAYMENT_APPROVAL_SNAPSHOT_PAGE_V2\0"), hexBytes(zero), uint64(0), utf8(pageBody));
	const snapshotDescriptor = { schema: "DemoPaymentApprovalSnapshotOpenV2" as const, snapshotMarker: "synthetic-approval-page-r4", authNetworkId: NETWORK, chainId: CHAIN, auctionId: AUCTION,
		operationMembershipSha256: membershipDigest, recordCount: 1, pageCount: 1, maxRecordsPerPage: 64 as const, maxCanonicalApprovalBytesPerRecord: 8192 as const,
		maxCanonicalApprovalArrayBytesPerPage: 524353 as const, finalPageDigest: pageDigest, verifiedApprovalSetSha256: approvalDigest };
	const snapshot: DemoPaymentApprovalSnapshotOpenV2 = { ...snapshotDescriptor, snapshotRootSha256: await hash(`COCO_DEMO_PAYMENT_APPROVAL_SNAPSHOT_ROOT_V2\0${JSON.stringify(snapshotDescriptor)}`) };
	class VerificationStore implements DemoPaymentVerificationStoreV2 {
		checkpoint: DemoPaymentVerificationCheckpointV2 | null = null; member: typeof member | null = null; keys: string[] = [];
		async createOrGet(initial: DemoPaymentVerificationCheckpointV2) { this.checkpoint ??= structuredClone(initial); return structuredClone(this.checkpoint); }
		async compareAndSwap(request: { expectedRevision: number; next: DemoPaymentVerificationCheckpointV2; appendMembers: readonly typeof member[]; appendApprovalKeys: readonly string[] }) {
			if (this.checkpoint?.revision !== request.expectedRevision) return false;
			if (request.appendMembers.length > 0) { if (this.member !== null || request.appendMembers.length !== 1) return false; this.member = structuredClone(request.appendMembers[0]!); }
			for (const key of request.appendApprovalKeys) { if (this.keys.at(-1)! >= key) return false; this.keys.push(key); }
			this.checkpoint = structuredClone(request.next); return true;
		}
		async readMemberByOperation(operationId: string) { return this.member?.operationId === operationId ? structuredClone(this.member) : null; }
		async findMember(request: { operationId: string }) { return this.member?.operationId === request.operationId ? structuredClone(this.member) : null; }
		async hasMemberConflict(candidate: typeof member) { return this.member !== null && (this.member.operationId === candidate.operationId || this.member.bidId === candidate.bidId || this.member.bidEventId === candidate.bidEventId); }
	}
	const store = new VerificationStore(); let pageReads = 0;
	const expected: DemoAuthenticatedPaymentCommitmentsV2 = { schema: "DemoAuthenticatedPaymentCommitmentsV2", authNetworkId: NETWORK, chainId: CHAIN, auctionId: AUCTION,
		closureHeight: 2, closureAppHash: batches[1]!.app_hash, immutableStorageMarker: marker, storageRootSha256: storageRoot,
		operationMembershipSha256: membershipDigest, operationCount: 1, approvalCount: 1, canonicalBatchHistorySha256: historyDigest, verifiedApprovalSetSha256: approvalDigest };
	const common = { expected, keyRoles: { committeePublicKey: `02${"d".repeat(64)}` }, storageAuthority: { schema: "DemoPaymentStorageAuthorityV2" as const, mode: "synthetic_fixture" as const, fixtureDigest: "f".repeat(64) }, store,
		history: { async open() { return structuredClone(open); }, async readChunk(request: { index: number }) { return request.index === 0 ? structuredClone(chunk) : null; } },
		approvals: { async openExact() { return structuredClone(snapshot); }, async readPage(request: { pageIndex: number }) { pageReads += 1; return request.pageIndex === 0 ? { schema: "DemoPaymentApprovalSnapshotPageV2" as const, snapshotMarker: snapshot.snapshotMarker, snapshotRootSha256: snapshot.snapshotRootSha256, pageIndex: 0, previousPageDigest: zero, records: [approval], cumulativeRecordCount: 1, eof: true, pageDigest } : null; } } };
	expect(await advanceDemoPaymentVerificationV2(common)).toMatchObject({ status: "verification_pending", phase: "approvals" });
	expect(pageReads).toBe(0);
	expect(await advanceDemoPaymentVerificationV2(common)).toMatchObject({ status: "ready", productionReady: false });
	expect(pageReads).toBe(1);
});
