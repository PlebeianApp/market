import { describe, expect, test } from "bun:test";
import type { Manager } from "@cashu/coco-core";

import { createCocoRail } from "./coco-rail";

function managerWithSend(send: Record<string, unknown>): Manager {
	return { ops: { send }, quotes: { mint: {}, melt: {} } } as unknown as Manager;
}

const pending = { id: "send-payment-a", mintUrl: "http://127.0.0.1:3338", unit: "sat", amount: 2_500,
	method: "default", state: "pending", token: "cashuA"+"x".repeat(64) };

describe("Coco rail caller-owned send recovery", () => {
	test("a pending operation is recovered without prepare or execute", async () => {
		let prepared = 0, executed = 0;
		const rail = createCocoRail(managerWithSend({
			async get() { return pending; }, async prepare() { prepared += 1; return pending; },
			async execute() { executed += 1; return { operation: pending, token: pending.token }; },
			recovery: { async run() {}, inProgress() { return false; } },
		}));
		const result = await rail.resumeSendOperation({ mintUrl: pending.mintUrl, amount: 2_500, operationId: pending.id });
		expect(result).toMatchObject({ operationId: pending.id, state: "pending", token: pending.token });
		expect({ prepared, executed }).toEqual({ prepared: 0, executed: 0 });
	});

	test("the same operation id with a different immutable intent fails before mutation", async () => {
		let prepared = 0, executed = 0;
		const rail = createCocoRail(managerWithSend({
			async get() { return pending; }, async prepare() { prepared += 1; return pending; },
			async execute() { executed += 1; return { operation: pending, token: pending.token }; },
			recovery: { async run() {}, inProgress() { return false; } },
		}));
		await expect(rail.resumeSendOperation({ mintUrl: pending.mintUrl, amount: 2_501, operationId: pending.id }))
			.rejects.toThrow("refused-send-operation-intent-conflict");
		expect({ prepared, executed }).toEqual({ prepared: 0, executed: 0 });
	});

	test("an executing operation invokes Coco recovery and returns only its recovered token", async () => {
		let operation = { ...pending, state: "executing", token: undefined as string | undefined };
		let recoveryRuns = 0;
		const rail = createCocoRail(managerWithSend({
			async get() { return operation; }, async prepare() { throw new Error("unexpected prepare"); },
			async execute() { throw new Error("unexpected execute"); },
			recovery: { async run() { recoveryRuns += 1; operation = { ...pending }; }, inProgress() { return false; } },
		}));
		const result = await rail.resumeSendOperation({ mintUrl: pending.mintUrl, amount: 2_500, operationId: pending.id });
		expect(result.token).toBe(pending.token);
		expect(recoveryRuns).toBe(1);
	});
});
