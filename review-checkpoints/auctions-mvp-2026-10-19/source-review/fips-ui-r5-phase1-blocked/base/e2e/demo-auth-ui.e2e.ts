import { expect, test } from "bun:test";
import type { WalletCommandRunner } from "../ts/wallet-command.ts";
import { DEMO_AUTH_PROFILE, TEST_ONLY_LABEL, TEST_UNIT_LABEL, parseDemoAuthUiConfig, type DemoSignedEvent } from "../ts/demo-auth-bid.ts";
import { DemoAuthBidStore } from "../plugins/demo-auth-bid-store.ts";
import { computeCommittedAuctionBatchHistorySha256, type CommittedBidBatchV1, type CommittedBidConsumerPorts, type DeliveryJournalEntry, type WalletBidJoinV1 } from "../plugins/committed-bid-consumer.ts";
import { DemoAuthBidController, createFetchDemoBridge, processAuthenticatedPaymentBatches, refundEligibility, type DemoBridgeStatus, type DemoProfilePorts } from "../visuals/webui/demo-auth.ts";

class Area { values = new Map<string, string>(); getItem(key: string) { return this.values.get(key) ?? null; } setItem(key: string, value: string) { this.values.set(key, value); } }
class Locks { tails = new Map<string, Promise<void>>(); async request<T>(name: string, _o: { mode: "exclusive" }, cb: () => Promise<T>) { const prior = this.tails.get(name) ?? Promise.resolve(); let done!: () => void; const tail = new Promise<void>((r) => done = r); this.tails.set(name, tail); await prior; try { return await cb(); } finally { done(); if (this.tails.get(name) === tail) this.tails.delete(name); } } }
const profiles = Array.from({ length: 5 }, (_, i) => ({ profileId: `p${i + 1}`, accountId: `a${i + 1}`, storageNamespace: `s${i + 1}`, signerPubkey: String(i + 1).repeat(64) }));
const config = parseDemoAuthUiConfig(JSON.stringify({ schema: "DemoAuthUiConfigV1", bridgeBasePath: "/v1/demo-auth", profile: "DEMO_AUTH_V1", authNetworkId: "a".repeat(64), chainId: "chain", auctionId: "auction", mintUrl: "https://testnut.cashu.space", mintSnapshot: { mintPublicKey: `03${"b".repeat(64)}`, serverVersion: "cdk-mintd/0.18.1", activeSatKeysetId: `01${"c".repeat(64)}`, denominationKeyDigest: "d".repeat(64), inputFeePpk: 100, advertisedNuts: [4, 7, 8, 9, 10, 11, 12, 14, 15, 17, 19, 20, 29], requiredNuts: [4, 7, 9, 10, 11, 12] }, sellerP2pkXpub: "x".repeat(64), baseEnd: 1_900_000_000, locktime: 1_900_001_920, startingBid: 2, sessionSubmissionCap: 40, testOnlyLabel: TEST_ONLY_LABEL, walletUnitLabel: TEST_UNIT_LABEL, profiles }));
const sign = async (event: { pubkey: string; created_at: number; kind: number; tags: readonly (readonly [string, string])[]; content: string }): Promise<DemoSignedEvent> => { const bytes = new TextEncoder().encode(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])); const id = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) => v.toString(16).padStart(2, "0")).join(""); return { ...event, id, sig: "f".repeat(128) }; };

class Joins {
  records: WalletBidJoinV1[] = [];
  async save(join: WalletBidJoinV1) { const prior = this.records.find((item) => item.operationId === join.operationId); if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(join)) throw new Error("join-conflict"); if (prior === undefined) this.records.push(join); }
  async find(input: { authNetworkId: string; actorId: string; operationId: string; auctionId: string; bidId: string; eventId: string }) { return this.records.filter((item) => item.authNetworkId === input.authNetworkId && item.actorId === input.actorId && item.operationId === input.operationId && item.auctionId === input.auctionId && item.bidId === input.bidId && item.eventId === input.eventId); }
  async readOriginalOperation(operationId: string) { return this.records.find((item) => item.originalSendOperationId === operationId) ?? null; }
}

