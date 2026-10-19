/**
 * Non-consensus DEMO_AUTH_V1 outbox consumer. The batch is public and
 * non-bearer; only a unique durable wallet join may authorize resuming the
 * original Coco Send through the separately accepted refund adapter.
 */
import type { WalletCommandRunner } from "../ts/wallet-command.ts";
import type { WalletOperationCommand, WalletOperationSnapshot } from "../../cashu-wrapper/ts/types.ts";
import { parseStrictJSON } from "../ts/demo-auth-bid.ts";

export const COMMITTED_BID_BATCH_SCHEMA = "CommittedBidBatchV1";
export const COMMITTED_AUCTION_BATCH_SCHEMA = "CommittedAuctionBatchV2";
export const DEMO_AUTH_PROFILE = "DEMO_AUTH_V1";
export const COMMITTED_BID_WALLET_APPLICATION_ID = "plebeian-market";
export const COMMITTED_BID_REFUND_OPERATION_KIND = "auctions.bid-refund";

const BID_JOIN_STORAGE_KEY = "plebeian-market.committed-bid-joins.v1";
const DELIVERY_JOURNAL_STORAGE_KEY = "plebeian-market.committed-bid-delivery.v1";
const BID_JOIN_STORE_SCHEMA = "WalletBidJoinStoreV1";
const DELIVERY_JOURNAL_SCHEMA = "CommittedBidDeliveryJournalV1";
const BID_JOIN_MUTATION_LOCK = "plebeian-market:committed-bid-joins:v1:mutation";
const DELIVERY_JOURNAL_MUTATION_LOCK = "plebeian-market:committed-bid-delivery:v1:mutation";

export interface CommittedBidEntryV1 {
	readonly actor_id: string;
	readonly operation_id: string;
	readonly auction_id: string;
	readonly bid_id: string;
	readonly event_id: string;
	readonly amount: number;
	readonly displaced_actor_id?: string;
	readonly displaced_operation_id?: string;
	readonly displaced_bid_id?: string;
	readonly displaced_event_id?: string;
	readonly displaced_refund_eligible: boolean;
}

export interface CommittedBidBatchV1 {
	readonly schema: "CommittedBidBatchV1";
	readonly auth_profile: "DEMO_AUTH_V1";
	readonly auth_network_id: string;
	readonly height: number;
	readonly app_hash: string;
	readonly bids: readonly CommittedBidEntryV1[];
}

export interface CommittedAutomaticCloseEntryV2 {
	readonly auth_network_id: string;
	readonly chain_id: string;
	readonly auction_id: string;
	readonly height: number;
	readonly pbts_seconds: number;
	readonly effective_end: number;
	readonly app_hash: string;
	readonly close_outcome: "winner" | "no_bids" | "reserve_not_met";
	readonly winner_bid_id: string;
	readonly winner_actor_id: string;
	readonly winner_operation_id: string;
	readonly amount: number;
}

/** The accepted automatic-close runner's public, non-bearer outbox shape. */
export interface CommittedAuctionBatchV2 {
	readonly schema: "CommittedAuctionBatchV2";
	readonly auth_profile: "DEMO_AUTH_V1";
	readonly auth_network_id: string;
	readonly chain_id: string;
	readonly height: number;
	readonly pbts_seconds: number;
	readonly app_hash: string;
	readonly bids: readonly CommittedBidEntryV1[];
	readonly closures: readonly CommittedAutomaticCloseEntryV2[];
}

export type CommittedBidBatch = CommittedBidBatchV1 | CommittedAuctionBatchV2;

/** Public bindings only. This record must never contain proofs or secrets. */
export interface WalletBidJoinV1 {
	readonly authNetworkId: string;
	readonly actorId: string;
	readonly operationId: string;
	readonly auctionId: string;
	readonly bidId: string;
	readonly eventId: string;
	readonly originalSendOperationId: string;
	readonly mintUrl: string;
	readonly unit: string;
	readonly testAmount: number;
	readonly publicCommitments: readonly string[];
	readonly conditionFingerprint: string;
	readonly locktime: number;
	readonly authorityGeneration: number;
}

export interface WalletBidJoinStore {
	find(input: {
		readonly authNetworkId: string;
		readonly actorId: string;
		readonly operationId: string;
		readonly auctionId: string;
		readonly bidId: string;
		readonly eventId: string;
	}): Promise<readonly WalletBidJoinV1[]>;
}

export interface DurableWalletBidJoinStore extends WalletBidJoinStore {
	/** Insert once; exact duplicates are idempotent and every other ownership collision is refused. */
	save(join: WalletBidJoinV1): Promise<void>;
	/** The unique owner of one original Coco send operation. */
	readOriginalOperation(operationId: string): Promise<WalletBidJoinV1 | null>;
}

