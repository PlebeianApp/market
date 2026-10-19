/**
 * Verification-only boundary for authenticated demo auction closure evidence.
 *
 * The caller supplies the complete auction history and a cryptographic signature
 * verifier. This module does not fetch history, run consensus, hold validator
 * keys, or claim that four signatures were produced by an independent DKG.
 */
import type { DemoAuthSignedBidExactSource } from "./demo-auth-signed-bid-source.ts";
import type { DemoPaymentApprovalV1 } from "./demo-payment-coordinator.ts";
import {
	canonicalUtf8Json,
	compareUtf8Bytes,
	computeCommittedAuctionBatchHistorySha256,
	decodeCommittedBidBatch,
	type CommittedAuctionBatchV2,
} from "./committed-bid-consumer.ts";
import type { DemoSignedEvent } from "../ts/demo-auth-bid.ts";

export const DEMO_CERTIFIED_CLOSURE_SCHEMA = "DemoCertifiedClosureV1" as const;
export const DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA = "DemoCertifiedClosureHistoryBatchV1" as const;
export const DEMO_CERTIFIED_CLOSURE_DOMAIN = "plebeian-auction-certified-closure/v1" as const;

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;
const COMPRESSED_PUBLIC_KEY = /^(02|03)[0-9a-f]{64}$/;
const SAFE_TEXT = /^[\x21-\x7e]{1,160}$/;

export type DemoCertifiedClosureOutcome = "winner" | "no_bids" | "reserve_not_met";

export interface DemoCertifiedClosureBidV1 {
	readonly auction_id: string;
	readonly bid_id: string;
	readonly operation_id: string;
	readonly event_id: string;
	readonly actor_id: string;
	readonly amount: number;
	/** Wallet spend/refund key and exact deposit identity committed by the signed bid. */
	readonly bidder_cashu_public_key: string;
	readonly locktime: number;
	readonly proof_state_refs: readonly string[];
	readonly displaced_refund_eligible: boolean;
	/** Public `child_pubkey` from the signed bid wire; the bidder's derivation path stays private. */
	readonly seller_child_public_key: string;
}

export interface DemoCertifiedClosureHistoryBatchV1 {
	readonly schema: typeof DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA;
	readonly auth_network_id: string;
	readonly chain_id: string;
	readonly height: number;
	readonly block_time: number;
	readonly app_hash: string;
	readonly bids: readonly DemoCertifiedClosureBidV1[];
}

export interface DemoCertifiedClosureValidatorSignatureV1 {
	readonly validator_id: string;
	readonly public_key: string;
	readonly signature: string;
}

export interface DemoCertifiedClosurePayloadV1 {
	readonly schema: typeof DEMO_CERTIFIED_CLOSURE_SCHEMA;
	readonly domain: typeof DEMO_CERTIFIED_CLOSURE_DOMAIN;
	readonly auth_network_id: string;
	readonly chain_id: string;
	readonly auction_id: string;
	readonly seller_p2pk_xpub: string;
	readonly base_end_height: number;
	readonly base_end_time: number;
	readonly effective_end_height: number;
	readonly effective_end_time: number;
	readonly close_height: number;
	readonly close_time: number;
	readonly history_start_height: number;
	readonly history_end_height: number;
	readonly history_root: string;
	readonly outcome: DemoCertifiedClosureOutcome;
	readonly winner_bid_id: string | null;
	readonly winner_operation_id: string | null;
	readonly winner_event_id: string | null;
	readonly winner_actor_id: string | null;
	readonly winner_amount: number | null;
	readonly app_hash: string;
	readonly validator_roster_version: string;
	readonly validator_roster: readonly {
		readonly validator_id: string;
		readonly public_key: string;
	}[];
}

export interface DemoCertifiedClosureCertificateV1 extends DemoCertifiedClosurePayloadV1 {
	readonly certificate_digest: string;
	readonly signatures: readonly DemoCertifiedClosureValidatorSignatureV1[];
}

export interface DemoCertifiedClosurePolicy {
	readonly authNetworkId: string;
	readonly chainId: string;
	readonly auctionId: string;
	readonly sellerP2pkXpub: string;
	readonly baseEndHeight: number;
	readonly baseEndTime: number;
	/** Minimum time after certified close during which main-path settlement stays valid. */
	readonly minimumSettlementWindowSeconds: number;
	readonly validatorRosterVersion: string;
	readonly validators: readonly {
		readonly validatorId: string;
		readonly publicKey: string;
	}[];
}

export interface DemoCertifiedClosureSignatureVerifier {
	verifyExact(request: {
		readonly domain: typeof DEMO_CERTIFIED_CLOSURE_DOMAIN;
		readonly validatorId: string;
		readonly publicKey: string;
		readonly digest: string;
		readonly signature: string;
	}): boolean | Promise<boolean>;
}

export interface VerifiedDemoCertifiedClosure {
	readonly certificate: DemoCertifiedClosureCertificateV1;
	readonly certificateDigest: string;
	readonly highestAcceptedBid: DemoCertifiedClosureBidV1 | null;
}

