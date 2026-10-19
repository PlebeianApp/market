/**
 * Adapts authenticated closure evidence to the exact public disposition assertion
 * required by the SIG_ALL execution path. This module performs no fetching,
 * consensus, signing, custody, or recipient-private output handling.
 */
import type {
	DemoCertifiedDispositionAssertion,
	DemoCertifiedDispositionAssertionPort,
} from "../../cashu-wrapper/ts/demo-sigall-disposition.ts";
import {
	verifyDemoCertifiedClosure,
	type DemoCertifiedClosureHistoryBatchV1,
	type DemoCertifiedClosurePolicy,
	type DemoCertifiedClosureSignatureVerifier,
} from "./demo-certified-closure.ts";

const HEX_64 = /^[0-9a-f]{64}$/;
const COMPRESSED_PUBLIC_KEY = /^(02|03)[0-9a-f]{64}$/;
const SAFE_TEXT = /^[\x21-\x7e]{1,160}$/;

export interface DemoCertifiedDispositionEvidence {
	readonly certificate: unknown;
	readonly history: readonly DemoCertifiedClosureHistoryBatchV1[];
	readonly policy: DemoCertifiedClosurePolicy;
	readonly signatureVerifier: DemoCertifiedClosureSignatureVerifier;
}

export class DemoCertifiedDispositionRefusedError extends Error {
	constructor(readonly code: string) {
		super(code);
		this.name = "DemoCertifiedDispositionRefusedError";
	}
}