function harness(options: { loseResponse?: boolean; reserveError?: string; refundPendingOnce?: boolean } = {}) {
  const calls: string[] = []; const submittedIds: string[] = []; const joins = new Joins(); let loseResponse = options.loseResponse ?? false; const reserved = new Map<string, Record<string, unknown>>(); const locked = new Map<string, number>(); let pbts = 100; let height = 5; let leader = 12; let batches: CommittedBidBatchV1[] = []; const journal = new Map<string, DeliveryJournalEntry>(); const refunded: string[] = [];
  const status = (): DemoBridgeStatus => { const accepted = batches.reduce((sum, batch) => sum + batch.bids.length, 0); return { profile: DEMO_AUTH_PROFILE, network_id: config.authNetworkId, chain_id: config.chainId, auction_id: config.auctionId, base_end: config.baseEnd, latest_committed_height: height, latest_app_hash: "b".repeat(64), latest_committed_pbts_seconds: pbts, fresh_slots_used: Math.max(reserved.size, accepted), session_submission_cap: config.sessionSubmissionCap, accepted_bid_count: accepted, committed_leader_amount: leader }; };
  const bridge = { async status() { return status(); }, async reserve(input: Record<string, unknown>) { calls.push("reserve"); if (options.reserveError !== undefined) throw new Error(options.reserveError); const key = String(input.operation_id); const prior = reserved.get(key); if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(input)) throw new Error("conflict"); if (prior === undefined) reserved.set(key, input); return { schema: "BidSlotReservationV1" as const, slot: [...reserved].findIndex(([operationId]) => operationId === key) + 1, reservation_id: "c".repeat(64), ...input } as never; }, async submit(event: DemoSignedEvent) { calls.push("submit"); submittedIds.push(event.id); if (loseResponse) { loseResponse = false; throw new Error("response-lost"); } }, async batches(after: number) { return batches.filter((batch) => batch.height > after); } };
  const proofAmounts = (amount: number) => [16, 8, 4, 2, 1].filter((part) => (amount & part) !== 0);
  const runner = { applicationId: "plebeian-market", account: { accountId: "a1", environmentId: "demo" }, async balance() { const totalLocked = [...locked.values()].reduce((sum, amount) => sum + amount, 0); return { available: 30 - totalLocked, reserved: 0, locked: totalLocked, pending: 0, unresolved: 0, total: 30 }; }, async run(command) { calls.push("wallet"); locked.set(command.commandId, command.money.amount); return { ...command, schemaVersion: 1, plan: [], completedSteps: [], state: "settled", revision: 1, createdAt: 0, updatedAt: 0, complete: true }; }, async lockedBidMaterial() { return null; }, async demoLockEvidence(operationId: string) { const amount = locked.get(operationId); if (amount === undefined) return null; return { mintUrl: config.mintUrl, unit: "sat", totalAmount: amount, proofs: proofAmounts(amount).map((part, index) => ({ amount: part, reservationId: String(index + 1).repeat(64), keysetId: "ks", inputFeePpk: 0 })), conditionFingerprint: "d".repeat(64), locktime: config.locktime, authorityGeneration: 0 }; } } as WalletCommandRunner;
  const consumer: CommittedBidConsumerPorts = { joins, journal: { async read(key) { return journal.get(key) ?? null; }, async begin(key, hash) { journal.set(key, { key, batchHash: hash, state: "pending" }); }, async delivered(key, hash) { journal.set(key, { key, batchHash: hash, state: "delivered" }); } }, async refundOriginalSend(join) { refunded.push(join.originalSendOperationId); return options.refundPendingOnce && refunded.length === 1 ? "pending" : "rolled_back"; } };
  const store = new DemoAuthBidStore(new Area(), new Locks(), "s1"); let signatures = 0;
  const ports: DemoProfilePorts = { runner, store, bridge, joins, consumer, signer: { async signEvent(event) { signatures += 1; return sign(event); } }, async project(amount) { return { proofs: proofAmounts(amount).map((part, index) => ({ amount: part, keysetId: "ks", amountKey: `k${part}`, inputFeePpk: 0, reservationId: String(index + 1).repeat(64), active: true })), projectedLockFee: 0, projectedRefundFee: 1 }; }, async newLockTarget() { return { path: "local-path-reference", childPubkey: `02${"e".repeat(64)}` }; } };
  return { controller: new DemoAuthBidController(config, "p1", ports), calls, submittedIds, joins, store, refunded, get signatures() { return signatures; }, setPBTS(value: number) { pbts = value; }, setHeight(value: number) { height = value; }, setLeader(value: number) { leader = value; }, setBatches(value: CommittedBidBatchV1[]) { batches = value; } };
}

