/**
 * seed-store.ts — where the wallet's seed lives, and the rules that keep it there.
 *
 * ## Why this is ours to own
 *
 * ADR-0010's Coco config takes `seedGetter: () => Promise<Uint8Array>`: **Coco is handed the seed and stores
 * none itself.** The repositories Coco persists (proofs, tokens, operations, quotes) are monetary authority; the
 * seed is not among them, and the host's durable records are written so that no field could hold one. So custody
 * is the app's, and with it four rules this module is written to keep:
 *
 *   1. the seed is generated **in this browser** (`crypto.getRandomValues`, 32 bytes) and never derived, guessed
 *      or defaulted to a constant;
 *   2. it lives in **this browser's own storage** — IndexedDB, falling back to localStorage when IndexedDB is
 *      unavailable — and in nothing else: no domain store, no operation record, no cart, no order, no event;
 *   3. reading never creates: a browser with no seed reads `null` and stays that way until `ensure()` is called,
 *      so a page load never silently mints a wallet identity;
 *   4. it is never logged and never sent. The only way it leaves the browser is `export()`, which is an explicit,
 *      user-initiated dump, and `import()`, which is the matching restore.
 *
 * The auction gate in ADR-0010 §7 leans on this: a refund authority that is not durably persisted fails closed
 * *before* the mint boundary, and this store is where "durably" begins.
 */

/**
 * 64 bytes: one seed, from the platform's own generator.
 *
 * 64 and not 32 is Coco's own requirement, not a preference: its `SeedService` refuses a `seedGetter` that returns
 * anything other than a 64-byte `Uint8Array` ("seedGetter must return a 64-byte Uint8Array"), so a store that
 * kept 32 would authenticate nothing and fail at the first mint call. The size is pinned here, and asserted.
 */
export const SEED_BYTES = 64;
/** The export's prefix, so a pasted seed is recognisable and a wrong string fails by name. */
export const SEED_EXPORT_PREFIX = "pbseed1:";
/** One IndexedDB database, one object store, one key: the seed and nothing else. */
const DB_NAME = "plebeian-wallet";
const STORE_NAME = "seed";
const RECORD_KEY = "wallet-seed-v1";
const LOCAL_KEY = "plebeian.wallet.seed.v1";
const SEED_NAMESPACE = /^[A-Za-z0-9_.:@-]{1,256}$/;

export type SeedLocation = "indexeddb" | "localstorage" | "memory";

/**
 * The storage surfaces this module needs, declared structurally rather than taken from the DOM's lib. This module
 * is app-neutral: a browser's real `IDBFactory` and `Storage` satisfy these shapes unchanged, a worker or a test
 * can supply its own, and nothing here forces a DOM lib on every consumer of the wallet host.
 */
export interface IndexedDbRequestLike<T> {
	readonly result: T;
	readonly error: unknown;
	onupgradeneeded?: ((event?: unknown) => void) | null;
	onsuccess?: ((event?: unknown) => void) | null;
	onerror?: ((event?: unknown) => void) | null;
}
export interface IndexedDbStoreLike {
	get(key: string): IndexedDbRequestLike<unknown>;
	put(value: unknown, key: string): IndexedDbRequestLike<unknown>;
}
export interface IndexedDbDatabaseLike {
	readonly objectStoreNames: { contains(name: string): boolean };
	createObjectStore(name: string): unknown;
	transaction(name: string, mode?: string): { objectStore(name: string): IndexedDbStoreLike };
	close(): void;
}
export interface IndexedDbFactoryLike {
	open(name: string, version?: number): IndexedDbRequestLike<IndexedDbDatabaseLike>;
}
/** localStorage, and anything shaped like it. */
export interface KeyValueAreaLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface SeedStore {
	/** The seed, or `null` when this browser has none. Reading never creates one. */
	read(): Promise<Uint8Array | null>;
	/** The seed, generated and persisted when absent. Idempotent: the second call returns the first seed. */
	ensure(): Promise<Uint8Array>;
	/** The explicit, user-initiated dump the ADR's disaster-recovery policy requires. */
	export(): Promise<string>;
	/** The matching restore, for a browser move or a recovery. */
	import(text: string): Promise<void>;
	/** Where the seed actually lives right now, so a caller can say so out loud. */
	location(): SeedLocation;
}

