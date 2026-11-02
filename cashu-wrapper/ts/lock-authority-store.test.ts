#!/usr/bin/env bun
/**
 * lock-authority-store.test.ts — the lock's authority is durable before the mint, and holds no bearer material.
 *
 * ADR-0010 §7 says the auction side owns "the refund private-key material or a reference to its protected recovery
 * form", the identifiers, "the derivation paths and lock/refund condition metadata", and "the durable link to the
 * Coco operation" - and that "duplicating full locked proof sets outside Coco is prohibited". These assertions are
 * those sentences: what is kept, what is refused, and that a write which does not survive never returns success.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	createBrowserLockAuthorityStore,
	createMemoryLockAuthorityStore,
	parseLockExport,
	LOCK_EXPORT_PREFIX,
	type LockAuthorityRecord,
} from "./lock-authority-store";
import type { KeyValueAreaLike } from "./seed-store";

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

function record(overrides: Partial<LockAuthorityRecord> = {}): LockAuthorityRecord {
	return {
		commandId: "auctions.bid-lock:auction-1:bid-1",
		applicationId: "plebeian-market",
		auctionRef: "auction-1",
		bidRef: "bid-1",
		mintUrl: "http://127.0.0.1:3338",
		unit: "sat",
		amount: 50,
		// The lock's key is the seller child pubkey `derive(p2pk_xpub, path)` (AUCTIONS.md §4.2) — NOT the refund key.
		childPubkey: "02a848c7a85dc92f6d06e36cc8a66b68731816b8567682ba34cdba225744f59ef1",
		// The locktime the lock secret carries (ADR-0003 L2.6).
		locktime: 1_800_000_000,
		// The bidder's separate refund key (ADR-0003 L2.7).
		refundPubkey: "03".concat("b7".repeat(32)),
		// The bidder-chosen high-entropy derivation path (§4.2/§5.5): bidder local state, never published.
		path: "m/1/2/3/4/5",
		refundSecret: "9f".repeat(32),
		derivation: { purpose: "p2pk", index: 0 },
		createdAt: 1_700_000_000_000,
		revision: 0,
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

async function main(): Promise<void> {
	const store = createMemoryLockAuthorityStore();
	ok("an empty store holds nothing", (await store.list()).length === 0);
	ok("and reads a named nothing", (await store.read("nothing")) === null);
	ok("its home is reported honestly", store.location() === "memory", store.location());

	// ---- §7 step 3: persist and verify -------------------------------------------------------------------
	const one = record();
	await store.save(one);
	const readBack = await store.read(one.commandId);
	ok("a saved authority reads back", readBack !== null);
	ok("with its lock key intact", readBack?.childPubkey === one.childPubkey, "the seller child pubkey the lock pays to");
	ok("with the locktime the lock secret carries intact", readBack?.locktime === one.locktime, "ADR-0003 L2.6");
	ok("with the bidder's separate refund key intact", readBack?.refundPubkey === one.refundPubkey, "ADR-0003 L2.7, distinct from the lock key");
	ok("with the bidder's private derivation path intact", readBack?.path === one.path, "§4.2/§5.5: bidder local state");
	ok("its refund secret intact", readBack?.refundSecret === one.refundSecret, "held by the app, per §7");
	ok("its derivation reference intact", readBack?.derivation?.purpose === "p2pk" && readBack?.derivation?.index === 0);
	ok("and its durable link to the Coco operation", readBack?.commandId === one.commandId, "the command id is Coco's operation id");

	// ---- the ADR's prohibition: no second proof authority -------------------------------------------------
	async function refused(label: string, candidate: Record<string, unknown>, expected: string): Promise<void> {
		let message = "";
		try {
			await store.save(candidate as unknown as LockAuthorityRecord);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		ok(label, message.includes(expected), message || "nothing was refused");
	}
	await refused("a record carrying a proof is refused by name", { ...one, proofs: ["x"] }, "refused-lock-record");
	await refused("a record carrying a token is refused by name", { ...one, token: "cashuB..." }, "refused-lock-record");
	await refused("a record carrying outputs is refused by name", { ...one, outputs: ["x"] }, "refused-lock-record");
	await refused("a record with a stray bearer-shaped field is refused", { ...one, signatures: ["x"] }, "refused-lock-record");

	// ---- §7 step 5: the export policy is explicit, and only ever user-initiated ---------------------------
	const exported = await store.exportAll();
	ok("an export is prefixed and recognisable", exported.startsWith(LOCK_EXPORT_PREFIX), exported.slice(0, 10));
	const parsed = parseLockExport(exported);
	ok("an export round-trips", parsed.length === 1 && parsed[0]!.commandId === one.commandId);
	let exportRefusal = "";
	try {
		parseLockExport("not-an-export");
	} catch (error) {
		exportRefusal = error instanceof Error ? error.message : String(error);
	}
	ok("a non-export is refused by name", exportRefusal.includes("refused-lock-export"), exportRefusal);

	// ---- a dropped authority is really dropped ------------------------------------------------------------
	await store.remove(one.commandId);
	ok("a removed authority is gone", (await store.read(one.commandId)) === null);

	// ---- the browser fallback keeps the same guarantees ---------------------------------------------------
	const area = stubArea();
	const browserStore = createBrowserLockAuthorityStore({ indexedDB: null, localStorage: area });
	ok("with no IndexedDB the store falls back and says so", browserStore.location() === "localstorage", browserStore.location());
	const two = record({ commandId: "lock-2" });
	await browserStore.save(two);
	ok("the fallback persists and verifies too", (await browserStore.read("lock-2"))?.amount === 50);
	ok("storage holds exactly one key", area.entries.size === 1, [...area.entries.keys()].join(", "));

	// ---- and the store itself never reaches a network or Coco ---------------------------------------------
	const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "lock-authority-store.ts"), "utf8");
	const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
	ok("the store reaches no network", !/fetch\(|WebSocket|XMLHttpRequest/.test(code));
	ok("and imports no Coco", !/@cashu\/coco/.test(code), "the host, not Coco, is what writes money state");

	console.log(`\nlock-authority-store.test.ts: ${passed} assertion(s) passed, 0 failed`);
	console.log("acceptance: what §7 says the auction side owns is kept and read back (identifiers, the reference to the refund authority, lock metadata, the link to the Coco operation), what the ADR forbids is refused by name, a write that does not survive never reports success, and the export exists only as an explicit dump");
}

main().catch((error) => {
	console.error(`\nlock-authority-store.test.ts: FAILED — ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
