import { describe, expect, test } from "bun:test";
import { deriveSellerChildPubkey } from "../../cashu-wrapper/ts/seller-child.ts";
import {
	DEMO_CERTIFIED_CLOSURE_DOMAIN,
	DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA,
	DEMO_CERTIFIED_CLOSURE_SCHEMA,
	computeCertifiedClosureDigest,
	computeCertifiedClosureHistoryRoot,
	computeDemoPaymentApprovalSetSha256,
	decodeDemoAuthenticatedPaymentCommitmentsV2,
	verifyDemoAuthenticatedHandoff,
	verifyDemoCertifiedClosure,
	type DemoCertifiedClosureCertificateV1,
	type DemoCertifiedClosureHistoryBatchV1,
	type DemoCertifiedClosurePayloadV1,
	type DemoCertifiedClosurePolicy,
	type OwnerLocalR4AuthenticatedEvidenceAgreementV1,
} from "./demo-certified-closure.ts";
import type { DemoPaymentApprovalV1 } from "./demo-payment-coordinator.ts";
import { canonicalUtf8Json, compareUtf8Bytes, computeCommittedAuctionBatchHistorySha256, type CommittedAuctionBatchV2 } from "./committed-bid-consumer.ts";

// These are verifier-bound contract fixtures, not validator consensus or DKG evidence.
const network = "a".repeat(64);
const sellerP2pkXpub = "xpub661MyMwAqRbcEtUEgdXRTY6dJQG9fRgs7C5QomqETKMYBJVtSGpRqyHSmhWy8snovPd5oWZgQ14zUquxbxu7Z1umuXbN5VDpUL1QobD5xUY";
const validators = ["1", "2", "3", "4"].map((digit, index) => ({
	validatorId: `validator-${index + 1}`,
	publicKey: `02${digit.repeat(64)}`,
}));
const oppositeParity = (compressed: string): string => `${compressed.startsWith("02") ? "03" : "02"}${compressed.slice(2)}`;
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

function bid(index: number, amount: number) {
	const privateBidderPath = `m/1/2/3/4/${index}`;
	return {
		auction_id: policy.auctionId,
		bid_id: `bid-${index}`,
		operation_id: `operation-${index}`,
		event_id: String(index).repeat(64),
		actor_id: (index + 4).toString().repeat(64),
		amount,
		bidder_cashu_public_key: `${index % 2 === 0 ? "03" : "02"}${(index + 10).toString(16).padStart(64, "0")}`,
		locktime: 1_900_000_400,
		proof_state_refs: [`02${(index + 20).toString(16).padStart(64, "0")}`],
		displaced_refund_eligible: index === 1,
		seller_child_public_key: deriveSellerChildPubkey(sellerP2pkXpub, privateBidderPath),
	};
}

function history(): DemoCertifiedClosureHistoryBatchV1[] {
	return [
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: network, chain_id: policy.chainId, height: 1, block_time: 1_900_000_010, app_hash: "b".repeat(64), bids: [bid(1, 12)] },
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: network, chain_id: policy.chainId, height: 2, block_time: 1_900_000_020, app_hash: "c".repeat(64), bids: [bid(2, 19)] },
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: network, chain_id: policy.chainId, height: 3, block_time: 1_900_000_030, app_hash: "d".repeat(64), bids: [] },
		{ schema: DEMO_CERTIFIED_CLOSURE_HISTORY_SCHEMA, auth_network_id: network, chain_id: policy.chainId, height: 4, block_time: 1_900_000_040, app_hash: "e".repeat(64), bids: [] },
	];
}

async function payload(batches = history()): Promise<DemoCertifiedClosurePayloadV1> {
	const winner = [...batches.flatMap((batch) => batch.bids)].sort((left, right) => right.amount - left.amount)[0] ?? bid(2, 19);
	return {
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
		outcome: "winner",
		winner_bid_id: winner.bid_id,
		winner_operation_id: winner.operation_id,
		winner_event_id: winner.event_id,
		winner_actor_id: winner.actor_id,
		winner_amount: winner.amount,
		app_hash: batches[3]!.app_hash,
		validator_roster_version: policy.validatorRosterVersion,
		validator_roster: validators.map((item) => ({ validator_id: item.validatorId, public_key: item.publicKey })),
	};
}

