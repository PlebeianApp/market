import { describe, expect, test } from "bun:test";
import { deriveSellerChildPubkey } from "../../cashu-wrapper/ts/seller-child.ts";
import type { DemoCertifiedDispositionAssertion } from "../../cashu-wrapper/ts/demo-sigall-disposition.ts";
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
import { createDemoCertifiedDispositionAssertionPort } from "./demo-certified-disposition.ts";

// Contract fixtures authenticate bytes through an injected verifier. They are
// not evidence of an independent validator deployment, DKG, or consensus.
const network = "a".repeat(64);
const sellerP2pkXpub = "xpub661MyMwAqRbcEtUEgdXRTY6dJQG9fRgs7C5QomqETKMYBJVtSGpRqyHSmhWy8snovPd5oWZgQ14zUquxbxu7Z1umuXbN5VDpUL1QobD5xUY";
const winnerActor = "5".repeat(64);
const loserActor = "6".repeat(64);
const winnerBidder = `02${"a".repeat(64)}`;
const loserBidder = `03${"b".repeat(64)}`;
const winnerRefund = `03${"c".repeat(64)}`;
const loserRefund = `02${"d".repeat(64)}`;
const validators = ["1", "2", "3", "4"].map((digit, index) => ({ validatorId: `validator-${index + 1}`, publicKey: `02${digit.repeat(64)}` }));
const policy: DemoCertifiedClosurePolicy = {
	authNetworkId: network,
	chainId: "demo-chain",
	auctionId: "auction-1",
	sellerP2pkXpub,
	baseEndHeight: 3,
	baseEndTime: 1_900_000_030,
	minimumSettlementWindowSeconds: 300,
	validatorRosterVersion: "demo-roster-v1",
	validators,
};

function bid(operation_id: string, bid_id: string, actor_id: string, amount: number, eventDigit: string, bidder_cashu_public_key: string, displaced_refund_eligible: boolean) {
	const privateBidderPath = `m/1/2/3/4/${Number(eventDigit)}`;
	return {
		auction_id: policy.auctionId,
		bid_id,
		operation_id,
		event_id: eventDigit.repeat(64),
		actor_id,
		amount,
		bidder_cashu_public_key,
		locktime: 1_900_000_400,
		proof_state_refs: [`02${(Number(eventDigit) + 20).toString(16).padStart(64, "0")}`],
		displaced_refund_eligible,
		seller_child_public_key: deriveSellerChildPubkey(sellerP2pkXpub, privateBidderPath),
	};
}

const loser = bid("refund-bid-7", "bid-7", loserActor, 12, "7", loserBidder, true);
const winner = bid("settle-bid-9", "bid-9", winnerActor, 19, "9", winnerBidder, false);

function history(withBids = true): DemoCertifiedClosureHistoryBatchV1[] {
	return [
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: network, chain_id: policy.chainId, height: 1, block_time: 1_900_000_010, app_hash: "b".repeat(64), bids: withBids ? [loser] : [] },
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: network, chain_id: policy.chainId, height: 2, block_time: 1_900_000_020, app_hash: "c".repeat(64), bids: withBids ? [winner] : [] },
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: network, chain_id: policy.chainId, height: 3, block_time: 1_900_000_030, app_hash: "d".repeat(64), bids: [] },
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: network, chain_id: policy.chainId, height: 4, block_time: 1_900_000_040, app_hash: "e".repeat(64), bids: [] },
	];
}

