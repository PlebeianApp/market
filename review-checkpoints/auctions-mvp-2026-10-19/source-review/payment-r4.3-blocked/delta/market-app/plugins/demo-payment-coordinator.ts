/**
 * TEST ONLY payment coordination for the authenticated auction demo.
 *
 * Legacy bidder-approval persistence remains for the demo shell, but execution now requires the
 * accepted portable-consensus handoff and delegates to the durable whole-device-offline executor.
 * Validator shares, nonce state, Cashu bearer material, recipient openings, and mint recovery stay
 * behind injected ports. This module is not evidence of a live mint, DKG ceremony, or deployment.
 */
import { decodeCommittedBidBatch, type CommittedAuctionBatchV2, type CommittedAutomaticCloseEntryV2, type CommittedBidEntryV1 } from "./committed-bid-consumer.ts";
import type { DemoAuthUiConfig, DemoSignedEvent, DemoUnsignedEvent } from "../ts/demo-auth-bid.ts";
import { parseStrictJSON, verifySignedBidTemplate } from "../ts/demo-auth-bid.ts";
import type { DemoBidIntentRecord } from "./demo-auth-bid-store.ts";
import { verifyDemoAuthEventId } from "../../cashu-wrapper/ts/index.ts";
import { deriveSellerChildPubkey } from "../../cashu-wrapper/ts/seller-child.ts";
import {
	demoMaintainerFederationSessionId,
	type DemoMaintainerOfflineIdentity,
	type DemoMaintainerExpectedDisposition,
	type DemoMaintainerOfflineExecutionResult,
	type DemoMaintainerOfflineRecoveryResult,
} from "../../cashu-wrapper/ts/demo-maintainer-offline.ts";

export const DEMO_PAYMENT_APPROVAL_SCHEMA = "DemoPaymentApprovalV1" as const;
export const DEMO_PAYMENT_RECEIPT_SCHEMA = "DemoFakeEcashReceiptV1" as const;
export const DEMO_PAYMENT_APPROVAL_KIND = 28643;
export const DEMO_PAYMENT_CONSENSUS_HANDOFF_SCHEMA = "CocoDemoPaymentConsensusHandoffV1" as const;
export const DEMO_PAYMENT_CONSENSUS_RECEIPT_SCHEMA = "CocoDemoVerifiedConsensusReceiptV1" as const;
export const DEMO_PAYMENT_POST_LOCKTIME_RACE = "mint-first-spend-remains-authoritative" as const;
export const DEMO_PAYMENT_MAX_BATCH_UTF8_BYTES = 64 * 1024;
export const DEMO_PAYMENT_MAX_HANDOFF_UTF8_BYTES = 4 * 1024 * 1024;

const STORE_SCHEMA = "DemoPaymentStoreV1";
const STORE_KEY = "plebeian-market.demo-payments.v1";
const STORE_LOCK = "plebeian-market:demo-payments:v1:mutation";
const EXECUTION_LOCK = "plebeian-market:demo-payments:v1:execution";
const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;
const PRINTABLE_ASCII_TEXT = /^[\x21-\x7e]{1,160}$/;
const VERIFIED_SELLER_BINDINGS = new Set<string>();

export type DemoPaymentRole = "winner_settlement" | "refund";

export interface DemoPaymentApprovalV1 {
	readonly schema: typeof DEMO_PAYMENT_APPROVAL_SCHEMA;
	readonly authNetworkId: string;
	readonly chainId: string;
	readonly auctionId: string;
	readonly operationId: string;
	readonly bidId: string;
	readonly bidEventId: string;
	readonly bidderActorId: string;
	readonly amount: number;
	readonly mintUrl: string;
	readonly sellerP2pkXpub: string;
	readonly sellerDerivationPath: string;
	readonly sellerRecipient: string;
	readonly refundRecipient: string;
	readonly conditionFingerprint: string;
	readonly winnerPackageDigest: string;
	readonly refundPackageDigest: string;
	readonly approvalCreatedAt: number;
	readonly approvalEventId: string;
	readonly approvalSignature: string;
}

export interface DemoPaymentCommittedBid {
	readonly authNetworkId: string;
	readonly chainId: string;
	readonly auctionId: string;
	readonly operationId: string;
	readonly bidId: string;
	readonly eventId: string;
	readonly actorId: string;
	readonly amount: number;
	readonly committedHeight: number;
}

export interface DemoPaymentAuthority {
	readonly auctionKey: string;
	readonly closureRoot: string;
}

export interface DemoPaymentOperation {
	readonly operationKey: string;
	readonly closureRoot: string;
	readonly operationId: string;
	readonly role: DemoPaymentRole;
	readonly packageDigest: string;
	readonly outcomeDigest: string;
	readonly state: "pending" | "terminal";
	readonly receipt?: DemoFakeEcashReceiptV1;
}

export interface DemoFakeEcashReceiptV1 {
	readonly schema: typeof DEMO_PAYMENT_RECEIPT_SCHEMA;
	readonly operationKey: string;
	readonly closureRoot: string;
	readonly operationId: string;
	readonly role: DemoPaymentRole;
	readonly packageDigest: string;
	readonly outcomeDigest: string;
	readonly amount: number;
	readonly recipient: string;
	readonly receiptId: string;
}

interface DemoPaymentEnvelope {
	readonly schema: typeof STORE_SCHEMA;
	readonly approvals: readonly DemoPaymentApprovalV1[];
	readonly committed: readonly DemoPaymentCommittedBid[];
	readonly authorities: readonly DemoPaymentAuthority[];
	readonly operations: readonly DemoPaymentOperation[];
}

interface StoredEnvelope extends DemoPaymentEnvelope { readonly checksum: string; }

