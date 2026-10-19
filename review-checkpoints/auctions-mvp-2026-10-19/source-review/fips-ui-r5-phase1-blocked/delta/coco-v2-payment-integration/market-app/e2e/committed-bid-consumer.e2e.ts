#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { CocoRailPort } from "../../cashu-wrapper/ts/coco-rail.ts";
import {
	createBrowserLockAuthorityStore,
	type LockAuthorityRecord,
	type LockAuthorityStore,
} from "../../cashu-wrapper/ts/lock-authority-store.ts";
import { createBrowserWalletOperationStore } from "../../cashu-wrapper/ts/operation-store.ts";
import { createMemorySeedStore } from "../../cashu-wrapper/ts/seed-store.ts";
import type { CocoOperationPort, CocoWalletRuntime, WalletAccount } from "../../cashu-wrapper/ts/types.ts";
import type { WalletCommandRunner } from "../ts/wallet-command.ts";
import { bindWallet, contribution as walletContribution, walletHost } from "../plugins/wallet-plugin.ts";
import {
	COMMITTED_BID_REFUND_OPERATION_KIND,
	DEMO_COMMITTED_AUCTION_HISTORY_CHUNK_SCHEMA,
	DEMO_COMMITTED_AUCTION_HISTORY_MAX_ARRAY_UTF8_BYTES,
	DEMO_COMMITTED_AUCTION_HISTORY_MAX_BATCHES,
	DEMO_COMMITTED_AUCTION_HISTORY_MAX_BATCH_UTF8_BYTES,
	DEMO_COMMITTED_AUCTION_HISTORY_OPEN_SCHEMA,
	DEMO_COMMITTED_AUCTION_HISTORY_PACKING_POLICY,
	computeDemoCommittedAuctionHistoryChunkDigestV2,
	computeDemoCommittedAuctionHistoryRootSha256V2,
	computeCommittedAuctionBatchHistorySha256,
	consumeCommittedBidBatch,
	createBrowserCommittedBidPersistence,
	createCommittedBidConsumerPorts,
	createCommittedBidRefundIntentReader,
	decodeCommittedBidBatch,
	verifyDemoCommittedAuctionHistoryV2,
	type CommittedAuctionBatchV2,
	type CommittedBidLockManager,
	type DemoCommittedAuctionHistoryChunkV2,
	type DemoCommittedAuctionHistoryOpenV2,
	type DemoCommittedAuctionHistoryPortV2,
	type CommittedBidStorageArea,
	type WalletBidJoinV1,
} from "../plugins/committed-bid-consumer.ts";

