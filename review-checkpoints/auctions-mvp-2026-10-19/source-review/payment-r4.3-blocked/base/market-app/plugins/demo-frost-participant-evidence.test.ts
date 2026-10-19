import { describe, expect, test } from "bun:test";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import { reservationId, type DemoUnsignedEvent } from "../ts/demo-auth-bid.ts";
import {
	DEMO_CERTIFIED_CLOSURE_DOMAIN,
	DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA,
	DEMO_CERTIFIED_CLOSURE_SCHEMA,
	computeCertifiedClosureDigest,
	computeCertifiedClosureHistoryRoot,
	type DemoCertifiedClosureBidV1,
	type DemoCertifiedClosureHistoryBatchV1,
	type DemoCertifiedClosurePayloadV1,
	type DemoCertifiedClosurePolicy,
} from "./demo-certified-closure.ts";
import { DemoAuthSignedBidStoreV2Source } from "./demo-auth-signed-bid-source.ts";
import {
	DemoFrostCertifiedClosureParticipantVerifier,
	DemoFrostConsensusHandoffParticipantVerifier,
	DemoFrostSignedBidParticipantVerifier,
} from "./demo-frost-participant-evidence.ts";
import {
	DEMO_PAYMENT_CONSENSUS_HANDOFF_SCHEMA,
	DEMO_PAYMENT_CONSENSUS_RECEIPT_SCHEMA,
	type DemoPaymentConsensusEvidencePort,
	type DemoPaymentConsensusHandoff,
} from "./demo-payment-coordinator.ts";
import type { CommittedAuctionBatchV2 } from "./committed-bid-consumer.ts";

const closureMarker = {
	schema: "COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V1" as const,
	source: "participant-local" as const,
};
const bidMarker = {
	schema: "COCO_DEMO_FROST_PARTICIPANT_LOCAL_SIGNED_BID_EVIDENCE_V1" as const,
	source: "participant-local" as const,
};
const network = "ab".repeat(32);
const actorKey = "02".padStart(64, "0");
const actor = bytesToHex(schnorr.getPublicKey(hexToBytes(actorKey)));
const validators = ["1", "2", "3", "4"].map((digit, index) => ({
	validatorId: `validator-${index + 1}`,
	publicKey: `02${digit.repeat(64)}`,
}));
const policy: DemoCertifiedClosurePolicy = {
	authNetworkId: network,
	chainId: "chain-1",
	auctionId: "auction-1",
	sellerP2pkXpub: "xpub-demo-participant-evidence-binding",
	baseEndHeight: 2,
	baseEndTime: 1_900_000_020,
	minimumSettlementWindowSeconds: 10,
	validatorRosterVersion: "roster-v1",
	validators,
};

function bid(index: number, amount: number, actorId = `${index + 5}`.repeat(64)): DemoCertifiedClosureBidV1 {
	return {
		auction_id: policy.auctionId,
		bid_id: `bid-${index}`,
		operation_id: `operation-${index}`,
		event_id: `${index}`.repeat(64),
		actor_id: actorId,
		amount,
		bidder_cashu_public_key: `02${(index + 10).toString(16).padStart(64, "0")}`,
		locktime: 1_900_000_100,
		proof_state_refs: [`02${(index + 20).toString(16).padStart(64, "0")}`],
		displaced_refund_eligible: index === 1,
		seller_child_public_key: `03${(index + 30).toString(16).padStart(64, "0")}`,
	};
}

async function closureFixture() {
	const loser = bid(1, 8);
	const winner = bid(2, 13);
	const history: DemoCertifiedClosureHistoryBatchV1[] = [
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: network, chain_id: policy.chainId, height: 1, block_time: 1_900_000_010, app_hash: "a".repeat(64), bids: [loser] },
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: network, chain_id: policy.chainId, height: 2, block_time: 1_900_000_020, app_hash: "b".repeat(64), bids: [winner] },
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: network, chain_id: policy.chainId, height: 3, block_time: 1_900_000_030, app_hash: "c".repeat(64), bids: [] },
	];
	const payload: DemoCertifiedClosurePayloadV1 = {
		schema: DEMO_CERTIFIED_CLOSURE_SCHEMA,
		domain: DEMO_CERTIFIED_CLOSURE_DOMAIN,
		auth_network_id: network,
		chain_id: policy.chainId,
		auction_id: policy.auctionId,
		seller_p2pk_xpub: policy.sellerP2pkXpub,
		base_end_height: policy.baseEndHeight,
		base_end_time: policy.baseEndTime,
		effective_end_height: 3,
		effective_end_time: 1_900_000_030,
		close_height: 3,
		close_time: 1_900_000_030,
		history_start_height: 1,
		history_end_height: 3,
		history_root: await computeCertifiedClosureHistoryRoot(history),
		outcome: "winner",
		winner_bid_id: winner.bid_id,
		winner_operation_id: winner.operation_id,
		winner_event_id: winner.event_id,
		winner_actor_id: winner.actor_id,
		winner_amount: winner.amount,
		app_hash: history[2]!.app_hash,
		validator_roster_version: policy.validatorRosterVersion,
		validator_roster: validators.map((entry) => ({ validator_id: entry.validatorId, public_key: entry.publicKey })),
	};
	const certificateDigest = await computeCertifiedClosureDigest(payload);
	const certificate = {
		...payload,
		certificate_digest: certificateDigest,
		signatures: validators.map((entry) => ({
			validator_id: entry.validatorId,
			public_key: entry.publicKey,
			signature: certificateDigest.repeat(2),
		})),
	};
	const signatureVerifier = {
		verifyExact(request: { readonly domain: string; readonly digest: string; readonly signature: string }) {
			return request.domain === DEMO_CERTIFIED_CLOSURE_DOMAIN && request.signature === request.digest.repeat(2);
		},
	};
	return { certificate, history, signatureVerifier, certificateDigest, loser, winner };
}