async function certificate(batches = history()): Promise<DemoCertifiedClosureCertificateV1> {
	const body = await payload(batches);
	const certificate_digest = await computeCertifiedClosureDigest(body);
	return {
		...body,
		certificate_digest,
		signatures: validators.map((item) => ({ validator_id: item.validatorId, public_key: item.publicKey, signature: certificate_digest.repeat(2) })),
	};
}

function committedHistory(cert: DemoCertifiedClosureCertificateV1, batches = history()): CommittedAuctionBatchV2[] {
	return batches.map((batch) => ({
		schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: batch.auth_network_id,
		chain_id: batch.chain_id, height: batch.height, pbts_seconds: batch.block_time, app_hash: batch.app_hash,
		bids: batch.bids.map((entry) => ({
			actor_id: entry.actor_id, operation_id: entry.operation_id, auction_id: entry.auction_id,
			bid_id: entry.bid_id, event_id: entry.event_id, amount: entry.amount,
			...(entry.displaced_refund_eligible ? {
				displaced_actor_id: entry.actor_id, displaced_operation_id: entry.operation_id,
				displaced_bid_id: entry.bid_id, displaced_event_id: entry.event_id,
			} : {}),
			displaced_refund_eligible: entry.displaced_refund_eligible,
		})),
		closures: batch.height === cert.close_height ? [{
			auth_network_id: cert.auth_network_id, chain_id: cert.chain_id, auction_id: cert.auction_id,
			height: cert.close_height, pbts_seconds: cert.close_time, effective_end: cert.effective_end_time,
			app_hash: cert.app_hash, close_outcome: cert.outcome,
			winner_bid_id: cert.winner_bid_id ?? "", winner_actor_id: cert.winner_actor_id ?? "",
			winner_operation_id: cert.winner_operation_id ?? "", amount: cert.winner_amount ?? 0,
		}] : [],
	}));
}

const verifier = {
	verifyExact(request: { readonly domain: string; readonly digest: string; readonly signature: string }) {
		return request.domain === DEMO_CERTIFIED_CLOSURE_DOMAIN && request.signature === request.digest.repeat(2);
	},
};

async function verify(cert: unknown, batches: readonly unknown[] = history(), selectedPolicy: DemoCertifiedClosurePolicy = policy) {
	return verifyDemoCertifiedClosure({ certificate: cert, history: batches, policy: selectedPolicy, signatureVerifier: verifier });
}