export interface OwnerLocalR4AuthenticatedEvidenceAgreementV1 {
	readonly schema: "OwnerLocalR4AuthenticatedEvidenceAgreementV1";
	readonly agreement: true;
	readonly session_id: string;
	readonly chain_id: string;
	readonly auth_network_id: string;
	readonly auction_id: string;
	readonly authenticated_genesis_sha256: string;
	readonly combined_genesis_sha256: string;
	readonly target_height: number;
	readonly target_block_id: string;
	readonly target_app_hash: string;
	readonly claimed_slots: readonly [1, 2, 3, 4];
	readonly collector_provenance_verified: false;
	readonly authenticated_run_verified: true;
	readonly nostr_signatures_verified: true;
	readonly warning: string;
}

export interface DemoAuthenticatedAgreementVerifier {
	verifyExact(agreement: OwnerLocalR4AuthenticatedEvidenceAgreementV1): boolean | Promise<boolean>;
}

export interface DemoPaymentApprovalVerifier {
	verifyExact(approval: DemoPaymentApprovalV1): boolean | Promise<boolean>;
}

/** The implementation must embody an A0-accepted lifetime contract. */
export interface DemoPaymentApprovalLifetimeVerifier {
	verifyExact(request: {
		readonly approval: DemoPaymentApprovalV1;
		readonly signedBid: DemoSignedEvent;
	}): boolean | Promise<boolean>;
}

export interface DemoAuthenticatedPaymentCommitmentsV1 {
	readonly schema: "DemoAuthenticatedPaymentCommitmentsV1";
	readonly canonicalBatchHistorySha256: string;
	readonly verifiedApprovalSetSha256: string;
}

/** Frozen R4.1/R4.3 public commitment boundary; it carries no payment secret. */
export interface DemoAuthenticatedPaymentCommitmentsV2 {
	readonly schema: "DemoAuthenticatedPaymentCommitmentsV2";
	readonly authNetworkId: string;
	readonly chainId: string;
	readonly auctionId: string;
	readonly closureHeight: number;
	readonly closureAppHash: string;
	readonly immutableStorageMarker: string;
	readonly storageRootSha256: string;
	readonly operationMembershipSha256: string;
	readonly operationCount: number;
	readonly approvalCount: number;
	readonly canonicalBatchHistorySha256: string;
	readonly verifiedApprovalSetSha256: string;
}

export interface VerifiedDemoAuthenticatedHandoff {
	readonly closure: VerifiedDemoCertifiedClosure;
	readonly agreement: OwnerLocalR4AuthenticatedEvidenceAgreementV1;
	readonly rawSignedEventsVerified: number;
	readonly bidderPaymentApprovalsVerified: number;
	readonly paymentCommitments: DemoAuthenticatedPaymentCommitmentsV1;
	readonly approvalLifetimePolicyVerified: true;
	readonly paymentExecutionVerified: false;
	readonly settlementVerified: false;
}

export class DemoCertifiedClosureRefusedError extends Error {
	constructor(readonly code: string) {
		super(code);
		this.name = "DemoCertifiedClosureRefusedError";
	}
}