async function consensusFixture() {
	const loser = bid(1, 8);
	const winner = bid(2, 13);
	const batches: CommittedAuctionBatchV2[] = [
		{ schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: network, chain_id: policy.chainId, height: 1, pbts_seconds: 1_900_000_010, app_hash: "a".repeat(64), bids: [{ actor_id: loser.actor_id, operation_id: loser.operation_id, auction_id: loser.auction_id, bid_id: loser.bid_id, event_id: loser.event_id, amount: loser.amount, displaced_refund_eligible: false }], closures: [] },
		{ schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: network, chain_id: policy.chainId, height: 2, pbts_seconds: 1_900_000_020, app_hash: "b".repeat(64), bids: [{ actor_id: winner.actor_id, operation_id: winner.operation_id, auction_id: winner.auction_id, bid_id: winner.bid_id, event_id: winner.event_id, amount: winner.amount, displaced_refund_eligible: false }], closures: [] },
		{ schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: network, chain_id: policy.chainId, height: 3, pbts_seconds: 1_900_000_030, app_hash: "c".repeat(64), bids: [], closures: [{ auth_network_id: network, chain_id: policy.chainId, auction_id: policy.auctionId, height: 3, pbts_seconds: 1_900_000_030, effective_end: 1_900_000_030, app_hash: "c".repeat(64), close_outcome: "winner", winner_bid_id: winner.bid_id, winner_actor_id: winner.actor_id, winner_operation_id: winner.operation_id, amount: winner.amount }] },
	];
	const handoff: DemoPaymentConsensusHandoff = { schema: DEMO_PAYMENT_CONSENSUS_HANDOFF_SCHEMA, authNetworkId: network, chainId: policy.chainId, closureHeight: 3, canonicalBatchBytes: batches.map((batch) => JSON.stringify(batch)) };
	const evidenceDigest = "de".repeat(32);
	const consensus: DemoPaymentConsensusEvidencePort = { async verifyExact(request) { return { schema: DEMO_PAYMENT_CONSENSUS_RECEIPT_SCHEMA, authNetworkId: network, chainId: policy.chainId, authenticatedStartHeight: 1, authenticatedThroughHeight: 4, canonicalSuccessorCommitHeight: 4, successorObservedHeight: 5, canonicalBatchSetDigest: request.canonicalBatchSetDigest, evidenceDigest }; } };
	return { handoff, consensus, loser, winner, evidenceDigest };
}