/** Hex, without `Buffer` or base64 libraries: this module must run in a browser and in `bun` unchanged. */
function toHex(bytes: Uint8Array): string {
	// An index loop, not `for...of`: this project's target has no `downlevelIteration`, and a Uint8Array is not
	// iterable without it.
	let out = "";
	for (let index = 0; index < bytes.length; index += 1) out += bytes[index]!.toString(16).padStart(2, "0");
	return out;
}

function fromHex(text: string): Uint8Array | null {
	const clean = text.trim().toLowerCase();
	if (clean.length !== SEED_BYTES * 2 || !/^[0-9a-f]+$/.test(clean)) return null;
	const bytes = new Uint8Array(SEED_BYTES);
	for (let i = 0; i < SEED_BYTES; i += 1) bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	return bytes;
}

/** Reject a seed that is the wrong size or all zeros: a wallet that "has a seed" but cannot be restored is worse
 *  than one that admits it has none. */
function assertUsableSeed(bytes: Uint8Array, source: string): Uint8Array {
	if (bytes.length !== SEED_BYTES) {
		throw new Error(`refused-seed-size: ${source} handed ${bytes.length} bytes, and a seed is ${SEED_BYTES}`);
	}
	if (bytes.every((byte) => byte === 0)) {
		throw new Error(`refused-seed-empty: ${source} handed an all-zero seed, which is not a key`);
	}
	return bytes;
}

function generate(): Uint8Array {
	const bytes = new Uint8Array(SEED_BYTES);
	globalThis.crypto.getRandomValues(bytes);
	return bytes;
}

/** Parse an export, refusing anything that is not one, by name. */
export function parseSeedExport(text: string): Uint8Array {
	const trimmed = text.trim();
	if (!trimmed.startsWith(SEED_EXPORT_PREFIX)) {
		throw new Error(`refused-seed-export: an export starts with ${SEED_EXPORT_PREFIX}`);
	}
	const bytes = fromHex(trimmed.slice(SEED_EXPORT_PREFIX.length));
	if (bytes === null) throw new Error("refused-seed-export: the export carries no usable seed");
	return assertUsableSeed(bytes, "the export");
}

/** The host's `seedGetter`, over this store: the one line Coco needs, and nothing more. */
export function seedGetterFor(store: SeedStore): () => Promise<Uint8Array> {
	return async () => store.ensure();
}

// ---------------------------------------------------------------------------------------------------------
// The browser store: IndexedDB when it is there, localStorage when it is not, memory when neither is (tests).
// ---------------------------------------------------------------------------------------------------------

interface SeedBackend {
	readonly location: SeedLocation;
	load(): Promise<Uint8Array | null>;
	save(bytes: Uint8Array): Promise<void>;
}

function indexedDbBackend(factory: () => IndexedDbFactoryLike, recordKey: string): SeedBackend {
	const open = (): Promise<IndexedDbDatabaseLike> =>
		new Promise((resolve, reject) => {
			const request = factory().open(DB_NAME, 1);
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new Error("indexeddb refused to open"));
		});
	const withStore = async <T>(mode: "readonly" | "readwrite", run: (store: IndexedDbStoreLike) => IndexedDbRequestLike<unknown>): Promise<T> => {
		const db = await open();
		try {
			return await new Promise<T>((resolve, reject) => {
				const transaction = db.transaction(STORE_NAME, mode);
				const request = run(transaction.objectStore(STORE_NAME));
				request.onsuccess = () => resolve(request.result as T);
				request.onerror = () => reject(request.error ?? new Error("indexeddb refused the request"));
			});
		} finally {
			db.close();
		}
	};
	return {
		location: "indexeddb",
		async load(): Promise<Uint8Array | null> {
			const value = await withStore<string | undefined>("readonly", (store) => store.get(recordKey));
			if (typeof value !== "string") return null;
			return fromHex(value);
		},
		async save(bytes: Uint8Array): Promise<void> {
			await withStore<unknown>("readwrite", (store) => store.put(toHex(bytes), recordKey));
		},
	};
}

