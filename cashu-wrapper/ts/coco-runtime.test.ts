#!/usr/bin/env bun
/**
 * coco-runtime.test.ts — the runtime is the only thing that touches Coco, and it reads Coco truthfully.
 *
 * Two halves, both against real objects rather than shapes invented here:
 *
 *   - a **real Coco manager** (`initializeCoco` over Coco's own `MemoryRepositories`, the same call the browser
 *     makes over `IndexedDbRepositories`), driven through our `CocoWalletRuntime`: its account, its reconciler
 *     declaration, its balance read off Coco's own snapshot, and a port that answers a named nothing for an
 *     operation that does not exist instead of throwing or inventing one;
 *   - a **scripted manager** for the state mapping, because Coco's family unions are seven states wide and a
 *     mapping is only worth having if every state in it is pinned - including the two that must not be reported.
 *
 * The boundary assertion at the end is the point of the module: the app's wallet plugin must not reach Coco.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MemoryRepositories } from "@cashu/coco-core";
import type { Manager } from "@cashu/coco-core";

import { CocoRuntimeStateError, engineOverManager, openCocoRuntime, runtimeOverManager } from "./coco-runtime";

import { createMemorySeedStore, seedGetterFor } from "./seed-store";
import type { WalletAccount } from "./types";

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

const ACCOUNT: WalletAccount = { accountId: "account-1", environmentId: "env-1" };
const HERE = dirname(fileURLToPath(import.meta.url));

/** A manager whose four families answer with views this test scripts, one state per family. */
function scriptedManager(views: { send?: Record<string, string>; melt?: Record<string, string> }): Manager {
	const family = (states: Record<string, string>) => {
		const viewsOf = (wanted: (state: string) => boolean) =>
			Object.entries(states)
				.filter(([, state]) => wanted(state))
				.map(([id, state]) => ({ id, state }));
		return {
			get: async (id: string) => (id in states ? { id, state: states[id]! } : null),
			listPrepared: async () => viewsOf((state) => state === "prepared"),
			// Coco's own in-flight list excludes terminal states; a fake that counted them would be measuring itself.
			listInFlight: async () => viewsOf((state) => !["prepared", "init", "finalized", "rolled_back"].includes(state)),
			refresh: async (id: string) => ({ id, state: states[id] ?? "finalized" }),
			reclaim: async (id: string) => ({ id, state: "rolled_back", ...(id ? {} : {}) }),
		};
	};
	const empty = family({});
	return {
		ops: { send: family(views.send ?? {}), melt: family(views.melt ?? {}), mint: empty, receive: empty },
		wallet: { balances: { total: async () => ({ spendable: 7, reserved: 5, total: 12, unit: "sat" }) } },
		dispose: async () => {
			(globalThis as unknown as { __cocoDisposed?: boolean }).__cocoDisposed = true;
		},
	} as unknown as Manager;
}

