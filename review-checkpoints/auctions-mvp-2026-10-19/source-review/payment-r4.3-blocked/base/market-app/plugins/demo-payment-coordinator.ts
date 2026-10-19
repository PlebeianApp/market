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
import type {
	DemoMaintainerOfflineIdentity,
	DemoMaintainerExpectedDisposition,
	DemoMaintainerOfflineExecutionResult,
	DemoMaintainerOfflineRecoveryResult,
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