export interface DemoPaymentStorageArea {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface DemoPaymentLockManager {
	request<T>(name: string, options: { readonly mode: "exclusive" }, callback: () => Promise<T>): Promise<T>;
}

export interface DemoPaymentPersistence {
	saveApproval(approval: DemoPaymentApprovalV1): Promise<void>;
	readApproval(scope: DemoPaymentScope & { readonly operationId: string }): Promise<DemoPaymentApprovalV1 | null>;
	listApprovals(scope: DemoPaymentScope): Promise<readonly DemoPaymentApprovalV1[]>;
	observeCommittedBid(bid: DemoPaymentCommittedBid): Promise<void>;
	listCommittedBids(scope: DemoPaymentScope): Promise<readonly DemoPaymentCommittedBid[]>;
	claimClosure(authority: DemoPaymentAuthority): Promise<void>;
	claimOperation(operation: DemoPaymentOperation): Promise<DemoPaymentOperation>;
	completeOperation(operationKey: string, receipt: DemoFakeEcashReceiptV1): Promise<void>;
	readOperation(operationKey: string): Promise<DemoPaymentOperation | null>;
	withExecutionLock<T>(callback: () => Promise<T>): Promise<T>;
}

export interface DemoPaymentScope {
	readonly authNetworkId: string;
	readonly chainId: string;
	readonly auctionId: string;
}

export interface DemoPaymentSigner {
	signEvent(event: DemoUnsignedEvent): Promise<DemoSignedEvent>;
}

export interface DemoPaymentCoordinatorConfig extends DemoPaymentScope {}

/** Exact public bytes only. Portable Comet evidence remains behind the separately injected verifier. */
export interface DemoPaymentConsensusHandoff {
	readonly schema: typeof DEMO_PAYMENT_CONSENSUS_HANDOFF_SCHEMA;
	readonly authNetworkId: string;
	readonly chainId: string;
	readonly closureHeight: number;
	readonly canonicalBatchBytes: readonly string[];
}

export interface DemoPaymentVerifiedConsensusReceipt {
	readonly schema: typeof DEMO_PAYMENT_CONSENSUS_RECEIPT_SCHEMA;
	readonly authNetworkId: string;
	readonly chainId: string;
	readonly authenticatedStartHeight: 1;
	readonly authenticatedThroughHeight: number;
	readonly canonicalSuccessorCommitHeight: number;
	readonly successorObservedHeight: number;
	readonly canonicalBatchSetDigest: string;
	readonly evidenceDigest: string;
}

/** Must independently verify portable blocks 1..H+1 and obtain H+1's canonical commit after H+2. */
export interface DemoPaymentConsensusEvidencePort {
	verifyExact(request: {
		readonly authNetworkId: string;
		readonly chainId: string;
		readonly closureHeight: number;
		readonly canonicalBatchBytes: readonly string[];
		readonly canonicalBatchSetDigest: string;
	}): Promise<DemoPaymentVerifiedConsensusReceipt | null>;
}

/** Resolves the raw kind-28642 event; no reserialized event or approval surrogate is accepted. */
export interface DemoPaymentRawSignedBidPort {
	readExact(request: {
		readonly authNetworkId: string;
		readonly chainId: string;
		readonly auctionId: string;
		readonly operationId: string;
		readonly bidId: string;
		readonly eventId: string;
		readonly actorId: string;
		readonly amount: number;
	}): Promise<DemoSignedEvent | null>;
}

export interface DemoPaymentOfflineIdentityPort {
	readExact(request: {
		readonly authNetworkId: string;
		readonly chainId: string;
		readonly auctionId: string;
		readonly operationId: string;
		readonly bidId: string;
		readonly eventId: string;
		readonly actorId: string;
		readonly amount: number;
		readonly expectedRole: DemoPaymentRole;
		readonly closureHeight: number;
		readonly closureAppHash: string;
		readonly consensusEvidenceDigest: string;
	}): Promise<DemoMaintainerOfflineIdentity | null>;
}

/** `createDemoMaintainerOfflineExecutor` implements this over the threshold-three federation port. */
export interface DemoPaymentOfflineExecutorPort {
	executeExact(identity: DemoMaintainerOfflineIdentity, expected: DemoMaintainerExpectedDisposition): Promise<DemoMaintainerOfflineExecutionResult>;
	recoverExact(identity: DemoMaintainerOfflineIdentity, expected: DemoMaintainerExpectedDisposition): Promise<DemoMaintainerOfflineRecoveryResult>;
}

export interface DemoPaymentPendingDisposition {
	readonly operationId: string;
	readonly role: "refund";
	readonly status: "refund_not_yet_eligible";
	readonly eligibleAt: number;
}

export interface DemoPaymentBatchResult {
	readonly paid: readonly string[];
	readonly refunded: readonly string[];
	readonly pendingDispositions: readonly DemoPaymentPendingDisposition[];
	readonly pendingRecovery: readonly { readonly operationId: string; readonly status: string }[];
	readonly consensusEvidenceDigest: string;
	/** Explicit non-claim: delayed MAIN and post-locktime REFUND remain competing valid spends. */
	readonly postLocktimeRace: typeof DEMO_PAYMENT_POST_LOCKTIME_RACE;
}

export interface DemoPaymentVerifiedConsensusHandoff {
	readonly handoff: DemoPaymentConsensusHandoff;
	readonly batches: readonly CommittedAuctionBatchV2[];
	readonly closureBatch: CommittedAuctionBatchV2;
	readonly closure: CommittedAutomaticCloseEntryV2;
	readonly receipt: DemoPaymentVerifiedConsensusReceipt;
	readonly canonicalBatchSetDigest: string;
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function assertSellerBinding(xpub: string, path: string, recipient: string): void {
	const key = JSON.stringify([xpub, path, recipient]);
	if (VERIFIED_SELLER_BINDINGS.has(key)) return;
	let derived: string;
	try { derived = deriveSellerChildPubkey(xpub, path); } catch { throw new Error("demo-payment-seller-binding-invalid"); }
	if (derived !== recipient) throw new Error("demo-payment-seller-binding-invalid");
	VERIFIED_SELLER_BINDINGS.add(key);
}

function canonicalApproval(approval: DemoPaymentApprovalV1): DemoPaymentApprovalV1 {
	const keys = ["schema", "authNetworkId", "chainId", "auctionId", "operationId", "bidId", "bidEventId", "bidderActorId", "amount", "mintUrl", "sellerP2pkXpub", "sellerDerivationPath", "sellerRecipient", "refundRecipient", "conditionFingerprint", "winnerPackageDigest", "refundPackageDigest", "approvalCreatedAt", "approvalEventId", "approvalSignature"];
	if (!exactObject(approval, keys) || approval.schema !== DEMO_PAYMENT_APPROVAL_SCHEMA || typeof approval.authNetworkId !== "string" || !HEX_64.test(approval.authNetworkId) || typeof approval.bidEventId !== "string" || !HEX_64.test(approval.bidEventId) || typeof approval.bidderActorId !== "string" || !HEX_64.test(approval.bidderActorId) || typeof approval.conditionFingerprint !== "string" || !HEX_64.test(approval.conditionFingerprint) || typeof approval.winnerPackageDigest !== "string" || !HEX_64.test(approval.winnerPackageDigest) || typeof approval.refundPackageDigest !== "string" || !HEX_64.test(approval.refundPackageDigest) || typeof approval.approvalEventId !== "string" || !HEX_64.test(approval.approvalEventId) || typeof approval.approvalSignature !== "string" || !HEX_128.test(approval.approvalSignature) || !Number.isSafeInteger(approval.approvalCreatedAt) || approval.approvalCreatedAt < 1 || !Number.isSafeInteger(approval.amount) || approval.amount < 1 || [approval.chainId, approval.auctionId, approval.operationId, approval.bidId, approval.mintUrl, approval.sellerP2pkXpub, approval.sellerDerivationPath, approval.sellerRecipient, approval.refundRecipient].some((value) => typeof value !== "string" || value.length === 0 || value.trim() !== value)) throw new Error("demo-payment-approval-invalid");
	assertSellerBinding(approval.sellerP2pkXpub, approval.sellerDerivationPath, approval.sellerRecipient);
	if (approval.refundRecipient !== approval.bidderActorId) throw new Error("demo-payment-refund-binding-invalid");
	if (!verifyDemoAuthEventId(approval.approvalSignature, approval.approvalEventId, approval.bidderActorId)) throw new Error("demo-payment-approval-signature-invalid");
	return { ...approval };
}

function approvalUnsigned(approval: DemoPaymentApprovalV1): DemoUnsignedEvent {
	const content = JSON.stringify({ schema: DEMO_PAYMENT_APPROVAL_SCHEMA, auth_network_id: approval.authNetworkId, chain_id: approval.chainId, auction_id: approval.auctionId, operation_id: approval.operationId, bid_id: approval.bidId, bid_event_id: approval.bidEventId, amount: approval.amount, mint_url: approval.mintUrl, seller_p2pk_xpub: approval.sellerP2pkXpub, seller_derivation_path: approval.sellerDerivationPath, seller_recipient: approval.sellerRecipient, refund_recipient: approval.refundRecipient, condition_fingerprint: approval.conditionFingerprint, winner_package_digest: approval.winnerPackageDigest, refund_package_digest: approval.refundPackageDigest });
	return { pubkey: approval.bidderActorId, created_at: approval.approvalCreatedAt, kind: DEMO_PAYMENT_APPROVAL_KIND, tags: [["protocol", "plebeian-auction-fake-ecash-payment"], ["version", "1"], ["environment", approval.authNetworkId], ["bid_event", approval.bidEventId]], content };
}

/**
 * New V1 approvals must use the same printable-ASCII grammar as the certified handoff.
 * This is deliberately a creation-time gate: historical V1 signed bytes retain their existing
 * parser and verification semantics and are never normalized or reserialized.
 */
function assertNewApprovalPrintableAscii(values: readonly string[]): void {
	if (values.some((value) => !PRINTABLE_ASCII_TEXT.test(value))) {
		throw new Error("demo-payment-approval-text-invalid");
	}
}

async function validateApprovalBinding(approval: DemoPaymentApprovalV1): Promise<void> {
	await verifySignedBidTemplate(approvalUnsigned(approval), { ...approvalUnsigned(approval), id: approval.approvalEventId, sig: approval.approvalSignature });
}

function canonicalCommitted(bid: DemoPaymentCommittedBid): DemoPaymentCommittedBid {
	const keys = ["authNetworkId", "chainId", "auctionId", "operationId", "bidId", "eventId", "actorId", "amount", "committedHeight"];
	if (!exactObject(bid, keys) || typeof bid.authNetworkId !== "string" || !HEX_64.test(bid.authNetworkId) || typeof bid.eventId !== "string" || !HEX_64.test(bid.eventId) || typeof bid.actorId !== "string" || !HEX_64.test(bid.actorId) || !Number.isSafeInteger(bid.amount) || bid.amount < 1 || !Number.isSafeInteger(bid.committedHeight) || bid.committedHeight < 1 || [bid.chainId, bid.auctionId, bid.operationId, bid.bidId].some((value) => typeof value !== "string" || value.length === 0 || value.trim() !== value)) throw new Error("demo-payment-committed-bid-invalid");
	return { ...bid };
}

function canonicalAuthority(authority: DemoPaymentAuthority): DemoPaymentAuthority {
	if (!exactObject(authority, ["auctionKey", "closureRoot"]) || typeof authority.auctionKey !== "string" || authority.auctionKey.length === 0 || !HEX_64.test(authority.closureRoot)) throw new Error("demo-payment-store-corrupt");
	return { ...authority };
}

function canonicalReceipt(receipt: DemoFakeEcashReceiptV1): DemoFakeEcashReceiptV1 {
	const keys = ["schema", "operationKey", "closureRoot", "operationId", "role", "packageDigest", "outcomeDigest", "amount", "recipient", "receiptId"];
	if (!exactObject(receipt, keys) || receipt.schema !== DEMO_PAYMENT_RECEIPT_SCHEMA || !["winner_settlement", "refund"].includes(receipt.role) || !HEX_64.test(receipt.closureRoot) || !HEX_64.test(receipt.packageDigest) || !HEX_64.test(receipt.outcomeDigest) || !HEX_64.test(receipt.receiptId) || !Number.isSafeInteger(receipt.amount) || receipt.amount < 1 || [receipt.operationKey, receipt.operationId, receipt.recipient].some((value) => typeof value !== "string" || value.length === 0)) throw new Error("demo-payment-receipt-invalid");
	return { ...receipt };
}

function canonicalOperation(operation: DemoPaymentOperation): DemoPaymentOperation {
	const keys = operation.receipt === undefined ? ["operationKey", "closureRoot", "operationId", "role", "packageDigest", "outcomeDigest", "state"] : ["operationKey", "closureRoot", "operationId", "role", "packageDigest", "outcomeDigest", "state", "receipt"];
	if (!exactObject(operation, keys) || !["winner_settlement", "refund"].includes(operation.role) || typeof operation.closureRoot !== "string" || !HEX_64.test(operation.closureRoot) || typeof operation.packageDigest !== "string" || !HEX_64.test(operation.packageDigest) || typeof operation.outcomeDigest !== "string" || !HEX_64.test(operation.outcomeDigest) || !["pending", "terminal"].includes(operation.state) || typeof operation.operationKey !== "string" || operation.operationKey.length === 0 || typeof operation.operationId !== "string" || operation.operationId.length === 0 || (operation.state === "terminal") !== (operation.receipt !== undefined)) throw new Error("demo-payment-store-corrupt");
	if (operation.receipt !== undefined) {
		const receipt = canonicalReceipt(operation.receipt);
		if (receipt.operationKey !== operation.operationKey || receipt.closureRoot !== operation.closureRoot || receipt.operationId !== operation.operationId || receipt.role !== operation.role || receipt.packageDigest !== operation.packageDigest || receipt.outcomeDigest !== operation.outcomeDigest) throw new Error("demo-payment-store-corrupt");
		return { ...operation, receipt };
	}
	return { ...operation };
}

function approvalKey(value: Pick<DemoPaymentApprovalV1, "authNetworkId" | "chainId" | "auctionId" | "operationId">): string { return JSON.stringify([value.authNetworkId, value.chainId, value.auctionId, value.operationId]); }
function committedKey(value: Pick<DemoPaymentCommittedBid, "authNetworkId" | "chainId" | "auctionId" | "operationId">): string { return JSON.stringify([value.authNetworkId, value.chainId, value.auctionId, value.operationId]); }
function emptyEnvelope(): DemoPaymentEnvelope { return { schema: STORE_SCHEMA, approvals: [], committed: [], authorities: [], operations: [] }; }
function body(envelope: DemoPaymentEnvelope): string { return JSON.stringify(envelope); }
async function sha256Hex(value: string): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

function browserArea(injected?: DemoPaymentStorageArea): DemoPaymentStorageArea {
	if (injected !== undefined) return injected;
	const area = (globalThis as unknown as { localStorage?: DemoPaymentStorageArea }).localStorage;
	if (area === undefined) throw new Error("demo-payment-durable-storage-unavailable");
	return area;
}

function browserLocks(injected?: DemoPaymentLockManager): DemoPaymentLockManager {
	if (injected !== undefined) return injected;
	const locks = (globalThis as unknown as { navigator?: { locks?: DemoPaymentLockManager } }).navigator?.locks;
	if (locks === undefined || typeof locks.request !== "function") throw new Error("demo-payment-durable-synchronization-unavailable");
	return { request: (name, options, callback) => locks.request(name, options, callback) };
}

async function readEnvelope(area: DemoPaymentStorageArea): Promise<DemoPaymentEnvelope> {
	const raw = area.getItem(STORE_KEY);
	if (raw === null) return emptyEnvelope();
	let value: unknown;
	try { value = parseStrictJSON(raw); } catch { throw new Error("demo-payment-store-corrupt"); }
	const keys = ["schema", "approvals", "committed", "authorities", "operations", "checksum"];
	if (!exactObject(value, keys) || value.schema !== STORE_SCHEMA || !Array.isArray(value.approvals) || !Array.isArray(value.committed) || !Array.isArray(value.authorities) || !Array.isArray(value.operations) || typeof value.checksum !== "string" || !HEX_64.test(value.checksum)) throw new Error("demo-payment-store-corrupt");
	const envelope: DemoPaymentEnvelope = { schema: STORE_SCHEMA, approvals: value.approvals.map((item) => canonicalApproval(item as DemoPaymentApprovalV1)), committed: value.committed.map((item) => canonicalCommitted(item as DemoPaymentCommittedBid)), authorities: value.authorities.map((item) => canonicalAuthority(item as DemoPaymentAuthority)), operations: value.operations.map((item) => canonicalOperation(item as DemoPaymentOperation)) };
	for (const approval of envelope.approvals) await validateApprovalBinding(approval);
	if (await sha256Hex(body(envelope)) !== value.checksum || new Set(envelope.approvals.map(approvalKey)).size !== envelope.approvals.length || new Set(envelope.committed.map(committedKey)).size !== envelope.committed.length || new Set(envelope.authorities.map((item) => item.auctionKey)).size !== envelope.authorities.length || new Set(envelope.operations.map((item) => item.operationKey)).size !== envelope.operations.length) throw new Error("demo-payment-store-corrupt");
	return envelope;
}

async function writeEnvelope(area: DemoPaymentStorageArea, envelope: DemoPaymentEnvelope): Promise<void> {
	const encoded = JSON.stringify({ ...envelope, checksum: await sha256Hex(body(envelope)) } satisfies StoredEnvelope);
	try { area.setItem(STORE_KEY, encoded); if (area.getItem(STORE_KEY) !== encoded) throw undefined; } catch { throw new Error("demo-payment-store-write-failed"); }
}

/** One fixed origin-wide root: callers cannot choose an alternate authority namespace. */
export function createBrowserDemoPaymentPersistence(options: { readonly localStorage?: DemoPaymentStorageArea; readonly lockManager?: DemoPaymentLockManager } = {}): DemoPaymentPersistence {
	const area = browserArea(options.localStorage);
	const locks = browserLocks(options.lockManager);
	const mutate = <T>(callback: (current: DemoPaymentEnvelope) => Promise<{ readonly next: DemoPaymentEnvelope; readonly result: T }>): Promise<T> => locks.request(STORE_LOCK, { mode: "exclusive" }, async () => { const current = await readEnvelope(area); const { next, result } = await callback(current); await writeEnvelope(area, next); return result; });
	return {
		async saveApproval(candidate) {
			const approval = canonicalApproval(candidate);
			await validateApprovalBinding(approval);
			await mutate(async (current) => { const prior = current.approvals.find((item) => approvalKey(item) === approvalKey(approval)); if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(approval)) throw new Error("demo-payment-approval-conflict"); return { next: prior === undefined ? { ...current, approvals: [...current.approvals, approval] } : current, result: undefined }; });
		},
		async readApproval(scope) { return (await readEnvelope(area)).approvals.find((item) => item.authNetworkId === scope.authNetworkId && item.chainId === scope.chainId && item.auctionId === scope.auctionId && item.operationId === scope.operationId) ?? null; },
		async listApprovals(scope) { return (await readEnvelope(area)).approvals.filter((item) => item.authNetworkId === scope.authNetworkId && item.chainId === scope.chainId && item.auctionId === scope.auctionId); },
		async observeCommittedBid(candidate) {
			const bid = canonicalCommitted(candidate);
			await mutate(async (current) => { const prior = current.committed.find((item) => committedKey(item) === committedKey(bid)); if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(bid)) throw new Error("demo-payment-committed-bid-conflict"); return { next: prior === undefined ? { ...current, committed: [...current.committed, bid] } : current, result: undefined }; });
		},
		async listCommittedBids(scope) { return (await readEnvelope(area)).committed.filter((item) => item.authNetworkId === scope.authNetworkId && item.chainId === scope.chainId && item.auctionId === scope.auctionId); },
		async claimClosure(authority) {
			try { authority = canonicalAuthority(authority); } catch { throw new Error("demo-payment-closure-invalid"); }
			await mutate(async (current) => { const prior = current.authorities.find((item) => item.auctionKey === authority.auctionKey); if (prior !== undefined && prior.closureRoot !== authority.closureRoot) throw new Error("demo-payment-alternate-operation-root"); return { next: prior === undefined ? { ...current, authorities: [...current.authorities, authority] } : current, result: undefined }; });
		},
		async claimOperation(candidate) {
			candidate = canonicalOperation(candidate);
			await mutate(async (current) => { const prior = current.operations.find((item) => item.operationKey === candidate.operationKey); if (prior !== undefined && (prior.closureRoot !== candidate.closureRoot || prior.operationId !== candidate.operationId || prior.role !== candidate.role || prior.packageDigest !== candidate.packageDigest || prior.outcomeDigest !== candidate.outcomeDigest)) throw new Error("demo-payment-operation-conflict"); const value = prior ?? candidate; return { next: prior === undefined ? { ...current, operations: [...current.operations, candidate] } : current, result: value }; });
			return (await readEnvelope(area)).operations.find((item) => item.operationKey === candidate.operationKey)!;
		},
		async completeOperation(operationKey, receipt) {
			receipt = canonicalReceipt(receipt);
			await mutate(async (current) => { const index = current.operations.findIndex((item) => item.operationKey === operationKey); if (index < 0) throw new Error("demo-payment-operation-missing"); const prior = current.operations[index]!; if (receipt.operationKey !== prior.operationKey || receipt.closureRoot !== prior.closureRoot || receipt.operationId !== prior.operationId || receipt.role !== prior.role || receipt.packageDigest !== prior.packageDigest || receipt.outcomeDigest !== prior.outcomeDigest) throw new Error("demo-payment-receipt-conflict"); if (prior.state === "terminal") { if (JSON.stringify(prior.receipt) !== JSON.stringify(receipt)) throw new Error("demo-payment-receipt-conflict"); return { next: current, result: undefined }; } const operations = current.operations.slice(); operations[index] = { ...prior, state: "terminal", receipt }; return { next: { ...current, operations }, result: undefined }; });
		},
		async readOperation(operationKey) { return (await readEnvelope(area)).operations.find((item) => item.operationKey === operationKey) ?? null; },
		async withExecutionLock(callback) { return locks.request(EXECUTION_LOCK, { mode: "exclusive" }, callback); },
	};
}

function packageBody(input: { readonly config: DemoAuthUiConfig; readonly record: DemoBidIntentRecord; readonly conditionFingerprint: string; readonly role: DemoPaymentRole; readonly recipient: string }): string {
	return JSON.stringify({ schema: "DemoFakeEcashPackageV1", role: input.role, auth_network_id: input.config.authNetworkId, chain_id: input.config.chainId, auction_id: input.record.auctionId, operation_id: input.record.operationId, bid_id: input.record.bidId, bid_event_id: input.record.signedEvent?.id, bidder_actor_id: input.record.signedEvent?.pubkey, amount: input.record.amount, mint_url: input.config.mintUrl, unit: "sat", recipient: input.recipient, condition_fingerprint: input.conditionFingerprint, canonical_intent: input.record.canonicalIntent });
}