function refuse(code: string): never {
	throw new DemoCertifiedDispositionRefusedError(code);
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return typeof value === "object"
		&& value !== null
		&& !Array.isArray(value)
		&& Object.keys(value).length === keys.length
		&& Object.keys(value).every((key) => keys.includes(key))
		&& keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function safeText(value: unknown): value is string {
	return typeof value === "string" && SAFE_TEXT.test(value) && value.trim() === value;
}

function canonicalAssertion(value: DemoCertifiedDispositionAssertion): DemoCertifiedDispositionAssertion {
	const keys = [
		"schema", "network", "chainId", "auctionId", "operationId", "bidId", "bidEventId", "bidderActorId", "role", "outcomeHeight",
		"appStateHash", "amount", "locktime", "proofStateRefs", "recipientPublicKey", "bidderPublicKey", "refundPublicKey", "sellerP2pkXpub",
		"packageDigest",
		"cashuSigAllDigest", "recipientCapabilityDigest", "outputsDigest",
	];
	if (!exactObject(value, keys)
		|| value.schema !== "COCO_DEMO_CERTIFIED_DISPOSITION_ASSERTION_V1"
		|| typeof value.network !== "string" || !HEX_64.test(value.network)
		|| !safeText(value.chainId)
		|| !safeText(value.auctionId)
		|| !safeText(value.operationId)
		|| !safeText(value.bidId)
		|| typeof value.bidEventId !== "string" || !HEX_64.test(value.bidEventId)
		|| typeof value.bidderActorId !== "string" || !HEX_64.test(value.bidderActorId)
		|| (value.role !== "winner_settlement" && value.role !== "refund")
		|| !Number.isSafeInteger(value.outcomeHeight) || value.outcomeHeight < 1
		|| typeof value.appStateHash !== "string" || !HEX_64.test(value.appStateHash)
		|| !Number.isSafeInteger(value.amount) || value.amount < 1
		|| !Number.isSafeInteger(value.locktime) || value.locktime < 1
		|| !Array.isArray(value.proofStateRefs) || value.proofStateRefs.length === 0
		|| value.proofStateRefs.some((item) => typeof item !== "string" || !COMPRESSED_PUBLIC_KEY.test(item))
		|| new Set(value.proofStateRefs).size !== value.proofStateRefs.length
		|| JSON.stringify(value.proofStateRefs) !== JSON.stringify([...value.proofStateRefs].sort())
		|| typeof value.recipientPublicKey !== "string" || !COMPRESSED_PUBLIC_KEY.test(value.recipientPublicKey)
		|| typeof value.bidderPublicKey !== "string" || !COMPRESSED_PUBLIC_KEY.test(value.bidderPublicKey)
		|| typeof value.refundPublicKey !== "string" || !COMPRESSED_PUBLIC_KEY.test(value.refundPublicKey)
		|| !safeText(value.sellerP2pkXpub)
		|| typeof value.packageDigest !== "string" || !HEX_64.test(value.packageDigest)
		|| typeof value.cashuSigAllDigest !== "string" || !HEX_64.test(value.cashuSigAllDigest)
		|| typeof value.recipientCapabilityDigest !== "string" || !HEX_64.test(value.recipientCapabilityDigest)
		|| typeof value.outputsDigest !== "string" || !HEX_64.test(value.outputsDigest)) refuse("certified-disposition-assertion-invalid");
	return { ...value };
}

/**
 * Create a verifier for one immutable closure-evidence snapshot.
 *
 * The package/output/capability digests remain covered by the bidder-approved
 * SIG_ALL contract. Closure evidence authenticates only auction disposition
 * facts, so this adapter does not pretend that validators certified those
 * otherwise unrelated digests.
 */
export function createDemoCertifiedDispositionAssertionPort(
	evidence: DemoCertifiedDispositionEvidence,
): DemoCertifiedDispositionAssertionPort {
	let certificate: unknown;
	let history: readonly DemoCertifiedClosureHistoryBatchV1[];
	let policy: DemoCertifiedClosurePolicy;
	const verifyExact = evidence.signatureVerifier.verifyExact.bind(evidence.signatureVerifier);
	const signatureVerifier: DemoCertifiedClosureSignatureVerifier = { verifyExact };
	try {
		certificate = structuredClone(evidence.certificate);
		history = structuredClone(evidence.history);
		policy = structuredClone(evidence.policy);
	} catch {
		refuse("certified-disposition-evidence-not-cloneable");
	}
	return {
		async assertCertifiedDisposition(value) {
			const assertion = canonicalAssertion(value);
			const verified = await verifyDemoCertifiedClosure({
				certificate,
				history,
				policy,
				signatureVerifier,
			});
			const closure = verified.certificate;
			if (assertion.network !== closure.auth_network_id
				|| assertion.chainId !== closure.chain_id
				|| assertion.auctionId !== closure.auction_id
				|| assertion.sellerP2pkXpub !== closure.seller_p2pk_xpub) refuse("certified-disposition-domain-mismatch");
			if (assertion.outcomeHeight !== closure.close_height) refuse("certified-disposition-height-mismatch");
			if (assertion.appStateHash !== closure.app_hash) refuse("certified-disposition-app-hash-mismatch");

			if (assertion.role === "winner_settlement") {
				if (closure.outcome !== "winner" || verified.highestAcceptedBid === null) refuse("certified-disposition-winner-missing");
				const winner = verified.highestAcceptedBid;
				if (assertion.operationId !== winner.operation_id) refuse("certified-disposition-winner-operation-mismatch");
				if (assertion.bidId !== winner.bid_id || assertion.bidEventId !== winner.event_id) refuse("certified-disposition-winner-bid-mismatch");
				if (assertion.amount !== winner.amount) refuse("certified-disposition-winner-amount-mismatch");
				if (assertion.bidderActorId !== winner.actor_id) refuse("certified-disposition-winner-actor-mismatch");
				if (assertion.bidderPublicKey !== winner.bidder_cashu_public_key) refuse("certified-disposition-winner-cashu-key-mismatch");
				if (assertion.locktime !== winner.locktime) refuse("certified-disposition-winner-locktime-mismatch");
				if (JSON.stringify(assertion.proofStateRefs) !== JSON.stringify(winner.proof_state_refs)) refuse("certified-disposition-winner-deposit-mismatch");
				if (assertion.recipientPublicKey !== winner.seller_child_public_key) refuse("certified-disposition-winner-recipient-mismatch");
				return;
			}

			if (closure.outcome === "no_bids") refuse("certified-disposition-no-bids-refund");
			if (assertion.recipientPublicKey !== assertion.refundPublicKey) refuse("certified-disposition-refund-recipient-mismatch");
			if (assertion.operationId === closure.winner_operation_id) refuse("certified-disposition-winner-cannot-refund");
			const accepted = history.flatMap((batch) => batch.bids).find((bid) => bid.operation_id === assertion.operationId);
			if (accepted === undefined) refuse("certified-disposition-refund-bid-missing");
			const winnerDeposit = new Set(verified.highestAcceptedBid?.proof_state_refs ?? []);
			if (accepted.proof_state_refs.some((ref) => winnerDeposit.has(ref))) refuse("certified-disposition-refund-overlaps-winner-deposit");
			if (accepted.bid_id !== assertion.bidId || accepted.event_id !== assertion.bidEventId) refuse("certified-disposition-refund-bid-mismatch");
			if (accepted.amount !== assertion.amount) refuse("certified-disposition-refund-amount-mismatch");
			if (accepted.actor_id !== assertion.bidderActorId) refuse("certified-disposition-refund-actor-mismatch");
			if (!accepted.displaced_refund_eligible) refuse("certified-disposition-refund-not-eligible");
			if (accepted.bidder_cashu_public_key !== assertion.bidderPublicKey) refuse("certified-disposition-refund-cashu-key-mismatch");
			if (accepted.locktime !== assertion.locktime) refuse("certified-disposition-refund-locktime-mismatch");
			if (JSON.stringify(accepted.proof_state_refs) !== JSON.stringify(assertion.proofStateRefs)) refuse("certified-disposition-refund-deposit-mismatch");
		},
	};
}
