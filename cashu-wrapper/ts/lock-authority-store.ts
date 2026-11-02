/**
 * lock-authority-store.ts — the one piece of a locked bid that Coco cannot reconstruct, held durably before the mint.
 *
 * ## Why this exists at all
 *
 * ADR-0010 §7 is precise about a P2PK auction lock, and it is precise about *order*:
 *
 *   1. create the Coco operation identity;
 *   2. generate or obtain the refund authority;
 *   3. **durably persist and verify the refund authority**;
 *   4. bind it to the account, the auction, the bid or rebid leg, the mint, the unit, the lock conditions and the
 *      Coco operation identity;
 *   5. place every non-seed-derived refund authority under an explicit, user-controlled disaster-recovery or export
 *      policy for the lifetime of the lock;
 *   6. **then** let the Coco operation cross the mint boundary.
 *
 * and: "**storage or recovery-policy failure fails closed before the mint lock**". The §7 storage split then says what
 * belongs here and what does not: the auction side owns the refund private-key material *or a reference to its
 * protected recovery form*, the auction/bid/rebid/settlement identifiers, the derivation paths and lock/refund
 * condition metadata, and the durable link to the Coco operation - while "duplicating full locked proof sets outside
 * Coco is prohibited". So this store holds exactly the first list, and it holds **no proof, no token and no locked
 * output**: those live in Coco's proof repository, which is the only local authority for them.
 *
 * ## Why the write is verified rather than assumed
 *
 * Step 3 says persist *and verify*, and step 6 says a failure fails closed. A store that writes and returns is not
 * enough: `save()` writes, reads back, and throws by name if the bytes did not survive - so a caller that reaches
 * step 6 knows the authority is genuinely recoverable, and a caller that does not cannot lock anything.
 */

import type { IndexedDbFactoryLike, KeyValueAreaLike } from "./seed-store";
import { RefusedError } from "./errors";

/** The export prefix, so a pasted disaster-recovery dump is recognisable and a wrong string fails by name. */
export const LOCK_EXPORT_PREFIX = "pblock1:";

const DB_NAME = "plebeian-wallet";
const STORE_NAME = "lock-authorities";
const LOCAL_KEY = "plebeian.wallet.lock-authorities.v1";

/**
 * One lock's authority: the durable link between an auctioned bid and the money Coco is holding for it. Every field
 * is here because §7's step 4 names it; there is deliberately no field for a proof, a token or an output.
 */
export interface LockAuthorityRecord {
	/** The host's durable command id, which is also Coco's operation id - the link §7 step 4 asks for. */
	readonly commandId: string;
	readonly applicationId: string;
	readonly auctionRef: string;
	readonly bidRef: string;
	readonly mintUrl: string;
	readonly unit: string;
	readonly amount: number;
	/**
	 * The lock's public key: NUT-11 `data` — the seller child pubkey `derive(auction.p2pk_xpub, path)` the proofs
	 * are locked to (AUCTIONS.md §4.2, ADR-0003 L2.5). It is **not** the refund key: those are two different keys
	 * on purpose, and conflating them was the fake-lock defect.
	 */
	readonly childPubkey: string;
	/** The locktime inside the lock secret: `max_end_at + settlement_grace` (AUCTIONS.md §5.2, ADR-0003 L2.6). */
	readonly locktime: number;
	/** The bidder's refund key inside the lock secret (ADR-0003 L2.7): a key this app can sign with, not the lock key. */
	readonly refundPubkey: string;
	/**
	 * The bidder-chosen high-entropy derivation path (AUCTIONS.md §4.2/§5.5): **bidder local state**, never
	 * published. ADR-0010 §7 step 4 lists "the derivation paths" among the facts this store owns, so it lives here
	 * beside the authority and nowhere else.
	 */
	readonly path: string;
	/** The refund secret in hex, when this app is holding it. Absent where only a reference is kept. */
	readonly refundSecret?: string;
	/** The derivation reference for a seed-derived authority: purpose and index, per §7's "derivation paths". */
	readonly derivation?: { readonly purpose: string; readonly index: number };
	/** Lock and refund condition metadata: what the lock actually demands, in the app's own words. */
	readonly conditions?: string;
	readonly createdAt: number;
	readonly revision: number;
}

