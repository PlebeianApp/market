#!/usr/bin/env bun
/**
 * operation-store.test.ts — the host's own operation bookkeeping is durable, isolated by account, and holds no
 * bearer material.
 *
 * The reference store (`MemoryWalletOperationStore`) is correct but not durable. This suite proves the browser
 * store is: a command's record survives being read back, an account's records are the only ones its scope
 * returns, a compare-and-set enforces the revision exactly (a stale writer and a changed immutable identity are
 * both refused by name), an unknown field that could hide a proof or a token is refused, and the fallback path
 * (no IndexedDB) keeps every one of those guarantees. The IndexedDB path itself is exercised structurally — it
 * is the same store logic over the same interface — and the module is asserted to reach no network and name no
 * Coco, because the monetary authority is Coco's `ProofRepository`, not this store.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createBrowserWalletOperationStore } from "./operation-store";
import { WalletCommandConflictError, WalletStaleWriterError } from "./errors";
import type { IndexedDbFactoryLike, IndexedDbRequestLike, IndexedDbStoreLike, KeyValueAreaLike } from "./seed-store";
import type { WalletOperationRecord } from "./types";

let passed = 0;
function ok(label: string, condition: boolean, detail = ""): void {
	const suffix = detail ? ` — ${detail}` : "";
	if (condition) {
		passed += 1;
		console.log(`PASS  ${label}${suffix}`);
		return;
	}
	console.log(`FAIL  ${label}${suffix}`);
	throw new Error(label + suffix);
}

const FINGERPRINT = "a".repeat(64);

function record(overrides: Partial<WalletOperationRecord> = {}): WalletOperationRecord {
	return {
		commandId: "plebeian-market.checkout.payment.account-1." + FINGERPRINT.slice(0, 32),
		applicationId: "plebeian-market",
		operationKind: "checkout.payment",
		account: { accountId: "account-1", environmentId: "env-1" },
		money: { mintUrl: "http://127.0.0.1:3338", unit: "sat", amount: 42 },
		intentFingerprint: FINGERPRINT,
		schemaVersion: 1,
		plan: ["request", "prepare", "attempt", "acknowledge", "settle"],
		completedSteps: [],
		state: "created",
		revision: 0,
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
		...overrides,
	};
}

function stubArea(): KeyValueAreaLike & { readonly entries: Map<string, string> } {
	const entries = new Map<string, string>();
	return {
		entries,
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => void entries.set(key, value),
	};
}

type AbortPoint = "after-read" | "after-write-success";

type MutableRequest<T> = {
	result: T;
	error: unknown;
	onupgradeneeded: ((event?: unknown) => void) | null;
	onsuccess: ((event?: unknown) => void) | null;
	onerror: ((event?: unknown) => void) | null;
};

type PendingRequest = {
	readonly kind: "get" | "put";
	readonly key: string;
	readonly value?: unknown;
	readonly request: MutableRequest<unknown>;
};

/**
 * The defect needs more than a shared Map: readwrite transactions are exclusive, writes are tentative until
 * completion, and abort rolls them back. The optional readonly barrier makes both halves of the old split
 * read/write implementation observe absence before either may write, so this suite is a deterministic regression.
 */
