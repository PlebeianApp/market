/**
 * Concrete participant-local adapters over the authenticated closure certificate and the
 * browser's actual signed-bid store. These adapters resolve immutable local evidence from a
 * locator-only coordinator message; no Cashu bearer proof or output opening crosses the boundary.
 *
 * This module intentionally does not implement the non-custodial Cashu digest proof. Until that
 * separate verifier exists, participant policy validation must remain fail-closed before signing.
 */
import type {
	DemoFrostCertifiedClosureVerifierPort,
	DemoFrostParticipantLocalEvidence,
	DemoFrostPublicDeposit,
	DemoFrostSignedBidVerifierPort,
	DemoFrostVerifiedClosureDisposition,
	DemoFrostVerifiedSignedBid,
} from "../../cashu-wrapper/ts/demo-frost-participant-policy.ts";
import { parseStrictJSON, reservationId } from "../ts/demo-auth-bid.ts";
import {
	verifyDemoCertifiedClosure,
	type DemoCertifiedClosureBidV1,
	type DemoCertifiedClosureHistoryBatchV1,
	type DemoCertifiedClosurePolicy,
	type DemoCertifiedClosureSignatureVerifier,
} from "./demo-certified-closure.ts";
import { DemoAuthSignedBidStoreV2Source } from "./demo-auth-signed-bid-source.ts";
import {
	verifyDemoPaymentConsensusHandoff,
	type DemoPaymentConsensusEvidencePort,
	type DemoPaymentConsensusHandoff,
	type DemoPaymentCoordinatorConfig,
} from "./demo-payment-coordinator.ts";

const HEX_64 = /^[0-9a-f]{64}$/;

function exactMarker(value: unknown, schema: DemoFrostParticipantLocalEvidence["schema"]): void {
	if (typeof value !== "object" || value === null || Array.isArray(value)
		|| Object.keys(value).length !== 2
		|| !("schema" in value) || !("source" in value)
		|| value.schema !== schema || value.source !== "participant-local") {
		throw new Error("demo-frost-participant-local-evidence-locator");
	}
}

function exactBid(
	history: readonly DemoCertifiedClosureHistoryBatchV1[],
	operationId: string,
): DemoCertifiedClosureBidV1 {
	const matches = history.flatMap((batch) => batch.bids).filter((bid) => bid.operation_id === operationId);
	if (matches.length !== 1) throw new Error("demo-frost-participant-closure-operation");
	return matches[0]!;
}

export interface DemoFrostParticipantClosureSnapshot {
	readonly certificate: unknown;
	readonly history: readonly DemoCertifiedClosureHistoryBatchV1[];
	readonly policy: DemoCertifiedClosurePolicy;
	readonly signatureVerifier: DemoCertifiedClosureSignatureVerifier;
}

export interface DemoFrostParticipantDispositionTarget {
	readonly role: "winner_settlement" | "refund";
	readonly operationId: string;
}