export interface LockAuthorityStore {
	/**
	 * Persist and **verify** a lock authority. Throws by name when the write did not survive, so a caller can fail
	 * closed before the mint rather than lock money it cannot reclaim.
	 */
	save(record: LockAuthorityRecord): Promise<void>;
	read(commandId: string): Promise<LockAuthorityRecord | null>;
	list(): Promise<readonly LockAuthorityRecord[]>;
	/** The explicit, user-initiated dump §7 step 5 asks for. Never called automatically. */
	exportAll(): Promise<string>;
	/** Drop an authority once its lock has been refunded or claimed and it has no further use. */
	remove(commandId: string): Promise<void>;
	/** Where it actually lives right now, so a caller can say so out loud. */
	location(): string;
}

/** Refuse a record that would put bearer material in this store: the ADR forbids a second proof authority. */
function assertNoBearerMaterial(record: LockAuthorityRecord): void {
	const extra = Object.keys(record).filter(
		(key) => !["commandId", "applicationId", "auctionRef", "bidRef", "mintUrl", "unit", "amount", "childPubkey", "locktime", "refundPubkey", "path", "refundSecret", "derivation", "conditions", "createdAt", "revision"].includes(key),
	);
	if (extra.length > 0) {
		throw new RefusedError(`refused-lock-record: this store holds no field called ${extra.join(", ")} - proofs and tokens live in Coco`);
	}
	const suspicious = JSON.stringify(record).match(/"(proof[s]?|token|outputs?|blinded|signature)"\s*:/i);
	if (suspicious !== null) {
		throw new RefusedError(`refused-lock-record: this store holds no bearer material, and \`${suspicious[1]}\` is bearer material`);
	}
}

interface Backend {
	readonly location: string;
	loadAll(): Promise<readonly LockAuthorityRecord[]>;
	put(record: LockAuthorityRecord): Promise<void>;
	remove(commandId: string): Promise<void>;
}

function memoryBackend(initial: readonly LockAuthorityRecord[] = []): Backend {
	const held = new Map<string, LockAuthorityRecord>();
	for (let index = 0; index < initial.length; index += 1) {
		const record = initial[index]!;
		held.set(record.commandId, record);
	}
	return {
		location: "memory",
		async loadAll() {
			const out: LockAuthorityRecord[] = [];
			held.forEach((record) => out.push(record));
			return out;
		},
		async put(record) {
			held.set(record.commandId, record);
		},
		async remove(commandId) {
			held.delete(commandId);
		},
	};
}

function localStorageBackend(area: KeyValueAreaLike): Backend {
	const load = (): LockAuthorityRecord[] => {
		const raw = area.getItem(LOCAL_KEY);
		if (raw === null) return [];
		try {
			const parsed: unknown = JSON.parse(raw);
			return Array.isArray(parsed) ? (parsed as LockAuthorityRecord[]) : [];
		} catch {
			return [];
		}
	};
	const write = (records: readonly LockAuthorityRecord[]): void => area.setItem(LOCAL_KEY, JSON.stringify(records));
	return {
		location: "localstorage",
		async loadAll() {
			return load();
		},
		async put(record) {
			const kept = load().filter((existing) => existing.commandId !== record.commandId);
			kept.push(record);
			write(kept);
		},
		async remove(commandId) {
			write(load().filter((record) => record.commandId !== commandId));
		},
	};
}

/** IndexedDB, structurally typed for the same reason `seed-store.ts` is: this module stays free of DOM libs. */
function indexedDbBackend(factory: () => IndexedDbFactoryLike): Backend {
	const open = (): Promise<{
		readonly objectStoreNames: { contains(name: string): boolean };
		createObjectStore(name: string): unknown;
		transaction(name: string, mode?: string): { objectStore(name: string): { get(key: string): unknown; put(value: unknown, key: string): unknown; delete(key: string): unknown; getAll?(): unknown } };
		close(): void;
	}> =>
		new Promise((resolve, reject) => {
			const request = factory().open(DB_NAME, 1) as unknown as {
				result: never;
				onupgradeneeded: (() => void) | null;
				onsuccess: (() => void) | null;
				onerror: (() => void) | null;
				error?: unknown;
			};
			request.onupgradeneeded = () => {
				const db = request.result as unknown as { objectStoreNames: { contains(name: string): boolean }; createObjectStore(name: string): unknown };
				if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new Error("indexeddb refused to open"));
		});

	const withStore = async <T>(mode: "readonly" | "readwrite", run: (store: never) => unknown): Promise<T> => {
		const db = await open();
		try {
			return await new Promise<T>((resolve, reject) => {
				const transaction = db.transaction(STORE_NAME, mode);
				const store = transaction.objectStore(STORE_NAME) as unknown as never;
				const request = run(store) as unknown as { result: T; onsuccess: (() => void) | null; onerror: (() => void) | null; error?: unknown };
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error ?? new Error("indexeddb refused the request"));
			});
		} finally {
			db.close();
		}
	};

	return {
		location: "indexeddb",
		async loadAll() {
			return await withStore<readonly LockAuthorityRecord[]>("readonly", (store) => (store as unknown as { getAll(): unknown }).getAll());
		},
		async put(record) {
			await withStore<unknown>("readwrite", (store) => (store as unknown as { put(value: unknown, key: string): unknown }).put(record, record.commandId));
		},
		async remove(commandId) {
			await withStore<unknown>("readwrite", (store) => (store as unknown as { delete(key: string): unknown }).delete(commandId));
		},
	};
}