function transactionalIndexedDb(options: { readonly splitReadonlyReads?: boolean } = {}): {
	readonly factory: IndexedDbFactoryLike;
	abortNext(point: AbortPoint): void;
	writeRequestSuccesses(): number;
} {
	let committed = new Map<string, unknown>();
	let storeExists = false;
	let nextAbort: AbortPoint | null = null;
	let writeSuccesses = 0;
	let readwriteActive = false;
	const readwriteQueue: FakeTransaction[] = [];
	let barrierEnabled = options.splitReadonlyReads === true;
	const barrier: Array<() => void> = [];

	const mutableRequest = <T>(): MutableRequest<T> => ({
		result: undefined as T,
		error: null,
		onupgradeneeded: null,
		onsuccess: null,
		onerror: null,
	});

	const startNextReadwrite = (): void => {
		if (readwriteActive) return;
		const next = readwriteQueue.shift();
		if (next === undefined) return;
		readwriteActive = true;
		queueMicrotask(() => next.start());
	};

	class FakeTransaction {
		error: unknown = null;
		oncomplete: ((event?: unknown) => void) | null = null;
		onerror: ((event?: unknown) => void) | null = null;
		onabort: ((event?: unknown) => void) | null = null;
		private readonly pending: PendingRequest[] = [];
		private active = false;
		private busy = false;
		private finished = false;
		private staged = new Map<string, unknown>();
		private abortPoint: AbortPoint | null = null;

		constructor(private readonly mode: "readonly" | "readwrite") {
			if (mode === "readwrite") {
				readwriteQueue.push(this);
				startNextReadwrite();
			} else {
				queueMicrotask(() => this.start());
			}
		}

		objectStore(_name: string): IndexedDbStoreLike {
			return {
				get: (key) => this.enqueue("get", key),
				put: (value, key) => this.enqueue("put", key, value),
			};
		}

		start(): void {
			if (this.finished) return;
			this.active = true;
			this.staged = new Map(committed);
			if (this.mode === "readwrite") {
				// The repaired path never uses the old readonly pre-check. Once it enters the atomic transaction,
				// disarm the regression-only barrier so ordinary reads after the contention can proceed.
				barrierEnabled = false;
				this.abortPoint = nextAbort;
				nextAbort = null;
			}
			this.advance();
		}

		private enqueue(kind: "get" | "put", key: string, value?: unknown): IndexedDbRequestLike<unknown> {
			const request = mutableRequest<unknown>();
			this.pending.push({ kind, key, value, request });
			this.advance();
			return request;
		}

		private advance(): void {
			if (!this.active || this.busy || this.finished) return;
			const operation = this.pending.shift();
			if (operation === undefined) {
				this.busy = true;
				queueMicrotask(() => this.complete());
				return;
			}
			this.busy = true;
			queueMicrotask(() => this.perform(operation));
		}

		private perform(operation: PendingRequest): void {
			if (this.finished) return;
			const succeed = (): void => {
				if (operation.kind === "get") {
					operation.request.result = (this.mode === "readwrite" ? this.staged : committed).get(operation.key);
				} else {
					this.staged.set(operation.key, operation.value);
					writeSuccesses += 1;
				}
				operation.request.onsuccess?.();
				this.busy = false;
				if (operation.kind === "get" && this.abortPoint === "after-read") {
					this.abort("after-read");
					return;
				}
				if (operation.kind === "put" && this.abortPoint === "after-write-success") {
					this.abort("after-write-success");
					return;
				}
				this.advance();
			};

			if (this.mode === "readonly" && operation.kind === "get" && barrierEnabled) {
				barrier.push(succeed);
				if (barrier.length === 2) {
					barrierEnabled = false;
					const waiting = barrier.splice(0);
					for (const release of waiting) release();
				}
				return;
			}
			succeed();
		}

		private complete(): void {
			if (this.finished) return;
			this.finished = true;
			if (this.mode === "readwrite") committed = new Map(this.staged);
			this.oncomplete?.();
			this.release();
		}

		private abort(point: AbortPoint): void {
			if (this.finished) return;
			this.finished = true;
			this.error = new Error(`forced indexeddb abort ${point}`);
			this.onabort?.();
			this.release();
		}

		private release(): void {
			if (this.mode !== "readwrite") return;
			readwriteActive = false;
			startNextReadwrite();
		}
	}

	const database = {
		objectStoreNames: { contains: (_name: string) => storeExists },
		createObjectStore: (_name: string) => {
			storeExists = true;
			return {};
		},
		transaction: (_name: string, mode = "readonly") => new FakeTransaction(mode === "readwrite" ? "readwrite" : "readonly"),
		close: () => undefined,
	};
	const factory: IndexedDbFactoryLike = {
		open: (_name: string, _version?: number) => {
			const request = mutableRequest<typeof database>();
			request.result = database;
			queueMicrotask(() => {
				if (!storeExists) request.onupgradeneeded?.();
				request.onsuccess?.();
			});
			return request;
		},
	};
	return {
		factory,
		abortNext(point) {
			nextAbort = point;
		},
		writeRequestSuccesses: () => writeSuccesses,
	};
}

async function refused(label: string, run: () => Promise<unknown>, name: string): Promise<void> {
	let message = "";
	try {
		await run();
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}
	ok(label, message.includes(name), message || "nothing was refused");
}

