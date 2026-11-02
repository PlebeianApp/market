/**
 * coco-runtime.ts — the host's runtime, with Coco wrapped inside it.
 *
 * ## What this is, and what it is not
 *
 * ADR-0010 makes the wallet host the boundary and Coco the monetary authority: Coco's `ProofRepository` is the only
 * local authority for spendable and reserved proofs, and its durable operation state is the authority for in-flight
 * monetary operations and their recovery material. This module is the adapter that lets our host drive that
 * authority, and it exists so that *nothing else in the app ever touches Coco directly*:
 *
 *   - the app builds a `Repositories` root (in the browser: `@cashu/coco-indexeddb`), supplies the seed through
 *     `seedGetter` (see `seed-store.ts` - Coco stores no seed of its own), and names its own `authority`
 *     namespace so two sessions over the same storage are fenced apart;
 *   - this module turns Coco's `Manager` into our `CocoWalletRuntime`, whose `engine` is bounded by our own
 *     `CocoOperationPort`: read one operation, enumerate what is prepared and what is in flight, refresh one,
 *     reclaim one. An app that cannot answer those four questions fails to compile rather than at a mint;
 *   - the four operation families are read through one structural view, because our port needs exactly two facts
 *     from an operation - its id and its state - and Coco's families each declare their own union;
 *   - `locked`, `pending` and `unresolved` in our balance vocabulary have **no counterpart** in Coco's public
 *     snapshot (`spendable | reserved | total`). They are reported as `0` here and never guessed, because a
 *     fabricated number in a money projection is worse than an absent one; the host, which owns the operation
 *     records, is where an application-locked amount can truthfully be added.
 *
 * Coco's own durable command key matters to us: an operation may carry a *caller-supplied* id (`callerSuppliedId`
 * on an `init` operation), and our host already claims a command before it executes one. So a command id can be
 * the operation id on both sides of the boundary, and a crash between the two is recoverable by that one identity.
 */

import { initializeCoco } from "@cashu/coco-core";
import type { BalanceQuery, Logger, Manager, WebSocketFactory } from "@cashu/coco-core";

/** Coco's plugin type, taken from the same signature for the same reason. */
export type CocoPlugin = NonNullable<Parameters<typeof initializeCoco>[0]["plugins"]>[number];

/**
 * Coco's repository root, taken from its own `initializeCoco` signature rather than from a named export: the
 * package exports `MemoryRepositories` and `IndexedDbRepositories` but not the interface, and a type derived from
 * the function it is passed to cannot drift from it.
 */
export type CocoRepositories = Parameters<typeof initializeCoco>[0]["repo"];

import type {
	CocoEngineOperation,
	CocoEngineOperationState,
	CocoOperationPort,
	CocoReconcilerStatus,
	CocoWalletRuntime,
	WalletAccount,
	WalletBalance,
	WalletBalanceQuery,
} from "./types";

/** The two facts our port reads off any operation, in any family, plus the two the engine may surface. */
interface CocoOperationView {
	readonly id: string;
	readonly state: string;
	readonly meltQuoteId?: string;
	readonly preimage?: string;
}

/** One family's surface, declared structurally: Coco's families agree on these names and differ in their unions. */
interface CocoOperationFamilyApi {
	get(id: string): Promise<CocoOperationView | null>;
	listPrepared(): Promise<readonly CocoOperationView[]>;
	listInFlight(): Promise<readonly CocoOperationView[]>;
	refresh(id: string): Promise<CocoOperationView>;
	reclaim?(id: string): Promise<CocoOperationView>;
	rollback?(id: string): Promise<CocoOperationView>;
}

/**
 * Coco's states, read into ours. `init` is deliberately absent: an `init` operation is never persisted, so it is
 * not a durable operation and the engine reports nothing for it rather than reporting it as prepared.
 * `rolling_back` reads as `pending`: it is transient and still in flight, and it is explicitly *not* terminal.
 */
const ENGINE_STATE: Readonly<Record<string, CocoEngineOperationState | undefined>> = {
	prepared: "prepared",
	executing: "executing",
	pending: "pending",
	rolling_back: "pending",
	finalized: "finalized",
	rolled_back: "rolled_back",
};

/** Refused by name: an operation in a state this runtime does not know is not silently mapped onto one it does. */
export class CocoRuntimeStateError extends Error {
	readonly state: string;
	readonly family: string;
	constructor(state: string, family: string) {
		super(`refused-coco-state: the ${family} engine reported \`${state}\`, which this runtime does not read into a port state`);
		this.name = "CocoRuntimeStateError";
		this.state = state;
		this.family = family;
	}
}