async function certificate(batches: DemoCertifiedClosureHistoryBatchV1[], outcome: "winner" | "no_bids" = "winner"): Promise<DemoCertifiedClosureCertificateV1> {
	const body: DemoCertifiedClosurePayloadV1 = {
		schema: DEMO_CERTIFIED_CLOSURE_SCHEMA,
		domain: DEMO_CERTIFIED_CLOSURE_DOMAIN,
		auth_network_id: network,
		chain_id: policy.chainId,
		auction_id: policy.auctionId,
		seller_p2pk_xpub: policy.sellerP2pkXpub,
		base_end_height: policy.baseEndHeight,
		base_end_time: policy.baseEndTime,
		effective_end_height: 4,
		effective_end_time: 1_900_000_040,
		close_height: 4,
		close_time: 1_900_000_040,
		history_start_height: 1,
		history_end_height: 4,
		history_root: await computeCertifiedClosureHistoryRoot(batches),
		outcome,
		winner_bid_id: outcome === "winner" ? winner.bid_id : null,
		winner_operation_id: outcome === "winner" ? winner.operation_id : null,
		winner_event_id: outcome === "winner" ? winner.event_id : null,
		winner_actor_id: outcome === "winner" ? winner.actor_id : null,
		winner_amount: outcome === "winner" ? winner.amount : null,
		app_hash: batches[3]!.app_hash,
		validator_roster_version: policy.validatorRosterVersion,
		validator_roster: validators.map((item) => ({ validator_id: item.validatorId, public_key: item.publicKey })),
	};
	const certificate_digest = await computeCertifiedClosureDigest(body);
	return { ...body, certificate_digest, signatures: validators.map((item) => ({ validator_id: item.validatorId, public_key: item.publicKey, signature: certificate_digest.repeat(2) })) };
}

const verifier = {
	verifyExact(request: { readonly digest: string; readonly signature: string }) {
		return request.signature === request.digest.repeat(2);
	},
};

function assertion(role: "winner_settlement" | "refund" = "winner_settlement"): DemoCertifiedDispositionAssertion {
	const bidderPublicKey = role === "winner_settlement" ? winnerBidder : loserBidder;
	const refundPublicKey = role === "winner_settlement" ? winnerRefund : loserRefund;
	return {
		schema: "COCO_DEMO_CERTIFIED_DISPOSITION_ASSERTION_V1",
		network,
		chainId: policy.chainId,
		auctionId: policy.auctionId,
		operationId: role === "winner_settlement" ? winner.operation_id : loser.operation_id,
		bidId: role === "winner_settlement" ? winner.bid_id : loser.bid_id,
		bidEventId: role === "winner_settlement" ? winner.event_id : loser.event_id,
		bidderActorId: role === "winner_settlement" ? winner.actor_id : loser.actor_id,
		role,
		outcomeHeight: 4,
		appStateHash: "e".repeat(64),
		amount: role === "winner_settlement" ? winner.amount : loser.amount,
		locktime: role === "winner_settlement" ? winner.locktime : loser.locktime,
		proofStateRefs: [...(role === "winner_settlement" ? winner.proof_state_refs : loser.proof_state_refs)],
		recipientPublicKey: role === "winner_settlement" ? winner.seller_child_public_key : refundPublicKey,
		bidderPublicKey,
		refundPublicKey,
		sellerP2pkXpub,
		packageDigest: "1".repeat(64),
		cashuSigAllDigest: "2".repeat(64),
		recipientCapabilityDigest: "3".repeat(64),
		outputsDigest: "4".repeat(64),
	};
}

async function port(batches = history(), outcome: "winner" | "no_bids" = "winner") {
	return createDemoCertifiedDispositionAssertionPort({ certificate: await certificate(batches, outcome), history: batches, policy, signatureVerifier: verifier });
}