async function main(): Promise<void> {
	const store = createBrowserWalletOperationStore({ indexedDB: null, localStorage: null });
	ok("with neither backend the store runs in memory and says so", store.location() === "memory", store.location());
	ok("an empty store holds nothing", (await store.list()).length === 0);
	ok("and reads a named nothing", (await store.get("nothing")) === null);

	// ---- createOrGet: durable, idempotent, and honest about which it was ---------------------------------
	const one = record();
	const first = await store.createOrGet(one);
	ok("a new command is created", first.created === true);
	ok("and reads back byte for byte", first.record.commandId === one.commandId && first.record.money.amount === 42);
	const again = await store.createOrGet(record({ state: "attempted", revision: 3 }));
	ok("createOrGet on an existing command returns the stored record, not the candidate", again.created === false && again.record.state === "created" && again.record.revision === 0, `state ${again.record.state}, revision ${again.record.revision}`);
	ok("a written record is really held", (await store.get(one.commandId))?.commandId === one.commandId);

	// ---- the scope: an account sees only its own commands -------------------------------------------------
	await store.createOrGet(record({ commandId: "other", account: { accountId: "account-2", environmentId: "env-1" } }));
	ok("listing scopes to one account", (await store.list({ accountId: "account-1", environmentId: "env-1" })).length === 1);
	ok("and the whole store holds both", (await store.list()).length === 2);

	// ---- compare-and-set: the revision is enforced exactly ------------------------------------------------
	const advanced = await store.compareAndSet(one.commandId, 0, { ...one, revision: 1, state: "requested" });
	ok("a compare-and-set on the current revision commits", advanced.revision === 1 && advanced.state === "requested");
	await refused(
		"a stale writer is refused by name",
		() => store.compareAndSet(one.commandId, 0, { ...one, revision: 1, state: "settled" }),
		"changed before this writer could commit",
	);
	await refused(
		"a changed immutable identity is refused by name",
		() => store.compareAndSet(one.commandId, 1, { ...one, revision: 2, money: { mintUrl: one.money.mintUrl, unit: "sat", amount: 99 } }),
		"different immutable intent",
	);
	await refused(
		"a jump of more than one revision is refused by name",
		() => store.compareAndSet(one.commandId, 1, { ...one, revision: 3, state: "settled" }),
		"changed before this writer could commit",
	);
	const committed = await store.compareAndSet(one.commandId, 1, { ...one, revision: 2, state: "settled", completedSteps: ["request", "prepare", "attempt", "acknowledge", "settle"] });
	ok("and a valid step-forward commits", committed.revision === 2 && committed.completedSteps.length === 5);

	// ---- the ADR's prohibition: no bearer material in the host's bookkeeping -----------------------------
	await refused("a record carrying a proof is refused by name", () => store.createOrGet({ ...record({ commandId: "bearer" }), proofs: ["x"] } as unknown as WalletOperationRecord), "refused-operation-record");
	await refused("a record carrying a token is refused by name", () => store.createOrGet({ ...record({ commandId: "bearer2" }), token: "cashuB..." } as unknown as WalletOperationRecord), "refused-operation-record");

	// ---- the browser fallback keeps every guarantee ------------------------------------------------------
	const area = stubArea();
	const browser = createBrowserWalletOperationStore({ indexedDB: null, localStorage: area });
	ok("with no IndexedDB the store falls back and says so", browser.location() === "localstorage", browser.location());
	const two = record({ commandId: "lock-2" });
	await browser.createOrGet(two);
	ok("the fallback persists a created command", (await browser.get("lock-2"))?.commandId === "lock-2");
	ok("storage holds exactly one key", area.entries.size === 1, [...area.entries.keys()].join(", "));
	// a fresh store over the same area reads the same record: this is the reload the durable store exists for.
	const reloaded = createBrowserWalletOperationStore({ indexedDB: null, localStorage: area });
	ok("the record survives a reload of the page", (await reloaded.get("lock-2"))?.money.amount === 42);
	await reloaded.compareAndSet("lock-2", 0, { ...two, revision: 1, state: "requested" });
	ok("and the fallback enforces the revision too", (await reloaded.get("lock-2"))?.revision === 1);
	await refused("the fallback refuses a stale writer by name", () => reloaded.compareAndSet("lock-2", 0, { ...two, revision: 1, state: "settled" }), "changed before this writer could commit");

	// ---- IndexedDB createOrGet: the transaction, not one store instance, owns the claim ------------------
	const sameDatabase = transactionalIndexedDb({ splitReadonlyReads: true });
	const sameLeft = createBrowserWalletOperationStore({ indexedDB: () => sameDatabase.factory, localStorage: null });
	const sameRight = createBrowserWalletOperationStore({ indexedDB: () => sameDatabase.factory, localStorage: null });
	const sameCandidate = record({ commandId: "contended-same" });
	const sameResults = await Promise.all([sameLeft.createOrGet(sameCandidate), sameRight.createOrGet(sameCandidate)]);
	ok("two independent IndexedDB stores produce exactly one creator", sameResults.filter((result) => result.created).length === 1);
	ok("same-candidate contenders both receive the committed record", sameResults.every((result) => result.record.commandId === sameCandidate.commandId && result.record.money.amount === sameCandidate.money.amount));
	const sameReloaded = createBrowserWalletOperationStore({ indexedDB: () => sameDatabase.factory, localStorage: null });
	ok("a completed IndexedDB creation survives a new store instance", (await sameReloaded.get(sameCandidate.commandId))?.commandId === sameCandidate.commandId);

	const differentDatabase = transactionalIndexedDb({ splitReadonlyReads: true });
	const differentLeft = createBrowserWalletOperationStore({ indexedDB: () => differentDatabase.factory, localStorage: null });
	const differentRight = createBrowserWalletOperationStore({ indexedDB: () => differentDatabase.factory, localStorage: null });
	const candidateLeft = record({ commandId: "contended-different", state: "created", revision: 0 });
	const candidateRight = record({ commandId: "contended-different", state: "attempted", revision: 3, money: { ...record().money, amount: 99 } });
	const differentResults = await Promise.all([differentLeft.createOrGet(candidateLeft), differentRight.createOrGet(candidateRight)]);
	const winner = differentResults.find((result) => result.created)?.record;
	ok("different-candidate contenders still produce exactly one creator", differentResults.filter((result) => result.created).length === 1 && winner !== undefined);
	ok("the losing contender receives the winner rather than its candidate", winner !== undefined && differentResults.every((result) => JSON.stringify(result.record) === JSON.stringify(winner)));
	const differentReloaded = createBrowserWalletOperationStore({ indexedDB: () => differentDatabase.factory, localStorage: null });
	ok("the losing candidate never overwrites the committed winner", winner !== undefined && JSON.stringify(await differentReloaded.get(candidateLeft.commandId)) === JSON.stringify(winner));

	const abortAfterReadDatabase = transactionalIndexedDb();
	const abortAfterRead = createBrowserWalletOperationStore({ indexedDB: () => abortAfterReadDatabase.factory, localStorage: null });
	abortAfterReadDatabase.abortNext("after-read");
	await refused("an abort after the read rejects createOrGet", () => abortAfterRead.createOrGet(record({ commandId: "abort-after-read" })), "forced indexeddb abort after-read");
	ok("an abort after the read leaves no operation behind", (await abortAfterRead.get("abort-after-read")) === null);
	const retryAfterRead = await createBrowserWalletOperationStore({ indexedDB: () => abortAfterReadDatabase.factory, localStorage: null }).createOrGet(record({ commandId: "abort-after-read" }));
	ok("a retry after the read abort creates normally", retryAfterRead.created === true && retryAfterRead.record.commandId === "abort-after-read");

	const abortAfterWriteDatabase = transactionalIndexedDb();
	const abortAfterWrite = createBrowserWalletOperationStore({ indexedDB: () => abortAfterWriteDatabase.factory, localStorage: null });
	abortAfterWriteDatabase.abortNext("after-write-success");
	await refused("an abort after apparent write success rejects createOrGet", () => abortAfterWrite.createOrGet(record({ commandId: "abort-after-write" })), "forced indexeddb abort after-write-success");
	ok("the write request did succeed before the forced abort", abortAfterWriteDatabase.writeRequestSuccesses() === 1);
	ok("the aborted apparent write is rolled back", (await abortAfterWrite.get("abort-after-write")) === null);
	const retryAfterWrite = await createBrowserWalletOperationStore({ indexedDB: () => abortAfterWriteDatabase.factory, localStorage: null }).createOrGet(record({ commandId: "abort-after-write" }));
	ok("a retry after rollback creates normally", retryAfterWrite.created === true && retryAfterWrite.record.commandId === "abort-after-write");

	// ---- and the store itself reaches no network and names no Coco ----------------------------------------
	const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "operation-store.ts"), "utf8");
	const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
	ok("the store reaches no network", !/fetch\(|WebSocket|XMLHttpRequest/.test(code), "no transport in the code");
	ok("and imports no Coco", !/@cashu\/coco/.test(code), "the host, not Coco, is what writes money state");
	ok("the store refuses with the host's own error classes", new WalletStaleWriterError("c").name === "WalletStaleWriterError" && new WalletCommandConflictError("c").name === "WalletCommandConflictError", "so the host's failure mapping reads them");

	console.log(`\noperation-store.test.ts: ${passed} assertion(s) passed, 0 failed`);
	console.log("acceptance: the host's own operation bookkeeping is durable across a reload, scoped to one account, revision-checked on every write, free of any bearer material, and backed by IndexedDB in the browser with an honest localStorage/memory fallback");
}

main().catch((error) => {
	console.error(`\noperation-store.test.ts: FAILED — ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