function readOperation(view: CocoOperationView, family: string): CocoEngineOperation {
	const state = ENGINE_STATE[view.state];
	if (state === undefined) throw new CocoRuntimeStateError(view.state, family);
	return {
		id: view.id,
		state,
		...(typeof view.meltQuoteId === "string" ? { meltQuoteId: view.meltQuoteId } : {}),
		...(typeof view.preimage === "string" ? { preimage: view.preimage } : {}),
	};
}

/**
 * A number from Coco's `Amount`.
 *
 * Coco hands balances back as an `Amount` object (not a number): `JSON.stringify` shows `"100"` for one and
 * `typeof` says `object`, so the honest reader accepts a number, a bigint, a numeric string, a `value` field, and
 * an object whose own string form is the number - and returns 0 only when it genuinely cannot tell. A money figure
 * that silently reads 0 because of a shape is worse than one that is visibly absent.
 */
function toNumber(amount: unknown): number {
	if (typeof amount === "number") return Number.isFinite(amount) ? amount : 0;
	if (typeof amount === "bigint") return Number(amount);
	if (typeof amount === "string") {
		const parsed = Number(amount);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	if (amount === null || amount === undefined) return 0;
	if (typeof amount === "object") {
		if ("value" in amount) {
			const fromValue = toNumber((amount as { value: unknown }).value);
			if (fromValue !== 0 || String((amount as { value: unknown }).value) === "0") return fromValue;
		}
		const asText = typeof (amount as { toString?: unknown }).toString === "function" ? String(amount) : "";
		const parsed = Number(asText);
		if (amount instanceof Uint8Array) return 0;
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

/**
 * The engine port over Coco's four families. `get` answers from whichever family knows the id - the others refuse,
 * and this port does not pretend otherwise - and `refresh`/`reclaim` are answered by that same family, so a leg is
 * never refreshed through a rail that does not own it.
 *
 * **The four families are not identical, and this port does not pretend they are.** Coco's real surface, read off a
 * live manager, is `send`: get/listPrepared/listInFlight/refresh/reclaim, `melt`: the same plus two quote lookups,
 * `receive`: get/listPrepared/listInFlight/refresh but no reclaim, and `mint`: get/listInFlight/refresh with
 * *neither* `listPrepared` nor `reclaim`. So a question a family cannot answer contributes nothing here rather
 * than being answered through a state that family does not report - which means `listPrepared` covers send, melt
 * and receive, and a prepared *mint* operation is invisible to it, exactly as it is invisible in Coco's own API.
 * The buyer and bidder paths this host serves move money through send (the auction's P2PK lock) and melt (payment),
 * so the gap does not narrow them; it is recorded here, and asserted in the suite, so no caller assumes otherwise.
 */
export function engineOverManager(manager: Manager): CocoOperationPort {
	const families: readonly { name: string; api: CocoOperationFamilyApi }[] = [
		{ name: "send", api: manager.ops.send as unknown as CocoOperationFamilyApi },
		{ name: "melt", api: manager.ops.melt as unknown as CocoOperationFamilyApi },
		{ name: "mint", api: manager.ops.mint as unknown as CocoOperationFamilyApi },
		{ name: "receive", api: manager.ops.receive as unknown as CocoOperationFamilyApi },
	];

	/** Call a family method only where it exists; a family that cannot answer contributes nothing. */
	const where = async <T>(fn: (() => Promise<T>) | undefined, fallback: T): Promise<T> => {
		if (fn === undefined) return fallback;
		try {
			return await fn();
		} catch {
			return fallback;
		}
	};

	const owner = async (operationId: string): Promise<{ name: string; api: CocoOperationFamilyApi } | null> => {
		for (const family of families) {
			const found = await where(family.api.get === undefined ? undefined : () => family.api.get(operationId), null);
			if (found !== null && found !== undefined) return family;
		}
		return null;
	};

	return {
		async get(operationId: string): Promise<CocoEngineOperation | null> {
			const family = await owner(operationId);
			if (family === null) return null;
			const found = await where(family.api.get === undefined ? undefined : () => family.api.get(operationId), null);
			if (found === null) return null;
			// An `init` operation is not persisted, so it is not a durable operation: it reads as nothing.
			if (found.state === "init") return null;
			return readOperation(found, family.name);
		},
		async listPrepared(): Promise<readonly CocoEngineOperation[]> {
			const out: CocoEngineOperation[] = [];
			for (const family of families) {
				const listed = await where(family.api.listPrepared === undefined ? undefined : () => family.api.listPrepared(), [] as readonly CocoOperationView[]);
				for (const view of listed) out.push(readOperation(view, family.name));
			}
			return out;
		},
		async listInFlight(): Promise<readonly CocoEngineOperation[]> {
			const out: CocoEngineOperation[] = [];
			for (const family of families) {
				const listed = await where(family.api.listInFlight === undefined ? undefined : () => family.api.listInFlight(), [] as readonly CocoOperationView[]);
				for (const view of listed) {
					if (view.state === "init") continue;
					out.push(readOperation(view, family.name));
				}
			}
			return out;
		},
		async refresh(operationId: string): Promise<CocoEngineOperation> {
			const family = await owner(operationId);
			if (family === null) throw new Error(`refused-unknown-operation: no Coco family knows \`${operationId}\``);
			return readOperation(await family.api.refresh(operationId), family.name);

		},
		async reclaim(operationId: string): Promise<CocoEngineOperation> {
			const family = await owner(operationId);
			if (family === null) throw new Error(`refused-unknown-operation: no Coco family knows \`${operationId}\``);
			const reclaim = family.api.reclaim ?? family.api.rollback;
			if (reclaim === undefined) {
				throw new Error(`refused-no-reclaim: the ${family.name} family cannot reclaim \`${operationId}\``);
			}
			return readOperation(await reclaim.call(family.api, operationId), family.name);
		},
	};
}

/**
 * Our runtime over a Coco manager. `reconcilers` is the app's declaration (`#09f049`) and it is true here because
 * this composition never disables Coco's own watchers: the proof-state watcher, the melt-quote watcher and the
 * melt-settlement processor all run, which is what lets a local read settle a leg.
 */
export function runtimeOverManager(account: WalletAccount, manager: Manager): CocoWalletRuntime {
	const reconcilers: CocoReconcilerStatus = {
		proofStateWatcher: true,
		meltQuoteWatcher: true,
		meltSettlementProcessor: true,
	};
	return {
		account,
		engine: engineOverManager(manager),
		reconcilers,
		async balance(query?: WalletBalanceQuery): Promise<WalletBalance> {
			const scope: BalanceQuery = {
				...(query?.mintUrl !== undefined ? { mintUrls: [query.mintUrl] } : {}),
				...(query?.unit !== undefined ? { units: [query.unit] } : {}),
			};
			const snapshot = (await manager.wallet.balances.total(scope)) as { spendable?: unknown; reserved?: unknown; total?: unknown };
			const available = toNumber(snapshot.spendable);
			const reserved = toNumber(snapshot.reserved);
			// The three our vocabulary has and Coco's snapshot does not: reported as 0, never guessed. An
			// application-locked amount is the host's to add, from the operation records only it owns.
			return {
				available,
				reserved,
				locked: 0,
				pending: 0,
				unresolved: 0,
				total: toNumber(snapshot.total ?? available + reserved),
			};
		},
		async dispose(): Promise<void> {
			await manager.dispose?.();
		},
	};
}

export interface CocoRuntimeOptions {
	/** The account this runtime is scoped to. The host keeps one runtime per account. */
	readonly account: WalletAccount;
	/** The app's own repository root: `IndexedDbRepositories` in the browser. Coco's proof authority lives here. */
	readonly repo: CocoRepositories;
	/** The app's own seed custody (`seed-store.ts`): Coco is handed the seed and stores none. */
	readonly seedGetter: () => Promise<Uint8Array>;
	/** The durable identity that fences concurrent sessions over the same storage, per ADR-0010. */
	readonly authority?: { readonly namespace?: string; readonly ownerId?: string };
	readonly logger?: Logger;
	readonly webSocketFactory?: WebSocketFactory;
	readonly plugins?: readonly CocoPlugin[];
}

/**
 * Open Coco and hand back our runtime. This is the one call the composition root makes; everything past it talks to
 * the host, not to Coco.
 */
export async function openCocoRuntime(options: CocoRuntimeOptions): Promise<CocoWalletRuntime> {
	const manager = await initializeCoco({
		repo: options.repo,
		seedGetter: options.seedGetter,
		...(options.authority !== undefined ? { authority: options.authority } : {}),
		...(options.logger !== undefined ? { logger: options.logger } : {}),
		...(options.webSocketFactory !== undefined ? { webSocketFactory: options.webSocketFactory } : {}),
		...(options.plugins !== undefined ? { plugins: [...options.plugins] } : {}),
	});
	return runtimeOverManager(options.account, manager);
}