export interface DeliveryJournalEntry {
	readonly key: string;
	readonly batchHash: string;
	readonly state: "pending" | "delivered";
}

export interface DeliveryJournalPort {
	read(key: string): Promise<DeliveryJournalEntry | null>;
	begin(key: string, batchHash: string): Promise<void>;
	delivered(key: string, batchHash: string): Promise<void>;
}

export interface CommittedBidConsumerPorts {
	readonly joins: WalletBidJoinStore;
	readonly journal: DeliveryJournalPort;
	/** Must invoke only the accepted send/refund adapter for this exact join. */
	readonly refundOriginalSend: (join: WalletBidJoinV1) => Promise<"rolled_back" | "pending">;
}

/** The localStorage subset used by the durable stores and deterministic offline tests. */
export interface CommittedBidStorageArea {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/** The smallest Web Locks shape used to hold one asynchronous exclusive mutation critical section. */
export interface CommittedBidLockManager {
	request<T>(
		name: string,
		options: { readonly mode: "exclusive" },
		callback: () => Promise<T>,
	): Promise<T>;
}

export interface CommittedBidPersistence {
	readonly joins: DurableWalletBidJoinStore;
	readonly journal: DeliveryJournalPort;
}

/** Structural copy of the accepted refund adapter's public, non-bearer intent. */
export interface CommittedBidRefundIntent {
	readonly auctionRef: string;
	readonly bidRef: string;
	readonly lockCommandId: string;
	readonly mintUrl: string;
	readonly unit: string;
}

export interface ConsumeCommittedBidResult {
	readonly state: "delivered" | "duplicate" | "pending" | "unresolved";
	readonly refundedOriginalSendOperations: readonly string[];
	readonly unresolvedBidIds: readonly string[];
}

const HEX_64 = /^[0-9a-f]{64}$/;
const JOIN_KEYS = [
	"authNetworkId", "actorId", "operationId", "auctionId", "bidId", "eventId",
	"originalSendOperationId", "mintUrl", "unit", "testAmount", "publicCommitments",
	"conditionFingerprint", "locktime", "authorityGeneration",
];
const JOURNAL_KEYS = ["key", "batchHash", "state"];
const EXACT_BATCH_KEYS = ["schema", "auth_profile", "auth_network_id", "height", "app_hash", "bids"];
const EXACT_V2_BATCH_KEYS = ["schema", "auth_profile", "auth_network_id", "chain_id", "height", "pbts_seconds", "app_hash", "bids", "closures"];
const EXACT_BID_KEYS = [
	"actor_id", "operation_id", "auction_id", "bid_id", "event_id", "amount",
	"displaced_actor_id", "displaced_operation_id", "displaced_bid_id", "displaced_event_id", "displaced_refund_eligible",
];
const EXACT_CLOSURE_KEYS = [
	"auth_network_id", "chain_id", "auction_id", "height", "pbts_seconds", "effective_end", "app_hash", "close_outcome",
	"winner_bid_id", "winner_actor_id", "winner_operation_id", "amount",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.every((key) => allowed.includes(key)) && required.every((key) => keys.includes(key));
}

function nonempty(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function deliveryKey(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const parts = value.split("/");
	if (parts.length !== 3 || !HEX_64.test(parts[0]) || !HEX_64.test(parts[2])) return false;
	const height = Number(parts[1]);
	return Number.isSafeInteger(height) && height >= 1 && String(height) === parts[1];
}

async function sha256Hex(value: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
	return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function wellFormedUnicode(value: string): string {
	let result = "";
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				result += value[index]! + value[index + 1]!;
				index += 1;
			} else result += "\ufffd";
		} else if (unit >= 0xdc00 && unit <= 0xdfff) result += "\ufffd";
		else result += value[index]!;
	}
	return result;
}

function normalizeJsonStrings(value: unknown): unknown {
	if (typeof value === "string") return wellFormedUnicode(value);
	if (Array.isArray(value)) return value.map(normalizeJsonStrings);
	if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeJsonStrings(item)]));
	return value;
}