describe("certified closure verification boundary", () => {
	test("strictly decodes the corrected V2 payment commitment boundary", () => {
		const value = {
			schema: "DemoAuthenticatedPaymentCommitmentsV2",
			authNetworkId: network,
			chainId: policy.chainId,
			auctionId: policy.auctionId,
			closureHeight: 4,
			closureAppHash: "e".repeat(64),
			immutableStorageMarker: "immutable-storage-1",
			storageRootSha256: "1".repeat(64),
			operationMembershipSha256: "2".repeat(64),
			operationCount: 2,
			approvalCount: 2,
			canonicalBatchHistorySha256: "3".repeat(64),
			verifiedApprovalSetSha256: "4".repeat(64),
		};
		expect(decodeDemoAuthenticatedPaymentCommitmentsV2(value)).toEqual(value);
		expect(() => decodeDemoAuthenticatedPaymentCommitmentsV2({ ...value, schema: "DemoAuthenticatedPaymentCommitmentsV1" })).toThrow("authenticated-payment-commitments-v2-invalid");
		expect(() => decodeDemoAuthenticatedPaymentCommitmentsV2({ ...value, approvalCount: 1 })).toThrow("authenticated-payment-commitments-v2-invalid");
		expect(() => decodeDemoAuthenticatedPaymentCommitmentsV2({ ...value, unexpected: true })).toThrow("authenticated-payment-commitments-v2-invalid");
	});

	test("accepts exact complete history and four authenticated validator identities", async () => {
		const batches = history();
		const cert = await certificate(batches);
		const result = await verify(cert, batches);
		expect(result.certificateDigest).toBe(cert.certificate_digest);
		expect(result.highestAcceptedBid).toEqual(bid(2, 19));
	});

	test("rejects wrong certificate and policy domains", async () => {
		const cert = await certificate();
		await expect(verify({ ...cert, domain: "another-domain" })).rejects.toThrow("certificate-invalid");
		await expect(verify(cert, history(), { ...policy, chainId: "other-chain" })).rejects.toThrow("domain-mismatch");
		await expect(verify(cert, history(), { ...policy, sellerP2pkXpub: `${policy.sellerP2pkXpub}1` })).rejects.toThrow("domain-mismatch");
	});

	test("rejects enrichment with the bidder-private derivation path", async () => {
		const batches = history();
		const cert = await certificate(batches);
		batches[0] = { ...batches[0]!, bids: [{ ...batches[0]!.bids[0]!, bidder_derivation_path: "m/1/2/3/4/5" }] } as never;
		await expect(verify(cert, batches)).rejects.toThrow("bid-invalid");
	});

	test("rejects missing, duplicate, reordered, or foreign validator identities", async () => {
		const cert = await certificate();
		await expect(verify({ ...cert, signatures: cert.signatures.slice(0, 3) })).rejects.toThrow("four-of-four-required");
		await expect(verify({ ...cert, signatures: [cert.signatures[0]!, cert.signatures[0]!, cert.signatures[2]!, cert.signatures[3]!] })).rejects.toThrow("four-of-four-required");
		await expect(verify({ ...cert, signatures: [cert.signatures[1]!, cert.signatures[0]!, cert.signatures[2]!, cert.signatures[3]!] })).rejects.toThrow("signature-roster-mismatch");
		const foreign = { ...cert.signatures[3]!, validator_id: "validator-9" };
		await expect(verify({ ...cert, signatures: [...cert.signatures.slice(0, 3), foreign] })).rejects.toThrow("signature-roster-mismatch");
		const parityDuplicateSignatures = cert.signatures.map((item, index) => index === 1
			? { ...item, public_key: oppositeParity(cert.signatures[0]!.public_key) }
			: item);
		await expect(verify({ ...cert, signatures: parityDuplicateSignatures })).rejects.toThrow("four-of-four-required");
	});

	test("treats opposite-parity encodings as the same BIP340 validator identity", async () => {
		const cert = await certificate();
		const parityDuplicateRoster = cert.validator_roster.map((item, index) => index === 1
			? { ...item, public_key: oppositeParity(cert.validator_roster[0]!.public_key) }
			: item);
		await expect(verify({ ...cert, validator_roster: parityDuplicateRoster })).rejects.toThrow("four-of-four-required");

		const parityDuplicatePolicy: DemoCertifiedClosurePolicy = {
			...policy,
			validators: policy.validators.map((item, index) => index === 1
				? { ...item, publicKey: oppositeParity(policy.validators[0]!.publicKey) }
				: item),
		};
		await expect(verify(cert, history(), parityDuplicatePolicy)).rejects.toThrow("policy-invalid");
	});

	test("rejects a bad cryptographic signature before returning verified evidence", async () => {
		const cert = await certificate();
		const signatures = cert.signatures.map((item, index) => index === 2 ? { ...item, signature: "0".repeat(128) } : item);
		await expect(verify({ ...cert, signatures })).rejects.toThrow("signature-invalid");
	});

	test("rejects a certificate naming a non-highest winner", async () => {
		const cert = await certificate();
		const lower = bid(1, 12);
		const changed = { ...cert, winner_bid_id: lower.bid_id, winner_operation_id: lower.operation_id, winner_event_id: lower.event_id, winner_actor_id: lower.actor_id, winner_amount: lower.amount };
		await expect(verify(changed)).rejects.toThrow("winner-not-highest");
	});

	test("refuses an ambiguous equal highest amount instead of inventing a tie-break rule", async () => {
		const batches = history();
		batches[0] = { ...batches[0]!, bids: [bid(1, 19)] };
		const cert = await certificate(batches);
		await expect(verify(cert, batches)).rejects.toThrow("winner-ambiguous-highest");
	});

	test("rejects bids at the effective close height or time", async () => {
		const batches = history();
		batches[3] = { ...batches[3]!, bids: [bid(3, 22)] };
		const cert = await certificate(batches);
		await expect(verify(cert, batches)).rejects.toThrow("bid-at-or-after-close");
	});

	test("rejects a bid whose refund locktime does not leave the policy settlement window", async () => {
		const batches = history();
		batches[0] = {
			...batches[0]!,
			bids: [{ ...batches[0]!.bids[0]!, locktime: 1_900_000_339 }],
		};
		await expect(verify(await certificate(batches), batches)).rejects.toThrow("locktime-floor");
	});

	test("anchors the settlement window to certified close time, not only effective end time", async () => {
		const batches = history();
		batches[0] = { ...batches[0]!, bids: [{ ...batches[0]!.bids[0]!, locktime: 1_900_000_345 }] };
		batches[3] = { ...batches[3]!, block_time: 1_900_000_050 };
		const body: DemoCertifiedClosurePayloadV1 = { ...await payload(batches), close_time: 1_900_000_050 };
		const certificate_digest = await computeCertifiedClosureDigest(body);
		const cert: DemoCertifiedClosureCertificateV1 = {
			...body,
			certificate_digest,
			signatures: validators.map((item) => ({ validator_id: item.validatorId, public_key: item.publicKey, signature: certificate_digest.repeat(2) })),
		};
		await expect(verify(cert, batches)).rejects.toThrow("locktime-floor");
	});

	test("rejects proof-state identifiers reused by two bid operations", async () => {
		const batches = history();
		const winnerRef = batches[1]!.bids[0]!.proof_state_refs[0]!;
		batches[0] = {
			...batches[0]!,
			bids: [{ ...batches[0]!.bids[0]!, proof_state_refs: [winnerRef] }],
		};
		await expect(verify(await certificate(batches), batches)).rejects.toThrow("duplicate-deposit");
	});

	test("rejects missing history start and pagination gaps", async () => {
		const cert = await certificate();
		await expect(verify(cert, history().slice(1))).rejects.toThrow("history-start-missing");
		const gapped = history();
		gapped[2] = { ...gapped[2]!, height: 7 };
		await expect(verify(cert, gapped)).rejects.toThrow("history-gap");
	});

	test("rejects history-root and closing app-hash mutations", async () => {
		const cert = await certificate();
		const changed = history();
		changed[0] = { ...changed[0]!, app_hash: "f".repeat(64) };
		await expect(verify(cert, changed)).rejects.toThrow("history-root-mismatch");
		const closeChanged = history();
		closeChanged[3] = { ...closeChanged[3]!, app_hash: "f".repeat(64) };
		await expect(verify(cert, closeChanged)).rejects.toThrow("close-binding-invalid");
	});

	test("enforces no-bids consistency in both directions", async () => {
		const cert = await certificate();
		await expect(verify({ ...cert, outcome: "no_bids", winner_bid_id: null, winner_operation_id: null, winner_event_id: null, winner_actor_id: null, winner_amount: null })).rejects.toThrow("no-bids-inconsistent");
		const empty = history().map((batch) => ({ ...batch, bids: [] }));
		const winnerOnEmpty = await certificate(empty);
		await expect(verify(winnerOnEmpty, empty)).rejects.toThrow("winner-missing");
		const body = await payload(empty);
		const noBidsBody: DemoCertifiedClosurePayloadV1 = { ...body, outcome: "no_bids", winner_bid_id: null, winner_operation_id: null, winner_event_id: null, winner_actor_id: null, winner_amount: null };
		const digest = await computeCertifiedClosureDigest(noBidsBody);
		const noBids: DemoCertifiedClosureCertificateV1 = { ...noBidsBody, certificate_digest: digest, signatures: validators.map((item) => ({ validator_id: item.validatorId, public_key: item.publicKey, signature: digest.repeat(2) })) };
		expect((await verify(noBids, empty)).highestAcceptedBid).toBeNull();
	});

	test("accepts reserve-not-met only with nonempty history and no winner identity", async () => {
		const batches = history();
		const body: DemoCertifiedClosurePayloadV1 = {
			...await payload(batches), outcome: "reserve_not_met",
			winner_bid_id: null, winner_operation_id: null, winner_event_id: null,
			winner_actor_id: null, winner_amount: null,
		};
		const digest = await computeCertifiedClosureDigest(body);
		const cert: DemoCertifiedClosureCertificateV1 = {
			...body, certificate_digest: digest,
			signatures: validators.map((item) => ({ validator_id: item.validatorId, public_key: item.publicKey, signature: digest.repeat(2) })),
		};
		expect((await verify(cert, batches)).highestAcceptedBid).toEqual(bid(2, 19));
		const empty = batches.map((batch) => ({ ...batch, bids: [] }));
		const emptyBody = { ...body, history_root: await computeCertifiedClosureHistoryRoot(empty) };
		const emptyDigest = await computeCertifiedClosureDigest(emptyBody);
		await expect(verify({ ...emptyBody, certificate_digest: emptyDigest, signatures: validators.map((item) => ({ validator_id: item.validatorId, public_key: item.publicKey, signature: emptyDigest.repeat(2) })) }, empty)).rejects.toThrow("reserve-not-met-missing-bid");
	});

	test("rejects schedule drift, digest mutations, and extra schema fields", async () => {
		const cert = await certificate();
		await expect(verify({ ...cert, base_end_time: cert.base_end_time + 1 })).rejects.toThrow("schedule-mismatch");
		await expect(verify({ ...cert, certificate_digest: "0".repeat(64) })).rejects.toThrow("digest-mismatch");
		await expect(verify({ ...cert, unexpected: true })).rejects.toThrow("certificate-invalid");
	});
});

