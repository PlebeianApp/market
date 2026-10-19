/**
 * Wallet-local composition for one automatic-close SIG_ALL disposition.
 *
 * The adapter snapshots every public value and port before its first await. It
 * authenticates the original signed bid and exact wallet-local deposit record,
 * obtains certified complete-history evidence, then delegates to the existing
 * durable SIG_ALL/recipient-private executor. It performs no network fetch and
 * has no fallback source, committee, mint, recovery store, or recipient process.
 */
import { bytesToHex } from "@noble/hashes/utils.js";

import {
	demoCashuSigAllDigest,
	demoOutputsDigest,
	demoRecipientCapabilityDigest,
	demoSigAllPackageDigest,
	demoSigAllRefundPublicKey,
	type DemoSigAllContract,
} from "../../cashu-wrapper/ts/demo-sigall-settlement.ts";
import {
	executeDemoSigAllDisposition,
	type DemoSigAllDispositionResult,
} from "../../cashu-wrapper/ts/demo-sigall-disposition.ts";
import { parseP2PKSecret, proofPoint } from "../../cashu-wrapper/ts/nut-client.ts";
import { deriveSellerChildPubkey, parseExtendedPublicKey } from "../../cashu-wrapper/ts/seller-child.ts";
import { verifyDemoAuthEventId } from "../../cashu-wrapper/ts/index.ts";
import {
	canonicalIntentV1,
	demoIntentIdentifiers,
	parseStrictJSON,
	reservationId,
	verifySignedBidTemplate,
	type DemoSignedEvent,
} from "../ts/demo-auth-bid.ts";
import {
	createDemoCertifiedDispositionAssertionPort,
	type DemoCertifiedDispositionEvidence,
} from "./demo-certified-disposition.ts";