/** The browser store: IndexedDB where it exists, localStorage where it does not, memory otherwise (tests). */
export function createBrowserLockAuthorityStore(
	options: { readonly indexedDB?: (() => IndexedDbFactoryLike) | null; readonly localStorage?: KeyValueAreaLike | null } = {},
): LockAuthorityStore {
	const platform = globalThis as unknown as { indexedDB?: unknown; localStorage?: unknown };
	const factory: (() => IndexedDbFactoryLike) | null =
		options.indexedDB === undefined
			? typeof platform.indexedDB !== "undefined"
				? () => platform.indexedDB as IndexedDbFactoryLike
				: null
			: options.indexedDB;
	const area: KeyValueAreaLike | null =
		options.localStorage === undefined
			? typeof platform.localStorage !== "undefined" && platform.localStorage !== null
				? (platform.localStorage as KeyValueAreaLike)
				: null
			: options.localStorage;
	return storeOver(factory !== null ? indexedDbBackend(factory) : area !== null ? localStorageBackend(area) : memoryBackend());
}

/** A store in memory only: correct behaviour, no durability. For tests. */
export function createMemoryLockAuthorityStore(initial?: readonly LockAuthorityRecord[]): LockAuthorityStore {
	return storeOver(memoryBackend(initial));
}

function storeOver(backend: Backend): LockAuthorityStore {
	return {
		location: () => backend.location,
		async save(record: LockAuthorityRecord): Promise<void> {
			assertNoBearerMaterial(record);
			await backend.put(record);
			// §7 step 3: persist *and verify*. A read-back that disagrees means the authority is not recoverable, and
			// the caller must be able to fail closed *before* the mint rather than after.
			const confirmed = (await backend.loadAll()).find((held) => held.commandId === record.commandId);
			if (confirmed === undefined) {
				throw new RefusedError(`refused-lock-unwritten: the lock authority for ${record.commandId} did not survive the write`);
			}
			if (confirmed.childPubkey !== record.childPubkey || (confirmed.refundSecret ?? "") !== (record.refundSecret ?? "")) {
				throw new RefusedError(`refused-lock-mismatch: the stored authority for ${record.commandId} does not match what was written`);
			}
		},
		async read(commandId: string): Promise<LockAuthorityRecord | null> {
			return (await backend.loadAll()).find((record) => record.commandId === commandId) ?? null;
		},
		async list(): Promise<readonly LockAuthorityRecord[]> {
			return await backend.loadAll();
		},
		async exportAll(): Promise<string> {
			const records = await backend.loadAll();
			return `${LOCK_EXPORT_PREFIX}${JSON.stringify(records)}`;
		},
		async remove(commandId: string): Promise<void> {
			await backend.remove(commandId);
		},
	};
}

/** Parse an export, refusing anything that is not one, by name. */
export function parseLockExport(text: string): readonly LockAuthorityRecord[] {
	const trimmed = text.trim();
	if (!trimmed.startsWith(LOCK_EXPORT_PREFIX)) {
		throw new RefusedError(`refused-lock-export: an export starts with ${LOCK_EXPORT_PREFIX}`);
	}
	try {
		const parsed: unknown = JSON.parse(trimmed.slice(LOCK_EXPORT_PREFIX.length));
		if (!Array.isArray(parsed)) throw new RefusedError("not a list");
		return parsed as readonly LockAuthorityRecord[];
	} catch {
		throw new RefusedError("refused-lock-export: the export carries no readable lock authorities");
	}
}