function agreement(): OwnerLocalR4AuthenticatedEvidenceAgreementV1 {
	return {
		schema: "OwnerLocalR4AuthenticatedEvidenceAgreementV1", agreement: true, session_id: "session-1",
		chain_id: policy.chainId, auth_network_id: network, auction_id: policy.auctionId,
		authenticated_genesis_sha256: "8".repeat(64), combined_genesis_sha256: "9".repeat(64),
		target_height: 4, target_block_id: "f".repeat(64), target_app_hash: "e".repeat(64),
		claimed_slots: [1, 2, 3, 4], collector_provenance_verified: false,
		authenticated_run_verified: true, nostr_signatures_verified: true, warning: "test collector claims only",
	};
}

function approvals(batches = history()): DemoPaymentApprovalV1[] {
	return batches.flatMap((batch) => batch.bids).map((entry, index) => ({
		schema: "DemoPaymentApprovalV1", authNetworkId: network, chainId: policy.chainId, auctionId: policy.auctionId,
		operationId: entry.operation_id, bidId: entry.bid_id, bidEventId: entry.event_id, bidderActorId: entry.actor_id,
		amount: entry.amount, mintUrl: "https://mint.invalid", sellerP2pkXpub,
		sellerDerivationPath: `m/1/2/3/4/${index + 1}`, sellerRecipient: entry.seller_child_public_key,
		refundRecipient: entry.actor_id, conditionFingerprint: `${index + 7}`.repeat(64),
		winnerPackageDigest: (index === 0 ? "a" : "c").repeat(64), refundPackageDigest: (index === 0 ? "b" : "d").repeat(64),
		approvalCreatedAt: 1_900_000_010 + index, approvalEventId: `${index + 7}`.repeat(64), approvalSignature: "c".repeat(128),
	}));
}