function committed(record: Awaited<ReturnType<DemoAuthBidStore["readLocal"]>>, height: number, displacement = false): CommittedBidBatchV1 {
  if (record?.signedEvent === undefined) throw new Error("fixture-missing-signed");
  const entry = displacement ? { actor_id: "9".repeat(64), operation_id: `da1o:${"9".repeat(59)}`, auction_id: config.auctionId, bid_id: `da1b:${"8".repeat(59)}`, event_id: "8".repeat(64), amount: record.amount + 1, displaced_actor_id: profiles[0]!.signerPubkey, displaced_operation_id: record.operationId, displaced_bid_id: record.bidId, displaced_event_id: record.signedEvent.id, displaced_refund_eligible: true } : { actor_id: profiles[0]!.signerPubkey, operation_id: record.operationId, auction_id: record.auctionId, bid_id: record.bidId, event_id: record.signedEvent.id, amount: record.amount, displaced_refund_eligible: false };
  return { schema: "CommittedBidBatchV1", auth_profile: "DEMO_AUTH_V1", auth_network_id: config.authNetworkId, height, app_hash: height.toString(16).padStart(64, "0"), bids: [entry] };
}

test("slot precedes lock and ambiguous response recovery resubmits only the exact signed Bid", async () => {
  const value = harness({ loseResponse: true });
  await expect(value.controller.placeBid("13", true)).rejects.toThrow("response-lost");
  expect(value.calls.indexOf("reserve")).toBeLessThan(value.calls.indexOf("wallet")); expect(value.submittedIds).toHaveLength(1); expect(value.signatures).toBe(1); expect(value.joins.records).toHaveLength(1);
  const operationId = (await value.store.listLocal())[0]!.operationId; const attempted = await value.store.readLocal(operationId);
  expect(attempted?.submissionAttempted).toBeTrue(); expect(attempted?.unsignedEvent?.created_at).toBe(100); expect(attempted?.unsignedEvent?.tags[3]).toEqual(["valid_until", "400"]);
  const retry = await value.controller.placeBid("", false, operationId); expect(retry.state).toBe("submitted"); expect(value.submittedIds).toEqual([value.submittedIds[0]!, value.submittedIds[0]!]); expect(value.signatures).toBe(1);
});

test("fresh rebid creates one changed intent and consumes only remaining available balance", async () => {
  const value = harness(); const first = await value.controller.placeBid("13", true);
  value.setHeight(6); value.setLeader(13); const second = await value.controller.placeBid("15", true);
  expect(second.operationId).not.toBe(first.operationId); expect(value.calls.filter((call) => call === "wallet")).toHaveLength(2); expect(value.submittedIds).toHaveLength(2);
  const retry = await value.controller.placeBid("", false, second.operationId); expect(retry.operationId).toBe(second.operationId); expect(value.calls.filter((call) => call === "wallet")).toHaveLength(2); expect(value.submittedIds).toHaveLength(2);
  value.setHeight(7); value.setLeader(15); await expect(value.controller.placeBid("17", true)).rejects.toThrow("bid-balance"); expect(value.calls.filter((call) => call === "wallet")).toHaveLength(2);
  expect(await value.controller.displayBalances()).toEqual({ available: 2, locked: 28, refund_eligible_locked: 0, refunded: 0 });
});