/** Obtain a second explicit bidder signature over the exact amount and recipients. */
export async function createDemoPaymentApproval(input: { readonly config: DemoAuthUiConfig; readonly record: DemoBidIntentRecord; readonly conditionFingerprint: string; readonly signer: DemoPaymentSigner }): Promise<DemoPaymentApprovalV1> {
	const { config, record } = input;
	if (record.signedEvent === undefined || record.signedEvent.pubkey !== config.profiles.find((item) => item.profileId === record.profileId)?.signerPubkey || !HEX_64.test(input.conditionFingerprint)) throw new Error("demo-payment-bid-binding-missing");
	const sellerRecipient = record.childPubkey;
	const refundRecipient = record.signedEvent.pubkey;
	assertNewApprovalPrintableAscii([
		config.chainId,
		record.auctionId,
		record.operationId,
		record.bidId,
		config.mintUrl,
		config.sellerP2pkXpub,
		record.path,
		sellerRecipient,
		refundRecipient,
	]);
	assertSellerBinding(config.sellerP2pkXpub, record.path, sellerRecipient);
	const winnerPackageDigest = await sha256Hex(packageBody({ config, record, conditionFingerprint: input.conditionFingerprint, role: "winner_settlement", recipient: sellerRecipient }));
	const refundPackageDigest = await sha256Hex(packageBody({ config, record, conditionFingerprint: input.conditionFingerprint, role: "refund", recipient: refundRecipient }));
	const approvalCreatedAt = record.signedEvent.created_at;
	const unsigned = approvalUnsigned({ schema: DEMO_PAYMENT_APPROVAL_SCHEMA, authNetworkId: config.authNetworkId, chainId: config.chainId, auctionId: record.auctionId, operationId: record.operationId, bidId: record.bidId, bidEventId: record.signedEvent.id, bidderActorId: record.signedEvent.pubkey, amount: record.amount, mintUrl: config.mintUrl, sellerP2pkXpub: config.sellerP2pkXpub, sellerDerivationPath: record.path, sellerRecipient, refundRecipient, conditionFingerprint: input.conditionFingerprint, winnerPackageDigest, refundPackageDigest, approvalCreatedAt, approvalEventId: "0".repeat(64), approvalSignature: "0".repeat(128) });
	const signed = await input.signer.signEvent(unsigned);
	await verifySignedBidTemplate(unsigned, signed);
	const approval = canonicalApproval({ schema: DEMO_PAYMENT_APPROVAL_SCHEMA, authNetworkId: config.authNetworkId, chainId: config.chainId, auctionId: record.auctionId, operationId: record.operationId, bidId: record.bidId, bidEventId: record.signedEvent.id, bidderActorId: record.signedEvent.pubkey, amount: record.amount, mintUrl: config.mintUrl, sellerP2pkXpub: config.sellerP2pkXpub, sellerDerivationPath: record.path, sellerRecipient, refundRecipient, conditionFingerprint: input.conditionFingerprint, winnerPackageDigest, refundPackageDigest, approvalCreatedAt, approvalEventId: signed.id, approvalSignature: signed.sig });
	await validateApprovalBinding(approval);
	return approval;
}

function canonicalHandoff(value: DemoPaymentConsensusHandoff): DemoPaymentConsensusHandoff {
	if (!exactObject(value, ["schema", "authNetworkId", "chainId", "closureHeight", "canonicalBatchBytes"])
		|| value.schema !== DEMO_PAYMENT_CONSENSUS_HANDOFF_SCHEMA
		|| !HEX_64.test(value.authNetworkId)
		|| typeof value.chainId !== "string" || value.chainId.length === 0 || value.chainId.trim() !== value.chainId
		|| !Number.isSafeInteger(value.closureHeight) || value.closureHeight < 1 || value.closureHeight > 4096
		|| !Array.isArray(value.canonicalBatchBytes) || value.canonicalBatchBytes.length !== value.closureHeight
		|| value.canonicalBatchBytes.some((item) => typeof item !== "string")) throw new Error("demo-payment-consensus-handoff-invalid");
	return { ...value, canonicalBatchBytes: [...value.canonicalBatchBytes] };
}

function canonicalConsensusReceipt(value: DemoPaymentVerifiedConsensusReceipt): DemoPaymentVerifiedConsensusReceipt {
	const keys = ["schema", "authNetworkId", "chainId", "authenticatedStartHeight", "authenticatedThroughHeight", "canonicalSuccessorCommitHeight", "successorObservedHeight", "canonicalBatchSetDigest", "evidenceDigest"];
	if (!exactObject(value, keys) || value.schema !== DEMO_PAYMENT_CONSENSUS_RECEIPT_SCHEMA
		|| !HEX_64.test(value.authNetworkId) || typeof value.chainId !== "string" || value.chainId.length === 0
		|| value.authenticatedStartHeight !== 1
		|| !Number.isSafeInteger(value.authenticatedThroughHeight)
		|| !Number.isSafeInteger(value.canonicalSuccessorCommitHeight)
		|| !Number.isSafeInteger(value.successorObservedHeight)
		|| !HEX_64.test(value.canonicalBatchSetDigest) || !HEX_64.test(value.evidenceDigest)) throw new Error("demo-payment-consensus-receipt-invalid");
	return { ...value };
}

function paymentBidCommand(raw: string): { operation_id: string; auction_id: string; bid_id: string; amount: number } {
	let value: unknown;
	try { value = parseStrictJSON(raw); } catch { throw new Error("demo-payment-raw-signed-bid-invalid"); }
	if (!exactObject(value, ["version", "type", "operation_id", "auction_id", "bid_id", "amount", "reservations"])
		|| value.version !== 1 || value.type !== "bid"
		|| typeof value.operation_id !== "string" || value.operation_id.length === 0
		|| typeof value.auction_id !== "string" || value.auction_id.length === 0
		|| typeof value.bid_id !== "string" || value.bid_id.length === 0
		|| !Number.isSafeInteger(value.amount) || (value.amount as number) < 1
		|| !Array.isArray(value.reservations) || value.reservations.length === 0) throw new Error("demo-payment-raw-signed-bid-invalid");
	for (const reservation of value.reservations) {
		if (!exactObject(reservation, ["reservation_id", "amount"]) || typeof reservation.reservation_id !== "string" || !HEX_64.test(reservation.reservation_id) || !Number.isSafeInteger(reservation.amount) || (reservation.amount as number) < 1) throw new Error("demo-payment-raw-signed-bid-invalid");
	}
	if (raw !== JSON.stringify(value)) throw new Error("demo-payment-raw-signed-bid-noncanonical");
	return { operation_id: value.operation_id, auction_id: value.auction_id, bid_id: value.bid_id, amount: value.amount as number };
}

async function verifyRawBid(event: DemoSignedEvent, bid: CommittedBidEntryV1, authNetworkId: string): Promise<void> {
	if (!exactObject(event, ["id", "pubkey", "created_at", "kind", "tags", "content", "sig"])
		|| event.id !== bid.event_id || event.pubkey !== bid.actor_id || event.kind !== 28642
		|| !Number.isSafeInteger(event.created_at) || event.created_at < 1
		|| typeof event.sig !== "string" || !HEX_128.test(event.sig)
		|| !Array.isArray(event.tags) || event.tags.length !== 4
		|| JSON.stringify(event.tags.slice(0, 3)) !== JSON.stringify([["protocol", "plebeian-auction-auth-demo"], ["version", "1"], ["environment", authNetworkId]])
		|| !Array.isArray(event.tags[3]) || event.tags[3]!.length !== 2 || event.tags[3]![0] !== "valid_until" || !/^[1-9][0-9]*$/.test(event.tags[3]![1] ?? "")) throw new Error("demo-payment-raw-signed-bid-invalid");
	const command = paymentBidCommand(event.content);
	if (command.operation_id !== bid.operation_id || command.auction_id !== bid.auction_id || command.bid_id !== bid.bid_id || command.amount !== bid.amount) throw new Error("demo-payment-raw-signed-bid-join-mismatch");
	const unsigned: DemoUnsignedEvent = { pubkey: event.pubkey, created_at: event.created_at, kind: event.kind, tags: event.tags, content: event.content };
	await verifySignedBidTemplate(unsigned, event);
	if (!verifyDemoAuthEventId(event.sig, event.id, event.pubkey)) throw new Error("demo-payment-raw-signed-bid-signature-invalid");
}

export async function verifyDemoPaymentConsensusHandoff(
	value: DemoPaymentConsensusHandoff,
	config: DemoPaymentCoordinatorConfig,
	consensus: DemoPaymentConsensusEvidencePort,
): Promise<DemoPaymentVerifiedConsensusHandoff> {
	const handoff = canonicalHandoff(value);
	if (!HEX_64.test(config.authNetworkId) || handoff.authNetworkId !== config.authNetworkId || handoff.chainId !== config.chainId || typeof config.auctionId !== "string" || config.auctionId.length === 0) throw new Error("demo-payment-consensus-domain-drift");
	const batches: CommittedAuctionBatchV2[] = [];
	const encoder = new TextEncoder();
	const batchUtf8Bytes = handoff.canonicalBatchBytes.map((raw) => encoder.encode(raw).byteLength);
	if (batchUtf8Bytes.some((size) => size > DEMO_PAYMENT_MAX_BATCH_UTF8_BYTES)) throw new Error("demo-payment-canonical-batch-limit");
	if (batchUtf8Bytes.reduce((sum, size) => sum + size, 0) > DEMO_PAYMENT_MAX_HANDOFF_UTF8_BYTES) throw new Error("demo-payment-consensus-handoff-limit");
	for (let index = 0; index < handoff.canonicalBatchBytes.length; index += 1) {
		const raw = handoff.canonicalBatchBytes[index]!;
		let parsed: unknown;
		try { parsed = parseStrictJSON(raw); } catch { throw new Error("demo-payment-canonical-batch-invalid"); }
		if (raw !== JSON.stringify(parsed)) throw new Error("demo-payment-canonical-batch-noncanonical");
		const decoded = decodeCommittedBidBatch(raw);
		if (decoded.schema !== "CommittedAuctionBatchV2" || decoded.height !== index + 1
			|| decoded.auth_network_id !== handoff.authNetworkId || decoded.chain_id !== handoff.chainId) throw new Error("demo-payment-batch-history-incomplete");
		batches.push(decoded);
	}
	const canonicalBatchSetDigest = await sha256Hex(JSON.stringify(handoff.canonicalBatchBytes));
	const verifyExact = consensus.verifyExact.bind(consensus);
	const rawReceipt = await verifyExact({
		authNetworkId: handoff.authNetworkId,
		chainId: handoff.chainId,
		closureHeight: handoff.closureHeight,
		canonicalBatchBytes: [...handoff.canonicalBatchBytes],
		canonicalBatchSetDigest,
	});
	if (rawReceipt === null) throw new Error("demo-payment-consensus-evidence-missing");
	const receipt = canonicalConsensusReceipt(rawReceipt);
	if (receipt.authNetworkId !== handoff.authNetworkId || receipt.chainId !== handoff.chainId
		|| receipt.authenticatedThroughHeight !== handoff.closureHeight + 1
		|| receipt.canonicalSuccessorCommitHeight !== handoff.closureHeight + 1
		|| receipt.successorObservedHeight !== handoff.closureHeight + 2
		|| receipt.canonicalBatchSetDigest !== canonicalBatchSetDigest) throw new Error("demo-payment-consensus-receipt-mismatch");
	const closureMatches = batches.flatMap((batch) => batch.closures.filter((closure) => closure.auction_id === config.auctionId).map((closure) => ({ batch, closure })));
	if (closureMatches.length !== 1) throw new Error("demo-payment-closure-count-invalid");
	const { batch: closureBatch, closure } = closureMatches[0]!;
	if (closureBatch.height !== handoff.closureHeight || closure.height !== handoff.closureHeight
		|| closure.auth_network_id !== handoff.authNetworkId || closure.chain_id !== handoff.chainId
		|| closure.app_hash !== closureBatch.app_hash || closure.pbts_seconds !== closureBatch.pbts_seconds) throw new Error("demo-payment-closure-domain-drift");
	return { handoff, batches, closureBatch, closure, receipt, canonicalBatchSetDigest };
}

type PaymentMode = "execute" | "recover";

/**
 * Payment coordinator over the accepted handoff and durable offline executor. It does not create a
 * second validator quorum, reserialize consensus batches, hold bearer inputs, or claim that FROST
 * removes the post-locktime MAIN/refund race. MAIN authorization is the executor's BIP340 3-of-4
 * federation output; the Cashu witness remains bidder-plus-committee NUT-11 2-of-2.
 */
export class DemoOfflinePaymentCoordinator {
	private readonly verifyConsensus: DemoPaymentConsensusEvidencePort["verifyExact"];
	private readonly readSignedBid: DemoPaymentRawSignedBidPort["readExact"];
	private readonly readIdentity: DemoPaymentOfflineIdentityPort["readExact"];
	private readonly executePayment: DemoPaymentOfflineExecutorPort["executeExact"];
	private readonly recoverPayment: DemoPaymentOfflineExecutorPort["recoverExact"];

	constructor(
		readonly persistence: DemoPaymentPersistence,
		consensus: DemoPaymentConsensusEvidencePort,
		signedBids: DemoPaymentRawSignedBidPort,
		identities: DemoPaymentOfflineIdentityPort,
		executor: DemoPaymentOfflineExecutorPort,
		private readonly config: DemoPaymentCoordinatorConfig,
	) {
		if (!HEX_64.test(config.authNetworkId) || [config.chainId, config.auctionId].some((value) => typeof value !== "string" || value.length === 0 || value.trim() !== value)) throw new Error("demo-payment-coordinator-config-invalid");
		this.verifyConsensus = consensus.verifyExact.bind(consensus);
		this.readSignedBid = signedBids.readExact.bind(signedBids);
		this.readIdentity = identities.readExact.bind(identities);
		this.executePayment = executor.executeExact.bind(executor);
		this.recoverPayment = executor.recoverExact.bind(executor);
	}

	/** Plain batch arrays are deliberately no longer an authorization boundary. */
	async processBatches(_batches: readonly CommittedAuctionBatchV2[]): Promise<DemoPaymentBatchResult> {
		throw new Error("demo-payment-consensus-handoff-required");
	}