function localStorageBackend(area: KeyValueAreaLike, localKey: string): SeedBackend {
	return {
		location: "localstorage",
		async load(): Promise<Uint8Array | null> {
			const value = area.getItem(localKey);
			return value === null ? null : fromHex(value);
		},
		async save(bytes: Uint8Array): Promise<void> {
			area.setItem(localKey, toHex(bytes));
		},
	};
}

/** The store the browser composition root gets. It picks its backend once, on first use, and says which. */
export function createBrowserSeedStore(options: {
	readonly indexedDB?: (() => IndexedDbFactoryLike) | null;
	readonly localStorage?: KeyValueAreaLike | null;
	/** Separate deterministic Coco counters must never share one seed. */
	readonly namespace?: string;
} = {}): SeedStore {
	// One cast, at the browser boundary and nowhere else: the platform's own objects are handed to us as-is.
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
	const namespace = options.namespace;
	if (namespace !== undefined && !SEED_NAMESPACE.test(namespace)) {
		throw new Error("refused-seed-namespace: the wallet namespace is invalid");
	}
	const recordKey = namespace === undefined ? RECORD_KEY : `${RECORD_KEY}:${namespace}`;
	const localKey = namespace === undefined ? LOCAL_KEY : `${LOCAL_KEY}:${namespace}`;
	const picked: SeedBackend = factory !== null
		? indexedDbBackend(factory, recordKey)
		: area !== null ? localStorageBackend(area, localKey) : memoryBackend();
	return storeOver(picked);
}

/** A store in memory only: correct behaviour, no durability. For tests, and for a browser that withheld both. */
export function createMemorySeedStore(initial?: Uint8Array): SeedStore {
	return storeOver(memoryBackend(initial));
}

function memoryBackend(initial?: Uint8Array): SeedBackend {
	let held: Uint8Array | null = initial ?? null;
	return {
		location: "memory",
		async load(): Promise<Uint8Array | null> {
			return held === null ? null : Uint8Array.from(held);
		},
		async save(bytes: Uint8Array): Promise<void> {
			held = Uint8Array.from(bytes);
		},
	};
}

function storeOver(backend: SeedBackend): SeedStore {
	return {
		location: () => backend.location,
		async read(): Promise<Uint8Array | null> {
			const bytes = await backend.load();
			return bytes === null ? null : assertUsableSeed(bytes, "this browser's storage");
		},
		async ensure(): Promise<Uint8Array> {
			const existing = await this.read();
			if (existing !== null) return existing;
			const fresh = generate();
			await backend.save(fresh);
			// Read back what storage actually kept: a write that did not survive is not custody.
			const confirmed = await backend.load();
			if (confirmed === null) throw new Error("refused-seed-unwritten: the seed was generated but storage kept nothing");
			return assertUsableSeed(confirmed, "this browser's storage");
		},
		async export(): Promise<string> {
			const bytes = await this.ensure();
			return `${SEED_EXPORT_PREFIX}${toHex(bytes)}`;
		},
		async import(text: string): Promise<void> {
			const bytes = parseSeedExport(text);
			await backend.save(bytes);
			const confirmed = await backend.load();
			if (confirmed === null || toHex(confirmed) !== toHex(bytes)) {
				throw new Error("refused-seed-unwritten: the imported seed did not survive the write");
			}
		},
	};
}