function refuse(code: string): never {
	throw new DemoCertifiedClosureRefusedError(code);
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

function positiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

export function decodeDemoAuthenticatedPaymentCommitmentsV2(value: unknown): DemoAuthenticatedPaymentCommitmentsV2 {
	const keys = [
		"schema", "authNetworkId", "chainId", "auctionId", "closureHeight", "closureAppHash",
		"immutableStorageMarker", "storageRootSha256", "operationMembershipSha256", "operationCount",
		"approvalCount", "canonicalBatchHistorySha256", "verifiedApprovalSetSha256",
	];
	if (!exactObject(value, keys)
		|| value.schema !== "DemoAuthenticatedPaymentCommitmentsV2"
		|| typeof value.authNetworkId !== "string" || !HEX_64.test(value.authNetworkId)
		|| !safeText(value.chainId) || !safeText(value.auctionId) || !positiveInteger(value.closureHeight)
		|| typeof value.closureAppHash !== "string" || !HEX_64.test(value.closureAppHash)
		|| !safeText(value.immutableStorageMarker)
		|| typeof value.storageRootSha256 !== "string" || !HEX_64.test(value.storageRootSha256)
		|| typeof value.operationMembershipSha256 !== "string" || !HEX_64.test(value.operationMembershipSha256)
		|| !Number.isSafeInteger(value.operationCount) || (value.operationCount as number) < 0
		|| !Number.isSafeInteger(value.approvalCount) || (value.approvalCount as number) < 0
		|| value.operationCount !== value.approvalCount
		|| typeof value.canonicalBatchHistorySha256 !== "string" || !HEX_64.test(value.canonicalBatchHistorySha256)
		|| typeof value.verifiedApprovalSetSha256 !== "string" || !HEX_64.test(value.verifiedApprovalSetSha256)) {
		refuse("authenticated-payment-commitments-v2-invalid");
	}
	return value as unknown as DemoAuthenticatedPaymentCommitmentsV2;
}

function canonicalBid(value: unknown): DemoCertifiedClosureBidV1 {
	const keys = [
		"auction_id", "bid_id", "operation_id", "event_id", "actor_id", "amount",
		"bidder_cashu_public_key", "locktime", "proof_state_refs", "displaced_refund_eligible",
		"seller_child_public_key",
	];
	if (!exactObject(value, keys)
		|| !safeText(value.auction_id)
		|| !safeText(value.bid_id)
		|| !safeText(value.operation_id)
		|| typeof value.event_id !== "string" || !HEX_64.test(value.event_id)
		|| typeof value.actor_id !== "string" || !HEX_64.test(value.actor_id)
		|| !positiveInteger(value.amount)
		|| typeof value.bidder_cashu_public_key !== "string" || !COMPRESSED_PUBLIC_KEY.test(value.bidder_cashu_public_key)
		|| !positiveInteger(value.locktime)
		|| !Array.isArray(value.proof_state_refs) || value.proof_state_refs.length === 0
		|| value.proof_state_refs.some((item) => typeof item !== "string" || !COMPRESSED_PUBLIC_KEY.test(item))
		|| new Set(value.proof_state_refs).size !== value.proof_state_refs.length
		|| JSON.stringify(value.proof_state_refs) !== JSON.stringify([...value.proof_state_refs].sort())
		|| typeof value.displaced_refund_eligible !== "boolean"
		|| typeof value.seller_child_public_key !== "string" || !COMPRESSED_PUBLIC_KEY.test(value.seller_child_public_key)) refuse("certified-closure-bid-invalid");
	return {
		auction_id: value.auction_id,
		bid_id: value.bid_id,
		operation_id: value.operation_id,
		event_id: value.event_id,
		actor_id: value.actor_id,
		amount: value.amount,
		bidder_cashu_public_key: value.bidder_cashu_public_key,
		locktime: value.locktime,
		proof_state_refs: [...value.proof_state_refs],
		displaced_refund_eligible: value.displaced_refund_eligible,
		seller_child_public_key: value.seller_child_public_key,
	};
}

function canonicalHistoryBatch(value: unknown): DemoCertifiedClosureHistoryBatchV1 {
	const keys = ["schema", "auth_network_id", "chain_id", "height", "block_time", "app_hash", "bids"];
	if (!exactObject(value, keys)
		|| value.schema !== DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA
		|| typeof value.auth_network_id !== "string" || !HEX_64.test(value.auth_network_id)
		|| !safeText(value.chain_id)
		|| !positiveInteger(value.height)
		|| !positiveInteger(value.block_time)
		|| typeof value.app_hash !== "string" || !HEX_64.test(value.app_hash)
		|| !Array.isArray(value.bids)) refuse("certified-closure-history-entry-invalid");
	return {
		schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA,
		auth_network_id: value.auth_network_id,
		chain_id: value.chain_id,
		height: value.height,
		block_time: value.block_time,
		app_hash: value.app_hash,
		bids: value.bids.map(canonicalBid),
	};
}

function canonicalRosterEntry(value: unknown): { readonly validator_id: string; readonly public_key: string } {
	if (!exactObject(value, ["validator_id", "public_key"])
		|| !safeText(value.validator_id)
		|| typeof value.public_key !== "string" || !COMPRESSED_PUBLIC_KEY.test(value.public_key)) refuse("certified-closure-roster-invalid");
	return { validator_id: value.validator_id, public_key: value.public_key };
}

function canonicalSignature(value: unknown): DemoCertifiedClosureValidatorSignatureV1 {
	if (!exactObject(value, ["validator_id", "public_key", "signature"])
		|| !safeText(value.validator_id)
		|| typeof value.public_key !== "string" || !COMPRESSED_PUBLIC_KEY.test(value.public_key)
		|| typeof value.signature !== "string" || !HEX_128.test(value.signature)) refuse("certified-closure-signature-invalid");
	return { validator_id: value.validator_id, public_key: value.public_key, signature: value.signature };
}

const PAYLOAD_KEYS = [
	"schema", "domain", "auth_network_id", "chain_id", "auction_id", "seller_p2pk_xpub",
	"base_end_height", "base_end_time", "effective_end_height", "effective_end_time",
	"close_height", "close_time", "history_start_height", "history_end_height",
	"history_root", "outcome", "winner_bid_id", "winner_operation_id", "winner_event_id",
	"winner_actor_id", "winner_amount", "app_hash", "validator_roster_version", "validator_roster",
] as const;

function canonicalPayload(value: unknown): DemoCertifiedClosurePayloadV1 {
	if (!exactObject(value, PAYLOAD_KEYS)
		|| value.schema !== DEMO_CERTIFIED_CLOSURE_SCHEMA
		|| value.domain !== DEMO_CERTIFIED_CLOSURE_DOMAIN
		|| typeof value.auth_network_id !== "string" || !HEX_64.test(value.auth_network_id)
		|| !safeText(value.chain_id)
		|| !safeText(value.auction_id)
		|| !safeText(value.seller_p2pk_xpub)
		|| !positiveInteger(value.base_end_height)
		|| !positiveInteger(value.base_end_time)
		|| !positiveInteger(value.effective_end_height)
		|| !positiveInteger(value.effective_end_time)
		|| !positiveInteger(value.close_height)
		|| !positiveInteger(value.close_time)
		|| !positiveInteger(value.history_start_height)
		|| !positiveInteger(value.history_end_height)
		|| typeof value.history_root !== "string" || !HEX_64.test(value.history_root)
		|| (value.outcome !== "winner" && value.outcome !== "no_bids" && value.outcome !== "reserve_not_met")
		|| typeof value.app_hash !== "string" || !HEX_64.test(value.app_hash)
		|| !safeText(value.validator_roster_version)
		|| !Array.isArray(value.validator_roster)) refuse("certified-closure-certificate-invalid");

	const winnerValues = [value.winner_bid_id, value.winner_operation_id, value.winner_event_id, value.winner_actor_id, value.winner_amount];
	if (value.outcome === "winner") {
		if (!safeText(value.winner_bid_id)
			|| !safeText(value.winner_operation_id)
			|| typeof value.winner_event_id !== "string" || !HEX_64.test(value.winner_event_id)
			|| typeof value.winner_actor_id !== "string" || !HEX_64.test(value.winner_actor_id)
			|| !positiveInteger(value.winner_amount)) refuse("certified-closure-winner-invalid");
	} else if (winnerValues.some((item) => item !== null)) refuse("certified-closure-no-winner-inconsistent");

	const roster = value.validator_roster.map(canonicalRosterEntry);
	if (roster.length !== 4
		|| new Set(roster.map((item) => item.validator_id)).size !== 4
		|| new Set(roster.map((item) => item.public_key.slice(2))).size !== 4) refuse("certified-closure-four-of-four-required");
	if (roster.some((item, index) => index > 0 && roster[index - 1]!.validator_id >= item.validator_id)) refuse("certified-closure-roster-order-invalid");

	return {
		schema: DEMO_CERTIFIED_CLOSURE_SCHEMA,
		domain: DEMO_CERTIFIED_CLOSURE_DOMAIN,
		auth_network_id: value.auth_network_id,
		chain_id: value.chain_id,
		auction_id: value.auction_id,
		seller_p2pk_xpub: value.seller_p2pk_xpub,
		base_end_height: value.base_end_height,
		base_end_time: value.base_end_time,
		effective_end_height: value.effective_end_height,
		effective_end_time: value.effective_end_time,
		close_height: value.close_height,
		close_time: value.close_time,
		history_start_height: value.history_start_height,
		history_end_height: value.history_end_height,
		history_root: value.history_root,
		outcome: value.outcome,
		winner_bid_id: value.winner_bid_id as string | null,
		winner_operation_id: value.winner_operation_id as string | null,
		winner_event_id: value.winner_event_id as string | null,
		winner_actor_id: value.winner_actor_id as string | null,
		winner_amount: value.winner_amount as number | null,
		app_hash: value.app_hash,
		validator_roster_version: value.validator_roster_version,
		validator_roster: roster,
	};
}

function canonicalCertificate(value: unknown): DemoCertifiedClosureCertificateV1 {
	if (typeof value !== "object" || value === null || Array.isArray(value)) refuse("certified-closure-certificate-invalid");
	const object = value as Record<string, unknown>;
	if (!exactObject(object, [...PAYLOAD_KEYS, "certificate_digest", "signatures"])) refuse("certified-closure-certificate-invalid");
	const payloadEntries = Object.fromEntries(PAYLOAD_KEYS.map((key) => [key, object[key]]));
	const payload = canonicalPayload(payloadEntries);
	if (typeof object.certificate_digest !== "string" || !HEX_64.test(object.certificate_digest) || !Array.isArray(object.signatures)) refuse("certified-closure-certificate-invalid");
	const signatures = object.signatures.map(canonicalSignature);
	return { ...payload, certificate_digest: object.certificate_digest, signatures };
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function computeCertifiedClosureHistoryRoot(history: readonly DemoCertifiedClosureHistoryBatchV1[]): Promise<string> {
	if (!Array.isArray(history)) refuse("certified-closure-history-invalid");
	const canonical = history.map(canonicalHistoryBatch);
	return sha256Hex(canonicalUtf8Json(canonical));
}

export async function computeCertifiedClosureDigest(payload: DemoCertifiedClosurePayloadV1): Promise<string> {
	return sha256Hex(canonicalUtf8Json(canonicalPayload(payload)));
}

function canonicalPolicy(policy: DemoCertifiedClosurePolicy): DemoCertifiedClosurePolicy {
	if (!exactObject(policy, ["authNetworkId", "chainId", "auctionId", "sellerP2pkXpub", "baseEndHeight", "baseEndTime", "minimumSettlementWindowSeconds", "validatorRosterVersion", "validators"])
		|| typeof policy.authNetworkId !== "string" || !HEX_64.test(policy.authNetworkId)
		|| !safeText(policy.chainId)
		|| !safeText(policy.auctionId)
		|| !safeText(policy.sellerP2pkXpub)
		|| !positiveInteger(policy.baseEndHeight)
		|| !positiveInteger(policy.baseEndTime)
		|| !positiveInteger(policy.minimumSettlementWindowSeconds)
		|| !safeText(policy.validatorRosterVersion)
		|| !Array.isArray(policy.validators)
		|| policy.validators.length !== 4) refuse("certified-closure-policy-invalid");
	const validators = policy.validators.map((item) => {
		if (!exactObject(item, ["validatorId", "publicKey"])
			|| !safeText(item.validatorId)
			|| typeof item.publicKey !== "string" || !COMPRESSED_PUBLIC_KEY.test(item.publicKey)) refuse("certified-closure-policy-invalid");
		return { validatorId: item.validatorId, publicKey: item.publicKey };
	});
	if (new Set(validators.map((item) => item.validatorId)).size !== 4
		|| new Set(validators.map((item) => item.publicKey.slice(2))).size !== 4
		|| validators.some((item, index) => index > 0 && validators[index - 1]!.validatorId >= item.validatorId)) refuse("certified-closure-policy-invalid");
	return { ...policy, validators };
}

function compareBids(left: DemoCertifiedClosureBidV1, right: DemoCertifiedClosureBidV1): number {
	if (left.amount !== right.amount) return right.amount - left.amount;
	const bidOrder = compareUtf8Bytes(left.bid_id, right.bid_id);
	if (bidOrder !== 0) return bidOrder;
	return compareUtf8Bytes(left.event_id, right.event_id);
}

function sameWinner(certificate: DemoCertifiedClosureCertificateV1, bid: DemoCertifiedClosureBidV1): boolean {
	return certificate.winner_bid_id === bid.bid_id
		&& certificate.winner_operation_id === bid.operation_id
		&& certificate.winner_event_id === bid.event_id
		&& certificate.winner_actor_id === bid.actor_id
		&& certificate.winner_amount === bid.amount;
}

/**
 * Verify a certificate and its full history before a payment signer is called.
 * Success authenticates only the supplied evidence under the injected keys.
 */
export async function verifyDemoCertifiedClosure(request: {
	readonly certificate: unknown;
	readonly history: readonly unknown[];
	readonly policy: DemoCertifiedClosurePolicy;
	readonly signatureVerifier: DemoCertifiedClosureSignatureVerifier;
}): Promise<VerifiedDemoCertifiedClosure> {
	const certificate = canonicalCertificate(request.certificate);
	const policy = canonicalPolicy(request.policy);
	if (certificate.auth_network_id !== policy.authNetworkId
		|| certificate.chain_id !== policy.chainId
		|| certificate.auction_id !== policy.auctionId
		|| certificate.seller_p2pk_xpub !== policy.sellerP2pkXpub) refuse("certified-closure-domain-mismatch");
	if (certificate.base_end_height !== policy.baseEndHeight || certificate.base_end_time !== policy.baseEndTime) refuse("certified-closure-schedule-mismatch");
	if (certificate.validator_roster_version !== policy.validatorRosterVersion) refuse("certified-closure-roster-version-mismatch");
	if (certificate.base_end_height > certificate.effective_end_height
		|| certificate.effective_end_height > certificate.close_height
		|| certificate.base_end_time > certificate.effective_end_time
		|| certificate.effective_end_time > certificate.close_time) refuse("certified-closure-schedule-invalid");
	if (certificate.history_start_height !== 1) refuse("certified-closure-history-start-missing");
	if (certificate.history_end_height !== certificate.close_height) refuse("certified-closure-history-end-invalid");

	const expectedRoster = policy.validators.map((item) => ({ validator_id: item.validatorId, public_key: item.publicKey }));
	if (JSON.stringify(certificate.validator_roster) !== JSON.stringify(expectedRoster)) refuse("certified-closure-roster-mismatch");
	if (certificate.signatures.length !== 4
		|| new Set(certificate.signatures.map((item) => item.validator_id)).size !== 4
		|| new Set(certificate.signatures.map((item) => item.public_key.slice(2))).size !== 4) refuse("certified-closure-four-of-four-required");
	for (let index = 0; index < expectedRoster.length; index += 1) {
		const signature = certificate.signatures[index];
		const expected = expectedRoster[index];
		if (signature?.validator_id !== expected?.validator_id || signature.public_key !== expected.public_key) refuse("certified-closure-signature-roster-mismatch");
	}

	if (!Array.isArray(request.history) || request.history.length === 0) refuse("certified-closure-history-start-missing");
	const history = request.history.map(canonicalHistoryBatch);
	if (history[0]!.height !== certificate.history_start_height) refuse("certified-closure-history-start-missing");
	if (history.at(-1)!.height !== certificate.history_end_height) refuse("certified-closure-history-end-invalid");
	const bids: DemoCertifiedClosureBidV1[] = [];
	const bidIds = new Set<string>();
	const operationIds = new Set<string>();
	const eventIds = new Set<string>();
	const proofStateRefs = new Set<string>();
	let priorTime = 0;
	for (let index = 0; index < history.length; index += 1) {
		const batch = history[index]!;
		const expectedHeight = certificate.history_start_height + index;
		if (batch.height !== expectedHeight) refuse("certified-closure-history-gap");
		if (batch.auth_network_id !== certificate.auth_network_id || batch.chain_id !== certificate.chain_id) refuse("certified-closure-history-domain-mismatch");
		if (batch.block_time < priorTime) refuse("certified-closure-history-time-regression");
		priorTime = batch.block_time;
		for (const bid of batch.bids) {
			if (bid.auction_id !== certificate.auction_id) refuse("certified-closure-history-auction-mismatch");
			if (batch.height >= certificate.effective_end_height || batch.block_time >= certificate.effective_end_time) refuse("certified-closure-bid-at-or-after-close");
			if (bid.locktime < certificate.close_time + policy.minimumSettlementWindowSeconds) refuse("certified-closure-locktime-floor");
			if (bidIds.has(bid.bid_id) || operationIds.has(bid.operation_id) || eventIds.has(bid.event_id)) refuse("certified-closure-duplicate-bid");
			for (const ref of bid.proof_state_refs) {
				if (proofStateRefs.has(ref)) refuse("certified-closure-duplicate-deposit");
				proofStateRefs.add(ref);
			}
			bidIds.add(bid.bid_id); operationIds.add(bid.operation_id); eventIds.add(bid.event_id); bids.push(bid);
		}
	}
	const closingBatch = history.at(-1)!;
	if (closingBatch.height !== certificate.close_height
		|| closingBatch.block_time !== certificate.close_time
		|| closingBatch.app_hash !== certificate.app_hash) refuse("certified-closure-close-binding-invalid");

	const historyRoot = await computeCertifiedClosureHistoryRoot(history);
	if (historyRoot !== certificate.history_root) refuse("certified-closure-history-root-mismatch");
	const orderedBids = [...bids].sort(compareBids);
	const highest = orderedBids[0] ?? null;
	if (certificate.outcome === "no_bids") {
		if (highest !== null) refuse("certified-closure-no-bids-inconsistent");
	} else if (certificate.outcome === "reserve_not_met") {
		if (highest === null) refuse("certified-closure-reserve-not-met-missing-bid");
	} else {
		if (highest === null) refuse("certified-closure-winner-missing");
		if (orderedBids[1]?.amount === highest.amount) refuse("certified-closure-winner-ambiguous-highest");
		if (!sameWinner(certificate, highest)) refuse("certified-closure-winner-not-highest");
	}

	const { certificate_digest: _digest, signatures: _signatures, ...payload } = certificate;
	const digest = await computeCertifiedClosureDigest(payload);
	if (digest !== certificate.certificate_digest) refuse("certified-closure-digest-mismatch");
	for (const signature of certificate.signatures) {
		const valid = await request.signatureVerifier.verifyExact({
			domain: DEMO_CERTIFIED_CLOSURE_DOMAIN,
			validatorId: signature.validator_id,
			publicKey: signature.public_key,
			digest,
			signature: signature.signature,
		});
		if (!valid) refuse("certified-closure-signature-invalid");
	}
	return { certificate, certificateDigest: digest, highestAcceptedBid: highest };
}

function canonicalAgreement(value: unknown): OwnerLocalR4AuthenticatedEvidenceAgreementV1 {
	const keys = [
		"schema", "agreement", "session_id", "chain_id", "auth_network_id", "auction_id",
		"authenticated_genesis_sha256", "combined_genesis_sha256", "target_height", "target_block_id",
		"target_app_hash", "claimed_slots", "collector_provenance_verified", "authenticated_run_verified",
		"nostr_signatures_verified", "warning",
	];
	if (!exactObject(value, keys)
		|| value.schema !== "OwnerLocalR4AuthenticatedEvidenceAgreementV1" || value.agreement !== true
		|| !safeText(value.session_id) || !safeText(value.chain_id) || !safeText(value.auction_id)
		|| typeof value.auth_network_id !== "string" || !HEX_64.test(value.auth_network_id)
		|| typeof value.authenticated_genesis_sha256 !== "string" || !HEX_64.test(value.authenticated_genesis_sha256)
		|| typeof value.combined_genesis_sha256 !== "string" || !HEX_64.test(value.combined_genesis_sha256)
		|| !positiveInteger(value.target_height)
		|| typeof value.target_block_id !== "string" || !HEX_64.test(value.target_block_id)
		|| typeof value.target_app_hash !== "string" || !HEX_64.test(value.target_app_hash)
		|| JSON.stringify(value.claimed_slots) !== "[1,2,3,4]"
		|| value.collector_provenance_verified !== false || value.authenticated_run_verified !== true
		|| value.nostr_signatures_verified !== true || typeof value.warning !== "string" || value.warning.length === 0) {
		refuse("authenticated-handoff-agreement-invalid");
	}
	return { ...value, claimed_slots: [1, 2, 3, 4] } as unknown as OwnerLocalR4AuthenticatedEvidenceAgreementV1;
}

const PAYMENT_APPROVAL_KEYS = [
	"schema", "authNetworkId", "chainId", "auctionId", "operationId", "bidId", "bidEventId",
	"bidderActorId", "amount", "mintUrl", "sellerP2pkXpub", "sellerDerivationPath", "sellerRecipient",
	"refundRecipient", "conditionFingerprint", "winnerPackageDigest", "refundPackageDigest",
	"approvalCreatedAt", "approvalEventId", "approvalSignature",
] as const;

function canonicalPaymentApproval(value: unknown): DemoPaymentApprovalV1 {
	if (!exactObject(value, PAYMENT_APPROVAL_KEYS) || value.schema !== "DemoPaymentApprovalV1"
		|| typeof value.authNetworkId !== "string" || !HEX_64.test(value.authNetworkId)
		|| !safeText(value.chainId) || !safeText(value.auctionId) || !safeText(value.operationId) || !safeText(value.bidId)
		|| typeof value.bidEventId !== "string" || !HEX_64.test(value.bidEventId)
		|| typeof value.bidderActorId !== "string" || !HEX_64.test(value.bidderActorId)
		|| !positiveInteger(value.amount) || !safeText(value.mintUrl) || !safeText(value.sellerP2pkXpub)
		|| !safeText(value.sellerDerivationPath) || !safeText(value.sellerRecipient) || !safeText(value.refundRecipient)
		|| typeof value.conditionFingerprint !== "string" || !HEX_64.test(value.conditionFingerprint)
		|| typeof value.winnerPackageDigest !== "string" || !HEX_64.test(value.winnerPackageDigest)
		|| typeof value.refundPackageDigest !== "string" || !HEX_64.test(value.refundPackageDigest)
		|| !positiveInteger(value.approvalCreatedAt)
		|| typeof value.approvalEventId !== "string" || !HEX_64.test(value.approvalEventId)
		|| typeof value.approvalSignature !== "string" || !HEX_128.test(value.approvalSignature)) {
		refuse("authenticated-handoff-payment-approval-invalid");
	}
	return { ...value } as unknown as DemoPaymentApprovalV1;
}

export async function computeDemoPaymentApprovalSetSha256(values: readonly unknown[]): Promise<string> {
	if (!Array.isArray(values)) refuse("authenticated-handoff-payment-approval-invalid");
	const approvals = values.map(canonicalPaymentApproval).sort((left, right) => {
		const leftKey = [left.authNetworkId, left.chainId, left.auctionId, left.operationId];
		const rightKey = [right.authNetworkId, right.chainId, right.auctionId, right.operationId];
		for (let index = 0; index < leftKey.length; index += 1) {
			const order = compareUtf8Bytes(leftKey[index]!, rightKey[index]!);
			if (order !== 0) return order;
		}
		return 0;
	});
	const canonical = approvals.map((approval) => Object.fromEntries(PAYMENT_APPROVAL_KEYS.map((key) => [key, approval[key]])));
	return sha256Hex(canonicalUtf8Json(canonical));
}

async function verifyCommittedBatchHistory(
	closure: VerifiedDemoCertifiedClosure,
	history: readonly DemoCertifiedClosureHistoryBatchV1[],
	values: readonly unknown[],
): Promise<string> {
	if (!Array.isArray(values) || values.length !== history.length) refuse("authenticated-handoff-committed-history-conflict");
	let batches: CommittedAuctionBatchV2[];
	try {
		batches = values.map((value) => {
			const decoded = decodeCommittedBidBatch(JSON.stringify(value));
			if (decoded.schema !== "CommittedAuctionBatchV2") throw new Error("v2-required");
			return decoded;
		}).sort((left, right) => left.height - right.height);
	} catch {
		refuse("authenticated-handoff-committed-history-invalid");
	}
	const certificate = closure.certificate;
	const matchingClosures = [] as CommittedAuctionBatchV2["closures"][number][];
	for (let index = 0; index < batches.length; index += 1) {
		const batch = batches[index]!;
		const enriched = history[index]!;
		if (batch.height !== index + 1 || batch.height !== enriched.height
			|| batch.auth_network_id !== certificate.auth_network_id || batch.chain_id !== certificate.chain_id
			|| batch.pbts_seconds !== enriched.block_time || batch.app_hash !== enriched.app_hash) {
			refuse("authenticated-handoff-committed-history-conflict");
		}
		const core = batch.bids.filter((bid) => bid.auction_id === certificate.auction_id).map((bid) => ({
			auction_id: bid.auction_id, bid_id: bid.bid_id, operation_id: bid.operation_id,
			event_id: bid.event_id, actor_id: bid.actor_id, amount: bid.amount,
			displaced_refund_eligible: bid.displaced_refund_eligible,
		}));
		const expected = enriched.bids.map((bid) => ({
			auction_id: bid.auction_id, bid_id: bid.bid_id, operation_id: bid.operation_id,
			event_id: bid.event_id, actor_id: bid.actor_id, amount: bid.amount,
			displaced_refund_eligible: bid.displaced_refund_eligible,
		}));
		if (JSON.stringify(core) !== JSON.stringify(expected)) refuse("authenticated-handoff-committed-history-conflict");
		matchingClosures.push(...batch.closures.filter((candidate) => candidate.auction_id === certificate.auction_id));
	}
	if (matchingClosures.length !== 1) refuse("authenticated-handoff-committed-closure-conflict");
	const committedClosure = matchingClosures[0]!;
	if (committedClosure.height !== certificate.close_height || committedClosure.pbts_seconds !== certificate.close_time
		|| committedClosure.app_hash !== certificate.app_hash || committedClosure.close_outcome !== certificate.outcome
		|| (committedClosure.winner_bid_id || null) !== certificate.winner_bid_id
		|| (committedClosure.winner_operation_id || null) !== certificate.winner_operation_id
		|| (committedClosure.winner_actor_id || null) !== certificate.winner_actor_id
		|| (committedClosure.amount || null) !== certificate.winner_amount) {
		refuse("authenticated-handoff-committed-closure-conflict");
	}
	try {
		return await computeCommittedAuctionBatchHistorySha256(batches);
	} catch {
		refuse("authenticated-handoff-committed-history-invalid");
	}
}

function assertAvailableIdentityRolesAreDistinct(closure: VerifiedDemoCertifiedClosure, bids: readonly DemoCertifiedClosureBidV1[]): void {
	const roleSets = [
		new Set(closure.certificate.validator_roster.map((item) => item.public_key.slice(2))),
		new Set(bids.map((item) => item.actor_id)),
		new Set(bids.map((item) => item.bidder_cashu_public_key.slice(2))),
		new Set(bids.map((item) => item.seller_child_public_key.slice(2))),
	];
	for (let left = 0; left < roleSets.length; left += 1) for (let right = left + 1; right < roleSets.length; right += 1) {
		if ([...roleSets[left]!].some((identity) => roleSets[right]!.has(identity))) refuse("authenticated-handoff-identity-role-conflict");
	}
}

/**
 * Verify the frozen offline application handoff before any payment execution.
 * The injected agreement and approval verifiers own their cryptographic formats;
 * this boundary owns exact cross-file joins and never claims mint or settlement.
 */
export async function verifyDemoAuthenticatedHandoff(request: {
	readonly certificate: unknown;
	readonly history: readonly unknown[];
	readonly policy: DemoCertifiedClosurePolicy;
	readonly signatureVerifier: DemoCertifiedClosureSignatureVerifier;
	readonly agreement: unknown;
	readonly agreementVerifier: DemoAuthenticatedAgreementVerifier;
	readonly signedEventSource: DemoAuthSignedBidExactSource;
	readonly committedBatches: readonly unknown[];
	readonly paymentApprovals: readonly unknown[];
	readonly paymentApprovalVerifier: DemoPaymentApprovalVerifier;
	readonly paymentApprovalLifetimeVerifier: DemoPaymentApprovalLifetimeVerifier;
}): Promise<VerifiedDemoAuthenticatedHandoff> {
	const closure = await verifyDemoCertifiedClosure(request);
	const agreement = canonicalAgreement(request.agreement);
	if (agreement.auth_network_id !== closure.certificate.auth_network_id
		|| agreement.chain_id !== closure.certificate.chain_id || agreement.auction_id !== closure.certificate.auction_id
		|| agreement.target_height !== closure.certificate.close_height || agreement.target_app_hash !== closure.certificate.app_hash) {
		refuse("authenticated-handoff-agreement-conflict");
	}
	if (!await request.agreementVerifier.verifyExact(agreement)) refuse("authenticated-handoff-agreement-unverified");
	const batches = request.history.map(canonicalHistoryBatch);
	const canonicalBatchHistorySha256 = await verifyCommittedBatchHistory(closure, batches, request.committedBatches);
	const bids = batches.flatMap((batch) => batch.bids);
	const exportedCount = request.signedEventSource.exactRecordCount?.();
	if (exportedCount !== undefined && exportedCount !== bids.length) refuse("authenticated-handoff-signed-event-conflict");
	const signedEvents = new Map<string, DemoSignedEvent>();
	for (const bid of bids) {
		const event = await request.signedEventSource.readExact({ operationId: bid.operation_id, bidId: bid.bid_id, eventId: bid.event_id, actorId: bid.actor_id, amount: bid.amount });
		if (event === null) refuse("authenticated-handoff-signed-event-missing");
		signedEvents.set(bid.operation_id, event);
	}
	if (!Array.isArray(request.paymentApprovals) || request.paymentApprovals.length !== bids.length) refuse("authenticated-handoff-payment-approval-missing");
	const approvals = request.paymentApprovals.map(canonicalPaymentApproval);
	const byOperation = new Map<string, DemoPaymentApprovalV1>();
	const approvalEvents = new Set<string>();
	for (const approval of approvals) {
		if (byOperation.has(approval.operationId) || approvalEvents.has(approval.approvalEventId)) refuse("authenticated-handoff-payment-approval-conflict");
		byOperation.set(approval.operationId, approval); approvalEvents.add(approval.approvalEventId);
	}
	for (const bid of bids) {
		const approval = byOperation.get(bid.operation_id);
		if (approval === undefined) refuse("authenticated-handoff-payment-approval-missing");
		if (approval.authNetworkId !== agreement.auth_network_id || approval.chainId !== agreement.chain_id
			|| approval.auctionId !== agreement.auction_id || approval.bidId !== bid.bid_id
			|| approval.bidEventId !== bid.event_id || approval.bidderActorId !== bid.actor_id || approval.amount !== bid.amount
			|| approval.sellerP2pkXpub !== closure.certificate.seller_p2pk_xpub
			|| approval.sellerRecipient !== bid.seller_child_public_key || approval.refundRecipient !== bid.actor_id) {
			refuse("authenticated-handoff-payment-approval-conflict");
		}
		const signedBid = signedEvents.get(bid.operation_id);
		if (signedBid === undefined || approval.approvalCreatedAt !== signedBid.created_at) refuse("authenticated-handoff-payment-approval-timestamp-conflict");
		if (!await request.paymentApprovalVerifier.verifyExact(approval)) refuse("authenticated-handoff-payment-approval-unverified");
		if (!await request.paymentApprovalLifetimeVerifier.verifyExact({ approval, signedBid })) refuse("authenticated-handoff-payment-approval-lifetime-unverified");
	}
	assertAvailableIdentityRolesAreDistinct(closure, bids);
	const verifiedApprovalSetSha256 = await computeDemoPaymentApprovalSetSha256(approvals);
	return {
		closure, agreement, rawSignedEventsVerified: bids.length, bidderPaymentApprovalsVerified: approvals.length,
		paymentCommitments: { schema: "DemoAuthenticatedPaymentCommitmentsV1", canonicalBatchHistorySha256, verifiedApprovalSetSha256 },
		approvalLifetimePolicyVerified: true, paymentExecutionVerified: false, settlementVerified: false,
	};
}