test("capacity refusal is before wallet mutation and final leader stays cleanup_pending", async () => {
  const refused = harness({ reserveError: "demo-auth-bridge-429" }); await expect(refused.controller.placeBid("13", true)).rejects.toThrow("bridge-429"); expect(refused.calls).not.toContain("wallet");
  expect(refundEligibility({ committedEligible: true, pbtsSeconds: config.locktime + 29, locktime: config.locktime, finalLeader: false })).toEqual({ allowed: false, state: "outbid_refundable_at" });
  expect(refundEligibility({ committedEligible: false, pbtsSeconds: config.locktime + 30, locktime: config.locktime, finalLeader: true })).toEqual({ allowed: false, state: "cleanup_pending" });
  const value = harness(); const submitted = await value.controller.placeBid("13", true); value.setBatches([committed(await value.store.readLocal(submitted.operationId), 6)]); value.setHeight(6); value.setPBTS(config.locktime + 30); const records = await value.controller.synchronize(); expect(records[0]?.state).toBe("cleanup_pending"); expect(value.refunded).toHaveLength(0);
});

test("the demo disables the competing legacy refund rail before and after locktime", async () => {
  const value = harness({ refundPendingOnce: true }); const submitted = await value.controller.placeBid("13", true); const record = await value.store.readLocal(submitted.operationId); value.setBatches([committed(record, 6), committed(record, 7, true)]); value.setHeight(7); value.setLeader(14); value.setPBTS(config.locktime + 29);
  const synced = await value.controller.synchronize(); expect(synced[0]?.state).toBe("outbid_refundable_at"); await expect(value.controller.refundOutbid(submitted.operationId)).rejects.toThrow("refund-owned-by-automatic-payment"); expect(value.refunded).toHaveLength(0);
  value.setPBTS(config.locktime + 30); await expect(value.controller.refundOutbid(submitted.operationId)).rejects.toThrow("refund-owned-by-automatic-payment"); expect(value.refunded).toHaveLength(0);
});

function bridgeResponse(body: unknown, url: string, status = 200, options: { redirected?: boolean; type?: ResponseType } = {}): Response {
	const result = new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
	Object.defineProperties(result, { url: { value: url }, redirected: { value: options.redirected ?? false }, type: { value: options.type ?? "basic" } });
	return result;
}

test("fetch bridge binds all four endpoints to the page origin and forces redirect error", async () => {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetchImpl = (async (input, init) => {
		const url = String(input); calls.push({ url, init });
		return bridgeResponse(url.includes("/batches?") ? { batches: [] } : {}, url);
	}) as typeof fetch;
	const bridge = createFetchDemoBridge("/v1/demo-auth", { fetchImpl, pageUrl: "https://market.example/auction?id=1" });
	await bridge.status(); await bridge.reserve({ profile: "DEMO_AUTH_V1", actor_pubkey: "1".repeat(64), auction_id: "auction", operation_id: "op", bid_id: "bid", amount: 13, intent_digest: "a".repeat(64) });
	await bridge.submit({ pubkey: "1".repeat(64), created_at: 1, kind: 28642, tags: [], content: "{}", id: "a".repeat(64), sig: "b".repeat(128) }); await bridge.batches(4, 40);
	expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/v1/demo-auth/status", "/v1/demo-auth/bid-slots", "/v1/demo-auth/bids", "/v1/demo-auth/batches"]);
	expect(calls.every((call) => new URL(call.url).origin === "https://market.example" && call.init?.redirect === "error")).toBeTrue();
});

