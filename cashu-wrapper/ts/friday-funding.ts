/** Durable, proof-free faucet intent journal. Bearer proofs stay in Coco. */
export type FundingStatus = "prepared" | "quote_known" | "mint_known" | "unknown" | "finalized";

export interface FridayFundingRecord {
	readonly eventId: string;
	readonly actor: string;
	readonly amount: number;
	readonly beforeBalance: number;
	readonly status: FundingStatus;
	readonly quoteId?: string;
	readonly operationId?: string;
	readonly error?: string;
}

const ACTOR = /^[0-9a-f]{64}$/;
const EVENT = /^[0-9a-f]{64}$/;

function exactNonnegative(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`friday-funding-invalid-${label}`);
}

export class FridayFundingJournal {
	readonly #amount: number;
	readonly #cap: number;
	readonly #records = new Map<string, FridayFundingRecord>();
	readonly #grants = new Map<string, number>();
	readonly #quarantinedActors = new Set<string>();

	constructor(amount: number, cap: number, records: readonly FridayFundingRecord[] = [], grants: Readonly<Record<string, number>> = {},
		quarantinedActors: readonly string[] = []) {
		exactNonnegative(amount, "amount"); exactNonnegative(cap, "cap");
		if (amount === 0 || cap < amount || cap%amount !== 0) throw new Error("friday-funding-invalid-policy");
		this.#amount = amount; this.#cap = cap;
		for (const [actor, granted] of Object.entries(grants)) {
			if (!ACTOR.test(actor)) throw new Error("friday-funding-invalid-grant-actor");
			exactNonnegative(granted, "grant");
			if (granted > cap || granted%amount !== 0) throw new Error("friday-funding-invalid-grant");
			this.#grants.set(actor, granted);
		}
		for (const actor of quarantinedActors) {
			if (!ACTOR.test(actor)) throw new Error("friday-funding-invalid-quarantine-actor");
			this.#quarantinedActors.add(actor);
		}
		for (const record of records) {
			this.#validate(record);
			if (this.#records.has(record.eventId)) throw new Error("friday-funding-duplicate-event");
			if (record.quoteId !== undefined && [...this.#records.values()].some((prior) => prior.quoteId === record.quoteId)) throw new Error("friday-funding-duplicate-quote");
			if (record.operationId !== undefined && [...this.#records.values()].some((prior) => prior.operationId === record.operationId)) throw new Error("friday-funding-duplicate-operation");
			this.#records.set(record.eventId, { ...record });
		}
		for (const actor of new Set([...this.#grants.keys(), ...records.map((record) => record.actor)])) {
			if (this.allocated(actor) > cap) throw new Error("friday-funding-cap-exceeded-in-state");
			const recordedFinalized = records.filter((record) => record.actor === actor && record.status === "finalized").reduce((sum, record) => sum+record.amount, 0);
			if (recordedFinalized > this.grant(actor)) throw new Error("friday-funding-finalized-grant-missing");
		}
	}

	record(eventId: string): FridayFundingRecord | null {
		const value = this.#records.get(eventId);
		return value === undefined ? null : { ...value };
	}

	grant(actor: string): number {
		if (!ACTOR.test(actor)) throw new Error("friday-funding-invalid-actor");
		return this.#grants.get(actor) ?? 0;
	}
	isQuarantined(actor: string): boolean {
		if (!ACTOR.test(actor)) throw new Error("friday-funding-invalid-actor");
		return this.#quarantinedActors.has(actor);
	}

	allocated(actor: string): number {
		if (this.isQuarantined(actor)) return this.#cap;
		return this.grant(actor)+[...this.#records.values()]
			.filter((record) => record.actor === actor && record.status !== "finalized")
			.reduce((sum, record) => sum+record.amount, 0);
	}

	pending(actor: string): readonly FridayFundingRecord[] {
		if (!ACTOR.test(actor)) throw new Error("friday-funding-invalid-actor");
		return [...this.#records.values()]
			.filter((record) => record.actor === actor && record.status !== "finalized")
			.sort((left, right) => left.eventId.localeCompare(right.eventId))
			.map((record) => ({ ...record }));
	}

	/**
	 * Exclude value that may already have arrived from an unresolved mint
	 * operation. Existing balance from before the operation stays usable; any
	 * observed increase is unavailable until the same operation finalizes.
	 */
	availableBacking(actor: string, walletBacking: number): number {
		exactNonnegative(walletBacking, "wallet-backing");
		if (this.isQuarantined(actor)) return 0;
		const records = this.pending(actor);
		if (records.length > 1) return 0;
		const record = records[0];
		if (record === undefined) return walletBacking;
		const movement = walletBacking-record.beforeBalance;
		if (movement !== 0 && movement !== record.amount) return 0;
		return walletBacking-Math.max(0, movement);
	}

	backingExact(actor: string, walletBacking: number): boolean {
		exactNonnegative(walletBacking, "wallet-backing");
		if (this.isQuarantined(actor)) return false;
		const records = this.pending(actor);
		if (records.length > 1) return false;
		const record = records[0];
		if (record === undefined) return true;
		const movement = walletBacking-record.beforeBalance;
		return movement === 0 || movement === record.amount;
	}

	begin(input: { eventId: string; actor: string; beforeBalance: number }): FridayFundingRecord {
		if (!EVENT.test(input.eventId) || !ACTOR.test(input.actor)) throw new Error("friday-funding-invalid-identity");
		exactNonnegative(input.beforeBalance, "before-balance");
		const existing = this.#records.get(input.eventId);
		if (existing !== undefined) {
			if (existing.actor !== input.actor || existing.beforeBalance !== input.beforeBalance) throw new Error("friday-funding-event-conflict");
			return { ...existing };
		}
		if (this.allocated(input.actor)+this.#amount > this.#cap) throw new Error("friday-funding-identity-cap");
		if (this.pending(input.actor).length !== 0) throw new Error("friday-funding-pending-operation");
		const record: FridayFundingRecord = { ...input, amount: this.#amount, status: "prepared" };
		this.#records.set(record.eventId, record);
		return { ...record };
	}

	attachQuote(eventId: string, quoteId: string): FridayFundingRecord {
		if (quoteId.length < 1 || quoteId.length > 512) throw new Error("friday-funding-invalid-quote");
		const current = this.#require(eventId);
		if (current.quoteId !== undefined && current.quoteId !== quoteId) throw new Error("friday-funding-quote-conflict");
		if ([...this.#records.values()].some((record) => record.eventId !== eventId && record.quoteId === quoteId)) throw new Error("friday-funding-quote-already-bound");
		return this.#set({ ...current, quoteId, status: current.operationId === undefined ? "quote_known" : current.status, error: undefined });
	}

	attachOperation(eventId: string, operationId: string): FridayFundingRecord {
		if (operationId.length < 1 || operationId.length > 512) throw new Error("friday-funding-invalid-operation");
		const current = this.#require(eventId);
		if (current.quoteId === undefined) throw new Error("friday-funding-operation-without-quote");
		if (current.operationId !== undefined && current.operationId !== operationId) throw new Error("friday-funding-operation-conflict");
		if ([...this.#records.values()].some((record) => record.eventId !== eventId && record.operationId === operationId)) throw new Error("friday-funding-operation-already-bound");
		return this.#set({ ...current, operationId, status: "mint_known", error: undefined });
	}

	markUnknown(eventId: string, error: string): FridayFundingRecord {
		const current = this.#require(eventId);
		if (current.status === "finalized") return { ...current };
		return this.#set({ ...current, status: "unknown", error: error.slice(0, 240) });
	}

	finalize(eventId: string, afterBalance: number): FridayFundingRecord {
		exactNonnegative(afterBalance, "after-balance");
		const current = this.#require(eventId);
		if (current.status === "finalized") return { ...current };
		if (current.quoteId === undefined || current.operationId === undefined || afterBalance !== current.beforeBalance+current.amount) {
			throw new Error("friday-funding-finalization-not-proven");
		}
		const granted = this.grant(current.actor)+current.amount;
		if (granted > this.#cap) throw new Error("friday-funding-identity-cap");
		this.#grants.set(current.actor, granted);
		return this.#set({ ...current, status: "finalized", error: undefined });
	}

	/** Fail closed when importing a legacy positive wallet with no exact grant journal. */
	quarantineLegacyBalance(actor: string): void {
		if (!ACTOR.test(actor)) throw new Error("friday-funding-invalid-actor");
		this.#quarantinedActors.add(actor);
	}

	snapshot(): { records: FridayFundingRecord[]; grants: Record<string, number>; quarantinedActors: string[] } {
		return {
			records: [...this.#records.values()].sort((a, b) => a.eventId.localeCompare(b.eventId)).map((record) => ({ ...record })),
			grants: Object.fromEntries([...this.#grants.entries()].sort(([left], [right]) => left.localeCompare(right))),
			quarantinedActors: [...this.#quarantinedActors].sort(),
		};
	}

	#require(eventId: string): FridayFundingRecord {
		const value = this.#records.get(eventId);
		if (value === undefined) throw new Error("friday-funding-record-missing");
		return value;
	}
	#set(record: FridayFundingRecord): FridayFundingRecord {
		this.#records.set(record.eventId, record);
		return { ...record };
	}
	#validate(record: FridayFundingRecord): void {
		if (!EVENT.test(record.eventId) || !ACTOR.test(record.actor) || record.amount !== this.#amount
			|| !["prepared", "quote_known", "mint_known", "unknown", "finalized"].includes(record.status)) throw new Error("friday-funding-invalid-record");
		exactNonnegative(record.beforeBalance, "before-balance");
		if (record.quoteId !== undefined && (record.quoteId.length < 1 || record.quoteId.length > 512)) throw new Error("friday-funding-invalid-quote");
		if (record.operationId !== undefined && (record.operationId.length < 1 || record.operationId.length > 512)) throw new Error("friday-funding-invalid-operation");
		if (record.operationId !== undefined && record.quoteId === undefined) throw new Error("friday-funding-operation-without-quote");
		if (record.status === "prepared" && (record.quoteId !== undefined || record.operationId !== undefined)
			|| record.status === "quote_known" && (record.quoteId === undefined || record.operationId !== undefined)
			|| record.status === "mint_known" && (record.quoteId === undefined || record.operationId === undefined)
			|| record.status === "finalized" && (record.quoteId === undefined || record.operationId === undefined)) {
			throw new Error("friday-funding-status-identities-mismatch");
		}
	}
}