	async processExactHandoff(handoff: DemoPaymentConsensusHandoff): Promise<DemoPaymentBatchResult> {
		return this.persistence.withExecutionLock(() => this.processExclusive(handoff, "execute"));
	}

	async recoverExactHandoff(handoff: DemoPaymentConsensusHandoff): Promise<DemoPaymentBatchResult> {
		return this.persistence.withExecutionLock(() => this.processExclusive(handoff, "recover"));
	}

	private async processExclusive(value: DemoPaymentConsensusHandoff, mode: PaymentMode): Promise<DemoPaymentBatchResult> {
		const verified = await verifyDemoPaymentConsensusHandoff(value, this.config, { verifyExact: this.verifyConsensus });
		const { handoff, batches, closure, receipt, canonicalBatchSetDigest } = verified;
		const closureRoot = await sha256Hex(JSON.stringify({ canonicalBatchSetDigest, consensusEvidenceDigest: receipt.evidenceDigest, closure }));
		await this.persistence.claimClosure({ auctionKey: JSON.stringify([handoff.authNetworkId, handoff.chainId, this.config.auctionId]), closureRoot });

		const bids = batches.flatMap((batch) => batch.height < handoff.closureHeight
			? batch.bids.filter((bid) => bid.auction_id === this.config.auctionId)
			: []);
		if (new Set(bids.map((bid) => bid.operation_id)).size !== bids.length || new Set(bids.map((bid) => bid.event_id)).size !== bids.length) throw new Error("demo-payment-bid-history-conflict");
		if (closure.close_outcome === "no_bids" && bids.length !== 0) throw new Error("demo-payment-no-bids-conflict");
		if (closure.close_outcome === "winner" && !bids.some((bid) => bid.operation_id === closure.winner_operation_id && bid.bid_id === closure.winner_bid_id && bid.actor_id === closure.winner_actor_id && bid.amount === closure.amount)) throw new Error("demo-payment-winner-binding-missing");

		const paid: string[] = [];
		const refunded: string[] = [];
		const pendingDispositions: DemoPaymentPendingDisposition[] = [];
		const pendingRecovery: Array<{ operationId: string; status: string }> = [];
		const dispositions = bids.map((bid, index) => ({
			bid,
			index,
			role: (closure.close_outcome === "winner" && closure.winner_operation_id === bid.operation_id ? "winner_settlement" : "refund") as DemoPaymentRole,
		})).sort((left, right) => {
			if (left.role !== right.role) return left.role === "winner_settlement" ? -1 : 1;
			return left.index - right.index;
		});
		for (const { bid, role } of dispositions) {
			const signed = await this.readSignedBid({ authNetworkId: handoff.authNetworkId, chainId: handoff.chainId, auctionId: bid.auction_id, operationId: bid.operation_id, bidId: bid.bid_id, eventId: bid.event_id, actorId: bid.actor_id, amount: bid.amount });
			if (signed === null) throw new Error("demo-payment-raw-signed-bid-missing");
			await verifyRawBid(structuredClone(signed), bid, handoff.authNetworkId);
			const identity = await this.readIdentity({ authNetworkId: handoff.authNetworkId, chainId: handoff.chainId, auctionId: bid.auction_id, operationId: bid.operation_id, bidId: bid.bid_id, eventId: bid.event_id, actorId: bid.actor_id, amount: bid.amount, expectedRole: role, closureHeight: closure.height, closureAppHash: closure.app_hash, consensusEvidenceDigest: receipt.evidenceDigest });
			if (identity === null) throw new Error("demo-payment-offline-identity-missing");
			const expected: DemoMaintainerExpectedDisposition = {
				schema: "COCO_DEMO_MAINTAINER_EXPECTED_DISPOSITION_V1",
				network: handoff.authNetworkId,
				chainId: handoff.chainId,
				auctionId: bid.auction_id,
				operationId: bid.operation_id,
				bidId: bid.bid_id,
				bidEventId: bid.event_id,
				bidderActorId: bid.actor_id,
				role,
				amount: bid.amount,
				outcomeHeight: closure.height,
				appStateHash: closure.app_hash,
				closureEvidenceDigest: receipt.evidenceDigest,
			};
			const result = mode === "execute"
				? await this.executePayment(structuredClone(identity), structuredClone(expected))
				: await this.recoverPayment(structuredClone(identity), structuredClone(expected));
			if (result.status === "deferred") {
				if (mode !== "execute" || role !== "refund" || result.reason !== "refund_not_yet_eligible") throw new Error("demo-payment-offline-deferred-invalid");
				pendingDispositions.push({ operationId: bid.operation_id, role: "refund", status: result.reason, eligibleAt: result.eligibleAt });
				continue;
			}
			if (result.status === "settled" || result.status === "refunded") {
				const expectedStatus = role === "winner_settlement" ? "settled" : "refunded";
				if (result.status !== expectedStatus) throw new Error("demo-payment-offline-outcome-mismatch");
				(result.status === "settled" ? paid : refunded).push(bid.operation_id);
			} else {
				if (mode !== "recover") throw new Error("demo-payment-offline-execution-incomplete");
				pendingRecovery.push({ operationId: bid.operation_id, status: result.status });
			}
		}
		return { paid, refunded, pendingDispositions, pendingRecovery, consensusEvidenceDigest: receipt.evidenceDigest, postLocktimeRace: DEMO_PAYMENT_POST_LOCKTIME_RACE };
	}
}

/** Backward import name retained for the demo shell; semantics are now the exact offline coordinator above. */
export class DemoFakeEcashPaymentCoordinator extends DemoOfflinePaymentCoordinator {}

// ---------------------------------------------------------------------------
// Accepted R4.3 V2 integration contracts.
// ---------------------------------------------------------------------------

export const DEMO_PAYMENT_APPROVAL_V2_SCHEMA = "DemoPaymentApprovalV2" as const;
export const DEMO_PAYMENT_APPROVAL_V2_LIFETIME = "terminal-bound-exact-operation-v1" as const;
export const DEMO_PAYMENT_APPROVAL_V2_REFUND_KEY = "separate-cashu-refund-key-v1" as const;
export const DEMO_PAYMENT_APPROVAL_V2_DOMAIN = "COCO_DEMO_PAYMENT_APPROVAL_V2\0";
export const DEMO_PAYMENT_APPROVAL_SET_V2_DOMAIN = "COCO_DEMO_PAYMENT_APPROVAL_SET_V2\0";
export const DEMO_PAYMENT_MEMBERSHIP_V2_DOMAIN = "COCO_DEMO_PAYMENT_OPERATION_MEMBERSHIP_V2\0";
export const DEMO_PAYMENT_COMPLETION_V2_DOMAIN = "COCO_DEMO_PAYMENT_COMPLETION_V2\0";
export const DEMO_PAYMENT_HISTORY_CHUNK_V2_DOMAIN = "COCO_DEMO_COMMITTED_AUCTION_HISTORY_CHUNK_V2\0";
export const DEMO_PAYMENT_HISTORY_ROOT_V2_DOMAIN = "COCO_DEMO_COMMITTED_AUCTION_HISTORY_ROOT_V2\0";
export const DEMO_PAYMENT_APPROVAL_PAGE_V2_DOMAIN = "COCO_DEMO_PAYMENT_APPROVAL_SNAPSHOT_PAGE_V2\0";
export const DEMO_PAYMENT_APPROVAL_ROOT_V2_DOMAIN = "COCO_DEMO_PAYMENT_APPROVAL_SNAPSHOT_ROOT_V2\0";
export const DEMO_PAYMENT_CHECKPOINT_V2_DOMAIN = "COCO_DEMO_PAYMENT_VERIFICATION_CHECKPOINT_V2\0";

const V2_COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/;
const V2_DERIVATION_PATH = /^m\/(?:0|[1-9][0-9]{0,9})\/(?:0|[1-9][0-9]{0,9})\/(?:0|[1-9][0-9]{0,9})\/(?:0|[1-9][0-9]{0,9})\/(?:0|[1-9][0-9]{0,9})$/;

export interface DemoPaymentApprovalV2 {
	readonly schema: typeof DEMO_PAYMENT_APPROVAL_V2_SCHEMA;
	readonly authNetworkId: string;
	readonly chainId: string;
	readonly auctionId: string;
	readonly operationId: string;
	readonly bidId: string;
	readonly bidEventId: string;
	readonly bidderActorId: string;
	readonly bidderCashuPublicKey: string;
	readonly refundCashuPublicKey: string;
	readonly refundKeyVersion: typeof DEMO_PAYMENT_APPROVAL_V2_REFUND_KEY;
	readonly amount: number;
	readonly mintUrl: string;
	readonly sellerP2pkXpub: string;
	readonly sellerDerivationPath: string;
	readonly sellerRecipientPublicKey: string;
	readonly conditionFingerprint: string;
	readonly winnerPackageDigest: string;
	readonly refundPackageDigest: string;
	readonly closeTime: number;
	readonly settlementWindowSeconds: number;
	readonly validUntil: number;
	readonly locktime: number;
	readonly approvalLifetimePolicyVersion: typeof DEMO_PAYMENT_APPROVAL_V2_LIFETIME;
	readonly approvalCreatedAt: number;
	readonly approvalEventId: string;
	readonly approvalSignature: string;
}

export interface DemoPaymentVerifiedApprovalV2 {
	readonly approval: DemoPaymentApprovalV2;
	readonly approvalDigest: string;
}

export interface DemoPaymentKeyRoleContextV2 {
	readonly committeePublicKey: string;
	readonly validatorPublicKeys?: readonly string[];
}

function v2RequireAscii(value: string, field: string): void {
	if (!PRINTABLE_ASCII_TEXT.test(value)) throw new Error(`demo-payment-v2-${field}-invalid`);
}

function v2RequireHex32(value: string, field: string): void {
	if (!HEX_64.test(value)) throw new Error(`demo-payment-v2-${field}-invalid`);
}

function v2RequirePoint(value: string, field: string): void {
	if (!V2_COMPRESSED_KEY.test(value)) throw new Error(`demo-payment-v2-${field}-invalid`);
}

function v2SafePositive(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`demo-payment-v2-${field}-invalid`);
}

function v2MintOrigin(value: string): void {
	v2RequireAscii(value, "mint-origin");
	let parsed: URL;
	try { parsed = new URL(value); } catch { throw new Error("demo-payment-v2-mint-origin-invalid"); }
	if (parsed.protocol !== "https:" || value !== parsed.origin || parsed.username !== "" || parsed.password !== ""
		|| parsed.port !== "" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
		throw new Error("demo-payment-v2-mint-origin-invalid");
	}
}

function v2DerivationPath(value: string): void {
	v2RequireAscii(value, "seller-path");
	if (!V2_DERIVATION_PATH.test(value)) throw new Error("demo-payment-v2-seller-path-invalid");
	for (const part of value.slice(2).split("/")) {
		const level = Number(part);
		if (!Number.isSafeInteger(level) || level > 2_147_483_647) throw new Error("demo-payment-v2-seller-path-invalid");
	}
}

function v2ApprovalCanonical(value: DemoPaymentApprovalV2): DemoPaymentApprovalV2 {
	return {
		schema: value.schema,
		authNetworkId: value.authNetworkId,
		chainId: value.chainId,
		auctionId: value.auctionId,
		operationId: value.operationId,
		bidId: value.bidId,
		bidEventId: value.bidEventId,
		bidderActorId: value.bidderActorId,
		bidderCashuPublicKey: value.bidderCashuPublicKey,
		refundCashuPublicKey: value.refundCashuPublicKey,
		refundKeyVersion: value.refundKeyVersion,
		amount: value.amount,
		mintUrl: value.mintUrl,
		sellerP2pkXpub: value.sellerP2pkXpub,
		sellerDerivationPath: value.sellerDerivationPath,
		sellerRecipientPublicKey: value.sellerRecipientPublicKey,
		conditionFingerprint: value.conditionFingerprint,
		winnerPackageDigest: value.winnerPackageDigest,
		refundPackageDigest: value.refundPackageDigest,
		closeTime: value.closeTime,
		settlementWindowSeconds: value.settlementWindowSeconds,
		validUntil: value.validUntil,
		locktime: value.locktime,
		approvalLifetimePolicyVersion: value.approvalLifetimePolicyVersion,
		approvalCreatedAt: value.approvalCreatedAt,
		approvalEventId: value.approvalEventId,
		approvalSignature: value.approvalSignature,
	};
}

function v2ApprovalContent(value: DemoPaymentApprovalV2): string {
	return JSON.stringify({
		schema: value.schema,
		auth_network_id: value.authNetworkId,
		chain_id: value.chainId,
		auction_id: value.auctionId,
		operation_id: value.operationId,
		bid_id: value.bidId,
		bid_event_id: value.bidEventId,
		bidder_cashu_public_key: value.bidderCashuPublicKey,
		refund_cashu_public_key: value.refundCashuPublicKey,
		refund_key_version: value.refundKeyVersion,
		amount: value.amount,
		mint_url: value.mintUrl,
		seller_p2pk_xpub: value.sellerP2pkXpub,
		seller_derivation_path: value.sellerDerivationPath,
		seller_recipient_public_key: value.sellerRecipientPublicKey,
		condition_fingerprint: value.conditionFingerprint,
		winner_package_digest: value.winnerPackageDigest,
		refund_package_digest: value.refundPackageDigest,
		close_time: value.closeTime,
		settlement_window_seconds: value.settlementWindowSeconds,
		valid_until: value.validUntil,
		locktime: value.locktime,
		approval_lifetime_policy_version: value.approvalLifetimePolicyVersion,
	});
}

function v2ApprovalUnsigned(value: DemoPaymentApprovalV2): DemoUnsignedEvent {
	return {
		pubkey: value.bidderActorId,
		created_at: value.approvalCreatedAt,
		kind: DEMO_PAYMENT_APPROVAL_KIND,
		tags: [
			["protocol", "plebeian-auction-fake-ecash-payment"],
			["version", "2"],
			["environment", value.authNetworkId],
			["bid_event", value.bidEventId],
		],
		content: v2ApprovalContent(value),
	};
}

async function v2DomainHash(domain: string, payload: string): Promise<string> {
	return sha256Hex(`${domain}${payload}`);
}