/** One verifier instance is scoped to one immutable disposition and participant-local snapshot. */
export class DemoFrostCertifiedClosureParticipantVerifier
	implements DemoFrostCertifiedClosureVerifierPort {
	private readonly certificate: unknown;
	private readonly history: readonly DemoCertifiedClosureHistoryBatchV1[];
	private readonly policy: DemoCertifiedClosurePolicy;
	private readonly signatureVerifier: DemoCertifiedClosureSignatureVerifier;
	private readonly target: DemoFrostParticipantDispositionTarget;

	constructor(
		snapshot: DemoFrostParticipantClosureSnapshot,
		target: DemoFrostParticipantDispositionTarget,
	) {
		this.certificate = structuredClone(snapshot.certificate);
		this.history = structuredClone(snapshot.history);
		this.policy = structuredClone(snapshot.policy);
		this.signatureVerifier = { verifyExact: snapshot.signatureVerifier.verifyExact.bind(snapshot.signatureVerifier) };
		if ((target.role !== "winner_settlement" && target.role !== "refund")
			|| target.operationId.length === 0 || target.operationId.trim() !== target.operationId) {
			throw new Error("demo-frost-participant-closure-target");
		}
		this.target = Object.freeze({ role: target.role, operationId: target.operationId });
	}

	async verifyAndDerive(evidence: unknown): Promise<DemoFrostVerifiedClosureDisposition> {
		exactMarker(evidence, "COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V1");
		const verified = await verifyDemoCertifiedClosure({
			certificate: this.certificate,
			history: this.history,
			policy: this.policy,
			signatureVerifier: this.signatureVerifier,
		});
		const bid = exactBid(this.history, this.target.operationId);
		if (this.target.role === "winner_settlement") {
			if (verified.highestAcceptedBid?.operation_id !== bid.operation_id) {
				throw new Error("demo-frost-participant-closure-not-winner");
			}
		} else {
			if (!bid.displaced_refund_eligible || verified.highestAcceptedBid?.operation_id === bid.operation_id) {
				throw new Error("demo-frost-participant-closure-refund-ineligible");
			}
			const winnerRefs = new Set(verified.highestAcceptedBid?.proof_state_refs ?? []);
			if (bid.proof_state_refs.some((reference) => winnerRefs.has(reference))) {
				throw new Error("demo-frost-participant-closure-refund-overlap");
			}
		}
		return {
			evidenceDigest: verified.certificateDigest,
			network: verified.certificate.auth_network_id,
			chainId: verified.certificate.chain_id,
			auctionId: verified.certificate.auction_id,
			operationId: bid.operation_id,
			bidId: bid.bid_id,
			bidEventId: bid.event_id,
			bidderActorId: bid.actor_id,
			role: this.target.role,
			outcomeHeight: verified.certificate.close_height,
			appStateHash: verified.certificate.app_hash,
			amount: bid.amount,
			locktime: bid.locktime,
			proofStateRefs: [...bid.proof_state_refs],
			recipientPublicKey: this.target.role === "winner_settlement"
				? bid.seller_child_public_key
				: bid.bidder_cashu_public_key,
		};
	}
}

/** Participant-local snapshot for the accepted portable-consensus handoff. */
export interface DemoFrostParticipantConsensusSnapshot {
	readonly handoff: DemoPaymentConsensusHandoff;
	readonly consensus: DemoPaymentConsensusEvidencePort;
	readonly config: DemoPaymentCoordinatorConfig;
	/** Public wallet-local bindings; bearer proofs and recipient openings remain outside this object. */
	readonly acceptedBids: readonly DemoCertifiedClosureBidV1[];
}

/**
 * Accepted successor to the legacy four-signature closure adapter. Portable Comet evidence
 * authenticates exact `CommittedAuctionBatchV2` bytes through H+1/H+2; participant-local public
 * Cashu bindings are joined by the same operation/bid/event/actor/amount tuple and are independently
 * checked again by `DemoFrostSignedBidParticipantVerifier` during policy validation.
 */
export class DemoFrostConsensusHandoffParticipantVerifier implements DemoFrostCertifiedClosureVerifierPort {
	private readonly handoff: DemoPaymentConsensusHandoff;
	private readonly consensus: DemoPaymentConsensusEvidencePort;
	private readonly config: DemoPaymentCoordinatorConfig;
	private readonly acceptedBids: readonly DemoCertifiedClosureBidV1[];
	private readonly target: DemoFrostParticipantDispositionTarget;

	constructor(snapshot: DemoFrostParticipantConsensusSnapshot, target: DemoFrostParticipantDispositionTarget) {
		this.handoff = structuredClone(snapshot.handoff);
		this.consensus = { verifyExact: snapshot.consensus.verifyExact.bind(snapshot.consensus) };
		this.config = structuredClone(snapshot.config);
		this.acceptedBids = structuredClone(snapshot.acceptedBids);
		if ((target.role !== "winner_settlement" && target.role !== "refund")
			|| typeof target.operationId !== "string" || target.operationId.length === 0 || target.operationId.trim() !== target.operationId) throw new Error("demo-frost-participant-consensus-target");
		this.target = Object.freeze({ role: target.role, operationId: target.operationId });
		if (new Set(this.acceptedBids.map((bid) => bid.operation_id)).size !== this.acceptedBids.length) throw new Error("demo-frost-participant-consensus-bindings");
	}