const HEX_64 = /^[0-9a-f]{64}$/;
const COMPRESSED_POINT = /^(02|03)[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const OPERATION_ID = /^da1o:[0-9a-f]{59}$/;
const BID_ID = /^da1b:[0-9a-f]{59}$/;

type DispositionOptions<OpeningRef, UnblindedRef, VerifiedRef> = Parameters<
	typeof executeDemoSigAllDisposition<OpeningRef, UnblindedRef, VerifiedRef>
>[0];

export interface DemoAutomaticCloseEvidencePort {
	readExact(request: {
		readonly network: string;
		readonly chainId: string;
		readonly auctionId: string;
		readonly outcomeHeight: number;
		readonly appStateHash: string;
	}): Promise<DemoCertifiedDispositionEvidence | null>;
}

export interface DemoWalletLocalReservationBinding {
	readonly reservationId: string;
	readonly principalAmount: number;
	readonly proofStateRef: string;
}

export interface DemoWalletLocalBidApproval {
	readonly schema: "COCO_DEMO_WALLET_LOCAL_BID_APPROVAL_V1";
	readonly custodyBoundary: "bidder-wallet-local";
	/**
	 * The kind-28642 event carries only the auction command and reservation IDs.
	 * Cashu fields are joined through bidEventId plus the actor-signed package digest below.
	 */
	readonly signedBid: DemoSignedEvent;
	readonly operationId: string;
	readonly bidId: string;
	readonly bidEventId: string;
	readonly bidderActorId: string;
	readonly bidderPublicKey: string;
	readonly refundPublicKey: string;
	readonly amount: number;
	readonly inputFee: number;
	readonly locktime: number;
	readonly sellerP2pkXpub: string;
	readonly sellerChildPublicKey: string;
	readonly reservations: readonly DemoWalletLocalReservationBinding[];
	readonly inputAmounts: readonly number[];
	readonly packageDigest: string;
	readonly cashuSigAllDigest: string;
	readonly recipientCapabilityDigest: string;
	readonly outputsDigest: string;
}

export interface DemoWalletLocalBidApprovalPort {
	readApprovedBid(request: {
		readonly network: string;
		readonly chainId: string;
		readonly auctionId: string;
		readonly operationId: string;
		readonly bidId: string;
		readonly bidEventId: string;
		readonly packageDigest: string;
		readonly cashuSigAllDigest: string;
		readonly proofStateRefs: readonly string[];
	}): Promise<DemoWalletLocalBidApproval | null>;
}

export interface DemoBrowserWalletApprovalStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface DemoBrowserOriginLockManager {
	request<T>(name: string, options: { readonly mode: "exclusive" }, run: () => Promise<T>): Promise<T>;
}

export interface DemoBrowserWalletApprovalRuntime {
	readonly storage?: DemoBrowserWalletApprovalStorage;
	readonly locks?: DemoBrowserOriginLockManager;
	readonly subtle?: SubtleCrypto;
}

export interface DemoDurableWalletLocalBidApprovalPort extends DemoWalletLocalBidApprovalPort {
	persistApprovedBid(request: {
		readonly network: string;
		readonly chainId: string;
		readonly auctionId: string;
		readonly approval: DemoWalletLocalBidApproval;
	}): Promise<void>;
}

export class DemoCertifiedWalletAdapterRefusedError extends Error {
	constructor(readonly code: string) {
		super(code);
		this.name = "DemoCertifiedWalletAdapterRefusedError";
	}
}

function refuse(code: string): never {
	throw new DemoCertifiedWalletAdapterRefusedError(code);
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		&& Object.keys(value).length === keys.length
		&& Object.keys(value).every((key) => keys.includes(key))
		&& keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function canonicalApproval(value: DemoWalletLocalBidApproval): DemoWalletLocalBidApproval {
	const keys = [
		"schema", "custodyBoundary", "signedBid", "operationId", "bidId", "bidEventId",
		"bidderActorId", "bidderPublicKey", "refundPublicKey", "amount", "inputFee", "locktime", "sellerP2pkXpub",
		"sellerChildPublicKey", "reservations", "inputAmounts", "packageDigest", "cashuSigAllDigest",
		"recipientCapabilityDigest", "outputsDigest",
	];
	if (!exactObject(value, keys)
		|| value.schema !== "COCO_DEMO_WALLET_LOCAL_BID_APPROVAL_V1"
		|| value.custodyBoundary !== "bidder-wallet-local"
		|| typeof value.operationId !== "string" || !OPERATION_ID.test(value.operationId)
		|| typeof value.bidId !== "string" || !BID_ID.test(value.bidId)
		|| typeof value.bidEventId !== "string" || !HEX_64.test(value.bidEventId)
		|| typeof value.bidderActorId !== "string" || !HEX_64.test(value.bidderActorId)
		|| typeof value.bidderPublicKey !== "string" || !COMPRESSED_POINT.test(value.bidderPublicKey)
		|| typeof value.refundPublicKey !== "string" || !COMPRESSED_POINT.test(value.refundPublicKey)
		|| !Number.isSafeInteger(value.amount) || value.amount < 1
		|| !Number.isSafeInteger(value.inputFee) || value.inputFee < 0
		|| !Number.isSafeInteger(value.locktime) || value.locktime < 1
		|| typeof value.sellerP2pkXpub !== "string" || value.sellerP2pkXpub.trim() !== value.sellerP2pkXpub
		|| typeof value.sellerChildPublicKey !== "string" || !COMPRESSED_POINT.test(value.sellerChildPublicKey)
		|| !Array.isArray(value.reservations) || value.reservations.length === 0
		|| !Array.isArray(value.inputAmounts) || value.inputAmounts.length === 0
		|| [value.packageDigest, value.cashuSigAllDigest, value.recipientCapabilityDigest, value.outputsDigest].some((digest) => typeof digest !== "string" || !HEX_64.test(digest))) {
		refuse("certified-wallet-approval-invalid");
	}
	try { parseExtendedPublicKey(value.sellerP2pkXpub); }
	catch { return refuse("certified-wallet-seller-binding-invalid"); }
	const reservations = value.reservations.map((item) => {
		if (!exactObject(item, ["reservationId", "principalAmount", "proofStateRef"])
			|| typeof item.reservationId !== "string" || !HEX_64.test(item.reservationId)
			|| typeof item.principalAmount !== "number" || !Number.isSafeInteger(item.principalAmount) || item.principalAmount < 1
			|| typeof item.proofStateRef !== "string" || !COMPRESSED_POINT.test(item.proofStateRef)) refuse("certified-wallet-deposit-invalid");
		return { reservationId: item.reservationId, principalAmount: item.principalAmount as number, proofStateRef: item.proofStateRef };
	});
	if (new Set(reservations.map((item) => item.reservationId)).size !== reservations.length
		|| new Set(reservations.map((item) => item.proofStateRef)).size !== reservations.length
		|| reservations.some((item, index) => index > 0 && reservations[index - 1]!.reservationId >= item.reservationId)) refuse("certified-wallet-deposit-invalid");
	if (value.inputAmounts.some((amount) => !Number.isSafeInteger(amount) || amount < 1)) refuse("certified-wallet-deposit-invalid");
	const signed = value.signedBid as unknown;
	if (!exactObject(signed, ["id", "pubkey", "created_at", "kind", "tags", "content", "sig"])
		|| typeof signed.id !== "string" || !HEX_64.test(signed.id)
		|| typeof signed.pubkey !== "string" || !HEX_64.test(signed.pubkey)
		|| !Number.isSafeInteger(signed.created_at) || (signed.created_at as number) < 1
		|| signed.kind !== 28642
		|| !Array.isArray(signed.tags) || signed.tags.some((tag) => !Array.isArray(tag) || tag.length !== 2 || tag.some((part) => typeof part !== "string"))
		|| typeof signed.content !== "string"
		|| typeof signed.sig !== "string" || !/^[0-9a-f]{128}$/.test(signed.sig)) refuse("certified-wallet-signed-bid-invalid");
	return structuredClone({
		...value,
		signedBid: {
			id: signed.id,
			pubkey: signed.pubkey,
			created_at: signed.created_at as number,
			kind: 28642,
			tags: signed.tags.map((tag) => [tag[0], tag[1]] as [string, string]),
			content: signed.content,
			sig: signed.sig,
		},
		reservations,
		inputAmounts: [...value.inputAmounts],
	});
}

const DURABLE_APPROVAL_SCHEMA = "COCO_DEMO_DURABLE_WALLET_APPROVAL_V1" as const;
const DURABLE_APPROVAL_LOCK = "coco-demo-wallet-approval-origin-lock-v1";
const DURABLE_APPROVAL_KEY_PREFIX = "coco.demo.wallet-approval.v1:";

interface DurableApprovalIdentity {
	readonly network: string;
	readonly chainId: string;
	readonly auctionId: string;
	readonly operationId: string;
	readonly bidId: string;
	readonly bidEventId: string;
	readonly packageDigest: string;
	readonly cashuSigAllDigest: string;
	readonly proofStateRefs: readonly string[];
}

function canonicalDurableIdentity(value: DurableApprovalIdentity): DurableApprovalIdentity {
	if (!exactObject(value, ["network", "chainId", "auctionId", "operationId", "bidId", "bidEventId", "packageDigest", "cashuSigAllDigest", "proofStateRefs"])
		|| !HEX_64.test(value.network)
		|| typeof value.chainId !== "string" || !SAFE_ID.test(value.chainId)
		|| typeof value.auctionId !== "string" || !SAFE_ID.test(value.auctionId)
		|| typeof value.operationId !== "string" || !OPERATION_ID.test(value.operationId)
		|| typeof value.bidId !== "string" || !BID_ID.test(value.bidId)
		|| !HEX_64.test(value.bidEventId) || !HEX_64.test(value.packageDigest) || !HEX_64.test(value.cashuSigAllDigest)
		|| !Array.isArray(value.proofStateRefs) || value.proofStateRefs.length === 0
		|| value.proofStateRefs.some((ref) => !COMPRESSED_POINT.test(ref))
		|| new Set(value.proofStateRefs).size !== value.proofStateRefs.length) refuse("certified-wallet-durable-identity-invalid");
	return { ...value, proofStateRefs: [...value.proofStateRefs].sort() };
}

async function browserSha256(subtle: SubtleCrypto, text: string): Promise<string> {
	const hashed = await subtle.digest("SHA-256", new TextEncoder().encode(text));
	return bytesToHex(new Uint8Array(hashed));
}

function primaryIdentity(identity: DurableApprovalIdentity): Record<string, string> {
	return {
		network: identity.network,
		chainId: identity.chainId,
		auctionId: identity.auctionId,
		operationId: identity.operationId,
		bidId: identity.bidId,
		bidEventId: identity.bidEventId,
	};
}

/**
 * Browser-local durable approval storage. Only authenticated public identifiers, digests, proof Ys,
 * and the signed bid are persisted; Cashu proof secrets, tokens, openings, and private keys are not
 * accepted by the exact approval schema. Web Locks serializes all tabs/workers for this origin.
 */
export function createBrowserDemoWalletLocalBidApprovalPort(
	runtime?: DemoBrowserWalletApprovalRuntime,
): DemoDurableWalletLocalBidApprovalPort {
	let storage = runtime?.storage;
	let locks = runtime?.locks;
	let subtle = runtime?.subtle;
	if (runtime === undefined) {
		try {
			storage = globalThis.localStorage;
			locks = globalThis.navigator?.locks as unknown as DemoBrowserOriginLockManager | undefined;
			subtle = globalThis.crypto?.subtle;
		} catch { return refuse("certified-wallet-durable-backend-unavailable"); }
	}
	if (storage === undefined || locks === undefined || subtle === undefined
		|| typeof storage.getItem !== "function" || typeof storage.setItem !== "function"
		|| typeof locks.request !== "function" || typeof subtle.digest !== "function") refuse("certified-wallet-durable-backend-unavailable");
	const getItem = storage.getItem.bind(storage);
	const setItem = storage.setItem.bind(storage);
	const withOriginLock = locks.request.bind(locks);
	const digestSubtle = subtle;

	async function storageKey(identity: DurableApprovalIdentity): Promise<string> {
		return `${DURABLE_APPROVAL_KEY_PREFIX}${await browserSha256(digestSubtle, JSON.stringify(primaryIdentity(identity)))}`;
	}

	async function parseStored(raw: string): Promise<{ identity: DurableApprovalIdentity; approval: DemoWalletLocalBidApproval }> {
		let parsed: unknown;
		try { parsed = parseStrictJSON(raw); }
		catch { return refuse("certified-wallet-durable-record-invalid"); }
		if (!exactObject(parsed, ["schema", "identity", "approval", "checksum"])
			|| parsed.schema !== DURABLE_APPROVAL_SCHEMA || typeof parsed.checksum !== "string" || !HEX_64.test(parsed.checksum)) refuse("certified-wallet-durable-record-invalid");
		const identity = canonicalDurableIdentity(parsed.identity as DurableApprovalIdentity);
		const approval = canonicalApproval(parsed.approval as DemoWalletLocalBidApproval);
		const payload = { schema: DURABLE_APPROVAL_SCHEMA, identity, approval };
		if (parsed.checksum !== await browserSha256(digestSubtle, JSON.stringify(payload))) refuse("certified-wallet-durable-checksum-invalid");
		return { identity, approval };
	}

	return Object.freeze({
		async persistApprovedBid(request: Parameters<DemoDurableWalletLocalBidApprovalPort["persistApprovedBid"]>[0]) {
			const approval = canonicalApproval(request.approval);
			const command = canonicalBidCommand(parseStrictJSON(approval.signedBid.content));
			if (approval.signedBid.pubkey !== approval.bidderActorId || approval.signedBid.id !== approval.bidEventId
				|| approval.signedBid.tags[2]?.[0] !== "environment" || approval.signedBid.tags[2]?.[1] !== request.network
				|| command.auction_id !== request.auctionId || command.operation_id !== approval.operationId || command.bid_id !== approval.bidId) refuse("certified-wallet-durable-identity-mismatch");
			await verifySignedBidTemplate({ pubkey: approval.signedBid.pubkey, created_at: approval.signedBid.created_at, kind: approval.signedBid.kind, tags: approval.signedBid.tags, content: approval.signedBid.content }, approval.signedBid);
			if (!verifyDemoAuthEventId(approval.signedBid.sig, approval.signedBid.id, approval.signedBid.pubkey)) refuse("certified-wallet-signed-bid-signature-invalid");
			const identity = canonicalDurableIdentity({
				network: request.network, chainId: request.chainId, auctionId: request.auctionId,
				operationId: approval.operationId, bidId: approval.bidId, bidEventId: approval.bidEventId,
				packageDigest: approval.packageDigest, cashuSigAllDigest: approval.cashuSigAllDigest,
				proofStateRefs: approval.reservations.map((item) => item.proofStateRef),
			});
			const payload = { schema: DURABLE_APPROVAL_SCHEMA, identity, approval };
			const serialized = JSON.stringify({ ...payload, checksum: await browserSha256(digestSubtle, JSON.stringify(payload)) });
			const key = await storageKey(identity);
			await withOriginLock(DURABLE_APPROVAL_LOCK, { mode: "exclusive" }, async () => {
				const existing = getItem(key);
				if (existing !== null) {
					await parseStored(existing);
					if (existing !== serialized) refuse("certified-wallet-durable-record-conflict");
					return;
				}
				setItem(key, serialized);
				if (getItem(key) !== serialized) refuse("certified-wallet-durable-readback-failed");
			});
		},
		async readApprovedBid(request: Parameters<DemoWalletLocalBidApprovalPort["readApprovedBid"]>[0]) {
			const expected = canonicalDurableIdentity({ ...request, proofStateRefs: [...request.proofStateRefs] });
			const key = await storageKey(expected);
			return withOriginLock(DURABLE_APPROVAL_LOCK, { mode: "exclusive" }, async () => {
				const raw = getItem(key);
				if (raw === null) return null;
				const stored = await parseStored(raw);
				if (JSON.stringify(stored.identity) !== JSON.stringify(expected)) refuse("certified-wallet-durable-identity-mismatch");
				return structuredClone(stored.approval);
			});
		},
	});
}

function canonicalBidCommand(value: unknown): {
	readonly version: 1;
	readonly type: "bid";
	readonly operation_id: string;
	readonly auction_id: string;
	readonly bid_id: string;
	readonly amount: number;
	readonly reservations: readonly { readonly reservation_id: string; readonly amount: number }[];
} {
	const keys = ["version", "type", "operation_id", "auction_id", "bid_id", "amount", "reservations"];
	if (!exactObject(value, keys) || value.version !== 1 || value.type !== "bid"
		|| typeof value.operation_id !== "string" || value.operation_id.length === 0
		|| typeof value.auction_id !== "string" || value.auction_id.length === 0
		|| typeof value.bid_id !== "string" || value.bid_id.length === 0
		|| !Number.isSafeInteger(value.amount) || (value.amount as number) < 1
		|| !Array.isArray(value.reservations) || value.reservations.length === 0) refuse("certified-wallet-signed-bid-invalid");
	const reservations = value.reservations.map((item) => {
		if (!exactObject(item, ["reservation_id", "amount"])
			|| typeof item.reservation_id !== "string" || !HEX_64.test(item.reservation_id)
			|| typeof item.amount !== "number" || !Number.isSafeInteger(item.amount) || item.amount < 1) refuse("certified-wallet-signed-bid-invalid");
		return { reservation_id: item.reservation_id, amount: item.amount as number };
	});
	if (new Set(reservations.map((item) => item.reservation_id)).size !== reservations.length
		|| reservations.some((item, index) => index > 0 && reservations[index - 1]!.reservation_id >= item.reservation_id)) refuse("certified-wallet-signed-bid-invalid");
	return { version: 1, type: "bid", operation_id: value.operation_id, auction_id: value.auction_id, bid_id: value.bid_id, amount: value.amount as number, reservations };
}

async function assertSignedBidAndDeposit(
	contract: DemoSigAllContract,
	proofStateRefs: readonly string[],
	approvalValue: DemoWalletLocalBidApproval,
): Promise<DemoWalletLocalBidApproval> {
	const approval = canonicalApproval(approvalValue);
	const packageDigest = demoSigAllPackageDigest(contract);
	const cashuSigAllDigest = demoCashuSigAllDigest(contract.inputs, contract.outputs);
	const outputsDigest = demoOutputsDigest(contract.outputs);
	const recipientCapabilityDigest = demoRecipientCapabilityDigest(contract.recipientCapability);
	if (approval.operationId !== contract.operationId || approval.bidId !== contract.bidId
		|| approval.bidEventId !== contract.bidEventId || approval.bidderActorId !== contract.bidderActorId
		|| approval.bidderPublicKey !== contract.bidderPublicKey || approval.amount !== contract.amount
		|| approval.refundPublicKey !== demoSigAllRefundPublicKey(contract)
		|| approval.inputFee !== contract.inputFee || approval.sellerP2pkXpub !== contract.sellerP2pkXpub
		|| approval.packageDigest !== packageDigest || approval.cashuSigAllDigest !== cashuSigAllDigest
		|| approval.outputsDigest !== outputsDigest || approval.recipientCapabilityDigest !== recipientCapabilityDigest) refuse("certified-wallet-approval-scope-mismatch");
	let sellerChild: string;
	try { sellerChild = deriveSellerChildPubkey(contract.sellerP2pkXpub, contract.bidderDerivationPath); }
	catch { return refuse("certified-wallet-seller-binding-invalid"); }
	if (approval.sellerChildPublicKey !== sellerChild) refuse("certified-wallet-seller-binding-invalid");
	if (JSON.stringify(approval.inputAmounts) !== JSON.stringify(contract.inputs.map((input) => input.amount))) refuse("certified-wallet-deposit-input-mismatch");
	const approvedRefs = approval.reservations.map((item) => item.proofStateRef).sort();
	if (JSON.stringify(approvedRefs) !== JSON.stringify([...proofStateRefs].sort())) refuse("certified-wallet-deposit-proof-mismatch");
	for (const reservation of approval.reservations) {
		if (reservation.reservationId !== await reservationId(contract.mintUrl, reservation.proofStateRef)) refuse("certified-wallet-deposit-reservation-mismatch");
		const inputIndex = proofStateRefs.indexOf(reservation.proofStateRef);
		const inputAmount = contract.inputs[inputIndex]?.amount;
		if (inputIndex < 0 || inputAmount === undefined || reservation.principalAmount > inputAmount) refuse("certified-wallet-deposit-amount-mismatch");
	}
	if (approval.reservations.reduce((total, item) => total + item.principalAmount, 0) !== contract.amount
		|| contract.inputs.reduce((total, input) => total + input.amount, 0)
			- approval.reservations.reduce((total, item) => total + item.principalAmount, 0) !== contract.inputFee) refuse("certified-wallet-deposit-amount-mismatch");
	for (const input of contract.inputs) {
		const parsed = parseP2PKSecret(input.secret);
		const inputLocktime = Number(parsed?.tags.find(([name]) => name === "locktime")?.[1]);
		if (!Number.isSafeInteger(inputLocktime) || inputLocktime !== approval.locktime) refuse("certified-wallet-locktime-mismatch");
	}

	const signed = approval.signedBid;
	const expectedTags = [
		["protocol", "plebeian-auction-auth-demo"], ["version", "1"], ["environment", contract.network],
	];
	if (signed.kind !== 28642 || signed.pubkey !== contract.bidderActorId || signed.id !== contract.bidEventId
		|| !Number.isSafeInteger(signed.created_at) || signed.created_at < 1
		|| signed.tags.length !== 4 || JSON.stringify(signed.tags.slice(0, 3)) !== JSON.stringify(expectedTags)
		|| signed.tags[3]?.length !== 2 || signed.tags[3]?.[0] !== "valid_until"
		|| !/^[1-9][0-9]*$/.test(signed.tags[3]?.[1] ?? "")) refuse("certified-wallet-signed-bid-scope-mismatch");
	const validUntil = Number(signed.tags[3]![1]);
	if (!Number.isSafeInteger(validUntil) || validUntil < signed.created_at || validUntil >= approval.locktime) refuse("certified-wallet-signed-bid-expiry-invalid");
	const unsigned = { pubkey: signed.pubkey, created_at: signed.created_at, kind: signed.kind, tags: signed.tags, content: signed.content };
	await verifySignedBidTemplate(unsigned, signed);
	if (!verifyDemoAuthEventId(signed.sig, signed.id, signed.pubkey)) refuse("certified-wallet-signed-bid-signature-invalid");
	let command: ReturnType<typeof canonicalBidCommand>;
	try { command = canonicalBidCommand(parseStrictJSON(signed.content)); }
	catch { return refuse("certified-wallet-signed-bid-invalid"); }
	if (signed.content !== JSON.stringify(command)) refuse("certified-wallet-signed-bid-noncanonical");
	if (command.operation_id !== contract.operationId || command.auction_id !== contract.auctionId
		|| command.bid_id !== contract.bidId || command.amount !== contract.amount) refuse("certified-wallet-signed-bid-scope-mismatch");
	const expectedReservations = approval.reservations.map((item) => ({ reservation_id: item.reservationId, amount: item.principalAmount }));
	if (JSON.stringify(command.reservations) !== JSON.stringify(expectedReservations)
		|| command.reservations.reduce((sum, item) => sum + item.amount, 0) !== contract.amount) refuse("certified-wallet-signed-bid-deposit-mismatch");

	const committedIntent = canonicalIntentV1({
		authNetworkId: contract.network,
		actorPubkey: contract.bidderActorId,
		auctionId: contract.auctionId,
		amount: contract.amount,
		mintUrl: contract.mintUrl,
		sellerP2pkXpub: contract.sellerP2pkXpub,
		locktime: approval.locktime,
		childPubkey: sellerChild,
	});
	const identifiers = await demoIntentIdentifiers(committedIntent);
	if (identifiers.operationId !== contract.operationId || identifiers.bidId !== contract.bidId) refuse("certified-wallet-cross-bid-reuse");
	// This exact join is the Cashu binding the bid event cannot itself carry: packageDigest includes
	// bidEventId, actor, wallet key, mint seal, inputs, outputs, and recipient capability.
	if (!verifyDemoAuthEventId(contract.approval.actorPackageSignature, packageDigest, contract.bidderActorId)
		|| !verifyDemoAuthEventId(contract.approval.packageSignature, packageDigest, contract.bidderPublicKey.slice(2))
		|| !verifyDemoAuthEventId(contract.approval.cashuSignature, cashuSigAllDigest, contract.bidderPublicKey.slice(2))) refuse("certified-wallet-local-approval-signature-invalid");
	return approval;
}

export async function executeDemoCertifiedWalletAutomaticClose<OpeningRef, UnblindedRef, VerifiedRef>(options: {
	readonly contract: DemoSigAllContract;
	readonly proofStateRefs: readonly string[];
	readonly automaticClose?: DemoAutomaticCloseEvidencePort;
	readonly walletLocal?: DemoWalletLocalBidApprovalPort;
	readonly execution: Omit<DispositionOptions<OpeningRef, UnblindedRef, VerifiedRef>, "contract" | "proofStateRefs" | "certifiedDisposition"> & {
		readonly recipient?: DispositionOptions<OpeningRef, UnblindedRef, VerifiedRef>["recipient"];
	};
}): Promise<DemoSigAllDispositionResult> {
	if (options.automaticClose === undefined) refuse("certified-wallet-close-source-unavailable");
	if (options.walletLocal === undefined) refuse("certified-wallet-local-source-unavailable");
	if (options.execution.recipient === undefined) refuse("certified-wallet-recipient-process-unavailable");

	let contract: DemoSigAllContract;
	let proofStateRefs: string[];
	let recipientIntent: DispositionOptions<OpeningRef, UnblindedRef, VerifiedRef>["recipient"]["intent"];
	let recipientKeyset: DispositionOptions<OpeningRef, UnblindedRef, VerifiedRef>["recipient"]["keyset"];
	try {
		contract = structuredClone(options.contract);
		proofStateRefs = [...options.proofStateRefs];
		recipientIntent = structuredClone(options.execution.recipient.intent);
		recipientKeyset = structuredClone(options.execution.recipient.keyset);
	} catch { return refuse("certified-wallet-public-state-not-cloneable"); }
	const automaticClose = options.automaticClose;
	const walletLocal = options.walletLocal;
	const readCloseEvidence = automaticClose.readExact.bind(automaticClose);
	const readApprovedBid = walletLocal.readApprovedBid.bind(walletLocal);
	const committee = Object.freeze({ ...options.execution.committee, authorize: options.execution.committee.authorize.bind(options.execution.committee) });
	const operationGate = Object.freeze({ runExclusive: options.execution.operationGate.runExclusive.bind(options.execution.operationGate) });
	const mint = Object.freeze({ swapExact: options.execution.mint.swapExact.bind(options.execution.mint) });
	const recoveryStore = Object.freeze({
		createOrGet: options.execution.recoveryStore.createOrGet.bind(options.execution.recoveryStore),
		read: options.execution.recoveryStore.read.bind(options.execution.recoveryStore),
		compareAndSwap: options.execution.recoveryStore.compareAndSwap.bind(options.execution.recoveryStore),
	});
	const terminalResponse = Object.freeze({ restoreCompleted: options.execution.terminalResponse.restoreCompleted.bind(options.execution.terminalResponse) });
	const recipientRoleBinding = Object.freeze({
		assertWinnerRecipient: options.execution.recipient.roleBinding.assertWinnerRecipient.bind(options.execution.recipient.roleBinding),
		assertRefundRecipient: options.execution.recipient.roleBinding.assertRefundRecipient.bind(options.execution.recipient.roleBinding),
	});
	const recipientUnblinder = Object.freeze({ unblindExact: options.execution.recipient.unblinder.unblindExact.bind(options.execution.recipient.unblinder) });
	const recipientVerifier = Object.freeze({ verifyExact: options.execution.recipient.verifier.verifyExact.bind(options.execution.recipient.verifier) });
	const recipientWallet = Object.freeze({ importVerified: options.execution.recipient.wallet.importVerified.bind(options.execution.recipient.wallet) });
	const recipientJournal = Object.freeze({
		runExclusive: options.execution.recipient.journal.runExclusive.bind(options.execution.recipient.journal),
		load: options.execution.recipient.journal.load.bind(options.execution.recipient.journal),
		savePrepared: options.execution.recipient.journal.savePrepared.bind(options.execution.recipient.journal),
		markImported: options.execution.recipient.journal.markImported.bind(options.execution.recipient.journal),
	});
	const execution = {
		committee,
		operationGate,
		mint,
		recoveryStore,
		terminalResponse,
		recipient: {
			intent: recipientIntent,
			keyset: recipientKeyset,
			roleBinding: recipientRoleBinding,
			unblinder: recipientUnblinder,
			verifier: recipientVerifier,
			wallet: recipientWallet,
			journal: recipientJournal,
		},
		now: options.execution.now,
		nowSeconds: options.execution.nowSeconds,
	};

	let derivedProofStateRefs: string[];
	try { derivedProofStateRefs = contract.inputs.map((input) => bytesToHex(proofPoint(input).toBytes(true))); }
	catch { return refuse("certified-wallet-deposit-proof-invalid"); }
	if (JSON.stringify(proofStateRefs) !== JSON.stringify(derivedProofStateRefs)) refuse("certified-wallet-deposit-proof-mismatch");
	const packageDigest = demoSigAllPackageDigest(contract);
	const cashuSigAllDigest = demoCashuSigAllDigest(contract.inputs, contract.outputs);
	const localApproval = await readApprovedBid({
		network: contract.network, chainId: contract.chainId, auctionId: contract.auctionId,
		operationId: contract.operationId, bidId: contract.bidId, bidEventId: contract.bidEventId,
		packageDigest, cashuSigAllDigest, proofStateRefs: [...proofStateRefs],
	});
	if (localApproval === null) refuse("certified-wallet-local-approval-missing");
	const approved = await assertSignedBidAndDeposit(contract, proofStateRefs, localApproval);

	const evidence = await readCloseEvidence({
		network: contract.network, chainId: contract.chainId, auctionId: contract.auctionId,
		outcomeHeight: contract.outcomeHeight, appStateHash: contract.appStateHash,
	});
	if (evidence === null) refuse("certified-wallet-close-evidence-missing");
	const certifiedDisposition = createDemoCertifiedDispositionAssertionPort(evidence);
	// Verify the exact certified disposition here as well as in the durable executor. This keeps a
	// substituted invocation port from turning the composition boundary into a history bypass.
	await certifiedDisposition.assertCertifiedDisposition({
		schema: "COCO_DEMO_CERTIFIED_DISPOSITION_ASSERTION_V1",
		network: contract.network,
		chainId: contract.chainId,
		auctionId: contract.auctionId,
		operationId: contract.operationId,
		bidId: contract.bidId,
		bidEventId: contract.bidEventId,
		bidderActorId: contract.bidderActorId,
		role: contract.role,
		outcomeHeight: contract.outcomeHeight,
		appStateHash: contract.appStateHash,
		amount: contract.amount,
		locktime: approved.locktime,
		proofStateRefs: [...proofStateRefs].sort(),
		recipientPublicKey: contract.recipientPublicKey,
		bidderPublicKey: contract.bidderPublicKey,
		refundPublicKey: demoSigAllRefundPublicKey(contract),
		sellerP2pkXpub: contract.sellerP2pkXpub,
		packageDigest,
		cashuSigAllDigest,
		recipientCapabilityDigest: demoRecipientCapabilityDigest(contract.recipientCapability),
		outputsDigest: demoOutputsDigest(contract.outputs),
	});
	return executeDemoSigAllDisposition({ contract, proofStateRefs, certifiedDisposition, ...execution });
}