describe("participant-local authenticated evidence adapters", () => {
	test("derives threshold-three participant policy only after the accepted H+1/H+2 consensus handoff", async () => {
		const fixture = await consensusFixture();
		const snapshot = {
			handoff: fixture.handoff,
			consensus: fixture.consensus,
			config: { authNetworkId: network, chainId: policy.chainId, auctionId: policy.auctionId },
			acceptedBids: [fixture.loser, fixture.winner],
		};
		await expect(new DemoFrostConsensusHandoffParticipantVerifier(snapshot, { role: "winner_settlement", operationId: fixture.winner.operation_id }).verifyAndDerive(closureMarker)).resolves.toMatchObject({
			evidenceDigest: fixture.evidenceDigest, role: "winner_settlement", operationId: fixture.winner.operation_id,
			recipientPublicKey: fixture.winner.seller_child_public_key, outcomeHeight: 3,
		});
		await expect(new DemoFrostConsensusHandoffParticipantVerifier(snapshot, { role: "refund", operationId: fixture.loser.operation_id }).verifyAndDerive(closureMarker)).resolves.toMatchObject({
			evidenceDigest: fixture.evidenceDigest, role: "refund", operationId: fixture.loser.operation_id,
			recipientPublicKey: fixture.loser.bidder_cashu_public_key,
		});
	});

	test("derives winner settlement and loser refund only from a verified four-signature closure", async () => {
		const fixture = await closureFixture();
		const snapshot = { certificate: fixture.certificate, history: fixture.history, policy, signatureVerifier: fixture.signatureVerifier };
		const winner = new DemoFrostCertifiedClosureParticipantVerifier(snapshot, {
			role: "winner_settlement",
			operationId: fixture.winner.operation_id,
		});
		await expect(winner.verifyAndDerive(closureMarker)).resolves.toMatchObject({
			evidenceDigest: fixture.certificateDigest,
			operationId: fixture.winner.operation_id,
			role: "winner_settlement",
			recipientPublicKey: fixture.winner.seller_child_public_key,
		});
		const loser = new DemoFrostCertifiedClosureParticipantVerifier(snapshot, {
			role: "refund",
			operationId: fixture.loser.operation_id,
		});
		await expect(loser.verifyAndDerive(closureMarker)).resolves.toMatchObject({
			operationId: fixture.loser.operation_id,
			role: "refund",
			recipientPublicKey: fixture.loser.bidder_cashu_public_key,
		});
		await expect(loser.verifyAndDerive({ ...closureMarker, source: "coordinator" })).rejects.toThrow("locator");
	});

	test("snapshots its disposition target before an asynchronous verifier can mutate the caller object", async () => {
		const fixture = await closureFixture();
		const target: { role: "winner_settlement" | "refund"; operationId: string } = {
			role: "refund",
			operationId: fixture.loser.operation_id,
		};
		const delayedVerifier = {
			async verifyExact(request: { readonly domain: string; readonly digest: string; readonly signature: string }) {
				target.role = "winner_settlement";
				target.operationId = fixture.winner.operation_id;
				await Promise.resolve();
				return request.domain === DEMO_CERTIFIED_CLOSURE_DOMAIN && request.signature === request.digest.repeat(2);
			},
		};
		const verifier = new DemoFrostCertifiedClosureParticipantVerifier({
			certificate: fixture.certificate,
			history: fixture.history,
			policy,
			signatureVerifier: delayedVerifier,
		}, target);
		await expect(verifier.verifyAndDerive(closureMarker)).resolves.toMatchObject({
			operationId: fixture.loser.operation_id,
			role: "refund",
			recipientPublicKey: fixture.loser.bidder_cashu_public_key,
		});
	});

	test("derives deposit amounts and references from the actual signed bid reservations", async () => {
		const mintUrl = "https://testnut.cashu.space";
		const proofStateRef = `02${"44".repeat(32)}`;
		const reservation = await reservationId(mintUrl, proofStateRef);
		const operationId = "da1o:participant-evidence";
		const bidId = "da1b:participant-evidence";
		const amount = 8;
		const content = JSON.stringify({
			version: 1,
			type: "bid",
			operation_id: operationId,
			auction_id: policy.auctionId,
			bid_id: bidId,
			amount,
			reservations: [{ reservation_id: reservation, amount }],
		});
		const unsigned: DemoUnsignedEvent = {
			pubkey: actor,
			created_at: 1_900_000_000,
			kind: 28642,
			tags: [["protocol", "plebeian-auction-auth-demo"], ["version", "1"], ["environment", network], ["valid_until", "1900000300"]],
			content,
		};
		const eventId = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content]))));
		const signedEvent = { ...unsigned, id: eventId, sig: bytesToHex(schnorr.sign(hexToBytes(eventId), hexToBytes(actorKey))) };
		const context = { authNetworkId: network, chainId: policy.chainId, auctionId: policy.auctionId, sessionSubmissionCap: 20, maxFreshBidsPerHeight: 5 };
		const storageKey = `demo-auth-signed:v2:${encodeURIComponent(network)}:${encodeURIComponent(context.chainId)}:${encodeURIComponent(context.auctionId)}`;
		const envelope = {
			schema: "DemoAuthSignedBidStoreV2",
			...context,
			records: [{
				schema: "DemoAuthSignedBidRecordV2", profileId: "bidder", storageNamespace: "bidder-scope", actorPubkey: actor,
				amount, observedHeight: 2, intentNonce: "ef".repeat(32), canonicalIntent: "canonical-intent",
				intentDigest: "12".repeat(32), operationId, bidId, reservationId: reservation, canonicalContent: content,
				unsignedEvent: unsigned, signedEvent, submissionAttempted: true, state: "committed", revision: 2,
				committedHeight: 2, committedAppHash: "34".repeat(32),
			}],
		};
		const source = new DemoAuthSignedBidStoreV2Source({
			getItem(key) { return key === storageKey ? JSON.stringify(envelope) : null; },
		}, context);
		const acceptedBid: DemoCertifiedClosureBidV1 = {
			...bid(3, amount, actor),
			auction_id: policy.auctionId,
			operation_id: operationId,
			bid_id: bidId,
			event_id: eventId,
			proof_state_refs: [proofStateRef],
		};
		const deposits = [{ proofStateRef, amount, keysetId: "00".repeat(33) }];
		const verifier = new DemoFrostSignedBidParticipantVerifier(source, {
			network,
			chainId: policy.chainId,
			mintUrl,
			acceptedBid,
			deposits,
		});
		await expect(verifier.verifyAndDerive(bidMarker)).resolves.toMatchObject({
			evidenceDigest: eventId,
			bidEventId: eventId,
			deposits,
		});
		const wrong = new DemoFrostSignedBidParticipantVerifier(source, {
			network, chainId: policy.chainId, mintUrl, acceptedBid,
			deposits: [{ ...deposits[0]!, amount: 7 }],
		});
		await expect(wrong.verifyAndDerive(bidMarker)).rejects.toThrow("deposits");
	});
});