async function authenticatedHandoff(overrides: Partial<Parameters<typeof verifyDemoAuthenticatedHandoff>[0]> = {}) {
	const batches = history();
	const cert = await certificate(batches);
	const approvalValues = approvals(batches);
	return verifyDemoAuthenticatedHandoff({
		certificate: cert, history: batches, policy, signatureVerifier: verifier,
		agreement: agreement(), agreementVerifier: { verifyExact: () => true },
		signedEventSource: { async readExact(query) {
			const approval = approvalValues.find((item) => item.operationId === query.operationId);
			return approval === undefined ? null : { pubkey: query.actorId, created_at: approval.approvalCreatedAt, kind: 28642, tags: [], content: "{}", id: query.eventId, sig: "d".repeat(128) };
		} },
		committedBatches: committedHistory(cert, batches),
		paymentApprovals: approvalValues, paymentApprovalVerifier: { verifyExact: () => true },
		paymentApprovalLifetimeVerifier: { verifyExact: () => true },
		...overrides,
	});
}

describe("authenticated application handoff", () => {
	test("uses the frozen Go/TypeScript commitment vectors", async () => {
		expect(canonicalUtf8Json({ value: "&<>\"\\\u2028\u2029" })).toBe(`{"value":"&<>\\"\\\\\\u2028\\u2029"}`);
		expect(canonicalUtf8Json({ value: "\ud800" })).toBe(canonicalUtf8Json({ value: "\ufffd" }));
		expect(canonicalUtf8Json({ value: "\udc00" })).toBe(canonicalUtf8Json({ value: "\ufffd" }));
		expect(canonicalUtf8Json({ value: "\ud83d\ude00" })).toBe('{"value":"😀"}');
		expect(canonicalUtf8Json({ value: "\ud83d\ude00" })).not.toBe(canonicalUtf8Json({ value: "\ufffd" }));
		const batches = [{
			schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: "a".repeat(64),
			chain_id: "chain", height: 1, pbts_seconds: 10, app_hash: "b".repeat(64), bids: [],
			closures: [{ auth_network_id: "a".repeat(64), chain_id: "chain", auction_id: "auction", height: 1, pbts_seconds: 10, effective_end: 10, app_hash: "b".repeat(64), close_outcome: "no_bids", winner_bid_id: "", winner_actor_id: "", winner_operation_id: "", amount: 0 }],
		}] as const;
		expect(await computeCommittedAuctionBatchHistorySha256(batches)).toBe("ec2e8619dc571e6e194062c28ba29622b8e2250856fa59e654458bebeebebd5d");
		expect(await computeDemoPaymentApprovalSetSha256([])).toBe("4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
		await expect(computeDemoPaymentApprovalSetSha256(null as never)).rejects.toThrow("payment-approval-invalid");
		const approval = {
			schema: "DemoPaymentApprovalV1", authNetworkId: "a".repeat(64), chainId: "chain", auctionId: "auction",
			operationId: "operation", bidId: "bid", bidEventId: "b".repeat(64), bidderActorId: "c".repeat(64), amount: 13,
			mintUrl: "https://mint.invalid", sellerP2pkXpub: "xpub", sellerDerivationPath: "m/1/2/3/4/5",
			sellerRecipient: `02${"d".repeat(64)}`, refundRecipient: "c".repeat(64), conditionFingerprint: "e".repeat(64),
			winnerPackageDigest: "f".repeat(64), refundPackageDigest: "1".repeat(64), approvalCreatedAt: 10,
			approvalEventId: "2".repeat(64), approvalSignature: "3".repeat(128),
		} as const;
		expect(await computeDemoPaymentApprovalSetSha256([approval])).toBe("2fa364730573ff4f5bf85ab13deed30d4f6a452c0ab290bf54f98f7045ad9d7a");

		const networkId = "a".repeat(64); const appHash = "b".repeat(64);
		const actor1 = "c".repeat(64); const event1 = "d".repeat(64);
		const actor2 = "e".repeat(64); const event2 = "f".repeat(64);
		const chainId = "Chain&<>\"\\Case-Z_!";
		const winnerAuction = "auction-&-winner"; const noBidsAuction = "auction-<-no_bids"; const reserveAuction = "auction->-reserve";
		const complexBatches = [{
			schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: networkId,
			chain_id: chainId, height: 1, pbts_seconds: 10, app_hash: appHash,
			bids: [
				{ actor_id: actor1, operation_id: "Op-Z&<>\"\\!", auction_id: winnerAuction, bid_id: "Bid-Z\"\\<>", event_id: event1, amount: 13, displaced_refund_eligible: false },
				{ actor_id: actor2, operation_id: "op/a?Case", auction_id: reserveAuction, bid_id: "bid_2", event_id: event2, amount: 7, displaced_refund_eligible: false },
			],
			closures: [
				{ auth_network_id: networkId, chain_id: chainId, auction_id: winnerAuction, height: 1, pbts_seconds: 10, effective_end: 10, app_hash: appHash, close_outcome: "winner", winner_bid_id: "Bid-Z\"\\<>", winner_actor_id: actor1, winner_operation_id: "Op-Z&<>\"\\!", amount: 13 },
				{ auth_network_id: networkId, chain_id: chainId, auction_id: noBidsAuction, height: 1, pbts_seconds: 10, effective_end: 10, app_hash: appHash, close_outcome: "no_bids", winner_bid_id: "", winner_actor_id: "", winner_operation_id: "", amount: 0 },
				{ auth_network_id: networkId, chain_id: chainId, auction_id: reserveAuction, height: 1, pbts_seconds: 10, effective_end: 10, app_hash: appHash, close_outcome: "reserve_not_met", winner_bid_id: "", winner_actor_id: "", winner_operation_id: "", amount: 0 },
			],
		}] as const;
		expect(await computeCommittedAuctionBatchHistorySha256(complexBatches)).toBe("eb1f649a897e3978fefe0e4fbc0f89f9e993cd99325db6c173d699ef83f37aac");
		const complexApproval = (index: number, operationId: string, bidId: string, bidEventId: string, bidderActorId: string) => ({
			schema: "DemoPaymentApprovalV1" as const, authNetworkId: networkId, chainId, auctionId: winnerAuction,
			operationId, bidId, bidEventId, bidderActorId, amount: 10 + index,
			mintUrl: "https://mint.invalid/a?x=&<>\"\\", sellerP2pkXpub: "xpub&<>\"\\Case", sellerDerivationPath: `m/1/2/3/4/${index}`,
			sellerRecipient: `02${String(index).repeat(64)}`, refundRecipient: bidderActorId,
			conditionFingerprint: String(index + 1).repeat(64), winnerPackageDigest: String(index + 2).repeat(64), refundPackageDigest: String(index + 3).repeat(64),
			approvalCreatedAt: 10 + index, approvalEventId: String(index + 4).repeat(64), approvalSignature: String(index + 5).repeat(128),
		});
		const complexApprovals = [
			complexApproval(3, "op/case", "bid/3", "3".repeat(64), "6".repeat(64)),
			complexApproval(1, "Op-Z&<>\"\\!", "Bid-Z\"\\<>", event1, actor1),
			complexApproval(2, "op!case", "bid!2", "2".repeat(64), "5".repeat(64)),
		];
		expect(await computeDemoPaymentApprovalSetSha256(complexApprovals)).toBe("94b358f062a9a2ff39289b00cd4cb94c04e77dd6151ffbf8c4986264d5b4b533");
		expect(["op/case", "Op-Z&<>\"\\!", "op!case"].sort(compareUtf8Bytes)).toEqual(["Op-Z&<>\"\\!", "op!case", "op/case"]);
	});

	test("requires four-slot successor evidence, every raw event, and every bidder payment approval", async () => {
		const result = await authenticatedHandoff();
		expect(result.agreement.claimed_slots).toEqual([1, 2, 3, 4]);
		expect(result.rawSignedEventsVerified).toBe(2);
		expect(result.bidderPaymentApprovalsVerified).toBe(2);
		expect(result.paymentCommitments.schema).toBe("DemoAuthenticatedPaymentCommitmentsV1");
		expect(result.paymentCommitments.canonicalBatchHistorySha256).toMatch(/^[0-9a-f]{64}$/);
		expect(result.paymentCommitments.verifiedApprovalSetSha256).toMatch(/^[0-9a-f]{64}$/);
		expect(result.approvalLifetimePolicyVerified).toBeTrue();
		expect(result.paymentExecutionVerified).toBeFalse();
		expect(result.settlementVerified).toBeFalse();
	});

	test("fails closed without an accepted payment-approval lifetime verifier", async () => {
		await expect(authenticatedHandoff({ paymentApprovalLifetimeVerifier: { verifyExact: () => false } })).rejects.toThrow("payment-approval-lifetime-unverified");
	});

	test("same-count approval substitution changes the verified approval-set commitment", async () => {
		const exact = approvals();
		const substituted = exact.map((item, index) => ({
			...item,
			winnerPackageDigest: exact[1 - index]!.winnerPackageDigest,
			refundPackageDigest: exact[1 - index]!.refundPackageDigest,
		}));
		expect(await computeDemoPaymentApprovalSetSha256(substituted)).not.toBe(await computeDemoPaymentApprovalSetSha256(exact));
	});

	test("fails closed on missing or conflicting consensus and raw-event evidence", async () => {
		await expect(authenticatedHandoff({ agreement: { ...agreement(), target_app_hash: "0".repeat(64) } })).rejects.toThrow("agreement-conflict");
		await expect(authenticatedHandoff({ agreementVerifier: { verifyExact: () => false } })).rejects.toThrow("agreement-unverified");
		await expect(authenticatedHandoff({ signedEventSource: { async readExact() { return null; } } })).rejects.toThrow("signed-event-missing");
		await expect(authenticatedHandoff({ signedEventSource: { async readExact() { throw new Error("raw-event-conflict"); } } })).rejects.toThrow("raw-event-conflict");
	});

	test("rejects a same-count swapped losing-bid history behind a stale handoff", async () => {
		const batches = history();
		const cert = await certificate(batches);
		const committed = committedHistory(cert, batches);
		committed[0] = { ...committed[0]!, bids: committed[0]!.bids.map((entry) => ({ ...entry, amount: entry.amount + 1 })) };
		await expect(authenticatedHandoff({ committedBatches: committed })).rejects.toThrow("committed-history-conflict");
	});

	test("fails closed on missing, conflicting, or unverified payment approvals", async () => {
		await expect(authenticatedHandoff({ paymentApprovals: approvals().slice(0, 1) })).rejects.toThrow("payment-approval-missing");
		const conflict = approvals(); conflict[0] = { ...conflict[0]!, amount: conflict[0]!.amount + 1 };
		await expect(authenticatedHandoff({ paymentApprovals: conflict })).rejects.toThrow("payment-approval-conflict");
		await expect(authenticatedHandoff({ paymentApprovalVerifier: { verifyExact: () => false } })).rejects.toThrow("payment-approval-unverified");
		const timestamp = approvals(); timestamp[0] = { ...timestamp[0]!, approvalCreatedAt: timestamp[0]!.approvalCreatedAt + 1 };
		await expect(authenticatedHandoff({ paymentApprovals: timestamp })).rejects.toThrow("payment-approval-timestamp-conflict");
	});

	test("fails closed when a closure identity is missing or conflicts with history", async () => {
		await expect(authenticatedHandoff({ certificate: undefined })).rejects.toThrow("certificate-invalid");
		const cert = await certificate();
		await expect(authenticatedHandoff({ certificate: { ...cert, app_hash: "0".repeat(64) } })).rejects.toThrow("close-binding-invalid");
	});
});