export function assertDemoPaymentKeyRolesV2(approval: DemoPaymentApprovalV2, context: DemoPaymentKeyRoleContextV2): void {
	v2RequirePoint(context.committeePublicKey, "committee-key");
	for (const [index, key] of (context.validatorPublicKeys ?? []).entries()) v2RequirePoint(key, `validator-key-${index}`);
	const roleX = [
		approval.bidderActorId,
		approval.bidderCashuPublicKey.slice(2),
		approval.refundCashuPublicKey.slice(2),
		approval.sellerRecipientPublicKey.slice(2),
		context.committeePublicKey.slice(2),
	];
	if (new Set(roleX).size !== roleX.length) throw new Error("demo-payment-v2-role-key-alias");
	const prohibited = new Set(roleX);
	for (const key of context.validatorPublicKeys ?? []) {
		if (prohibited.has(key.slice(2))) throw new Error("demo-payment-v2-validator-key-alias");
		prohibited.add(key.slice(2));
	}
}

export async function verifyDemoPaymentApprovalV2(
	input: DemoPaymentApprovalV2,
	context: DemoPaymentKeyRoleContextV2,
): Promise<DemoPaymentVerifiedApprovalV2> {
	let value: DemoPaymentApprovalV2;
	try { value = structuredClone(input); } catch { throw new Error("demo-payment-v2-approval-not-cloneable"); }
	const keys = [
		"schema", "authNetworkId", "chainId", "auctionId", "operationId", "bidId", "bidEventId",
		"bidderActorId", "bidderCashuPublicKey", "refundCashuPublicKey", "refundKeyVersion", "amount",
		"mintUrl", "sellerP2pkXpub", "sellerDerivationPath", "sellerRecipientPublicKey",
		"conditionFingerprint", "winnerPackageDigest", "refundPackageDigest", "closeTime",
		"settlementWindowSeconds", "validUntil", "locktime", "approvalLifetimePolicyVersion",
		"approvalCreatedAt", "approvalEventId", "approvalSignature",
	];
	if (!exactObject(value, keys) || value.schema !== DEMO_PAYMENT_APPROVAL_V2_SCHEMA
		|| value.refundKeyVersion !== DEMO_PAYMENT_APPROVAL_V2_REFUND_KEY
		|| value.approvalLifetimePolicyVersion !== DEMO_PAYMENT_APPROVAL_V2_LIFETIME) {
		throw new Error("demo-payment-v2-approval-shape");
	}
	for (const [field, text] of Object.entries({ chainId: value.chainId, auctionId: value.auctionId, operationId: value.operationId, bidId: value.bidId })) v2RequireAscii(text, field);
	for (const [field, digest] of Object.entries({
		authNetworkId: value.authNetworkId, bidEventId: value.bidEventId, bidderActorId: value.bidderActorId,
		conditionFingerprint: value.conditionFingerprint, winnerPackageDigest: value.winnerPackageDigest,
		refundPackageDigest: value.refundPackageDigest, approvalEventId: value.approvalEventId,
	})) v2RequireHex32(digest, field);
	v2RequirePoint(value.bidderCashuPublicKey, "bidder-cashu-key");
	v2RequirePoint(value.refundCashuPublicKey, "refund-cashu-key");
	v2RequirePoint(value.sellerRecipientPublicKey, "seller-recipient-key");
	if (!HEX_128.test(value.approvalSignature)) throw new Error("demo-payment-v2-approval-signature-invalid");
	v2SafePositive(value.amount, "amount");
	for (const [field, timestamp] of Object.entries({ closeTime: value.closeTime, validUntil: value.validUntil, locktime: value.locktime, approvalCreatedAt: value.approvalCreatedAt })) v2SafePositive(timestamp, field);
	if (!Number.isSafeInteger(value.settlementWindowSeconds) || value.settlementWindowSeconds < 60
		|| value.closeTime > value.validUntil || value.approvalCreatedAt > value.closeTime
		|| !Number.isSafeInteger(value.closeTime + value.settlementWindowSeconds)
		|| value.closeTime + value.settlementWindowSeconds > value.locktime - 60) {
		throw new Error("demo-payment-v2-approval-lifetime-invalid");
	}
	v2MintOrigin(value.mintUrl);
	v2RequireAscii(value.sellerP2pkXpub, "seller-xpub");
	v2DerivationPath(value.sellerDerivationPath);
	assertSellerBinding(value.sellerP2pkXpub, value.sellerDerivationPath, value.sellerRecipientPublicKey);
	assertDemoPaymentKeyRolesV2(value, context);
	const unsigned = v2ApprovalUnsigned(value);
	if (new TextEncoder().encode(unsigned.content).byteLength > 4096) throw new Error("demo-payment-v2-approval-content-limit");
	const canonical = v2ApprovalCanonical(value);
	const canonicalBytes = JSON.stringify(canonical);
	if (new TextEncoder().encode(canonicalBytes).byteLength > 8192) throw new Error("demo-payment-v2-approval-limit");
	const signed: DemoSignedEvent = { ...unsigned, id: value.approvalEventId, sig: value.approvalSignature };
	await verifySignedBidTemplate(unsigned, signed);
	if (!verifyDemoAuthEventId(value.approvalSignature, value.approvalEventId, value.bidderActorId)) throw new Error("demo-payment-v2-approval-signature-invalid");
	return { approval: canonical, approvalDigest: await v2DomainHash(DEMO_PAYMENT_APPROVAL_V2_DOMAIN, canonicalBytes) };
}

export interface DemoPaymentOperationMemberV2 {
	readonly operationId: string;
	readonly bidId: string;
	readonly bidEventId: string;
	readonly bidderActorId: string;
	readonly amount: number;
	readonly committedHeight: number;
	readonly committedEntryIndex: number;
}

export interface DemoPaymentOperationMembershipV2 {
	readonly members: readonly DemoPaymentOperationMemberV2[];
	readonly operationMembershipSha256: string;
}

function v2CanonicalMember(value: DemoPaymentOperationMemberV2): DemoPaymentOperationMemberV2 {
	return {
		operationId: value.operationId,
		bidId: value.bidId,
		bidEventId: value.bidEventId,
		bidderActorId: value.bidderActorId,
		amount: value.amount,
		committedHeight: value.committedHeight,
		committedEntryIndex: value.committedEntryIndex,
	};
}

export async function deriveDemoPaymentOperationMembershipV2(
	batches: readonly CommittedAuctionBatchV2[],
	expected: DemoPaymentScope,
	closureHeight: number,
): Promise<DemoPaymentOperationMembershipV2> {
	if (!HEX_64.test(expected.authNetworkId) || !Number.isSafeInteger(closureHeight) || closureHeight < 1) throw new Error("demo-payment-v2-membership-scope-invalid");
	const members: DemoPaymentOperationMemberV2[] = [];
	const operationIds = new Set<string>();
	const bidIds = new Set<string>();
	const eventIds = new Set<string>();
	const tuples = new Set<string>();
	for (const [historyIndex, batch] of batches.entries()) {
		if (batch.auth_network_id !== expected.authNetworkId || batch.chain_id !== expected.chainId || batch.height !== historyIndex + 1) throw new Error("demo-payment-v2-membership-history-invalid");
		if (batch.height >= closureHeight) continue;
		for (const [committedEntryIndex, bid] of batch.bids.entries()) {
			if (bid.auction_id !== expected.auctionId) continue;
			const displacementFields = [bid.displaced_actor_id, bid.displaced_operation_id, bid.displaced_bid_id, bid.displaced_event_id];
			const displacementCount = displacementFields.filter((item) => item !== undefined).length;
			if ((bid.displaced_refund_eligible && displacementCount !== 4) || (!bid.displaced_refund_eligible && displacementCount !== 0)) throw new Error("demo-payment-v2-displacement-invalid");
			if (bid.displaced_refund_eligible) {
				const prior = members.find((item) => item.bidderActorId === bid.displaced_actor_id
					&& item.operationId === bid.displaced_operation_id && item.bidId === bid.displaced_bid_id && item.bidEventId === bid.displaced_event_id);
				if (prior === undefined) throw new Error("demo-payment-v2-displacement-forward-or-external");
			}
			const member = v2CanonicalMember({ operationId: bid.operation_id, bidId: bid.bid_id, bidEventId: bid.event_id, bidderActorId: bid.actor_id, amount: bid.amount, committedHeight: batch.height, committedEntryIndex });
			const tuple = JSON.stringify(member);
			if (operationIds.has(member.operationId) || bidIds.has(member.bidId) || eventIds.has(member.bidEventId) || tuples.has(tuple)) throw new Error("demo-payment-v2-membership-conflict");
			operationIds.add(member.operationId); bidIds.add(member.bidId); eventIds.add(member.bidEventId); tuples.add(tuple); members.push(member);
		}
	}
	const canonical = JSON.stringify(members);
	return { members, operationMembershipSha256: await v2DomainHash(DEMO_PAYMENT_MEMBERSHIP_V2_DOMAIN, canonical) };
}

export interface DemoPaymentApprovalSetV2 {
	readonly approvals: readonly DemoPaymentApprovalV2[];
	readonly approvalDigests: readonly string[];
	readonly verifiedApprovalSetSha256: string;
}

function v2StringTupleCompare(left: readonly string[], right: readonly string[]): number {
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] === right[index]) continue;
		return left[index]! < right[index]! ? -1 : 1;
	}
	return 0;
}

export async function verifyDemoPaymentApprovalSetV2(options: {
	readonly approvals: readonly DemoPaymentApprovalV2[];
	readonly membership: DemoPaymentOperationMembershipV2;
	readonly expected: DemoPaymentScope;
	readonly keyRoles: DemoPaymentKeyRoleContextV2;
}): Promise<DemoPaymentApprovalSetV2> {
	if (options.approvals.length !== options.membership.members.length) throw new Error("demo-payment-v2-approval-membership-count");
	const verified = await Promise.all(options.approvals.map((approval) => verifyDemoPaymentApprovalV2(approval, options.keyRoles)));
	const byOperation = new Map<string, DemoPaymentVerifiedApprovalV2>();
	for (const item of verified) {
		if (byOperation.has(item.approval.operationId)) throw new Error("demo-payment-v2-approval-duplicate");
		byOperation.set(item.approval.operationId, item);
	}
	for (const member of options.membership.members) {
		const item = byOperation.get(member.operationId);
		if (item === undefined) throw new Error("demo-payment-v2-approval-missing");
		const approval = item.approval;
		if (approval.authNetworkId !== options.expected.authNetworkId || approval.chainId !== options.expected.chainId || approval.auctionId !== options.expected.auctionId
			|| approval.operationId !== member.operationId || approval.bidId !== member.bidId || approval.bidEventId !== member.bidEventId
			|| approval.bidderActorId !== member.bidderActorId || approval.amount !== member.amount) throw new Error("demo-payment-v2-approval-member-join");
	}
	const ordered = [...verified].sort((left, right) => v2StringTupleCompare(
		[left.approval.authNetworkId, left.approval.chainId, left.approval.auctionId, left.approval.operationId, left.approval.approvalEventId],
		[right.approval.authNetworkId, right.approval.chainId, right.approval.auctionId, right.approval.operationId, right.approval.approvalEventId],
	));
	const approvals = ordered.map((item) => item.approval);
	return {
		approvals,
		approvalDigests: ordered.map((item) => item.approvalDigest),
		verifiedApprovalSetSha256: await v2DomainHash(DEMO_PAYMENT_APPROVAL_SET_V2_DOMAIN, JSON.stringify(approvals)),
	};
}

export interface DemoPaymentDispositionV2 {
	readonly member: DemoPaymentOperationMemberV2;
	readonly role: DemoPaymentRole;
}

export function deriveDemoPaymentDispositionsV2(
	membership: DemoPaymentOperationMembershipV2,
	closure: CommittedAutomaticCloseEntryV2,
): readonly DemoPaymentDispositionV2[] {
	const members = [...membership.members];
	if (closure.close_outcome === "no_bids") {
		if (members.length !== 0) throw new Error("demo-payment-v2-no-bids-membership-conflict");
		return [];
	}
	if (closure.close_outcome === "reserve_not_met") return members.map((member) => ({ member, role: "refund" as const }));
	const winner = members.find((member) => member.operationId === closure.winner_operation_id && member.bidId === closure.winner_bid_id
		&& member.bidderActorId === closure.winner_actor_id && member.amount === closure.amount);
	if (winner === undefined) throw new Error("demo-payment-v2-winner-membership-missing");
	return [
		{ member: winner, role: "winner_settlement" },
		...members.filter((member) => member.operationId !== winner.operationId).map((member) => ({ member, role: "refund" as const })),
	];
}

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

export function exactDemoAuthenticatedPaymentCommitmentsV2(value: DemoAuthenticatedPaymentCommitmentsV2): DemoAuthenticatedPaymentCommitmentsV2 {
	const keys = ["schema", "authNetworkId", "chainId", "auctionId", "closureHeight", "closureAppHash", "immutableStorageMarker", "storageRootSha256", "operationMembershipSha256", "operationCount", "approvalCount", "canonicalBatchHistorySha256", "verifiedApprovalSetSha256"];
	if (!exactObject(value, keys) || value.schema !== "DemoAuthenticatedPaymentCommitmentsV2" || !HEX_64.test(value.authNetworkId)
		|| !HEX_64.test(value.closureAppHash) || !HEX_64.test(value.storageRootSha256) || !HEX_64.test(value.operationMembershipSha256)
		|| !HEX_64.test(value.canonicalBatchHistorySha256) || !HEX_64.test(value.verifiedApprovalSetSha256)
		|| !PRINTABLE_ASCII_TEXT.test(value.chainId) || !PRINTABLE_ASCII_TEXT.test(value.auctionId) || !PRINTABLE_ASCII_TEXT.test(value.immutableStorageMarker)
		|| !Number.isSafeInteger(value.closureHeight) || value.closureHeight < 1 || !Number.isSafeInteger(value.operationCount) || value.operationCount < 0
		|| !Number.isSafeInteger(value.approvalCount) || value.approvalCount < 0 || value.approvalCount !== value.operationCount) throw new Error("demo-payment-v2-commitments-invalid");
	return { ...value };
}

export interface DemoPaymentMintTerminalJournalV2 {
	readonly requestDigest: string;
	readonly responseDigest: string;
	readonly outputCount: number;
	readonly amountTotal: number;
	readonly source: "mint_response" | "exact_recovery";
	readonly completedAt: number;
}