test("fetch bridge rejects redirect evidence, empty/foreign finals and unsafe bases without following a signed Bid", async () => {
	for (const status of [301, 302, 303, 307, 308]) {
		const calls: string[] = [];
		const bridge = createFetchDemoBridge("/v1/demo-auth", { pageUrl: "https://market.example/demo", fetchImpl: (async (input, init) => { calls.push(String(input)); expect(init?.redirect).toBe("error"); return bridgeResponse({}, String(input), status); }) as typeof fetch });
		await expect(bridge.submit({ pubkey: "1".repeat(64), created_at: 1, kind: 28642, tags: [], content: "signed-bid-body", id: "a".repeat(64), sig: "b".repeat(128) })).rejects.toThrow("demo-auth-bridge-redirect");
		expect(calls).toEqual(["https://market.example/v1/demo-auth/bids"]); expect(calls.some((url) => new URL(url).origin === "https://evil.example")).toBeFalse();
	}
	for (const finalUrl of ["", "https://evil.example/v1/demo-auth/status"]) {
		const bridge = createFetchDemoBridge("/v1/demo-auth", { pageUrl: "https://market.example/demo", fetchImpl: (async () => bridgeResponse({}, finalUrl)) as typeof fetch });
		await expect(bridge.status()).rejects.toThrow(finalUrl === "" ? "final-url" : "origin");
	}
	for (const basePath of ["//evil.example/v1", "/v1/%2e%2e/demo-auth", "/v1/%2Fdemo-auth", "/v1/../demo-auth", "/v1/demo-auth?x=1", "/v1/demo-auth#x", "https://evil.example/v1/demo-auth", "/v1\\demo-auth"]) expect(() => createFetchDemoBridge(basePath, { pageUrl: "https://market.example", fetchImpl: fetch })).toThrow("demo-auth-bridge-base");
	expect(() => createFetchDemoBridge("/v1/demo-auth", { pageUrl: "https://user@market.example", fetchImpl: fetch })).toThrow("demo-auth-bridge-page-origin");
});

test("closure-bearing V2 payment execution requires an exact authenticated handoff", async () => {
	const actor = "5".repeat(64); const eventId = "6".repeat(64); const appHash = "7".repeat(64);
	const batches = [{
		schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: config.authNetworkId,
		chain_id: config.chainId, height: 1, pbts_seconds: 200, app_hash: appHash,
		bids: [{ actor_id: actor, operation_id: "operation", auction_id: config.auctionId, bid_id: "bid", event_id: eventId, amount: 13, displaced_refund_eligible: false }],
		closures: [{ auth_network_id: config.authNetworkId, chain_id: config.chainId, auction_id: config.auctionId, height: 1, pbts_seconds: 200, effective_end: 200, app_hash: appHash, close_outcome: "winner", winner_bid_id: "bid", winner_actor_id: actor, winner_operation_id: "operation", amount: 13 }],
	}] as const;
	let executions = 0;
	const coordinator = { async processVerifiedBatches(_values: unknown, expected: { canonicalBatchHistorySha256: string }) {
		expect(expected.canonicalBatchHistorySha256).toBe(await computeCommittedAuctionBatchHistorySha256(batches));
		executions += 1; return { paid: [], refunded: [], blocked: [] };
	} };
	await expect(processAuthenticatedPaymentBatches({ config, batches, coordinator })).rejects.toThrow("handoff-unavailable");
	expect(executions).toBe(0);
	const verified = {
		rawSignedEventsVerified: 1, bidderPaymentApprovalsVerified: 1, paymentExecutionVerified: false, settlementVerified: false,
		approvalLifetimePolicyVerified: true,
		paymentCommitments: { schema: "DemoAuthenticatedPaymentCommitmentsV1", canonicalBatchHistorySha256: await computeCommittedAuctionBatchHistorySha256(batches), verifiedApprovalSetSha256: "9".repeat(64) },
		agreement: { agreement: true, claimed_slots: [1, 2, 3, 4], collector_provenance_verified: false, authenticated_run_verified: true, nostr_signatures_verified: true, auth_network_id: config.authNetworkId, chain_id: config.chainId, auction_id: config.auctionId, target_height: 1, target_app_hash: appHash },
		closure: { certificate: { auth_network_id: config.authNetworkId, chain_id: config.chainId, auction_id: config.auctionId, seller_p2pk_xpub: config.sellerP2pkXpub, close_height: 1, close_time: 200, app_hash: appHash, outcome: "winner", winner_bid_id: "bid", winner_operation_id: "operation", winner_event_id: eventId, winner_actor_id: actor, winner_amount: 13 } },
	};
	await processAuthenticatedPaymentBatches({ config, batches, coordinator, handoff: { async verifyExact() { return verified as never; } } });
	expect(executions).toBe(1);
	await expect(processAuthenticatedPaymentBatches({ config, batches, coordinator, handoff: { async verifyExact() { return { ...verified, bidderPaymentApprovalsVerified: 0 } as never; } } })).rejects.toThrow("handoff-conflict");
	expect(executions).toBe(1);

	const stale = structuredClone(batches) as unknown as Array<Record<string, unknown> & { bids: Array<Record<string, unknown>> }>;
	stale[0]!.bids[0]!.amount = 12;
	await expect(processAuthenticatedPaymentBatches({ config, batches: stale as never, coordinator, handoff: { async verifyExact() { return verified as never; } } })).rejects.toThrow("handoff-conflict");
	expect(executions).toBe(1);
});