	async verifyAndDerive(evidence: unknown): Promise<DemoFrostVerifiedClosureDisposition> {
		exactMarker(evidence, "COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V1");
		const verified = await verifyDemoPaymentConsensusHandoff(this.handoff, this.config, this.consensus);
		const committed = verified.batches.flatMap((batch) => batch.height < verified.handoff.closureHeight
			? batch.bids.filter((bid) => bid.auction_id === this.config.auctionId && bid.operation_id === this.target.operationId)
			: []);
		const local = this.acceptedBids.filter((bid) => bid.operation_id === this.target.operationId);
		if (committed.length !== 1 || local.length !== 1) throw new Error("demo-frost-participant-consensus-operation");
		const bid = local[0]!;
		const publicBid = committed[0]!;
		if (bid.auction_id !== this.config.auctionId || bid.bid_id !== publicBid.bid_id || bid.event_id !== publicBid.event_id
			|| bid.actor_id !== publicBid.actor_id || bid.amount !== publicBid.amount) throw new Error("demo-frost-participant-consensus-bid-join");
		const closure = verified.closure;
		if (this.target.role === "winner_settlement") {
			if (closure.close_outcome !== "winner" || closure.winner_operation_id !== bid.operation_id
				|| closure.winner_bid_id !== bid.bid_id || closure.winner_actor_id !== bid.actor_id || closure.amount !== bid.amount) throw new Error("demo-frost-participant-consensus-not-winner");
		} else {
			if (closure.close_outcome === "no_bids" || (closure.close_outcome === "winner" && closure.winner_operation_id === bid.operation_id)) throw new Error("demo-frost-participant-consensus-refund-ineligible");
			const winner = this.acceptedBids.find((candidate) => candidate.operation_id === closure.winner_operation_id);
			const winnerRefs = new Set(winner?.proof_state_refs ?? []);
			if (bid.proof_state_refs.some((reference) => winnerRefs.has(reference))) throw new Error("demo-frost-participant-consensus-refund-overlap");
		}
		return {
			evidenceDigest: verified.receipt.evidenceDigest,
			network: verified.handoff.authNetworkId,
			chainId: verified.handoff.chainId,
			auctionId: bid.auction_id,
			operationId: bid.operation_id,
			bidId: bid.bid_id,
			bidEventId: bid.event_id,
			bidderActorId: bid.actor_id,
			role: this.target.role,
			outcomeHeight: closure.height,
			appStateHash: closure.app_hash,
			amount: bid.amount,
			locktime: bid.locktime,
			proofStateRefs: [...bid.proof_state_refs],
			recipientPublicKey: this.target.role === "winner_settlement" ? bid.seller_child_public_key : bid.bidder_cashu_public_key,
		};
	}
}

export interface DemoFrostParticipantSignedBidScope {
	readonly network: string;
	readonly chainId: string;
	readonly mintUrl: string;
	readonly acceptedBid: DemoCertifiedClosureBidV1;
	readonly deposits: readonly DemoFrostPublicDeposit[];
}