export interface DemoRecipientImportCompletionV2 {
	readonly schema: "DemoRecipientImportCompletionV2";
	readonly operationId: string;
	readonly role: DemoPaymentRole;
	readonly recipientPublicKey: string;
	readonly amount: number;
	readonly proofCount: number;
	readonly recipientRequestDigest: string;
	readonly recipientResponseDigest: string;
	readonly recipientImportIdempotencyKey: string;
	readonly imported: true;
}

export interface DemoRecipientImportCompletionPortV2 {
	readExact(request: Omit<DemoRecipientImportCompletionV2, "schema" | "amount" | "proofCount" | "imported">): Promise<DemoRecipientImportCompletionV2 | null>;
}

export interface DemoPaymentCompletionIdentityV2 {
	readonly schema: "DemoPaymentCompletionIdentityV2";
	readonly evidenceDigest: string;
	readonly selectionRoot: string;
	readonly templateDigest: string;
	readonly bundleDigest: string;
	readonly operationId: string;
	readonly role: DemoPaymentRole;
	readonly recipientPublicKey: string;
	readonly amount: number;
	readonly proofCount: number;
	readonly mintRequestDigest: string;
	readonly mintResponseDigest: string;
	readonly recipientRequestDigest: string;
	readonly recipientResponseDigest: string;
	readonly recipientImportIdempotencyKey: string;
	readonly terminalSource: "mint_response" | "exact_recovery";
	readonly completedAt: number;
	readonly imported: true;
}

export interface DemoAuthenticatedPaymentReceiptV2 {
	readonly schema: "DemoAuthenticatedPaymentReceiptV2";
	readonly completion: DemoPaymentCompletionIdentityV2;
	readonly completionDigest: string;
	readonly diagnostics: {
		readonly schema: "DemoPaymentDeliveryDiagnosticsV2";
		readonly deliverySource: "submitted" | "terminal_restore" | "gate_replay";
		readonly alreadyImported: boolean;
		readonly observedAt: number;
	};
}

export async function buildDemoPaymentCompletionV2(options: {
	readonly evidenceDigest: string;
	readonly selectionRoot: string;
	readonly templateDigest: string;
	readonly bundleDigest: string;
	readonly operationId: string;
	readonly role: DemoPaymentRole;
	readonly recipientPublicKey: string;
	readonly amount: number;
	readonly proofCount: number;
	readonly mintRequestDigest: string;
	readonly mintResponseDigest: string;
	readonly recipientRequestDigest: string;
	readonly recipientResponseDigest: string;
	readonly mintJournal: DemoPaymentMintTerminalJournalV2;
	readonly recipientJournal: DemoRecipientImportCompletionV2;
	readonly deliverySource: DemoAuthenticatedPaymentReceiptV2["diagnostics"]["deliverySource"];
	readonly alreadyImported: boolean;
	readonly observedAt: number;
}): Promise<DemoAuthenticatedPaymentReceiptV2> {
	for (const [field, digest] of Object.entries({ evidenceDigest: options.evidenceDigest, selectionRoot: options.selectionRoot, templateDigest: options.templateDigest, bundleDigest: options.bundleDigest, mintRequestDigest: options.mintRequestDigest, mintResponseDigest: options.mintResponseDigest, recipientRequestDigest: options.recipientRequestDigest, recipientResponseDigest: options.recipientResponseDigest })) v2RequireHex32(digest, field);
	v2SafePositive(options.amount, "completion-amount"); v2SafePositive(options.proofCount, "completion-proof-count");
	v2RequireAscii(options.operationId, "completion-operation"); v2RequirePoint(options.recipientPublicKey, "completion-recipient");
	if (!Number.isSafeInteger(options.observedAt) || options.observedAt < 0) throw new Error("demo-payment-v2-completion-observed-at-invalid");
	const importKey = await sha256Hex(`COCO_DEMO_RECIPIENT_IMPORT_V1\0${options.recipientRequestDigest}`);
	const mint = options.mintJournal;
	const recipient = options.recipientJournal;
	if (!exactObject(mint, ["requestDigest", "responseDigest", "outputCount", "amountTotal", "source", "completedAt"])
		|| !exactObject(recipient, ["schema", "operationId", "role", "recipientPublicKey", "amount", "proofCount", "recipientRequestDigest", "recipientResponseDigest", "recipientImportIdempotencyKey", "imported"])
		|| !["mint_response", "exact_recovery"].includes(mint.source) || !Number.isSafeInteger(mint.completedAt) || mint.completedAt < 0
		|| !HEX_64.test(recipient.recipientImportIdempotencyKey)
		|| mint.requestDigest !== options.mintRequestDigest || mint.responseDigest !== options.mintResponseDigest
		|| mint.outputCount !== options.proofCount || mint.amountTotal !== options.amount
		|| recipient.schema !== "DemoRecipientImportCompletionV2" || recipient.operationId !== options.operationId || recipient.role !== options.role
		|| recipient.recipientPublicKey !== options.recipientPublicKey || recipient.amount !== options.amount || recipient.proofCount !== options.proofCount
		|| recipient.recipientRequestDigest !== options.recipientRequestDigest || recipient.recipientResponseDigest !== options.recipientResponseDigest
		|| recipient.recipientImportIdempotencyKey !== importKey || recipient.imported !== true) throw new Error("demo-payment-v2-completion-journal-mismatch");
	const completion: DemoPaymentCompletionIdentityV2 = {
		schema: "DemoPaymentCompletionIdentityV2", evidenceDigest: options.evidenceDigest, selectionRoot: options.selectionRoot,
		templateDigest: options.templateDigest, bundleDigest: options.bundleDigest, operationId: options.operationId, role: options.role,
		recipientPublicKey: options.recipientPublicKey, amount: options.amount, proofCount: options.proofCount,
		mintRequestDigest: options.mintRequestDigest, mintResponseDigest: options.mintResponseDigest,
		recipientRequestDigest: options.recipientRequestDigest, recipientResponseDigest: options.recipientResponseDigest,
		recipientImportIdempotencyKey: importKey, terminalSource: mint.source, completedAt: mint.completedAt, imported: true,
	};
	const completionDigest = await v2DomainHash(DEMO_PAYMENT_COMPLETION_V2_DOMAIN, JSON.stringify(completion));
	return {
		schema: "DemoAuthenticatedPaymentReceiptV2", completion, completionDigest,
		diagnostics: { schema: "DemoPaymentDeliveryDiagnosticsV2", deliverySource: options.deliverySource, alreadyImported: options.alreadyImported, observedAt: options.observedAt },
	};
}

export interface DemoMainSessionReservationV2 {
	readonly schema: "DemoMainSessionReservationV2";
	readonly clockPolicyVersion: "durable-monotonic-executor-seconds-v1";
	readonly clockId: string;
	readonly observedSeconds: number;
	readonly attemptNumber: number;
	readonly sessionId: string;
}

export interface DemoMainSessionReservationPortV2 {
	reserveMainSessionBeforeCutoff(request: {
		readonly scope: string;
		readonly bundleDigest: string;
		readonly selectionRoot: string;
		readonly cutoffSeconds: number;
		readonly expectedClockId: string;
		readonly clockPolicyVersion: "durable-monotonic-executor-seconds-v1";
	}): Promise<DemoMainSessionReservationV2>;
}

export async function reserveDemoMainSessionBeforeCutoffV2(
	port: DemoMainSessionReservationPortV2,
	request: Parameters<DemoMainSessionReservationPortV2["reserveMainSessionBeforeCutoff"]>[0],
): Promise<DemoMainSessionReservationV2> {
	if (!PRINTABLE_ASCII_TEXT.test(request.scope) || !HEX_64.test(request.bundleDigest) || !HEX_64.test(request.selectionRoot)
		|| !PRINTABLE_ASCII_TEXT.test(request.expectedClockId) || !Number.isSafeInteger(request.cutoffSeconds) || request.cutoffSeconds < 1
		|| request.clockPolicyVersion !== "durable-monotonic-executor-seconds-v1") throw new Error("demo-payment-v2-session-request-invalid");
	const result = await port.reserveMainSessionBeforeCutoff({ ...request });
	if (!exactObject(result, ["schema", "clockPolicyVersion", "clockId", "observedSeconds", "attemptNumber", "sessionId"])
		|| result.schema !== "DemoMainSessionReservationV2" || result.clockPolicyVersion !== request.clockPolicyVersion || result.clockId !== request.expectedClockId
		|| !Number.isSafeInteger(result.observedSeconds) || result.observedSeconds < 0 || result.observedSeconds >= request.cutoffSeconds
		|| !Number.isSafeInteger(result.attemptNumber) || result.attemptNumber < 1
		|| result.sessionId !== demoMaintainerFederationSessionId(request.selectionRoot, result.attemptNumber)) throw new Error("demo-payment-v2-session-reservation-invalid");
	return { ...result };
}

export interface DemoSha256StateV1 {
	readonly schema: "DemoSha256StateV1";
	readonly h: readonly [number, number, number, number, number, number, number, number];
	readonly totalBytes: number;
	readonly tailHex: string;
}

