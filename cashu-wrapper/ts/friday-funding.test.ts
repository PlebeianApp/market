import { describe, expect, test } from "bun:test";
import { FridayFundingJournal } from "./friday-funding";

const ACTOR = "33".repeat(32);
const event = (index: number): string => index.toString(16).padStart(64, "0");

function finalize(journal: FridayFundingJournal, index: number, before: number): void {
	const id = event(index);
	journal.begin({ eventId: id, actor: ACTOR, beforeBalance: before });
	journal.attachQuote(id, `quote-${index}`);
	journal.attachOperation(id, `mint-${index}`);
	journal.finalize(id, before+10_000);
}

describe("Friday faucet journal", () => {
	test("grants five real intents and refuses a sixth at the 50k identity cap", () => {
		const journal = new FridayFundingJournal(10_000, 50_000);
		for (let index = 1; index <= 5; index += 1) finalize(journal, index, (index-1)*10_000);
		expect(journal.grant(ACTOR)).toBe(50_000);
		expect(() => journal.begin({ eventId: event(6), actor: ACTOR, beforeBalance: 50_000 })).toThrow("friday-funding-identity-cap");
	});

	test("an unknown quote or mint response consumes cap until the same identity recovers", () => {
		const journal = new FridayFundingJournal(10_000, 50_000, [], { [ACTOR]: 40_000 });
		journal.begin({ eventId: event(1), actor: ACTOR, beforeBalance: 40_000 });
		journal.markUnknown(event(1), "response lost");
		expect(journal.allocated(ACTOR)).toBe(50_000);
		expect(() => journal.begin({ eventId: event(2), actor: ACTOR, beforeBalance: 40_000 })).toThrow("friday-funding-identity-cap");
		journal.attachQuote(event(1), "same-quote");
		journal.attachOperation(event(1), "same-operation");
		journal.finalize(event(1), 50_000);
		expect(journal.grant(ACTOR)).toBe(50_000);
	});

	test("unresolved funding never becomes spendable and blocks a second mint mutation", () => {
		const journal = new FridayFundingJournal(10_000, 50_000, [], { [ACTOR]: 20_000 });
		journal.begin({ eventId: event(1), actor: ACTOR, beforeBalance: 20_000 });
		journal.markUnknown(event(1), "response lost");
		expect(journal.availableBacking(ACTOR, 20_000)).toBe(20_000);
		expect(journal.availableBacking(ACTOR, 30_000)).toBe(20_000);
		expect(journal.backingExact(ACTOR, 30_000)).toBeTrue();
		expect(journal.availableBacking(ACTOR, 25_000)).toBe(0);
		expect(journal.backingExact(ACTOR, 25_000)).toBeFalse();
		expect(() => journal.begin({ eventId: event(2), actor: ACTOR, beforeBalance: 30_000 })).toThrow("friday-funding-pending-operation");
	});

	test("checkpoint reconstruction preserves one operation and cannot double count finalize", () => {
		const first = new FridayFundingJournal(10_000, 50_000);
		first.begin({ eventId: event(1), actor: ACTOR, beforeBalance: 0 });
		first.attachQuote(event(1), "quote"); first.attachOperation(event(1), "operation"); first.markUnknown(event(1), "lost");
		const snapshot = first.snapshot();
		const restored = new FridayFundingJournal(10_000, 50_000, snapshot.records, snapshot.grants, snapshot.quarantinedActors);
		restored.finalize(event(1), 10_000); restored.finalize(event(1), 10_000);
		expect(restored.grant(ACTOR)).toBe(10_000);
		expect(restored.record(event(1))?.operationId).toBe("operation");
	});

	test("unexplained positive backing is quarantined without inventing issued value", () => {
		const journal = new FridayFundingJournal(10_000, 50_000);
		journal.quarantineLegacyBalance(ACTOR);
		expect(journal.isQuarantined(ACTOR)).toBeTrue();
		expect(journal.grant(ACTOR)).toBe(0);
		expect(journal.snapshot()).toMatchObject({ grants: {}, quarantinedActors: [ACTOR] });
		expect(journal.availableBacking(ACTOR, 2_500)).toBe(0);
		expect(journal.backingExact(ACTOR, 2_500)).toBeFalse();
		expect(() => journal.begin({ eventId: event(1), actor: ACTOR, beforeBalance: 2_500 })).toThrow("friday-funding-identity-cap");
	});

	test("one mint quote or operation cannot back two faucet intents", () => {
		const journal = new FridayFundingJournal(10_000, 50_000);
		journal.begin({ eventId: event(1), actor: ACTOR, beforeBalance: 0 });
		journal.attachQuote(event(1), "quote"); journal.attachOperation(event(1), "operation");
		journal.finalize(event(1), 10_000);
		journal.begin({ eventId: event(2), actor: ACTOR, beforeBalance: 10_000 });
		expect(() => journal.attachQuote(event(2), "quote")).toThrow("friday-funding-quote-already-bound");
		journal.attachQuote(event(2), "quote-2");
		expect(() => journal.attachOperation(event(2), "operation")).toThrow("friday-funding-operation-already-bound");
	});

	test("tampered checkpoint status or missing finalized grant fails closed", () => {
		const prepared = { eventId: event(1), actor: ACTOR, amount: 10_000, beforeBalance: 0, status: "prepared" as const, quoteId: "smuggled" };
		expect(() => new FridayFundingJournal(10_000, 50_000, [prepared])).toThrow("friday-funding-status-identities-mismatch");
		const finalized = { ...prepared, status: "finalized" as const, operationId: "operation" };
		expect(() => new FridayFundingJournal(10_000, 50_000, [finalized])).toThrow("friday-funding-finalized-grant-missing");
	});
});