async function main(): Promise<void> {
	// The suite's assertions throw on failure; nothing below may swallow one. (An earlier draft wrapped a call in
	// `.catch(() => undefined)`, which printed a FAIL and still reported success - so that pattern is gone, and the
	// negative assertions below are the only ones that catch, and they assert on what was caught.
	// ---- a real Coco manager, through our runtime -------------------------------------------------------
	const runtime = await openCocoRuntime({
		account: ACCOUNT,
		repo: new MemoryRepositories(),
		seedGetter: seedGetterFor(createMemorySeedStore()),
		authority: { namespace: "plebeian-market-test", ownerId: "runtime-1" },
	});
	ok("openCocoRuntime hands back one runtime for the account", runtime.account.accountId === ACCOUNT.accountId);
	ok("and it declares all three of Coco's own reconcilers", runtime.reconcilers.proofStateWatcher && runtime.reconcilers.meltQuoteWatcher && runtime.reconcilers.meltSettlementProcessor);
	ok("the runtime declares no equivalent outside them", runtime.reconcilers.equivalent === undefined, "the engine's own three run");

	const balance = await runtime.balance();
	ok("a fresh Coco wallet reads a zero balance", balance.available === 0 && balance.reserved === 0 && balance.total === 0, JSON.stringify(balance));
	ok("and the three fields Coco cannot answer are zero rather than guessed", balance.locked === 0 && balance.pending === 0 && balance.unresolved === 0, "never fabricated");

	ok("the engine reports a named nothing for an unknown operation", (await runtime.engine.get("no-such-operation")) === null);
	ok("nothing is prepared in a fresh wallet", (await runtime.engine.listPrepared()).length === 0);
	ok("nothing is in flight in a fresh wallet", (await runtime.engine.listInFlight()).length === 0);

	/** Run something expected to refuse, and assert it refused by the right name - never swallowing a failure. */
	async function refusal(run: () => Promise<unknown>, expected: string): Promise<string> {
		let message = "";
		try {
			await run();
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		ok(`the engine refuses by name: ${expected}`, message.includes(expected), message || "nothing was refused");
		return message;
	}
	await refusal(() => runtime.engine.refresh("no-such-operation"), "refused-unknown-operation");
	await refusal(() => runtime.engine.reclaim("no-such-operation"), "refused-unknown-operation");
	await runtime.dispose();

	// ---- the state mapping, every state pinned ----------------------------------------------------------
	const engine = engineOverManager(
		scriptedManager({
			send: { "send-prepared": "prepared", "send-executing": "executing", "send-pending": "pending", "send-rolling": "rolling_back", "send-final": "finalized", "send-rolled": "rolled_back", "send-init": "init" },
			melt: { "melt-pending": "pending" },
		}),
	);
	const mapped = async (id: string) => (await engine.get(id))?.state ?? "not-reported";
	ok("prepared reads as prepared", (await mapped("send-prepared")) === "prepared");
	ok("executing reads as executing", (await mapped("send-executing")) === "executing");
	ok("pending reads as pending", (await mapped("send-pending")) === "pending");
	ok("rolling_back reads as pending, because it is in flight and not terminal", (await mapped("send-rolling")) === "pending");
	ok("finalized reads as finalized", (await mapped("send-final")) === "finalized");
	ok("rolled_back reads as rolled_back", (await mapped("send-rolled")) === "rolled_back");
	ok("an unpersisted init operation is not reported as a durable operation", (await mapped("send-init")) === "not-reported");
	ok("a second family is read too, not just send", (await mapped("melt-pending")) === "pending");
	ok("listInFlight carries both families", (await engine.listInFlight()).length === 4, `${(await engine.listInFlight()).length} operations`);
	ok("listPrepared carries only what is prepared", (await engine.listPrepared()).length === 1);

	// Coco's mint family declares neither `listPrepared` nor `reclaim` (read off a live manager). A question a
	// family cannot answer contributes nothing - and a reclaim it cannot do is refused by name, not attempted.
	const partial = scriptedManager({});
	delete (partial.ops.mint as unknown as { listPrepared?: unknown }).listPrepared;
	delete (partial.ops.mint as unknown as { reclaim?: unknown }).reclaim;
	const partialEngine = engineOverManager(partial);
	ok("a family that cannot list prepared does not break the list", Array.isArray(await partialEngine.listPrepared()));
	ok("nor does it break the in-flight list", Array.isArray(await partialEngine.listInFlight()));
	let reclaimRefusal = "";
	try {
		await partialEngine.reclaim("mint-prepared-1");
	} catch (error) {
		reclaimRefusal = error instanceof Error ? error.message : String(error);
	}
	ok("a family that cannot reclaim is refused by name", reclaimRefusal.includes("refused-no-reclaim") || reclaimRefusal.includes("refused-unknown-operation"), reclaimRefusal);
	ok("refresh answers through the owning family", (await engine.refresh("send-prepared")).state === "prepared");
	ok("reclaim answers through the owning family", (await engine.reclaim("send-pending")).state === "rolled_back");

	let stateError = "";
	try {
		engineOverManager(scriptedManager({ send: { "send-unknown": "some_new_coco_state" } }));
		await engineOverManager(scriptedManager({ send: { "send-unknown": "some_new_coco_state" } })).get("send-unknown");
	} catch (error) {
		stateError = error instanceof CocoRuntimeStateError ? `refused-coco-state:${(error as CocoRuntimeStateError).state}` : String(error);
	}
	ok("a state this runtime does not know is refused by name", stateError === "refused-coco-state:some_new_coco_state", stateError);

	// ---- the balance mapping keeps its word --------------------------------------------------------------
	const scripted = runtimeOverManager(ACCOUNT, scriptedManager({}));
	const scriptedBalance = await scripted.balance();
	ok("available comes from Coco's own spendable", scriptedBalance.available === 7, String(scriptedBalance.available));
	ok("reserved comes from Coco's own reserved", scriptedBalance.reserved === 5, String(scriptedBalance.reserved));
	ok("total comes from Coco's own total", scriptedBalance.total === 12, String(scriptedBalance.total));
	ok("a non-zero reserved does not leak into locked", scriptedBalance.locked === 0, "application-locked is the host's to add");
	await scripted.dispose();
	ok("dispose reaches Coco", (globalThis as unknown as { __cocoDisposed?: boolean }).__cocoDisposed === true);

	// ---- the boundary: nothing in the app reaches Coco directly ------------------------------------------
	const plugin = readFileSync(resolve(HERE, "..", "..", "market-app", "plugins", "wallet-plugin.ts"), "utf8");
	ok("the app's wallet plugin imports no Coco", !/@cashu\/coco/.test(plugin), "the runtime is the only door to Coco");
	ok("and the plugin names no manager or repository", !/initializeCoco|Repositories|Manager\b/.test(plugin.replace(/\/\*[\s\S]*?\*\//g, "")), "no Coco surface in the plugin's code");

	console.log(`\ncoco-runtime.test.ts: ${passed} assertion(s) passed, 0 failed`);
	console.log("acceptance: one module wraps Coco behind the host's own ports - a real manager initialised from the app's repositories and seed, an engine port bounded by our declared surface, every Coco state pinned to ours (with `init` and unknown states refused rather than reported), and a balance that reports only what Coco actually knows");
}

main().catch((error) => {
	console.error(`\ncoco-runtime.test.ts: FAILED — ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