describe("certified disposition assertion adapter", () => {
	test("accepts the exact certified winner settlement", async () => {
		await expect((await port()).assertCertifiedDisposition(assertion())).resolves.toBeUndefined();
	});

	test("accepts an exact accepted losing-bid refund to that bidder", async () => {
		await expect((await port()).assertCertifiedDisposition(assertion("refund"))).resolves.toBeUndefined();
	});

	test("binds winner and loser dispositions to the certified Cashu key, locktime, and exact deposit", async () => {
		await expect((await port()).assertCertifiedDisposition({
			...assertion(),
			proofStateRefs: [...loser.proof_state_refs],
		})).rejects.toThrow("winner-deposit-mismatch");
		await expect((await port()).assertCertifiedDisposition({
			...assertion("refund"),
			proofStateRefs: [...winner.proof_state_refs],
		})).rejects.toThrow("refund-deposit-mismatch");
		await expect((await port()).assertCertifiedDisposition({
			...assertion("refund"),
			locktime: loser.locktime + 1,
		})).rejects.toThrow("refund-locktime-mismatch");
	});

	test("refuses a losing operation without certified displacement eligibility", async () => {
		const batches = history();
		batches[0] = { ...batches[0]!, bids: [{ ...loser, displaced_refund_eligible: false }] };
		await expect((await port(batches)).assertCertifiedDisposition(assertion("refund"))).rejects.toThrow("refund-not-eligible");
	});

	test("refuses the certified winner presented as a refund", async () => {
		const value = { ...assertion("refund"), operationId: winner.operation_id, amount: winner.amount, bidderPublicKey: winnerBidder, refundPublicKey: winnerRefund, recipientPublicKey: winnerRefund };
		await expect((await port()).assertCertifiedDisposition(value)).rejects.toThrow("winner-cannot-refund");
	});

	test("refuses wrong actor and amount for winner or loser", async () => {
		const adapter = await port();
		await expect(adapter.assertCertifiedDisposition({ ...assertion(), bidderActorId: loserActor })).rejects.toThrow("winner-actor-mismatch");
		await expect(adapter.assertCertifiedDisposition({ ...assertion(), amount: winner.amount + 1 })).rejects.toThrow("winner-amount-mismatch");
		await expect(adapter.assertCertifiedDisposition({ ...assertion("refund"), bidderActorId: "7".repeat(64) })).rejects.toThrow("refund-actor-mismatch");
		await expect(adapter.assertCertifiedDisposition({ ...assertion("refund"), amount: loser.amount + 1 })).rejects.toThrow("refund-amount-mismatch");
	});

	test("refuses a payout outside the certified seller xpub or published child", async () => {
		const adapter = await port();
		await expect(adapter.assertCertifiedDisposition({ ...assertion(), sellerP2pkXpub: `${sellerP2pkXpub}1` })).rejects.toThrow("domain-mismatch");
		await expect(adapter.assertCertifiedDisposition({ ...assertion(), recipientPublicKey: loser.seller_child_public_key })).rejects.toThrow("winner-recipient-mismatch");
	});

	test("refuses wrong closure height and app hash before disposition success", async () => {
		const adapter = await port();
		await expect(adapter.assertCertifiedDisposition({ ...assertion(), outcomeHeight: 5 })).rejects.toThrow("height-mismatch");
		await expect(adapter.assertCertifiedDisposition({ ...assertion("refund"), appStateHash: "f".repeat(64) })).rejects.toThrow("app-hash-mismatch");
	});

	test("refuses a disposition in another network, chain, or auction", async () => {
		const adapter = await port();
		await expect(adapter.assertCertifiedDisposition({ ...assertion(), network: "f".repeat(64) })).rejects.toThrow("domain-mismatch");
		await expect(adapter.assertCertifiedDisposition({ ...assertion(), chainId: "other-chain" })).rejects.toThrow("domain-mismatch");
		await expect(adapter.assertCertifiedDisposition({ ...assertion(), auctionId: "other-auction" })).rejects.toThrow("domain-mismatch");
	});

	test("refuses refunds for a certified no-bids closure", async () => {
		const empty = history(false);
		await expect((await port(empty, "no_bids")).assertCertifiedDisposition(assertion("refund"))).rejects.toThrow("no-bids-refund");
	});

	test("refuses a refund recipient different from the certified losing bidder", async () => {
		await expect((await port()).assertCertifiedDisposition({ ...assertion("refund"), recipientPublicKey: winnerBidder })).rejects.toThrow("refund-recipient-mismatch");
	});

	test("snapshots certificate and history against caller mutation", async () => {
		const batches = history();
		const cert = await certificate(batches);
		const adapter = createDemoCertifiedDispositionAssertionPort({ certificate: cert, history: batches, policy, signatureVerifier: verifier });
		batches[0] = { ...batches[0]!, bids: [] };
		(cert as { app_hash: string }).app_hash = "f".repeat(64);
		await expect(adapter.assertCertifiedDisposition(assertion("refund"))).resolves.toBeUndefined();
	});
});
