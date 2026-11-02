#!/usr/bin/env bun
/**
 * seed-store.test.ts — the seed stays in the browser, and this proves it stays there alone.
 *
 * ADR-0010 hands Coco the seed through `seedGetter` and stores none itself, so custody is the app's. These
 * assertions are the custody rules, not a happy path: reading creates nothing, the seed is one random 32-byte
 * value that survives a reload, an export round-trips, a malformed one fails by name, and the storage holds
 * exactly one key - the seed - with no envelope, no metadata and no second field for anything to hide in.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	createBrowserSeedStore,
	createMemorySeedStore,
	parseSeedExport,
	seedGetterFor,
	SEED_EXPORT_PREFIX,
	SEED_BYTES,
} from "./seed-store";
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

/** A stand-in for the browser's localStorage, so the fallback backend can be exercised off-browser. */
function stubStorage(): KeyValueAreaLike & { readonly entries: Map<string, string> } {
	const entries = new Map<string, string>();
	return {
		entries,
		get length() {
			return entries.size;
		},
		clear: () => entries.clear(),
		getItem: (key: string) => entries.get(key) ?? null,
		key: (index: number) => [...entries.keys()][index] ?? null,
		removeItem: (key: string) => void entries.delete(key),
		setItem: (key: string, value: string) => void entries.set(key, value),
	} as KeyValueAreaLike & { readonly entries: Map<string, string> };
}

async function main(): Promise<void> {
	// ---- reading never creates -------------------------------------------------------------------------
	const store = createMemorySeedStore();
	ok("a browser with no seed reads null", (await store.read()) === null);
	ok("and reading created nothing", (await store.read()) === null, "still null after a second read");
	ok("the seed's home is reported honestly", store.location() === "memory", store.location());

	// ---- generating is real, random and idempotent ------------------------------------------------------
	const first = await store.ensure();
	ok("ensure() yields a 32-byte seed", first.length === SEED_BYTES, `${first.length} bytes`);
	ok("the seed is not an all-zero key", !first.every((byte) => byte === 0));
	ok("ensure() is idempotent: the second call returns the same seed", (await store.ensure()).every((byte, index) => byte === first[index]));
	const other = await createMemorySeedStore().ensure();
	ok("two browsers do not share a seed", !other.every((byte, index) => byte === first[index]), "generated, never derived or constant");
	ok("Coco's seedGetter hands back the stored seed", (await seedGetterFor(store)()).every((byte, index) => byte === first[index]));

	// ---- export and restore -----------------------------------------------------------------------------
	const exported = await store.export();
	ok("an export is prefixed and recognisable", exported.startsWith(SEED_EXPORT_PREFIX), exported.slice(0, 12));
	ok("an export carries only the seed", exported.length === SEED_EXPORT_PREFIX.length + SEED_BYTES * 2, `${exported.length} chars`);
	const restored = createMemorySeedStore();
	await restored.import(exported);
	ok("an export round-trips into another browser", (await restored.read())!.every((byte, index) => byte === first[index]));

	async function refused(label: string, text: string, expected: string): Promise<void> {
		let message = "";
		try {
			await createMemorySeedStore().import(text);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		ok(label, message.includes(expected), message || "nothing was refused");
	}
	await refused("an export without the prefix is refused by name", "deadbeef", "refused-seed-export");
	await refused("a short export is refused by name", `${SEED_EXPORT_PREFIX}deadbeef`, "refused-seed-export");
	await refused("an all-zero export is refused by name", `${SEED_EXPORT_PREFIX}${"00".repeat(SEED_BYTES)}`, "refused-seed-empty");
	let directMessage = "";
	try {
		parseSeedExport("not-an-export");
	} catch (error) {
		directMessage = error instanceof Error ? error.message : String(error);
	}
	ok("the parser refuses a non-export by name", directMessage.includes("refused-seed-export"), directMessage);

	// ---- the storage holds the seed and nothing else ----------------------------------------------------
	const area = stubStorage();
	const localStore = createBrowserSeedStore({ indexedDB: null, localStorage: area });
	ok("with no IndexedDB the store falls back and says so", localStore.location() === "localstorage", localStore.location());
	const localSeed = await localStore.ensure();
	ok("the fallback persists the seed", [...area.entries.values()][0] === [...localSeed].map((b) => b.toString(16).padStart(2, "0")).join(""), "hex, no envelope");
	ok("storage holds exactly one key", area.entries.size === 1, [...area.entries.keys()].join(", "));
	ok("that key is the seed itself, not a JSON record", !/[{[]/.test([...area.entries.values()][0] ?? ""), "no envelope, so no second field to hide in");
	const reloaded = createBrowserSeedStore({ indexedDB: null, localStorage: area });
	ok("the seed survives a reload of the page", (await reloaded.read())!.every((byte, index) => byte === localSeed[index]));
	const actorA = createBrowserSeedStore({ indexedDB: null, localStorage: area, namespace: `friday:${"a".repeat(64)}` });
	const actorB = createBrowserSeedStore({ indexedDB: null, localStorage: area, namespace: `friday:${"b".repeat(64)}` });
	const actorASeed = await actorA.ensure(), actorBSeed = await actorB.ensure();
	ok("separate Coco actor repositories receive separate namespaced seeds",
		!actorASeed.every((byte, index) => byte === actorBSeed[index]), "independent deterministic counters cannot collide at zero");
	ok("namespaced seeds survive actor-specific reload", (await createBrowserSeedStore({ indexedDB: null,
		localStorage: area, namespace: `friday:${"a".repeat(64)}` }).read())!
		.every((byte, index) => byte === actorASeed[index]));

	// ---- and it goes nowhere else ------------------------------------------------------------------------
	const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "seed-store.ts"), "utf8");
	const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
	ok("the module reaches no network", !/fetch\(|WebSocket|XMLHttpRequest|sendBeacon/.test(code), "no transport in the code");
	ok("the module writes to no domain store", !/EventStore|event-store|CartPort|OrderStore|PluginContribution/.test(code), "no domain store in the code");
	ok("the module keeps exactly one storage key", (code.match(/plebeian\.wallet\.seed\.v1/g) ?? []).length === 1, "one key, named once");

	console.log(`\nseed-store.test.ts: ${passed} assertion(s) passed, 0 failed`);
	console.log("acceptance: the seed is generated in this browser, kept in this browser's own storage with no envelope, read without being created, exportable and importable by name - and the wallet host receives it through seedGetter, never through a domain store");
}

main().catch((error) => {
	console.error(`\nseed-store.test.ts: FAILED — ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