/** Shared UTF-8 JSON encoding: no HTML escaping; U+2028/U+2029 remain explicit escapes. */
export function canonicalUtf8Json(value: unknown): string {
	const encoded = JSON.stringify(normalizeJsonStrings(value));
	if (encoded === undefined) throw new Error("canonical-json-value-invalid");
	return encoded.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function compareUtf8Bytes(left: string, right: string): number {
	const leftBytes = new TextEncoder().encode(left);
	const rightBytes = new TextEncoder().encode(right);
	const length = Math.min(leftBytes.length, rightBytes.length);
	for (let index = 0; index < length; index += 1) {
		if (leftBytes[index] !== rightBytes[index]) return leftBytes[index]! - rightBytes[index]!;
	}
	return leftBytes.length - rightBytes.length;
}

function joinTuple(join: Pick<WalletBidJoinV1, "authNetworkId" | "actorId" | "operationId" | "auctionId" | "bidId" | "eventId">): string {
	// JSON's string encoding plus array element boundaries makes this injective for the six strings.
	return JSON.stringify([join.authNetworkId, join.actorId, join.operationId, join.auctionId, join.bidId, join.eventId]);
}

function projectJoin(value: unknown): WalletBidJoinV1 {
	if (!isRecord(value) || !exactKeys(value, JOIN_KEYS, JOIN_KEYS)) throw new Error("wallet-bid-join-store-corrupt");
	const commitments = value.publicCommitments;
	if (
		!HEX_64.test(String(value.authNetworkId)) || !HEX_64.test(String(value.actorId)) ||
		!nonempty(value.operationId) || !nonempty(value.auctionId) || !nonempty(value.bidId) ||
		!HEX_64.test(String(value.eventId)) || !nonempty(value.originalSendOperationId) ||
		value.originalSendOperationId !== value.operationId || !nonempty(value.mintUrl) || !nonempty(value.unit) ||
		!Number.isSafeInteger(value.testAmount) || (value.testAmount as number) <= 0 ||
		!Array.isArray(commitments) || commitments.length === 0 || !commitments.every(nonempty) ||
		!HEX_64.test(String(value.conditionFingerprint)) || !Number.isSafeInteger(value.locktime) || (value.locktime as number) <= 0 ||
		!Number.isSafeInteger(value.authorityGeneration) || (value.authorityGeneration as number) < 0
	) throw new Error("wallet-bid-join-store-corrupt");
	return {
		authNetworkId: value.authNetworkId as string,
		actorId: value.actorId as string,
		operationId: value.operationId,
		auctionId: value.auctionId,
		bidId: value.bidId,
		eventId: value.eventId as string,
		originalSendOperationId: value.originalSendOperationId,
		mintUrl: value.mintUrl,
		unit: value.unit,
		testAmount: value.testAmount as number,
		publicCommitments: [...commitments] as string[],
		conditionFingerprint: value.conditionFingerprint as string,
		locktime: value.locktime as number,
		authorityGeneration: value.authorityGeneration as number,
	};
}

function projectJournalEntry(value: unknown): DeliveryJournalEntry {
	if (
		!isRecord(value) || !exactKeys(value, JOURNAL_KEYS, JOURNAL_KEYS) || !deliveryKey(value.key) ||
		!HEX_64.test(String(value.batchHash)) || (value.state !== "pending" && value.state !== "delivered")
	) throw new Error("committed-bid-delivery-store-corrupt");
	return { key: value.key, batchHash: value.batchHash as string, state: value.state };
}

function exactJoin(left: WalletBidJoinV1, right: WalletBidJoinV1): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function storageArea(area?: CommittedBidStorageArea): CommittedBidStorageArea {
	if (area) {
		try {
			area.getItem(BID_JOIN_STORAGE_KEY);
			area.getItem(DELIVERY_JOURNAL_STORAGE_KEY);
			return area;
		} catch {
			throw new Error("committed-bid-durable-storage-unavailable");
		}
	}
	try {
		const candidate = globalThis.localStorage;
		if (candidate && typeof candidate.getItem === "function" && typeof candidate.setItem === "function") {
			candidate.getItem(BID_JOIN_STORAGE_KEY);
			candidate.getItem(DELIVERY_JOURNAL_STORAGE_KEY);
			return candidate;
		}
	} catch {
		// Named refusal below is the public contract; browser policy details are not exposed.
	}
	throw new Error("committed-bid-durable-storage-unavailable");
}

function synchronization(injected?: CommittedBidLockManager): CommittedBidLockManager {
	if (injected !== undefined) {
		if (typeof injected.request === "function") return injected;
		throw new Error("committed-bid-durable-synchronization-unavailable");
	}
	try {
		const navigatorValue = (globalThis as unknown as { navigator?: { locks?: unknown } }).navigator;
		const locks = navigatorValue?.locks as { request?: unknown } | undefined;
		if (locks && typeof locks.request === "function") {
			type NativeRequest = <T>(
				name: string,
				options: { readonly mode: "exclusive" },
				callback: (lock: unknown) => Promise<T>,
			) => Promise<T>;
			const request = locks.request as NativeRequest;
			return {
				request<T>(name: string, options: { readonly mode: "exclusive" }, callback: () => Promise<T>): Promise<T> {
						return request.call(locks, name, options, async () => await callback()) as Promise<T>;
				},
			};
		}
	} catch {
		// The fixed refusal below is the only public outcome for an unusable browser lock manager.
	}
	throw new Error("committed-bid-durable-synchronization-unavailable");
}

function serializeJoinRecords(records: readonly WalletBidJoinV1[]): string {
	return JSON.stringify({ schema: BID_JOIN_STORE_SCHEMA, records });
}

function serializeJournalRecords(records: readonly DeliveryJournalEntry[]): string {
	return JSON.stringify({ schema: DELIVERY_JOURNAL_SCHEMA, records });
}

async function readJoinRecords(area: CommittedBidStorageArea): Promise<WalletBidJoinV1[]> {
	try {
		const encoded = area.getItem(BID_JOIN_STORAGE_KEY);
		if (encoded === null) return [];
		const envelope: unknown = JSON.parse(encoded);
		if (!isRecord(envelope) || !exactKeys(envelope, ["schema", "records", "checksum"], ["schema", "records", "checksum"]) || envelope.schema !== BID_JOIN_STORE_SCHEMA || !Array.isArray(envelope.records) || !HEX_64.test(String(envelope.checksum))) throw undefined;
		const records = envelope.records.map(projectJoin).sort((left, right) => compareUtf8Bytes(joinTuple(left), joinTuple(right)));
		if (await sha256Hex(serializeJoinRecords(records)) !== envelope.checksum) throw undefined;
		const tuples = new Set<string>();
		const operations = new Set<string>();
		for (const record of records) {
			const tuple = joinTuple(record);
			if (tuples.has(tuple) || operations.has(record.originalSendOperationId)) throw undefined;
			tuples.add(tuple);
			operations.add(record.originalSendOperationId);
		}
		return records;
	} catch {
		throw new Error("wallet-bid-join-store-corrupt");
	}
}

async function writeJoinRecords(area: CommittedBidStorageArea, records: readonly WalletBidJoinV1[]): Promise<void> {
	const ordered = [...records].sort((left, right) => compareUtf8Bytes(joinTuple(left), joinTuple(right)));
	const body = serializeJoinRecords(ordered);
	const encoded = JSON.stringify({ schema: BID_JOIN_STORE_SCHEMA, records: ordered, checksum: await sha256Hex(body) });
	try {
		area.setItem(BID_JOIN_STORAGE_KEY, encoded);
		if (area.getItem(BID_JOIN_STORAGE_KEY) !== encoded) throw undefined;
	} catch {
		throw new Error("wallet-bid-join-store-write-failed");
	}
}

async function readJournalRecords(area: CommittedBidStorageArea): Promise<DeliveryJournalEntry[]> {
	try {
		const encoded = area.getItem(DELIVERY_JOURNAL_STORAGE_KEY);
		if (encoded === null) return [];
		const envelope: unknown = JSON.parse(encoded);
		if (!isRecord(envelope) || !exactKeys(envelope, ["schema", "records", "checksum"], ["schema", "records", "checksum"]) || envelope.schema !== DELIVERY_JOURNAL_SCHEMA || !Array.isArray(envelope.records) || !HEX_64.test(String(envelope.checksum))) throw undefined;
		const records = envelope.records.map(projectJournalEntry).sort((left, right) => compareUtf8Bytes(left.key, right.key));
		if (await sha256Hex(serializeJournalRecords(records)) !== envelope.checksum) throw undefined;
		if (new Set(records.map((record) => record.key)).size !== records.length) throw undefined;
		return records;
	} catch {
		throw new Error("committed-bid-delivery-store-corrupt");
	}
}

async function writeJournalRecords(area: CommittedBidStorageArea, records: readonly DeliveryJournalEntry[]): Promise<void> {
	const ordered = [...records].sort((left, right) => compareUtf8Bytes(left.key, right.key));
	const body = serializeJournalRecords(ordered);
	const encoded = JSON.stringify({ schema: DELIVERY_JOURNAL_SCHEMA, records: ordered, checksum: await sha256Hex(body) });
	try {
		area.setItem(DELIVERY_JOURNAL_STORAGE_KEY, encoded);
		if (area.getItem(DELIVERY_JOURNAL_STORAGE_KEY) !== encoded) throw undefined;
	} catch {
		throw new Error("committed-bid-delivery-store-write-failed");
	}
}

/**
 * Build the consumer's two browser-persistent, public-only stores. There is no memory fallback: if localStorage
 * or origin-wide Web Locks are unavailable the consumer refuses by name before it can acknowledge an outbox
 * delivery. Tests may inject a structural lock manager, but every persistence object over one injected storage
 * area must share that area's one manager; per-instance managers are not a supported durable configuration.
 */
export function createBrowserCommittedBidPersistence(options: {
	readonly localStorage?: CommittedBidStorageArea;
	readonly lockManager?: CommittedBidLockManager;
	readonly namespace?: string;
} = {}): CommittedBidPersistence {
	const baseArea = storageArea(options.localStorage);
	const baseLocks = synchronization(options.lockManager);
	const namespace = options.namespace;
	if (namespace !== undefined && !/^[A-Za-z0-9._:-]{1,128}$/.test(namespace)) throw new Error("committed-bid-namespace-invalid");
	const area: CommittedBidStorageArea = namespace === undefined ? baseArea : {
		getItem: (key) => baseArea.getItem(`${namespace}.${key}`),
		setItem: (key, value) => baseArea.setItem(`${namespace}.${key}`, value),
	};
	const locks: CommittedBidLockManager = namespace === undefined ? baseLocks : {
		request: (name, lockOptions, callback) => baseLocks.request(`${namespace}:${name}`, lockOptions, callback),
	};

	const joins: DurableWalletBidJoinStore = {
		async save(candidate): Promise<void> {
			const join = projectJoin(candidate);
			return locks.request(BID_JOIN_MUTATION_LOCK, { mode: "exclusive" }, async () => {
				const records = await readJoinRecords(area);
				const tuple = joinTuple(join);
				const tupleOwner = records.find((record) => joinTuple(record) === tuple);
				if (tupleOwner) {
					if (exactJoin(tupleOwner, join)) return;
					throw new Error("wallet-bid-join-tuple-conflict");
				}
				const operationOwner = records.find((record) => record.originalSendOperationId === join.originalSendOperationId);
				if (operationOwner) throw new Error("wallet-bid-original-operation-conflict");
				await writeJoinRecords(area, [...records, join]);
			});
		},
		async find(input): Promise<readonly WalletBidJoinV1[]> {
			const key = JSON.stringify([input.authNetworkId, input.actorId, input.operationId, input.auctionId, input.bidId, input.eventId]);
			return (await readJoinRecords(area)).filter((record) => joinTuple(record) === key);
		},
		async readOriginalOperation(operationId): Promise<WalletBidJoinV1 | null> {
			const matches = (await readJoinRecords(area)).filter((record) => record.originalSendOperationId === operationId);
			if (matches.length > 1) throw new Error("wallet-bid-join-store-corrupt");
			return matches[0] ?? null;
		},
	};

	const journal: DeliveryJournalPort = {
		async read(key): Promise<DeliveryJournalEntry | null> {
			return (await readJournalRecords(area)).find((record) => record.key === key) ?? null;
		},
		async begin(key, batchHash): Promise<void> {
			if (!deliveryKey(key) || !HEX_64.test(batchHash)) throw new Error("committed-bid-delivery-invalid");
			return locks.request(DELIVERY_JOURNAL_MUTATION_LOCK, { mode: "exclusive" }, async () => {
				const records = await readJournalRecords(area);
				const prior = records.find((record) => record.key === key);
				if (prior) {
					if (prior.batchHash !== batchHash) throw new Error("committed-bid-delivery-conflict");
					if (prior.state !== "pending") throw new Error("committed-bid-delivery-state-conflict");
					return;
				}
				await writeJournalRecords(area, [...records, { key, batchHash, state: "pending" }]);
			});
		},
		async delivered(key, batchHash): Promise<void> {
			if (!deliveryKey(key) || !HEX_64.test(batchHash)) throw new Error("committed-bid-delivery-invalid");
			return locks.request(DELIVERY_JOURNAL_MUTATION_LOCK, { mode: "exclusive" }, async () => {
				const records = await readJournalRecords(area);
				const index = records.findIndex((record) => record.key === key);
				if (index < 0 || records[index].batchHash !== batchHash) throw new Error("committed-bid-delivery-conflict");
				if (records[index].state === "delivered") return;
				const next = records.slice();
				next[index] = { key, batchHash, state: "delivered" };
				await writeJournalRecords(area, next);
			});
		},
	};

	return { joins, journal };
}

/** The R5 adapter reader: resolve its command exclusively through the durable, public join. */
export function createCommittedBidRefundIntentReader(joins: DurableWalletBidJoinStore): (commandId: string) => Promise<CommittedBidRefundIntent | null> {
	return async (commandId: string): Promise<CommittedBidRefundIntent | null> => {
		const prefix = `${COMMITTED_BID_REFUND_OPERATION_KIND}:`;
		if (!commandId.startsWith(prefix) || commandId.length === prefix.length) return null;
		const operationId = commandId.slice(prefix.length);
		const join = await joins.readOriginalOperation(operationId);
		if (join === null || commandId !== `${prefix}${join.originalSendOperationId}`) return null;
		return {
			auctionRef: join.auctionId,
			bidRef: join.bidId,
			lockCommandId: join.originalSendOperationId,
			mintUrl: join.mintUrl,
			unit: join.unit,
		};
	};
}

function sameRefundSnapshot(snapshot: WalletOperationSnapshot, command: WalletOperationCommand): boolean {
	return snapshot.commandId === command.commandId && snapshot.applicationId === command.applicationId &&
		snapshot.operationKind === command.operationKind && snapshot.account.accountId === command.account.accountId &&
		snapshot.account.environmentId === command.account.environmentId && snapshot.money.mintUrl === command.money.mintUrl &&
		snapshot.money.unit === command.money.unit && snapshot.money.amount === command.money.amount &&
		snapshot.intentFingerprint === command.intentFingerprint;
}

/** Compose the outbox consumer to the app's actual wallet command runner and accepted R5 refund command. */
export function createCommittedBidConsumerPorts(
	persistence: CommittedBidPersistence,
	runner: WalletCommandRunner,
): CommittedBidConsumerPorts {
	if (runner.applicationId !== COMMITTED_BID_WALLET_APPLICATION_ID) throw new Error("committed-bid-wallet-application-mismatch");
	return {
		joins: persistence.joins,
		journal: persistence.journal,
		async refundOriginalSend(join): Promise<"rolled_back" | "pending"> {
			const command: WalletOperationCommand = {
				commandId: `${COMMITTED_BID_REFUND_OPERATION_KIND}:${join.originalSendOperationId}`,
				applicationId: COMMITTED_BID_WALLET_APPLICATION_ID,
				operationKind: COMMITTED_BID_REFUND_OPERATION_KIND,
				account: runner.account,
				money: { mintUrl: join.mintUrl, unit: join.unit, amount: join.testAmount },
				intentFingerprint: join.conditionFingerprint,
			};
			const snapshot = await runner.run(command);
			if (!sameRefundSnapshot(snapshot, command)) throw new Error("committed-bid-wallet-snapshot-conflict");
			if (snapshot.state !== "settled") return "pending";
			if (snapshot.engineOperationId !== join.originalSendOperationId) throw new Error("committed-bid-wallet-terminal-conflict");
			return "rolled_back";
		},
	};
}

function validateCommittedBidEntries(value: unknown): asserts value is readonly CommittedBidEntryV1[] {
	if (!Array.isArray(value) || value.length > 16) throw new Error("committed-bid-batch-profile");
	for (const candidate of value) {
		if (!isRecord(candidate) || !exactKeys(candidate, EXACT_BID_KEYS, ["actor_id", "operation_id", "auction_id", "bid_id", "event_id", "amount", "displaced_refund_eligible"])) throw new Error("committed-bid-entry-shape");
		if (typeof candidate.actor_id !== "string" || !HEX_64.test(candidate.actor_id) || typeof candidate.event_id !== "string" || !HEX_64.test(candidate.event_id) || !nonempty(candidate.operation_id) || !nonempty(candidate.auction_id) || !nonempty(candidate.bid_id) || !Number.isSafeInteger(candidate.amount) || (candidate.amount as number) <= 0 || typeof candidate.displaced_refund_eligible !== "boolean") throw new Error("committed-bid-entry-invalid");
		const displaced = candidate.displaced_refund_eligible;
		const displacementKeys = ["displaced_actor_id", "displaced_operation_id", "displaced_bid_id", "displaced_event_id"];
		const hasAnyDisplacement = displacementKeys.some((key) => Object.prototype.hasOwnProperty.call(candidate, key));
		const hasExactDisplacement = nonempty(candidate.displaced_bid_id) && nonempty(candidate.displaced_operation_id) && typeof candidate.displaced_actor_id === "string" && HEX_64.test(candidate.displaced_actor_id) && typeof candidate.displaced_event_id === "string" && HEX_64.test(candidate.displaced_event_id);
		if ((displaced && !hasExactDisplacement) || (!displaced && hasAnyDisplacement)) throw new Error("committed-bid-entry-displacement");
	}
}

function validateAutomaticCloseEntries(batch: Record<string, unknown>): void {
	const closures = batch.closures;
	if (!Array.isArray(closures) || closures.length > 64) throw new Error("committed-close-batch-profile");
	let priorAuction = "";
	for (const candidate of closures) {
		if (!isRecord(candidate) || !exactKeys(candidate, EXACT_CLOSURE_KEYS, EXACT_CLOSURE_KEYS)) throw new Error("committed-close-entry-shape");
		if (
			candidate.auth_network_id !== batch.auth_network_id || candidate.chain_id !== batch.chain_id || candidate.height !== batch.height ||
			candidate.pbts_seconds !== batch.pbts_seconds || candidate.app_hash !== batch.app_hash || !nonempty(candidate.auction_id) ||
			!Number.isSafeInteger(candidate.effective_end) || (candidate.effective_end as number) < 0 || (candidate.effective_end as number) > (candidate.pbts_seconds as number)
		) throw new Error("committed-close-entry-identity");
		if ((candidate.auction_id as string) <= priorAuction) throw new Error("committed-close-entry-order");
		priorAuction = candidate.auction_id as string;
		if (candidate.close_outcome === "winner") {
			if (!nonempty(candidate.winner_bid_id) || typeof candidate.winner_actor_id !== "string" || !HEX_64.test(candidate.winner_actor_id) || !nonempty(candidate.winner_operation_id) || !Number.isSafeInteger(candidate.amount) || (candidate.amount as number) <= 0) throw new Error("committed-close-entry-winner");
		} else if (candidate.close_outcome === "no_bids" || candidate.close_outcome === "reserve_not_met") {
			if (candidate.winner_bid_id !== "" || candidate.winner_actor_id !== "" || candidate.winner_operation_id !== "" || candidate.amount !== 0) throw new Error("committed-close-entry-no-winner");
		} else {
			throw new Error("committed-close-entry-outcome");
		}
	}
}

export function decodeCommittedBidBatch(raw: string): CommittedBidBatch {
	if (new TextEncoder().encode(raw).byteLength > 64 * 1024) throw new Error("committed-bid-batch-limit");
	let parsed: unknown;
	try { parsed = parseStrictJSON(raw); } catch { throw new Error("committed-bid-batch-malformed"); }
	if (!isRecord(parsed)) throw new Error("committed-bid-batch-shape");
	const v2 = parsed.schema === COMMITTED_AUCTION_BATCH_SCHEMA;
	if (!exactKeys(parsed, v2 ? EXACT_V2_BATCH_KEYS : EXACT_BATCH_KEYS, v2 ? EXACT_V2_BATCH_KEYS : EXACT_BATCH_KEYS)) throw new Error("committed-bid-batch-shape");
	if (
		(!v2 && parsed.schema !== COMMITTED_BID_BATCH_SCHEMA) || parsed.auth_profile !== DEMO_AUTH_PROFILE ||
		typeof parsed.auth_network_id !== "string" || !HEX_64.test(parsed.auth_network_id) ||
		typeof parsed.app_hash !== "string" || !HEX_64.test(parsed.app_hash) ||
		!Number.isSafeInteger(parsed.height) || (parsed.height as number) < 1
	) throw new Error("committed-bid-batch-profile");
	validateCommittedBidEntries(parsed.bids);
	if (v2) {
		if (!nonempty(parsed.chain_id) || !Number.isSafeInteger(parsed.pbts_seconds) || (parsed.pbts_seconds as number) < 0) throw new Error("committed-close-batch-profile");
		validateAutomaticCloseEntries(parsed);
	}
	return parsed as unknown as CommittedBidBatch;
}

/**
 * Canonical Go-compatible V2 history commitment. This deliberately rebuilds
 * every object in the frozen struct field order instead of trusting caller or
 * parser property insertion order. No payment field is added to the batch.
 */
export async function computeCommittedAuctionBatchHistorySha256(values: readonly unknown[]): Promise<string> {
	if (!Array.isArray(values)) throw new Error("committed-bid-batch-history-invalid");
	const ordered = values.map((value) => {
		const decoded = decodeCommittedBidBatch(JSON.stringify(value));
		if (decoded.schema !== COMMITTED_AUCTION_BATCH_SCHEMA) throw new Error("committed-bid-batch-history-v2-required");
		return decoded;
	}).sort((left, right) => left.height - right.height);
	if (ordered.length === 0 || ordered[0]!.height !== 1 || ordered.some((batch, index) => batch.height !== index + 1)) {
		throw new Error("committed-bid-batch-history-incomplete");
	}
	const canonical = ordered.map((batch) => ({
		schema: batch.schema,
		auth_profile: batch.auth_profile,
		auth_network_id: batch.auth_network_id,
		chain_id: batch.chain_id,
		height: batch.height,
		pbts_seconds: batch.pbts_seconds,
		app_hash: batch.app_hash,
		bids: batch.bids.map((bid) => ({
			actor_id: bid.actor_id,
			operation_id: bid.operation_id,
			auction_id: bid.auction_id,
			bid_id: bid.bid_id,
			event_id: bid.event_id,
			amount: bid.amount,
			...(bid.displaced_refund_eligible ? {
				displaced_actor_id: bid.displaced_actor_id,
				displaced_operation_id: bid.displaced_operation_id,
				displaced_bid_id: bid.displaced_bid_id,
				displaced_event_id: bid.displaced_event_id,
			} : {}),
			displaced_refund_eligible: bid.displaced_refund_eligible,
		})),
		closures: batch.closures.map((closure) => ({
			auth_network_id: closure.auth_network_id,
			chain_id: closure.chain_id,
			auction_id: closure.auction_id,
			height: closure.height,
			pbts_seconds: closure.pbts_seconds,
			effective_end: closure.effective_end,
			app_hash: closure.app_hash,
			close_outcome: closure.close_outcome,
			winner_bid_id: closure.winner_bid_id,
			winner_actor_id: closure.winner_actor_id,
			winner_operation_id: closure.winner_operation_id,
			amount: closure.amount,
		})),
	}));
	return sha256Hex(canonicalUtf8Json(canonical));
}

function assertJoin(join: WalletBidJoinV1, batch: CommittedBidBatch, entry: CommittedBidEntryV1): void {
	if (
		join.authNetworkId !== batch.auth_network_id || join.actorId !== entry.displaced_actor_id ||
		join.operationId !== entry.displaced_operation_id || join.auctionId !== entry.auction_id || join.bidId !== entry.displaced_bid_id || join.eventId !== entry.displaced_event_id ||
		join.originalSendOperationId !== join.operationId ||
		!nonempty(join.mintUrl) || !nonempty(join.unit) || !Number.isSafeInteger(join.testAmount) || join.testAmount <= 0 ||
		!Array.isArray(join.publicCommitments) || join.publicCommitments.length === 0 || !join.publicCommitments.every(nonempty) ||
		!HEX_64.test(join.conditionFingerprint) || !Number.isSafeInteger(join.locktime) || join.locktime <= 0 ||
		!Number.isSafeInteger(join.authorityGeneration) || join.authorityGeneration < 0
	) throw new Error("wallet-bid-join-invalid");
}

export async function consumeCommittedBidBatch(raw: string, ports: CommittedBidConsumerPorts): Promise<ConsumeCommittedBidResult> {
	const batch = decodeCommittedBidBatch(raw);
	const batchHash = await sha256Hex(raw);
	const key = `${batch.auth_network_id}/${batch.height}/${batch.app_hash}`;
	const prior = await ports.journal.read(key);
	if (prior && prior.batchHash !== batchHash) throw new Error("committed-bid-batch-key-conflict");
	const replayDelivered = prior?.state === "delivered";
	if (!replayDelivered) await ports.journal.begin(key, batchHash);
	const refunded: string[] = [];
	const unresolved: string[] = [];
	let pending = false;
	for (const entry of batch.bids) {
		if (!entry.displaced_refund_eligible) continue;
		const joins = await ports.joins.find({ authNetworkId: batch.auth_network_id, actorId: entry.displaced_actor_id!, operationId: entry.displaced_operation_id!, auctionId: entry.auction_id, bidId: entry.displaced_bid_id!, eventId: entry.displaced_event_id! });
		if (joins.length !== 1) { unresolved.push(entry.displaced_bid_id!); continue; }
		try { assertJoin(joins[0], batch, entry); } catch { unresolved.push(entry.displaced_bid_id!); continue; }
		const state = await ports.refundOriginalSend(joins[0]);
		if (state === "rolled_back") refunded.push(joins[0].originalSendOperationId); else pending = true;
	}
	if (unresolved.length > 0) return { state: "unresolved", refundedOriginalSendOperations: refunded, unresolvedBidIds: unresolved };
	if (pending) return { state: "pending", refundedOriginalSendOperations: refunded, unresolvedBidIds: [] };
	if (!replayDelivered) await ports.journal.delivered(key, batchHash);
	return { state: replayDelivered ? "duplicate" : "delivered", refundedOriginalSendOperations: refunded, unresolvedBidIds: [] };
}