let passed = 0;
function ok(label: string, condition: boolean, detail = ""): void {
	if (!condition) throw new Error(`${label}${detail ? ` — ${detail}` : ""}`);
	passed += 1;
	console.log(`PASS  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function refuses(label: string, action: () => Promise<unknown>, expected: string): Promise<void> {
	try {
		await action();
		throw new Error("accepted");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ok(label, message.includes(expected), message);
	}
}

/** One origin-wide deterministic lock manager shared by every persistence object over one retained area. */
class DeterministicExclusiveLockManager implements CommittedBidLockManager {
	private readonly tails = new Map<string, Promise<void>>();

	async request<T>(name: string, options: { readonly mode: "exclusive" }, callback: () => Promise<T>): Promise<T> {
		if (options.mode !== "exclusive") throw new Error("test lock manager accepts exclusive locks only");
		const predecessor = this.tails.get(name) ?? Promise.resolve();
		let release!: () => void;
		const held = new Promise<void>((resolveHeld) => { release = resolveHeld; });
		const queued = predecessor.then(() => held);
		this.tails.set(name, queued);
		await predecessor;
		try {
			return await callback();
		} finally {
			release();
			if (this.tails.get(name) === queued) this.tails.delete(name);
		}
	}
}

class RetainedStorageArea implements CommittedBidStorageArea {
	readonly held = new Map<string, string>();
	readonly lockManager = new DeterministicExclusiveLockManager();
	successfulAuthorityRemovals = 0;
	private fail: ((key: string, value: string) => boolean) | null = null;

	getItem(key: string): string | null { return this.held.get(key) ?? null; }
	setItem(key: string, value: string): void {
		if (this.fail?.(key, value)) {
			this.fail = null;
			throw new Error("injected durable storage failure");
		}
		if (key === "plebeian.wallet.lock-authorities.v1" && value === "[]") this.successfulAuthorityRemovals += 1;
		this.held.set(key, value);
	}
	failNext(predicate: (key: string, value: string) => boolean): void { this.fail = predicate; }
	clone(): RetainedStorageArea {
		const clone = new RetainedStorageArea();
		for (const [key, value] of this.held) clone.held.set(key, value);
		return clone;
	}
	keyContaining(part: string): string {
		const key = [...this.held.keys()].find((candidate) => candidate.includes(part));
		if (!key) throw new Error(`missing retained key containing ${part}`);
		return key;
	}
}

function persistenceOver(area: RetainedStorageArea): ReturnType<typeof createBrowserCommittedBidPersistence> {
	return createBrowserCommittedBidPersistence({ localStorage: area, lockManager: area.lockManager });
}

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(resolve(HERE, "fixtures/committed-bid-batch-v1.json"), "utf8").trim();
const parsed = decodeCommittedBidBatch(fixture);
const displaced = parsed.bids[0]!;
const ACCOUNT: WalletAccount = { accountId: "demo-account", environmentId: "demo-environment" };
const MINT = "http://127.0.0.1:3338";
const CLOCK_MS = 1_800_000_000_000;
const VALID_CHILD_PUBKEY = "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";
const VALID_REFUND_PUBKEY = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const originalOperationId = displaced.displaced_operation_id!;
const refundCommandId = `${COMMITTED_BID_REFUND_OPERATION_KIND}:${originalOperationId}`;
const deliveryKey = `${parsed.auth_network_id}/${parsed.height}/${parsed.app_hash}`;

const join: WalletBidJoinV1 = {
	authNetworkId: parsed.auth_network_id,
	actorId: displaced.displaced_actor_id!,
	operationId: originalOperationId,
	auctionId: displaced.auction_id,
	bidId: displaced.displaced_bid_id!,
	eventId: displaced.displaced_event_id!,
	originalSendOperationId: originalOperationId,
	mintUrl: MINT,
	unit: "sat",
	testAmount: 100,
	publicCommitments: ["public-condition-commitment"],
	conditionFingerprint: "d".repeat(64),
	locktime: 1_700_000_000,
	authorityGeneration: 1,
};

const authority: LockAuthorityRecord = {
	commandId: originalOperationId,
	applicationId: "plebeian-market",
	auctionRef: join.auctionId,
	bidRef: join.bidId,
	mintUrl: join.mintUrl,
	unit: join.unit,
	amount: join.testAmount,
	childPubkey: VALID_CHILD_PUBKEY,
	locktime: join.locktime,
	refundPubkey: VALID_REFUND_PUBKEY,
	path: "m/1/2/3/4/5",
	derivation: { purpose: "p2pk", index: 0 },
	createdAt: 1_700_000_000_000,
	revision: 0,
};

interface EngineModel {
	state: "pending" | "rolling_back" | "rolled_back";
	readonly id: string;
	getCalls: number;
}
interface RailModel {
	readonly engine: EngineModel;
	readonly responseLossAfterTerminal: boolean;
	responseWasLost: boolean;
	reclaimCalls: number;
	readonly reclaimTargets: string[];
	readonly forbiddenCalls: string[];
	readonly events: string[];
}

function enginePort(model: EngineModel, events: string[]): CocoOperationPort {
	return {
		async get(operationId) {
			model.getCalls += 1;
			events.push(`engine-read:${model.state}`);
			return operationId === model.id ? { id: model.id, state: model.state as never } : null;
		},
		async listPrepared() { return []; },
		async listInFlight() { return []; },
		async refresh() { return { id: model.id, state: model.state as never }; },
		async reclaim() { throw new Error("host runtime must not reclaim outside the accepted rail"); },
	};
}

function railPort(model: RailModel): CocoRailPort {
	const forbidden = (name: string): void => { model.forbiddenCalls.push(name); };
	return {
		async trustMint(input) { forbidden("trustMint"); return { mintUrl: input.mintUrl, trusted: false }; },
		async fund(input) { forbidden("fund"); return { operationId: input.operationId ?? "unused", state: "pending" }; },
		async send(input) { forbidden("send"); return { operationId: input.operationId, state: "pending" }; },
		async sendP2pk(input) { forbidden("sendP2pk"); return { operationId: input.operationId, state: "pending" }; },
		async sendLockedP2pk(input) { forbidden("sendLockedP2pk"); return { operationId: input.operationId, state: "pending" }; },
		async melt(input) { forbidden("melt"); return { operationId: input.operationId, state: "pending" }; },
		async receive(input) { forbidden("receive"); return { operationId: input.operationId ?? "unused", state: "finalized" }; },
		async reclaim(input) {
			model.reclaimCalls += 1;
			model.reclaimTargets.push(`${input.operationId}:${input.family ?? "send"}:${input.spendingPath ?? "default"}`);
			model.events.push("rail-reclaim");
			model.engine.state = "rolled_back";
			if (model.responseLossAfterTerminal && !model.responseWasLost) {
				model.responseWasLost = true;
				throw new Error("injected response loss after durable rolled_back");
			}
			return { operationId: input.operationId, state: "rolled_back" };
		},
		async generateLockKeypair() { forbidden("generateLockKeypair"); return { pubkey: "", secretKey: "", derivationIndex: null, purpose: null }; },
		async lockedToken() { forbidden("lockedToken"); return null; },
		async redeemP2pk(input) { forbidden("redeemP2pk"); return { operationId: input.operationId ?? "unused", state: "finalized" }; },
	};
}

function runtime(model: RailModel): CocoWalletRuntime {
	return {
		account: ACCOUNT,
		engine: enginePort(model.engine, model.events),
		reconcilers: { proofStateWatcher: true, meltQuoteWatcher: true, meltSettlementProcessor: true },
		async balance() { return { available: 0, reserved: 0, locked: 0, pending: 0, unresolved: 0, total: 0 }; },
		async dispose() {},
	};
}

function newRail(responseLossAfterTerminal = false): RailModel {
	return {
		engine: { state: "pending", id: originalOperationId, getCalls: 0 },
		responseLossAfterTerminal,
		responseWasLost: false,
		reclaimCalls: 0,
		reclaimTargets: [],
		forbiddenCalls: [],
		events: [],
	};
}

const runner = walletContribution.provides[1]!.implementation as WalletCommandRunner;
async function compose(area: RetainedStorageArea, rail: RailModel): Promise<{
	readonly persistence: ReturnType<typeof createBrowserCommittedBidPersistence>;
	readonly authorities: LockAuthorityStore;
	readonly host: Awaited<ReturnType<typeof walletHost>>;
}> {
	const persistence = persistenceOver(area);
	const authorities = createBrowserLockAuthorityStore({ indexedDB: null, localStorage: area });
	const operationStore = createBrowserWalletOperationStore({ indexedDB: null, localStorage: area });
	bindWallet(
		{
			account: ACCOUNT,
			mintUrl: MINT,
			unit: "sat",
			async readCheckoutIntent() { return null; },
			async readBidIntent() { return null; },
			readRefundIntent: createCommittedBidRefundIntentReader(persistence.joins),
		},
		{
			seedStore: createMemorySeedStore(),
			operationStore,
			authorities,
			async openDomain(asked) {
				if (asked.accountId !== ACCOUNT.accountId || asked.environmentId !== ACCOUNT.environmentId) throw new Error("wrong account");
				return { runtime: runtime(rail), rail: railPort(rail), async dispose() {} };
			},
			now: () => CLOCK_MS,
		},
	);
	return { persistence, authorities, host: await walletHost() };
}

async function sha256Hex(value: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
	return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function emptyCommittedBatch(height: number, throughHeight: number, outcome: "no_bids" | "winner" = "no_bids"): CommittedAuctionBatchV2 {
	const appHash = String(height % 10).repeat(64);
	return {
		schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: "a".repeat(64),
		chain_id: "chain-test", height, pbts_seconds: 1_900_000_000 + height, app_hash: appHash,
		bids: [],
		closures: height === throughHeight ? [{
			auth_network_id: "a".repeat(64), chain_id: "chain-test", auction_id: "auction-target",
			height, pbts_seconds: 1_900_000_000 + height, effective_end: 1_900_000_000 + height,
			app_hash: appHash, close_outcome: outcome, winner_bid_id: "", winner_actor_id: "",
			winner_operation_id: "", amount: 0,
		}] : [],
	};
}

async function immutableHistoryPort(
	batches: readonly CommittedAuctionBatchV2[],
	marker: string,
	packedBatches = DEMO_COMMITTED_AUCTION_HISTORY_MAX_BATCHES,
): Promise<{ readonly port: DemoCommittedAuctionHistoryPortV2; readonly open: DemoCommittedAuctionHistoryOpenV2 }> {
	const canonicalBatchHistorySha256 = await computeCommittedAuctionBatchHistorySha256(batches);
	const chunks: DemoCommittedAuctionHistoryChunkV2[] = [];
	let previousChunkDigest = "0".repeat(64);
	for (let start = 0; start < batches.length; start += packedBatches) {
		const selected = batches.slice(start, start + packedBatches);
		const chunk: DemoCommittedAuctionHistoryChunkV2 = {
			schema: DEMO_COMMITTED_AUCTION_HISTORY_CHUNK_SCHEMA,
			immutableStorageMarker: marker,
			storageRootSha256: "0".repeat(64),
			index: chunks.length,
			firstHeight: selected[0]!.height,
			lastHeight: selected[selected.length - 1]!.height,
			previousChunkDigest,
			batches: selected,
			chunkDigest: "0".repeat(64),
		};
		const sealed = { ...chunk, chunkDigest: computeDemoCommittedAuctionHistoryChunkDigestV2(chunk) };
		chunks.push(sealed);
		previousChunkDigest = sealed.chunkDigest;
	}
	const provisional: DemoCommittedAuctionHistoryOpenV2 = {
		schema: DEMO_COMMITTED_AUCTION_HISTORY_OPEN_SCHEMA,
		authNetworkId: "a".repeat(64), chainId: "chain-test", firstHeight: 1,
		throughHeight: batches.length, throughAppHash: batches[batches.length - 1]!.app_hash,
		immutableStorageMarker: marker, storageRootSha256: "0".repeat(64), chunkCount: chunks.length,
		batchCount: batches.length, packingPolicy: DEMO_COMMITTED_AUCTION_HISTORY_PACKING_POLICY,
		maxBatchesPerChunk: DEMO_COMMITTED_AUCTION_HISTORY_MAX_BATCHES,
		maxCanonicalBatchUtf8Bytes: DEMO_COMMITTED_AUCTION_HISTORY_MAX_BATCH_UTF8_BYTES,
		maxCanonicalBatchArrayUtf8BytesPerChunk: DEMO_COMMITTED_AUCTION_HISTORY_MAX_ARRAY_UTF8_BYTES,
		finalChunkDigest: previousChunkDigest, canonicalBatchHistorySha256,
	};
	const storageRootSha256 = computeDemoCommittedAuctionHistoryRootSha256V2(provisional);
	const open = { ...provisional, storageRootSha256 };
	const sealedChunks = chunks.map((chunk) => ({ ...chunk, storageRootSha256 }));
	const port: DemoCommittedAuctionHistoryPortV2 = {
		async open() { return open; },
		async readChunk(request) {
			if (request.immutableStorageMarker !== marker || request.storageRootSha256 !== storageRootSha256) return null;
			return sealedChunks[request.index] ?? null;
		},
	};
	return { port, open };
}

function frozenMembershipHistory(): CommittedAuctionBatchV2[] {
	const batches = Array.from({ length: 8 }, (_, index) => emptyCommittedBatch(index + 1, 8));
	batches[6] = {
		...batches[6]!,
		bids: [
			{ actor_id: "1".repeat(64), operation_id: "op-other", auction_id: "auction-other", bid_id: "bid-other", event_id: "2".repeat(64), amount: 999, displaced_refund_eligible: false },
			{ actor_id: "4".repeat(64), operation_id: "op-target", auction_id: "auction-target", bid_id: "bid-target", event_id: "3".repeat(64), amount: 2100, displaced_refund_eligible: false },
		],
	};
	batches[7] = {
		...batches[7]!,
		closures: [{ ...batches[7]!.closures[0]!, close_outcome: "winner", winner_bid_id: "bid-target", winner_actor_id: "4".repeat(64), winner_operation_id: "op-target", amount: 2100 }],
	};
	return batches;
}

{
	const frozenDigest = "52089e597ea98ecf4909cd27921bd5f784c95b99e1c05d5586946269d19215a0";
	const built = await immutableHistoryPort(frozenMembershipHistory(), "immutable-history-vector-1");
	const expected = {
		authNetworkId: built.open.authNetworkId, chainId: built.open.chainId, auctionId: "auction-target",
		closureHeight: built.open.throughHeight, closureAppHash: built.open.throughAppHash,
		immutableStorageMarker: built.open.immutableStorageMarker, storageRootSha256: built.open.storageRootSha256,
		operationMembershipSha256: frozenDigest, operationCount: 1,
		canonicalBatchHistorySha256: built.open.canonicalBatchHistorySha256,
	};
	const verified = await verifyDemoCommittedAuctionHistoryV2(built.port, expected);
	ok("R4.2 original-array membership index-1 vector verifies", verified.operationMembershipSha256 === frozenDigest && verified.operationCount === 1);

	const moved = frozenMembershipHistory();
	moved[6] = { ...moved[6]!, bids: [moved[6]!.bids[1]!] };
	const drifted = await immutableHistoryPort(moved, "immutable-history-vector-drift");
	await refuses(
		"filter-first provenance drift refuses the frozen membership commitment",
		() => verifyDemoCommittedAuctionHistoryV2(drifted.port, {
			...expected,
			immutableStorageMarker: drifted.open.immutableStorageMarker,
			storageRootSha256: drifted.open.storageRootSha256,
			canonicalBatchHistorySha256: drifted.open.canonicalBatchHistorySha256,
		}),
		"committed-history-membership-mismatch",
	);
}

{
	const batches = Array.from({ length: 65 }, (_, index) => emptyCommittedBatch(index + 1, 65));
	const built = await immutableHistoryPort(batches, "immutable-history-65-heights");
	const emptyMembership = await sha256Hex("COCO_DEMO_PAYMENT_OPERATION_MEMBERSHIP_V2\0[]");
	const expected = {
		authNetworkId: built.open.authNetworkId, chainId: built.open.chainId, auctionId: "auction-target",
		closureHeight: 65, closureAppHash: built.open.throughAppHash,
		immutableStorageMarker: built.open.immutableStorageMarker, storageRootSha256: built.open.storageRootSha256,
		operationMembershipSha256: emptyMembership, operationCount: 0,
		canonicalBatchHistorySha256: built.open.canonicalBatchHistorySha256,
	};
	ok("greedy 64/65 history boundary verifies two chunks", built.open.chunkCount === 2 && (await verifyDemoCommittedAuctionHistoryV2(built.port, expected)).operationCount === 0);
	const nonGreedy = await immutableHistoryPort(batches, "immutable-history-non-greedy", 63);
	await refuses(
		"64/65 history refuses a validly hashed but non-greedy 63/2 split",
		() => verifyDemoCommittedAuctionHistoryV2(nonGreedy.port, {
			...expected,
			immutableStorageMarker: nonGreedy.open.immutableStorageMarker,
			storageRootSha256: nonGreedy.open.storageRootSha256,
			canonicalBatchHistorySha256: nonGreedy.open.canonicalBatchHistorySha256,
		}),
		"committed-history-chunk-not-greedy",
	);
	await refuses(
		"missing immutable history authority fails closed",
		() => verifyDemoCommittedAuctionHistoryV2({ ...built.port, async open() { return null; } }, expected),
		"committed-history-open-missing",
	);
	const driftRoot = "f".repeat(64);
	await refuses(
		"self-referential or drifting storage root fails closed",
		() => verifyDemoCommittedAuctionHistoryV2({ ...built.port, async open() { return { ...built.open, storageRootSha256: driftRoot }; } }, { ...expected, storageRootSha256: driftRoot }),
		"committed-history-root-mismatch",
	);
}

function tuple(value: WalletBidJoinV1): string {
	return JSON.stringify([value.authNetworkId, value.actorId, value.operationId, value.auctionId, value.bidId, value.eventId]);
}
async function forceJoinRecords(area: RetainedStorageArea, records: readonly WalletBidJoinV1[]): Promise<void> {
	const key = area.keyContaining("committed-bid-joins");
	const envelope = JSON.parse(area.getItem(key)!);
	const ordered = [...records].sort((left, right) => tuple(left).localeCompare(tuple(right)));
	const body = JSON.stringify({ schema: envelope.schema, records: ordered });
	area.setItem(key, JSON.stringify({ schema: envelope.schema, records: ordered, checksum: await sha256Hex(body) }));
}
async function prepare(area: RetainedStorageArea, rail: RailModel): Promise<Awaited<ReturnType<typeof compose>>> {
	const built = await compose(area, rail);
	await built.persistence.joins.save(join);
	await built.authorities.save(authority);
	return built;
}

ok("public Go golden fixture decodes", parsed.bids.length === 1 && displaced.displaced_refund_eligible);
try {
	createBrowserCommittedBidPersistence();
	throw new Error("memory fallback accepted");
} catch (error) {
	ok("durable consumer refuses when browser storage is unavailable", (error as Error).message === "committed-bid-durable-storage-unavailable");
}
await refuses(
	"durable consumer refuses valid storage without origin-wide synchronization",
	async () => { createBrowserCommittedBidPersistence({ localStorage: new RetainedStorageArea() }); },
	"committed-bid-durable-synchronization-unavailable",
);

{
	const area = new RetainedStorageArea();
	const first = persistenceOver(area);
	await first.joins.save(join);
	await first.joins.save(join);
	const restarted = persistenceOver(area);
	const found = await restarted.joins.find(join);
	ok("six-field join survives reconstruction and exact duplicate save", found.length === 1 && found[0]!.originalSendOperationId === originalOperationId);
	const intent = await createCommittedBidRefundIntentReader(restarted.joins)(refundCommandId);
	ok("R5 intent is rebuilt only from the durable public join", JSON.stringify(intent) === JSON.stringify({ auctionRef: join.auctionId, bidRef: join.bidId, lockCommandId: originalOperationId, mintUrl: MINT, unit: "sat" }));
	const retained = area.getItem(area.keyContaining("committed-bid-joins"))!;
	ok("join envelope contains no bearer fields", !/"(?:proofs?|tokens?|seed|refundSecret|privateKey|nwc|nostrConnect)"\s*:/i.test(retained));
	await refuses("a mismatched original operation is never persisted", () => restarted.joins.save({ ...join, originalSendOperationId: "other-operation" }), "wallet-bid-join-store-corrupt");
	await refuses("an extra bearer-shaped field is never persisted", () => restarted.joins.save({ ...join, proofs: ["redeemable"] } as unknown as WalletBidJoinV1), "wallet-bid-join-store-corrupt");
	await refuses("same tuple with different content fails closed", () => restarted.joins.save({ ...join, testAmount: 101 }), "wallet-bid-join-tuple-conflict");
	await refuses("one original operation cannot acquire another tuple owner", () => restarted.joins.save({ ...join, bidId: "other-bid" }), "wallet-bid-original-operation-conflict");

	const corrupt = area.clone();
	const key = corrupt.keyContaining("committed-bid-joins");
	const envelope = JSON.parse(corrupt.getItem(key)!);
	envelope.checksum = "0".repeat(64);
	corrupt.setItem(key, JSON.stringify(envelope));
	await refuses("checksum-invalid join bytes fail on reconstructed read", () => persistenceOver(corrupt).joins.find(join), "wallet-bid-join-store-corrupt");

	const malformed = area.clone();
	malformed.setItem(malformed.keyContaining("committed-bid-joins"), "{not-json");
	await refuses("malformed join bytes fail on reconstructed read", () => persistenceOver(malformed).joins.find(join), "wallet-bid-join-store-corrupt");
}

{
	const area = new RetainedStorageArea();
	let persistence = persistenceOver(area);
	const hash = await sha256Hex(fixture);
	await persistence.journal.begin(deliveryKey, hash);
	persistence = persistenceOver(area);
	await persistence.journal.begin(deliveryKey, hash);
	ok("pending journal entry and exact begin survive reconstruction", (await persistence.journal.read(deliveryKey))?.state === "pending");
	await persistence.journal.delivered(deliveryKey, hash);
	persistence = persistenceOver(area);
	await persistence.journal.delivered(deliveryKey, hash);
	ok("delivered journal entry and exact acknowledgement survive reconstruction", (await persistence.journal.read(deliveryKey))?.state === "delivered");
	await refuses("delivered journal cannot move backward to begin", () => persistence.journal.begin(deliveryKey, hash), "committed-bid-delivery-state-conflict");
	await refuses("same delivery key rejects a different batch hash", () => persistence.journal.delivered(deliveryKey, "e".repeat(64)), "committed-bid-delivery-conflict");
	await refuses("delivery journal rejects a non-tuple key", () => persistence.journal.begin("not/a/delivery/key", hash), "committed-bid-delivery-invalid");
	const corrupt = area.clone();
	const key = corrupt.keyContaining("committed-bid-delivery");
	const envelope = JSON.parse(corrupt.getItem(key)!);
	envelope.checksum = "0".repeat(64);
	corrupt.setItem(key, JSON.stringify(envelope));
	await refuses("checksum-invalid journal bytes fail on reconstructed read", () => persistenceOver(corrupt).journal.read(deliveryKey), "committed-bid-delivery-store-corrupt");
}

{
	const area = new RetainedStorageArea();
	const first = persistenceOver(area);
	const second = persistenceOver(area);
	const contender: WalletBidJoinV1 = { ...join, bidId: "bid-concurrent-owner", eventId: "c".repeat(64) };
	const settled = await Promise.allSettled([first.joins.save(join), second.joins.save(contender)]);
	const rejectionMessages = settled.flatMap((result) =>
		result.status === "rejected" && result.reason instanceof Error ? [result.reason.message] : [],
	);
	ok(
		"two instances enforce one original-operation owner with one named rejection",
		settled.filter((result) => result.status === "fulfilled").length === 1 &&
			JSON.stringify(rejectionMessages) === JSON.stringify(["wallet-bid-original-operation-conflict"]),
	);
	const winner = settled[0]!.status === "fulfilled" ? join : contender;
	const reconstructed = persistenceOver(area);
	const owner = await reconstructed.joins.readOriginalOperation(originalOperationId);
	const records = JSON.parse(area.getItem(area.keyContaining("committed-bid-joins"))!).records;
	ok(
		"ownership-conflict reconstruction retains exactly the winner",
		JSON.stringify(owner) === JSON.stringify(winner) && records.length === 1 &&
			(await reconstructed.joins.find(winner)).length === 1,
	);
}

{
	const area = new RetainedStorageArea();
	const first = persistenceOver(area);
	const second = persistenceOver(area);
	const firstHash = "a".repeat(64);
	const secondHash = "b".repeat(64);
	const settled = await Promise.allSettled([
		first.journal.begin(deliveryKey, firstHash),
		second.journal.begin(deliveryKey, secondHash),
	]);
	const rejectionMessages = settled.flatMap((result) =>
		result.status === "rejected" && result.reason instanceof Error ? [result.reason.message] : [],
	);
	ok(
		"two instances enforce one delivery hash with one named rejection",
		settled.filter((result) => result.status === "fulfilled").length === 1 &&
			JSON.stringify(rejectionMessages) === JSON.stringify(["committed-bid-delivery-conflict"]),
	);
	const winnerHash = settled[0]!.status === "fulfilled" ? firstHash : secondHash;
	const reconstructed = persistenceOver(area);
	const retained = await reconstructed.journal.read(deliveryKey);
	const records = JSON.parse(area.getItem(area.keyContaining("committed-bid-delivery"))!).records;
	ok(
		"delivery-conflict reconstruction retains exactly the pending winner",
		retained?.batchHash === winnerHash && retained.state === "pending" && records.length === 1,
	);
}

{
	const area = new RetainedStorageArea();
	const first = persistenceOver(area);
	const second = persistenceOver(area);
	const disjoint: WalletBidJoinV1 = {
		...join,
		operationId: "auctions.bid-lock:friday-auction:bid-disjoint",
		bidId: "bid-disjoint",
		eventId: "e".repeat(64),
		originalSendOperationId: "auctions.bid-lock:friday-auction:bid-disjoint",
	};
	const settled = await Promise.allSettled([first.joins.save(join), second.joins.save(disjoint)]);
	ok("two instances preserve both disjoint joins", settled.every((result) => result.status === "fulfilled"));
	const reconstructed = persistenceOver(area);
	const records = JSON.parse(area.getItem(area.keyContaining("committed-bid-joins"))!).records;
	ok(
		"disjoint-join reconstruction reads both exact records",
		records.length === 2 && (await reconstructed.joins.find(join)).length === 1 &&
			(await reconstructed.joins.find(disjoint)).length === 1,
	);
}

{
	const area = new RetainedStorageArea();
	const first = persistenceOver(area);
	const second = persistenceOver(area);
	const otherKey = `${parsed.auth_network_id}/${parsed.height + 1}/${"e".repeat(64)}`;
	const firstHash = "a".repeat(64);
	const secondHash = "b".repeat(64);
	const settled = await Promise.allSettled([
		first.journal.begin(deliveryKey, firstHash),
		second.journal.begin(otherKey, secondHash),
	]);
	ok("two instances preserve both disjoint deliveries", settled.every((result) => result.status === "fulfilled"));
	const reconstructed = persistenceOver(area);
	const records = JSON.parse(area.getItem(area.keyContaining("committed-bid-delivery"))!).records;
	ok(
		"disjoint-delivery reconstruction reads both exact pending entries",
		records.length === 2 && (await reconstructed.journal.read(deliveryKey))?.batchHash === firstHash &&
			(await reconstructed.journal.read(otherKey))?.batchHash === secondHash,
	);
}

{
	const area = new RetainedStorageArea();
	const first = persistenceOver(area);
	const second = persistenceOver(area);
	const joinSettled = await Promise.allSettled([first.joins.save(join), second.joins.save(join)]);
	const reconstructedJoin = persistenceOver(area);
	const joinRecords = JSON.parse(area.getItem(area.keyContaining("committed-bid-joins"))!).records;
	ok(
		"concurrent exact join duplicates both fulfill and retain one record",
		joinSettled.every((result) => result.status === "fulfilled") && joinRecords.length === 1 &&
			(await reconstructedJoin.joins.find(join)).length === 1,
	);
	const hash = "a".repeat(64);
	const deliverySettled = await Promise.allSettled([
		first.journal.begin(deliveryKey, hash),
		second.journal.begin(deliveryKey, hash),
	]);
	const reconstructedDelivery = persistenceOver(area);
	const deliveryRecords = JSON.parse(area.getItem(area.keyContaining("committed-bid-delivery"))!).records;
	ok(
		"concurrent exact delivery duplicates both fulfill and retain one pending record",
		deliverySettled.every((result) => result.status === "fulfilled") && deliveryRecords.length === 1 &&
			(await reconstructedDelivery.journal.read(deliveryKey))?.state === "pending",
	);
}

async function noRailCase(
	label: string,
	mutate: (area: RetainedStorageArea, persistence: ReturnType<typeof createBrowserCommittedBidPersistence>) => Promise<void>,
	expectedState: "unresolved" | "refused",
): Promise<void> {
	const area = new RetainedStorageArea();
	const rail = newRail();
	const built = await compose(area, rail);
	await mutate(area, built.persistence);
	if (expectedState === "unresolved") {
		const result = await consumeCommittedBidBatch(fixture, createCommittedBidConsumerPorts(built.persistence, runner));
		ok(label, result.state === "unresolved" && rail.reclaimCalls === 0);
	} else {
		await refuses(label, () => consumeCommittedBidBatch(fixture, createCommittedBidConsumerPorts(built.persistence, runner)), "wallet-bid-join-store-corrupt");
		ok(`${label} makes no rail call`, rail.reclaimCalls === 0);
	}
}

await noRailCase("missing join remains unresolved", async () => undefined, "unresolved");
await noRailCase("wrong six-field tuple remains unresolved", async (_area, persistence) => {
	await persistence.joins.save({ ...join, eventId: "a".repeat(64) });
}, "unresolved");
await noRailCase("checksummed conflicting join records are refused", async (area, persistence) => {
	await persistence.joins.save(join);
	await forceJoinRecords(area, [join, { ...join, testAmount: 101 }]);
}, "refused");
await noRailCase("checksummed duplicate-operation owners are refused", async (area, persistence) => {
	await persistence.joins.save(join);
	await forceJoinRecords(area, [join, { ...join, bidId: "other-bid", eventId: "b".repeat(64) }]);
}, "refused");
await noRailCase("checksum-invalid join authority is refused", async (area, persistence) => {
	await persistence.joins.save(join);
	const key = area.keyContaining("committed-bid-joins");
	const envelope = JSON.parse(area.getItem(key)!);
	envelope.checksum = "f".repeat(64);
	area.setItem(key, JSON.stringify(envelope));
}, "refused");

{
	const area = new RetainedStorageArea();
	const rail = newRail(true);
	const first = await prepare(area, rail);
	await refuses("post-terminal Coco response loss leaves consumer delivery pending", () => consumeCommittedBidBatch(fixture, createCommittedBidConsumerPorts(first.persistence, runner)), "Wallet command");
	const pending = persistenceOver(area);
	ok("response loss persisted pending delivery before the external boundary", (await pending.journal.read(deliveryKey))?.state === "pending");

	const restarted = await compose(area, rail);
	const recovered = await restarted.host.recover(refundCommandId, { resume: true });
	ok("fresh host and stores recover the exact terminal original operation", recovered.state === "settled" && recovered.engineOperationId === originalOperationId);
	ok(
		"consumer command preserves the exact R5 identity, account, money and fingerprint",
		recovered.commandId === refundCommandId && recovered.applicationId === "plebeian-market" &&
			recovered.operationKind === "auctions.bid-refund" && recovered.account.accountId === ACCOUNT.accountId &&
			recovered.account.environmentId === ACCOUNT.environmentId && recovered.money.mintUrl === join.mintUrl &&
			recovered.money.unit === join.unit && recovered.money.amount === join.testAmount &&
			recovered.intentFingerprint === join.conditionFingerprint,
	);
	ok("host holds one refund command joined to the one original monetary identity", (await restarted.host.list(ACCOUNT)).length === 1);
	const delivered = await consumeCommittedBidBatch(fixture, createCommittedBidConsumerPorts(restarted.persistence, runner));
	ok("response-loss reconstruction converges delivery", delivered.state === "delivered");
	ok("response loss causes one original-send refund rail action", rail.reclaimCalls === 1 && rail.reclaimTargets[0] === `${originalOperationId}:send:refund`);
	ok("response-loss recovery uses no alternate monetary rail", rail.forbiddenCalls.length === 0);
	const duplicate = await consumeCommittedBidBatch(fixture, createCommittedBidConsumerPorts(restarted.persistence, runner));
	ok("repeated delivered recovery is idempotent", duplicate.state === "duplicate" && rail.reclaimCalls === 1 && area.successfulAuthorityRemovals === 1);
}

{
	const area = new RetainedStorageArea();
	const rail = newRail();
	const first = await prepare(area, rail);
	area.failNext((key, value) => key.includes("committed-bid-delivery") && value.includes('"state":"delivered"'));
	await refuses("delivery before journal acknowledgement surfaces durable write failure", () => consumeCommittedBidBatch(fixture, createCommittedBidConsumerPorts(first.persistence, runner)), "committed-bid-delivery-store-write-failed");
	const pending = persistenceOver(area);
	ok("delivery-before-ack retains pending bytes", (await pending.journal.read(deliveryKey))?.state === "pending");
	const restarted = await compose(area, rail);
	const delivered = await consumeCommittedBidBatch(fixture, createCommittedBidConsumerPorts(restarted.persistence, runner));
	ok("delivery-before-ack full reconstruction converges", delivered.state === "delivered" && rail.reclaimCalls === 1 && area.successfulAuthorityRemovals === 1);
	const conflict = JSON.parse(fixture);
	conflict.bids[0].amount += 1;
	await refuses("delivered key rejects different batch bytes", () => consumeCommittedBidBatch(JSON.stringify(conflict), createCommittedBidConsumerPorts(restarted.persistence, runner)), "committed-bid-batch-key-conflict");
}

{
	const area = new RetainedStorageArea();
	const rail = newRail();
	const first = await prepare(area, rail);
	area.failNext((key, value) => {
		if (key === "plebeian.wallet.lock-authorities.v1" && value === "[]") {
			rail.events.push("authority-remove-attempt");
			return true;
		}
		return false;
	});
	await refuses("failure between terminal read and cleanup leaves command recoverable", () => consumeCommittedBidBatch(fixture, createCommittedBidConsumerPorts(first.persistence, runner)), "Wallet command");
	const removalAttempt = rail.events.indexOf("authority-remove-attempt");
	const terminalReadBeforeRemoval = rail.events.slice(0, removalAttempt).lastIndexOf("engine-read:rolled_back");
	ok("terminal original-operation read occurs before cleanup", removalAttempt > 0 && terminalReadBeforeRemoval >= 0);
	ok("failed cleanup keeps authority and avoids a second rail action", (await first.authorities.read(originalOperationId)) !== null && rail.reclaimCalls === 1 && area.successfulAuthorityRemovals === 0);

	const restarted = await compose(area, rail);
	const recovered = await restarted.host.recover(refundCommandId, { resume: true });
	ok("cleanup failure resumes to settled without another rail action", recovered.state === "settled" && rail.reclaimCalls === 1 && area.successfulAuthorityRemovals === 1);
	const repeated = await restarted.host.recover(refundCommandId, { resume: true });
	ok("repeated terminal host recovery removes no authority twice", repeated.state === "settled" && rail.reclaimCalls === 1 && area.successfulAuthorityRemovals === 1);
	const delivered = await consumeCommittedBidBatch(fixture, createCommittedBidConsumerPorts(restarted.persistence, runner));
	ok("recovered cleanup permits one durable delivery acknowledgement", delivered.state === "delivered");
}

for (const mutation of ["{}", fixture.replace('"height":2', '"height":0'), fixture.replace('"displaced_refund_eligible":true', '"displaced_refund_eligible":false')]) {
	try {
		decodeCommittedBidBatch(mutation);
		throw new Error("mutation accepted");
	} catch {
		ok("malformed or inconsistent batch fails closed", true);
	}
}

console.log(`\n${passed} assertions passed`);