test("reserve-not-met stays distinct and continues as refund-only evidence", async () => {
	const actor = "5".repeat(64); const eventId = "6".repeat(64); const appHash = "7".repeat(64);
	const batches = [{
		schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: config.authNetworkId,
		chain_id: config.chainId, height: 1, pbts_seconds: 100, app_hash: "6".repeat(64),
		bids: [{ actor_id: actor, operation_id: "operation", auction_id: config.auctionId, bid_id: "bid", event_id: eventId, amount: 13, displaced_refund_eligible: false }],
		closures: [],
	}, {
		schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: config.authNetworkId,
		chain_id: config.chainId, height: 2, pbts_seconds: 200, app_hash: appHash, bids: [],
		closures: [{ auth_network_id: config.authNetworkId, chain_id: config.chainId, auction_id: config.auctionId, height: 2, pbts_seconds: 200, effective_end: 200, app_hash: appHash, close_outcome: "reserve_not_met", winner_bid_id: "", winner_actor_id: "", winner_operation_id: "", amount: 0 }],
	}] as const;
	const commitments = { schema: "DemoAuthenticatedPaymentCommitmentsV1" as const, canonicalBatchHistorySha256: await computeCommittedAuctionBatchHistorySha256(batches), verifiedApprovalSetSha256: "9".repeat(64) };
	let refunds: readonly string[] = [];
	const coordinator = { async processVerifiedBatches(_values: unknown, expected: typeof commitments) {
		expect(expected).toEqual(commitments);
		refunds = ["operation"];
		return { paid: [], refunded: refunds, blocked: [] };
	} };
	const verified = {
		rawSignedEventsVerified: 1, bidderPaymentApprovalsVerified: 1, paymentExecutionVerified: false, settlementVerified: false,
		approvalLifetimePolicyVerified: true, paymentCommitments: commitments,
		agreement: { agreement: true, claimed_slots: [1, 2, 3, 4], collector_provenance_verified: false, authenticated_run_verified: true, nostr_signatures_verified: true, auth_network_id: config.authNetworkId, chain_id: config.chainId, auction_id: config.auctionId, target_height: 2, target_app_hash: appHash },
		closure: { certificate: { auth_network_id: config.authNetworkId, chain_id: config.chainId, auction_id: config.auctionId, seller_p2pk_xpub: config.sellerP2pkXpub, close_height: 2, close_time: 200, app_hash: appHash, outcome: "reserve_not_met", winner_bid_id: null, winner_operation_id: null, winner_event_id: null, winner_actor_id: null, winner_amount: null } },
	};
	await processAuthenticatedPaymentBatches({ config, batches, coordinator, handoff: { async verifyExact() { return verified as never; } } });
	expect(refunds).toEqual(["operation"]);
});