function canonicalSignedCommand(value: unknown): {
	operation_id: string;
	auction_id: string;
	bid_id: string;
	amount: number;
	reservations: Array<{ reservation_id: string; amount: number }>;
} {
	const keys = ["version", "type", "operation_id", "auction_id", "bid_id", "amount", "reservations"];
	if (typeof value !== "object" || value === null || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.sort())) {
		throw new Error("demo-frost-participant-signed-bid-command");
	}
	const command = value as Record<string, unknown>;
	if (command.version !== 1 || command.type !== "bid"
		|| typeof command.operation_id !== "string" || typeof command.auction_id !== "string"
		|| typeof command.bid_id !== "string" || !Number.isSafeInteger(command.amount)
		|| (command.amount as number) < 1 || !Array.isArray(command.reservations)) {
		throw new Error("demo-frost-participant-signed-bid-command");
	}
	const reservations = command.reservations.map((entry) => {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)
			|| JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["amount", "reservation_id"])
			|| typeof (entry as Record<string, unknown>).reservation_id !== "string"
			|| !HEX_64.test((entry as Record<string, unknown>).reservation_id as string)
			|| !Number.isSafeInteger((entry as Record<string, unknown>).amount)
			|| ((entry as Record<string, unknown>).amount as number) < 1) {
			throw new Error("demo-frost-participant-signed-bid-reservation");
		}
		return {
			reservation_id: (entry as Record<string, unknown>).reservation_id as string,
			amount: (entry as Record<string, unknown>).amount as number,
		};
	});
	return {
		operation_id: command.operation_id,
		auction_id: command.auction_id,
		bid_id: command.bid_id,
		amount: command.amount as number,
		reservations,
	};
}

/** Verifies the Nostr event and derives the exact signed deposit manifest from its reservations. */
export class DemoFrostSignedBidParticipantVerifier implements DemoFrostSignedBidVerifierPort {
	private readonly scope: DemoFrostParticipantSignedBidScope;

	constructor(
		private readonly source: DemoAuthSignedBidStoreV2Source,
		scope: DemoFrostParticipantSignedBidScope,
	) {
		this.scope = structuredClone(scope);
	}

	async verifyAndDerive(evidence: unknown): Promise<DemoFrostVerifiedSignedBid> {
		exactMarker(evidence, "COCO_DEMO_FROST_PARTICIPANT_LOCAL_SIGNED_BID_EVIDENCE_V1");
		const bid = this.scope.acceptedBid;
		const signed = await this.source.readExact({
			operationId: bid.operation_id,
			bidId: bid.bid_id,
			eventId: bid.event_id,
			actorId: bid.actor_id,
			amount: bid.amount,
		});
		if (signed === null) throw new Error("demo-frost-participant-signed-bid-missing");
		let raw: unknown;
		try {
			raw = parseStrictJSON(signed.content);
		} catch {
			throw new Error("demo-frost-participant-signed-bid-command");
		}
		const command = canonicalSignedCommand(raw);
		if (JSON.stringify(raw) !== signed.content
			|| command.operation_id !== bid.operation_id || command.auction_id !== bid.auction_id
			|| command.bid_id !== bid.bid_id || command.amount !== bid.amount) {
			throw new Error("demo-frost-participant-signed-bid-identity");
		}
		if (this.scope.deposits.length !== bid.proof_state_refs.length
			|| this.scope.deposits.reduce((total, deposit) => total + deposit.amount, 0) !== bid.amount
			|| JSON.stringify(this.scope.deposits.map((deposit) => deposit.proofStateRef))
				!== JSON.stringify(bid.proof_state_refs)) {
			throw new Error("demo-frost-participant-signed-bid-deposits");
		}
		const expectedReservations = await Promise.all(this.scope.deposits.map(async (deposit) => ({
			reservation_id: await reservationId(this.scope.mintUrl, deposit.proofStateRef),
			amount: deposit.amount,
		})));
		expectedReservations.sort((left, right) => left.reservation_id.localeCompare(right.reservation_id));
		if (JSON.stringify(command.reservations) !== JSON.stringify(expectedReservations)) {
			throw new Error("demo-frost-participant-signed-bid-reservation-binding");
		}
		return {
			evidenceDigest: signed.id,
			network: this.scope.network,
			chainId: this.scope.chainId,
			auctionId: bid.auction_id,
			operationId: bid.operation_id,
			bidId: bid.bid_id,
			bidEventId: bid.event_id,
			bidderActorId: bid.actor_id,
			amount: bid.amount,
			locktime: bid.locktime,
			bidderPublicKey: bid.bidder_cashu_public_key,
			sellerRecipientPublicKey: bid.seller_child_public_key,
			deposits: this.scope.deposits.map((deposit) => ({ ...deposit })),
		};
	}
}