const V2_SHA256_INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19] as const;
const V2_SHA256_K = [
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function v2HexBytes(value: string): Uint8Array {
	if (!/^(?:[0-9a-f]{2})*$/.test(value)) throw new Error("demo-payment-v2-hex-invalid");
	return Uint8Array.from({ length: value.length / 2 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function v2BytesHex(value: Uint8Array): string {
	return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function v2ConcatBytes(...parts: readonly Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) { out.set(part, offset); offset += part.length; }
	return out;
}

async function v2HashBytes(...parts: readonly Uint8Array[]): Promise<string> {
	return v2BytesHex(new Uint8Array(await crypto.subtle.digest("SHA-256", v2ConcatBytes(...parts) as BufferSource)));
}

function v2Uint64(value: number): Uint8Array {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error("demo-payment-v2-uint64-invalid");
	const out = new Uint8Array(8);
	let held = BigInt(value);
	for (let index = 7; index >= 0; index -= 1) { out[index] = Number(held & 255n); held >>= 8n; }
	return out;
}

function v2Rotr(value: number, shift: number): number { return (value >>> shift) | (value << (32 - shift)); }

function v2Sha256Block(h: number[], block: Uint8Array): void {
	const w = new Uint32Array(64);
	for (let index = 0; index < 16; index += 1) {
		const offset = index * 4;
		w[index] = ((block[offset]! << 24) | (block[offset + 1]! << 16) | (block[offset + 2]! << 8) | block[offset + 3]!) >>> 0;
	}
	for (let index = 16; index < 64; index += 1) {
		const x = w[index - 15]!; const y = w[index - 2]!;
		const s0 = (v2Rotr(x, 7) ^ v2Rotr(x, 18) ^ (x >>> 3)) >>> 0;
		const s1 = (v2Rotr(y, 17) ^ v2Rotr(y, 19) ^ (y >>> 10)) >>> 0;
		w[index] = (w[index - 16]! + s0 + w[index - 7]! + s1) >>> 0;
	}
	let [a, b, c, d, e, f, g, hh] = h;
	for (let index = 0; index < 64; index += 1) {
		const s1 = (v2Rotr(e!, 6) ^ v2Rotr(e!, 11) ^ v2Rotr(e!, 25)) >>> 0;
		const choose = ((e! & f!) ^ (~e! & g!)) >>> 0;
		const t1 = (hh! + s1 + choose + V2_SHA256_K[index]! + w[index]!) >>> 0;
		const s0 = (v2Rotr(a!, 2) ^ v2Rotr(a!, 13) ^ v2Rotr(a!, 22)) >>> 0;
		const majority = ((a! & b!) ^ (a! & c!) ^ (b! & c!)) >>> 0;
		const t2 = (s0 + majority) >>> 0;
		hh = g; g = f; f = e; e = (d! + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
	}
	const next = [a!, b!, c!, d!, e!, f!, g!, hh!];
	for (let index = 0; index < 8; index += 1) h[index] = (h[index]! + next[index]!) >>> 0;
}

export function demoSha256InitialV1(prefix = new Uint8Array()): DemoSha256StateV1 {
	return demoSha256UpdateV1({ schema: "DemoSha256StateV1", h: [...V2_SHA256_INITIAL], totalBytes: 0, tailHex: "" }, prefix);
}

function v2ValidateShaState(value: DemoSha256StateV1): void {
	if (value.schema !== "DemoSha256StateV1" || !Array.isArray(value.h) || value.h.length !== 8
		|| value.h.some((word) => !Number.isSafeInteger(word) || word < 0 || word > 0xffffffff)
		|| !Number.isSafeInteger(value.totalBytes) || value.totalBytes < 0 || !/^(?:[0-9a-f]{2}){0,63}$/.test(value.tailHex)
		|| value.tailHex.length / 2 !== value.totalBytes % 64) throw new Error("demo-payment-v2-sha-state-invalid");
}

export function demoSha256UpdateV1(value: DemoSha256StateV1, bytes: Uint8Array): DemoSha256StateV1 {
	v2ValidateShaState(value);
	const totalBytes = value.totalBytes + bytes.length;
	if (!Number.isSafeInteger(totalBytes)) throw new Error("demo-payment-v2-sha-state-overflow");
	const held = v2ConcatBytes(v2HexBytes(value.tailHex), bytes);
	const h = [...value.h];
	let offset = 0;
	while (offset + 64 <= held.length) { v2Sha256Block(h, held.subarray(offset, offset + 64)); offset += 64; }
	return { schema: "DemoSha256StateV1", h: h as unknown as DemoSha256StateV1["h"], totalBytes, tailHex: v2BytesHex(held.subarray(offset)) };
}

export function demoSha256DigestV1(value: DemoSha256StateV1): string {
	v2ValidateShaState(value);
	const h = [...value.h];
	const tail = v2HexBytes(value.tailHex);
	const paddingLength = (56 - ((value.totalBytes + 1) % 64) + 64) % 64;
	const padding = new Uint8Array(1 + paddingLength + 8);
	padding[0] = 0x80;
	let bits = BigInt(value.totalBytes) * 8n;
	for (let index = padding.length - 1; index >= padding.length - 8; index -= 1) { padding[index] = Number(bits & 255n); bits >>= 8n; }
	const finalBytes = v2ConcatBytes(tail, padding);
	for (let offset = 0; offset < finalBytes.length; offset += 64) v2Sha256Block(h, finalBytes.subarray(offset, offset + 64));
	const digest = new Uint8Array(32);
	for (let index = 0; index < 8; index += 1) {
		const word = h[index]!;
		digest[index * 4] = word >>> 24; digest[index * 4 + 1] = word >>> 16; digest[index * 4 + 2] = word >>> 8; digest[index * 4 + 3] = word;
	}
	return v2BytesHex(digest);
}

export interface DemoCommittedAuctionHistoryOpenV2 {
	readonly schema: "DemoCommittedAuctionHistoryOpenV2";
	readonly authNetworkId: string;
	readonly chainId: string;
	readonly firstHeight: 1;
	readonly throughHeight: number;
	readonly throughAppHash: string;
	readonly immutableStorageMarker: string;
	readonly storageRootSha256: string;
	readonly chunkCount: number;
	readonly batchCount: number;
	readonly packingPolicy: "greedy-contiguous-height-v1";
	readonly maxBatchesPerChunk: 64;
	readonly maxCanonicalBatchUtf8Bytes: 65536;
	readonly maxCanonicalBatchArrayUtf8BytesPerChunk: 4194304;
	readonly finalChunkDigest: string;
	readonly canonicalBatchHistorySha256: string;
}

export interface DemoCommittedAuctionHistoryChunkV2 {
	readonly schema: "DemoCommittedAuctionHistoryChunkV2";
	readonly immutableStorageMarker: string;
	readonly storageRootSha256: string;
	readonly index: number;
	readonly firstHeight: number;
	readonly lastHeight: number;
	readonly previousChunkDigest: string;
	readonly batches: readonly CommittedAuctionBatchV2[];
	readonly chunkDigest: string;
}

export interface DemoCommittedAuctionHistoryPortV2 {
	open(request: { readonly authNetworkId: string; readonly chainId: string; readonly throughHeight: number; readonly throughAppHash: string }): Promise<DemoCommittedAuctionHistoryOpenV2 | null>;
	readChunk(request: { readonly immutableStorageMarker: string; readonly storageRootSha256: string; readonly index: number }): Promise<DemoCommittedAuctionHistoryChunkV2 | null>;
}

export interface DemoPaymentApprovalSnapshotOpenV2 {
	readonly schema: "DemoPaymentApprovalSnapshotOpenV2";
	readonly snapshotMarker: string;
	readonly snapshotRootSha256: string;
	readonly authNetworkId: string;
	readonly chainId: string;
	readonly auctionId: string;
	readonly operationMembershipSha256: string;
	readonly recordCount: number;
	readonly pageCount: number;
	readonly maxRecordsPerPage: 64;
	readonly maxCanonicalApprovalBytesPerRecord: 8192;
	readonly maxCanonicalApprovalArrayBytesPerPage: 524353;
	readonly finalPageDigest: string;
	readonly verifiedApprovalSetSha256: string;
}

export interface DemoPaymentApprovalSnapshotPageV2 {
	readonly schema: "DemoPaymentApprovalSnapshotPageV2";
	readonly snapshotMarker: string;
	readonly snapshotRootSha256: string;
	readonly pageIndex: number;
	readonly previousPageDigest: string;
	readonly records: readonly DemoPaymentApprovalV2[];
	readonly cumulativeRecordCount: number;
	readonly eof: boolean;
	readonly pageDigest: string;
}

export interface DemoPaymentApprovalSnapshotPortV2 {
	openExact(request: { readonly authNetworkId: string; readonly chainId: string; readonly auctionId: string; readonly operationMembershipSha256: string; readonly operationCount: number; readonly operationMembershipIndexMarker: string; readonly operationMembershipIndexRootSha256: string }): Promise<DemoPaymentApprovalSnapshotOpenV2 | null>;
	readPage(request: { readonly snapshotMarker: string; readonly snapshotRootSha256: string; readonly pageIndex: number }): Promise<DemoPaymentApprovalSnapshotPageV2 | null>;
}

export interface DemoPaymentVerificationCheckpointV2 {
	readonly schema: "DemoPaymentVerificationCheckpointV2";
	readonly revision: number;
	readonly phase: "history" | "approvals" | "ready" | "consumed";
	readonly authNetworkId: string;
	readonly chainId: string;
	readonly auctionId: string;
	readonly closureHeight: number;
	readonly closureAppHash: string;
	readonly immutableStorageMarker: string;
	readonly storageRootSha256: string;
	readonly nextChunkIndex: number;
	readonly nextHeight: number;
	readonly verifiedBatchCount: number;
	readonly previousChunkDigest: string;
	readonly historySha256State: DemoSha256StateV1;
	readonly operationMembershipSha256State: DemoSha256StateV1;
	readonly operationCount: number;
	readonly operationMembershipSha256: string | null;
	readonly operationMembershipIndexMarker: string;
	readonly operationMembershipIndexRootSha256: string;
	readonly approvalSnapshotMarker: string | null;
	readonly approvalSnapshotRootSha256: string | null;
	readonly nextApprovalPageIndex: number;
	readonly verifiedApprovalCount: number;
	readonly previousApprovalPageDigest: string;
	readonly approvalSha256State: DemoSha256StateV1;
	readonly checkpointDigest: string;
}

export interface DemoPaymentVerificationStoreV2 {
	createOrGet(initial: DemoPaymentVerificationCheckpointV2): Promise<DemoPaymentVerificationCheckpointV2>;
	compareAndSwap(request: { readonly expectedRevision: number; readonly next: DemoPaymentVerificationCheckpointV2; readonly appendMembers: readonly DemoPaymentOperationMemberV2[]; readonly appendApprovalKeys: readonly string[] }): Promise<boolean>;
	readMemberByOperation(operationId: string): Promise<DemoPaymentOperationMemberV2 | null>;
	findMember(request: { readonly operationId: string; readonly bidId: string; readonly bidEventId: string; readonly bidderActorId: string }): Promise<DemoPaymentOperationMemberV2 | null>;
	hasMemberConflict(member: DemoPaymentOperationMemberV2): Promise<boolean>;
}

export type DemoPaymentStorageAuthorityV2 =
	| { readonly schema: "DemoPaymentStorageAuthorityV2"; readonly mode: "synthetic_fixture"; readonly fixtureDigest: string }
	| { readonly schema: "DemoPaymentStorageAuthorityV2"; readonly mode: "accepted_sealed"; readonly handoffSeal: string };

export type DemoPaymentVerificationProgressV2 =
	| { readonly status: "verification_pending"; readonly checkpointDigest: string; readonly phase: "history" | "approvals"; readonly productionReady: boolean }
	| { readonly status: "ready"; readonly checkpointDigest: string; readonly productionReady: boolean };

function v2CheckpointBody(value: Omit<DemoPaymentVerificationCheckpointV2, "checkpointDigest">): Omit<DemoPaymentVerificationCheckpointV2, "checkpointDigest"> { return value; }

async function v2Checkpoint(next: Omit<DemoPaymentVerificationCheckpointV2, "checkpointDigest">): Promise<DemoPaymentVerificationCheckpointV2> {
	return { ...next, checkpointDigest: await v2DomainHash(DEMO_PAYMENT_CHECKPOINT_V2_DOMAIN, JSON.stringify(v2CheckpointBody(next))) };
}

async function v2HistoryOpen(port: DemoCommittedAuctionHistoryPortV2, expected: DemoAuthenticatedPaymentCommitmentsV2): Promise<DemoCommittedAuctionHistoryOpenV2> {
	const open = await port.open({ authNetworkId: expected.authNetworkId, chainId: expected.chainId, throughHeight: expected.closureHeight, throughAppHash: expected.closureAppHash });
	if (open === null || open.schema !== "DemoCommittedAuctionHistoryOpenV2" || open.authNetworkId !== expected.authNetworkId || open.chainId !== expected.chainId
		|| open.firstHeight !== 1 || open.throughHeight !== expected.closureHeight || open.throughAppHash !== expected.closureAppHash
		|| open.immutableStorageMarker !== expected.immutableStorageMarker || open.storageRootSha256 !== expected.storageRootSha256
		|| open.batchCount !== open.throughHeight || open.packingPolicy !== "greedy-contiguous-height-v1" || open.maxBatchesPerChunk !== 64
		|| open.maxCanonicalBatchUtf8Bytes !== 65536 || open.maxCanonicalBatchArrayUtf8BytesPerChunk !== 4194304
		|| open.canonicalBatchHistorySha256 !== expected.canonicalBatchHistorySha256 || !HEX_64.test(open.finalChunkDigest)) throw new Error("demo-payment-v2-history-open-mismatch");
	const rootDescriptor = {
		schema: open.schema, authNetworkId: open.authNetworkId, chainId: open.chainId, firstHeight: open.firstHeight,
		throughHeight: open.throughHeight, throughAppHash: open.throughAppHash, immutableStorageMarker: open.immutableStorageMarker,
		chunkCount: open.chunkCount, batchCount: open.batchCount, packingPolicy: open.packingPolicy, maxBatchesPerChunk: open.maxBatchesPerChunk,
		maxCanonicalBatchUtf8Bytes: open.maxCanonicalBatchUtf8Bytes, maxCanonicalBatchArrayUtf8BytesPerChunk: open.maxCanonicalBatchArrayUtf8BytesPerChunk,
		finalChunkDigest: open.finalChunkDigest, canonicalBatchHistorySha256: open.canonicalBatchHistorySha256,
	};
	if (await v2DomainHash(DEMO_PAYMENT_HISTORY_ROOT_V2_DOMAIN, JSON.stringify(rootDescriptor)) !== open.storageRootSha256) throw new Error("demo-payment-v2-history-root-invalid");
	return open;
}

async function v2ChunkDigest(chunk: DemoCommittedAuctionHistoryChunkV2): Promise<string> {
	const body = JSON.stringify({ schema: chunk.schema, immutableStorageMarker: chunk.immutableStorageMarker, index: chunk.index, firstHeight: chunk.firstHeight, lastHeight: chunk.lastHeight, batches: chunk.batches });
	return v2HashBytes(new TextEncoder().encode(DEMO_PAYMENT_HISTORY_CHUNK_V2_DOMAIN), v2HexBytes(chunk.previousChunkDigest), v2Uint64(chunk.index), new TextEncoder().encode(body));
}

async function v2PageDigest(page: DemoPaymentApprovalSnapshotPageV2): Promise<string> {
	const body = JSON.stringify({ schema: page.schema, snapshotMarker: page.snapshotMarker, pageIndex: page.pageIndex, records: page.records, cumulativeRecordCount: page.cumulativeRecordCount, eof: page.eof });
	return v2HashBytes(new TextEncoder().encode(DEMO_PAYMENT_APPROVAL_PAGE_V2_DOMAIN), v2HexBytes(page.previousPageDigest), v2Uint64(page.pageIndex), new TextEncoder().encode(body));
}

async function v2MembersFromChunk(chunk: DemoCommittedAuctionHistoryChunkV2, expected: DemoAuthenticatedPaymentCommitmentsV2, store: DemoPaymentVerificationStoreV2): Promise<DemoPaymentOperationMemberV2[]> {
	const out: DemoPaymentOperationMemberV2[] = [];
	const operationIds = new Set<string>(); const bidIds = new Set<string>(); const eventIds = new Set<string>();
	for (const batch of chunk.batches) {
		if (batch.auth_network_id !== expected.authNetworkId || batch.chain_id !== expected.chainId || batch.height < 1 || batch.height > expected.closureHeight) throw new Error("demo-payment-v2-history-batch-domain");
		for (const [committedEntryIndex, bid] of batch.bids.entries()) {
			if (batch.height >= expected.closureHeight || bid.auction_id !== expected.auctionId) continue;
			const displaced = [bid.displaced_actor_id, bid.displaced_operation_id, bid.displaced_bid_id, bid.displaced_event_id];
			const displacedCount = displaced.filter((item) => item !== undefined).length;
			if ((bid.displaced_refund_eligible && displacedCount !== 4) || (!bid.displaced_refund_eligible && displacedCount !== 0)) throw new Error("demo-payment-v2-displacement-invalid");
			if (bid.displaced_refund_eligible) {
				const local = out.find((member) => member.operationId === bid.displaced_operation_id && member.bidId === bid.displaced_bid_id && member.bidEventId === bid.displaced_event_id && member.bidderActorId === bid.displaced_actor_id);
				const prior = local ?? await store.findMember({ operationId: bid.displaced_operation_id!, bidId: bid.displaced_bid_id!, bidEventId: bid.displaced_event_id!, bidderActorId: bid.displaced_actor_id! });
				if (prior === null || prior === undefined) throw new Error("demo-payment-v2-displacement-forward-or-external");
			}
			const member = v2CanonicalMember({ operationId: bid.operation_id, bidId: bid.bid_id, bidEventId: bid.event_id, bidderActorId: bid.actor_id, amount: bid.amount, committedHeight: batch.height, committedEntryIndex });
			if (operationIds.has(member.operationId) || bidIds.has(member.bidId) || eventIds.has(member.bidEventId) || await store.hasMemberConflict(member)) throw new Error("demo-payment-v2-membership-conflict");
			operationIds.add(member.operationId); bidIds.add(member.bidId); eventIds.add(member.bidEventId); out.push(member);
		}
	}
	return out;
}

export async function advanceDemoPaymentVerificationV2(options: {
	readonly history: DemoCommittedAuctionHistoryPortV2;
	readonly approvals: DemoPaymentApprovalSnapshotPortV2;
	readonly store: DemoPaymentVerificationStoreV2;
	readonly expected: DemoAuthenticatedPaymentCommitmentsV2;
	readonly keyRoles: DemoPaymentKeyRoleContextV2;
	readonly storageAuthority: DemoPaymentStorageAuthorityV2;
}): Promise<DemoPaymentVerificationProgressV2> {
	if (options.storageAuthority.schema !== "DemoPaymentStorageAuthorityV2") throw new Error("demo-payment-v2-storage-adapter-unaccepted");
	// No concrete storage-owner handoff digest is frozen in this lane. Keep the future tagged
	// variant readable at the type boundary, but never let a caller-provided seal self-authorize.
	if (options.storageAuthority.mode !== "synthetic_fixture" || !HEX_64.test(options.storageAuthority.fixtureDigest)) {
		throw new Error("demo-payment-v2-storage-adapter-unaccepted");
	}
	const productionReady = false;
	const expected = exactDemoAuthenticatedPaymentCommitmentsV2(options.expected);
	const open = await v2HistoryOpen(options.history, expected);
	const zero = "0".repeat(64);
	const initial = await v2Checkpoint({
		schema: "DemoPaymentVerificationCheckpointV2", revision: 0, phase: "history", authNetworkId: expected.authNetworkId, chainId: expected.chainId,
		auctionId: expected.auctionId, closureHeight: expected.closureHeight, closureAppHash: expected.closureAppHash,
		immutableStorageMarker: expected.immutableStorageMarker, storageRootSha256: expected.storageRootSha256,
		nextChunkIndex: 0, nextHeight: 1, verifiedBatchCount: 0, previousChunkDigest: zero,
		historySha256State: demoSha256InitialV1(new TextEncoder().encode("[")),
		operationMembershipSha256State: demoSha256InitialV1(new TextEncoder().encode(`${DEMO_PAYMENT_MEMBERSHIP_V2_DOMAIN}[`)),
		operationCount: 0, operationMembershipSha256: null,
		operationMembershipIndexMarker: `membership:${expected.authNetworkId}:${expected.chainId}:${expected.auctionId}`,
		operationMembershipIndexRootSha256: expected.operationMembershipSha256,
		approvalSnapshotMarker: null, approvalSnapshotRootSha256: null, nextApprovalPageIndex: 0, verifiedApprovalCount: 0,
		previousApprovalPageDigest: zero, approvalSha256State: demoSha256InitialV1(new TextEncoder().encode(`${DEMO_PAYMENT_APPROVAL_SET_V2_DOMAIN}[`)),
	});
	let checkpoint = await options.store.createOrGet(initial);
	if (checkpoint.authNetworkId !== expected.authNetworkId || checkpoint.chainId !== expected.chainId || checkpoint.auctionId !== expected.auctionId
		|| checkpoint.closureHeight !== expected.closureHeight || checkpoint.closureAppHash !== expected.closureAppHash
		|| checkpoint.immutableStorageMarker !== expected.immutableStorageMarker || checkpoint.storageRootSha256 !== expected.storageRootSha256) throw new Error("demo-payment-v2-checkpoint-domain-drift");
	if (checkpoint.phase === "ready" || checkpoint.phase === "consumed") return { status: "ready", checkpointDigest: checkpoint.checkpointDigest, productionReady };
	if (checkpoint.phase === "history") {
		if (checkpoint.nextChunkIndex >= open.chunkCount) throw new Error("demo-payment-v2-history-late-eof");
		const chunk = await options.history.readChunk({ immutableStorageMarker: open.immutableStorageMarker, storageRootSha256: open.storageRootSha256, index: checkpoint.nextChunkIndex });
		if (chunk === null || chunk.schema !== "DemoCommittedAuctionHistoryChunkV2" || chunk.immutableStorageMarker !== open.immutableStorageMarker || chunk.storageRootSha256 !== open.storageRootSha256
			|| chunk.index !== checkpoint.nextChunkIndex || chunk.previousChunkDigest !== checkpoint.previousChunkDigest || chunk.firstHeight !== checkpoint.nextHeight
			|| chunk.batches.length < 1 || chunk.batches.length > 64 || chunk.lastHeight !== chunk.firstHeight + chunk.batches.length - 1
			|| chunk.batches.some((batch, index) => batch.height !== chunk.firstHeight + index)) throw new Error("demo-payment-v2-history-chunk-invalid");
		const batchBytes = chunk.batches.map((batch) => new TextEncoder().encode(JSON.stringify(batch)));
		if (batchBytes.some((bytes) => bytes.length > 65536) || 2 + batchBytes.reduce((sum, bytes) => sum + bytes.length, 0) + Math.max(0, batchBytes.length - 1) > 4194304) throw new Error("demo-payment-v2-history-chunk-limit");
		if (await v2ChunkDigest(chunk) !== chunk.chunkDigest) throw new Error("demo-payment-v2-history-chunk-digest");
		let historyState = checkpoint.historySha256State;
		for (const [index, bytes] of batchBytes.entries()) historyState = demoSha256UpdateV1(historyState, v2ConcatBytes(new TextEncoder().encode(checkpoint.verifiedBatchCount + index === 0 ? "" : ","), bytes));
		const additions = await v2MembersFromChunk(chunk, expected, options.store);
		let membershipState = checkpoint.operationMembershipSha256State;
		for (const [index, member] of additions.entries()) membershipState = demoSha256UpdateV1(membershipState, new TextEncoder().encode(`${checkpoint.operationCount + index === 0 ? "" : ","}${JSON.stringify(member)}`));
		const isLast = chunk.index + 1 === open.chunkCount;
		let phase: DemoPaymentVerificationCheckpointV2["phase"] = "history";
		let operationMembershipSha256: string | null = null;
		let snapshot: DemoPaymentApprovalSnapshotOpenV2 | null = null;
		if (isLast) {
			if (chunk.chunkDigest !== open.finalChunkDigest || chunk.lastHeight !== open.throughHeight) throw new Error("demo-payment-v2-history-final-mismatch");
			historyState = demoSha256UpdateV1(historyState, new TextEncoder().encode("]"));
			membershipState = demoSha256UpdateV1(membershipState, new TextEncoder().encode("]"));
			operationMembershipSha256 = demoSha256DigestV1(membershipState);
			if (demoSha256DigestV1(historyState) !== expected.canonicalBatchHistorySha256 || operationMembershipSha256 !== expected.operationMembershipSha256
				|| checkpoint.operationCount + additions.length !== expected.operationCount) throw new Error("demo-payment-v2-history-commitment-mismatch");
			snapshot = await options.approvals.openExact({ authNetworkId: expected.authNetworkId, chainId: expected.chainId, auctionId: expected.auctionId,
				operationMembershipSha256, operationCount: expected.operationCount, operationMembershipIndexMarker: checkpoint.operationMembershipIndexMarker,
				operationMembershipIndexRootSha256: checkpoint.operationMembershipIndexRootSha256 });
			if (snapshot === null || snapshot.schema !== "DemoPaymentApprovalSnapshotOpenV2" || snapshot.authNetworkId !== expected.authNetworkId || snapshot.chainId !== expected.chainId
				|| snapshot.auctionId !== expected.auctionId || snapshot.operationMembershipSha256 !== operationMembershipSha256 || snapshot.recordCount !== expected.approvalCount
				|| snapshot.maxRecordsPerPage !== 64 || snapshot.maxCanonicalApprovalBytesPerRecord !== 8192 || snapshot.maxCanonicalApprovalArrayBytesPerPage !== 524353
				|| snapshot.verifiedApprovalSetSha256 !== expected.verifiedApprovalSetSha256) throw new Error("demo-payment-v2-approval-snapshot-mismatch");
			const rootDescriptor = { schema: snapshot.schema, snapshotMarker: snapshot.snapshotMarker, authNetworkId: snapshot.authNetworkId, chainId: snapshot.chainId,
				auctionId: snapshot.auctionId, operationMembershipSha256: snapshot.operationMembershipSha256, recordCount: snapshot.recordCount, pageCount: snapshot.pageCount,
				maxRecordsPerPage: snapshot.maxRecordsPerPage, maxCanonicalApprovalBytesPerRecord: snapshot.maxCanonicalApprovalBytesPerRecord,
				maxCanonicalApprovalArrayBytesPerPage: snapshot.maxCanonicalApprovalArrayBytesPerPage, finalPageDigest: snapshot.finalPageDigest,
				verifiedApprovalSetSha256: snapshot.verifiedApprovalSetSha256 };
			if (await v2DomainHash(DEMO_PAYMENT_APPROVAL_ROOT_V2_DOMAIN, JSON.stringify(rootDescriptor)) !== snapshot.snapshotRootSha256) throw new Error("demo-payment-v2-approval-snapshot-root");
			phase = snapshot.recordCount === 0 ? "ready" : "approvals";
			if (snapshot.recordCount === 0 && (snapshot.pageCount !== 0 || snapshot.finalPageDigest !== zero || expected.operationCount !== 0
				|| demoSha256DigestV1(demoSha256UpdateV1(checkpoint.approvalSha256State, new TextEncoder().encode("]"))) !== expected.verifiedApprovalSetSha256)) throw new Error("demo-payment-v2-empty-approval-snapshot-invalid");
		}
		const next = await v2Checkpoint({ ...checkpoint, revision: checkpoint.revision + 1, phase, nextChunkIndex: checkpoint.nextChunkIndex + 1,
			nextHeight: chunk.lastHeight + 1, verifiedBatchCount: checkpoint.verifiedBatchCount + chunk.batches.length, previousChunkDigest: chunk.chunkDigest,
			historySha256State: historyState, operationMembershipSha256State: membershipState, operationCount: checkpoint.operationCount + additions.length,
			operationMembershipSha256, approvalSnapshotMarker: snapshot?.snapshotMarker ?? null, approvalSnapshotRootSha256: snapshot?.snapshotRootSha256 ?? null });
		if (!await options.store.compareAndSwap({ expectedRevision: checkpoint.revision, next, appendMembers: additions, appendApprovalKeys: [] })) throw new Error("demo-payment-v2-checkpoint-cas-conflict");
		return phase === "ready" ? { status: "ready", checkpointDigest: next.checkpointDigest, productionReady } : { status: "verification_pending", checkpointDigest: next.checkpointDigest, phase, productionReady };
	}
	if (checkpoint.operationMembershipSha256 === null || checkpoint.approvalSnapshotMarker === null || checkpoint.approvalSnapshotRootSha256 === null) throw new Error("demo-payment-v2-approval-checkpoint-invalid");
	const snapshot = await options.approvals.openExact({ authNetworkId: expected.authNetworkId, chainId: expected.chainId, auctionId: expected.auctionId,
		operationMembershipSha256: checkpoint.operationMembershipSha256!, operationCount: checkpoint.operationCount,
		operationMembershipIndexMarker: checkpoint.operationMembershipIndexMarker, operationMembershipIndexRootSha256: checkpoint.operationMembershipIndexRootSha256 });
	if (snapshot === null || snapshot.snapshotMarker !== checkpoint.approvalSnapshotMarker || snapshot.snapshotRootSha256 !== checkpoint.approvalSnapshotRootSha256
		|| snapshot.operationMembershipSha256 !== checkpoint.operationMembershipSha256 || snapshot.recordCount !== expected.approvalCount
		|| snapshot.verifiedApprovalSetSha256 !== expected.verifiedApprovalSetSha256 || checkpoint.nextApprovalPageIndex >= snapshot.pageCount) throw new Error("demo-payment-v2-approval-snapshot-drift");
	const page = await options.approvals.readPage({ snapshotMarker: checkpoint.approvalSnapshotMarker, snapshotRootSha256: checkpoint.approvalSnapshotRootSha256, pageIndex: checkpoint.nextApprovalPageIndex });
	if (page === null || page.schema !== "DemoPaymentApprovalSnapshotPageV2" || page.snapshotMarker !== checkpoint.approvalSnapshotMarker || page.snapshotRootSha256 !== checkpoint.approvalSnapshotRootSha256
		|| page.pageIndex !== checkpoint.nextApprovalPageIndex || page.previousPageDigest !== checkpoint.previousApprovalPageDigest || page.records.length < 1 || page.records.length > 64
		|| page.cumulativeRecordCount !== checkpoint.verifiedApprovalCount + page.records.length || page.eof !== (page.pageIndex + 1 === snapshot.pageCount)
		|| (page.eof && page.pageDigest !== snapshot.finalPageDigest) || await v2PageDigest(page) !== page.pageDigest) throw new Error("demo-payment-v2-approval-page-invalid");
	let approvalState = checkpoint.approvalSha256State;
	const approvalKeys: string[] = [];
	let priorApprovalKey: string | null = null;
	for (const [index, approval] of page.records.entries()) {
		const verified = await verifyDemoPaymentApprovalV2(approval, options.keyRoles);
		const member = await options.store.readMemberByOperation(verified.approval.operationId);
		if (member === null || verified.approval.authNetworkId !== expected.authNetworkId || verified.approval.chainId !== expected.chainId || verified.approval.auctionId !== expected.auctionId
			|| verified.approval.bidId !== member.bidId || verified.approval.bidEventId !== member.bidEventId || verified.approval.bidderActorId !== member.bidderActorId || verified.approval.amount !== member.amount) throw new Error("demo-payment-v2-approval-member-join");
		const key = JSON.stringify([verified.approval.authNetworkId, verified.approval.chainId, verified.approval.auctionId, verified.approval.operationId, verified.approval.approvalEventId]);
		if (priorApprovalKey !== null && priorApprovalKey >= key) throw new Error("demo-payment-v2-approval-order-invalid");
		priorApprovalKey = key;
		approvalKeys.push(key);
		approvalState = demoSha256UpdateV1(approvalState, new TextEncoder().encode(`${checkpoint.verifiedApprovalCount + index === 0 ? "" : ","}${JSON.stringify(verified.approval)}`));
	}
	const total = checkpoint.verifiedApprovalCount + page.records.length;
	let phase: DemoPaymentVerificationCheckpointV2["phase"] = "approvals";
	if (page.eof) {
		if (total !== expected.approvalCount) throw new Error("demo-payment-v2-approval-count-mismatch");
		approvalState = demoSha256UpdateV1(approvalState, new TextEncoder().encode("]"));
		if (demoSha256DigestV1(approvalState) !== expected.verifiedApprovalSetSha256) throw new Error("demo-payment-v2-approval-set-mismatch");
		phase = "ready";
	} else if (total >= expected.approvalCount) throw new Error("demo-payment-v2-approval-late-eof");
	const next = await v2Checkpoint({ ...checkpoint, revision: checkpoint.revision + 1, phase, nextApprovalPageIndex: checkpoint.nextApprovalPageIndex + 1,
		verifiedApprovalCount: total, previousApprovalPageDigest: page.pageDigest, approvalSha256State: approvalState });
	if (!await options.store.compareAndSwap({ expectedRevision: checkpoint.revision, next, appendMembers: [], appendApprovalKeys: approvalKeys })) throw new Error("demo-payment-v2-checkpoint-cas-conflict");
	return phase === "ready" ? { status: "ready", checkpointDigest: next.checkpointDigest, productionReady } : { status: "verification_pending", checkpointDigest: next.checkpointDigest, phase: "approvals", productionReady };
}
