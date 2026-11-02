import { describe, expect, test } from "bun:test";

import { createCocoRail } from "./coco-rail";

const ORIGINAL_ID = "auctions.bid-lock:auction-9:bid-4";

interface ReclaimCall {
	readonly family: "send" | "melt";
	readonly args: readonly unknown[];
}

function managerFor(
	options: {
		readonly send?: readonly unknown[];
		readonly melt?: readonly unknown[];
	} = {},
): {
	readonly manager: never;
	readonly calls: ReclaimCall[];
	readonly forbiddenCalls: string[];
} {
	const calls: ReclaimCall[] = [];
	const forbiddenCalls: string[] = [];
	const send = [...(options.send ?? [{ id: ORIGINAL_ID, state: "rolled_back" }])];
	const melt = [...(options.melt ?? [{ id: ORIGINAL_ID, state: "rolled_back" }])];
	const next = async (family: "send" | "melt", args: readonly unknown[]): Promise<unknown> => {
		calls.push({ family, args: [...args] });
		const queue = family === "send" ? send : melt;
		const value = queue.shift();
		if (value instanceof Error) throw value;
		return value;
	};
	const forbidden = (name: string) => async (): Promise<never> => {
		forbiddenCalls.push(name);
		throw new Error(`unexpected ${name}`);
	};
	return {
		manager: {
			quotes: { mint: {}, melt: {} },
			ops: {
				mint: {
					prepare: forbidden("mint.prepare"),
					execute: forbidden("mint.execute"),
					get: forbidden("mint.get"),
					listByQuote: forbidden("mint.listByQuote"),
				},
				send: {
					prepare: forbidden("send.prepare"),
					execute: forbidden("send.execute"),
					get: forbidden("send.get"),
					reclaim: (...args: readonly unknown[]) => next("send", args),
				},
				melt: {
					prepare: forbidden("melt.prepare"),
					execute: forbidden("melt.execute"),
					reclaim: (...args: readonly unknown[]) => next("melt", args),
				},
				receive: {
					prepare: forbidden("receive.prepare"),
					execute: forbidden("receive.execute"),
				},
			},
		} as never,
		calls,
		forbiddenCalls,
	};
}

describe("Coco rail durable refund reclaim", () => {
	test("calls send reclaim with the original id and exact refund option", async () => {
		const fake = managerFor();
		const result = await createCocoRail(fake.manager).reclaim({
			operationId: ORIGINAL_ID,
			family: "send",
			spendingPath: "refund",
		});

		expect(result).toEqual({ operationId: ORIGINAL_ID, state: "rolled_back" });
		expect(fake.calls).toEqual([
			{
				family: "send",
				args: [ORIGINAL_ID, { spendingPath: "refund" }],
			},
		]);
		expect(fake.forbiddenCalls).toEqual([]);
	});

	test("keeps one-argument default send and melt reclaim calls compatible", async () => {
		const fake = managerFor();
		const rail = createCocoRail(fake.manager);

		expect(await rail.reclaim({ operationId: ORIGINAL_ID })).toEqual({
			operationId: ORIGINAL_ID,
			state: "rolled_back",
		});
		expect(await rail.reclaim({ operationId: ORIGINAL_ID, family: "melt" })).toEqual({
			operationId: ORIGINAL_ID,
			state: "rolled_back",
		});
		expect(fake.calls).toEqual([
			{ family: "send", args: [ORIGINAL_ID] },
			{ family: "melt", args: [ORIGINAL_ID] },
		]);
	});

	test("rejects melt plus refund before either manager reclaim is called", async () => {
		const fake = managerFor();
		const rail = createCocoRail(fake.manager);

		await expect(
			rail.reclaim({ operationId: ORIGINAL_ID, family: "melt", spendingPath: "refund" }),
		).rejects.toMatchObject({ code: "refused_reclaim_path" });
		expect(fake.calls).toEqual([]);
		expect(fake.forbiddenCalls).toEqual([]);
	});

	test("preserves response loss, rolling_back resumption and terminal state on one id", async () => {
		const fake = managerFor({
			send: [
				new Error("response lost"),
				{ id: ORIGINAL_ID, state: "rolling_back" },
				{ id: ORIGINAL_ID, state: "rolled_back" },
			],
		});
		const rail = createCocoRail(fake.manager);
		const input = { operationId: ORIGINAL_ID, spendingPath: "refund" as const };

		await expect(rail.reclaim(input)).rejects.toThrow("response lost");
		expect(await rail.reclaim(input)).toEqual({
			operationId: ORIGINAL_ID,
			state: "rolling_back",
		});
		expect(await rail.reclaim(input)).toEqual({
			operationId: ORIGINAL_ID,
			state: "rolled_back",
		});
		expect(fake.calls).toHaveLength(3);
		expect(fake.calls.every((call) => JSON.stringify(call.args) === JSON.stringify([ORIGINAL_ID, { spendingPath: "refund" }]))).toBe(true);
	});

	test("fails closed when reclaim returns a different id", async () => {
		const fake = managerFor({ send: [{ id: "different-operation", state: "rolled_back" }] });
		await expect(
			createCocoRail(fake.manager).reclaim({ operationId: ORIGINAL_ID, spendingPath: "refund" }),
		).rejects.toMatchObject({ code: "refused_rail_operation_id" });
	});

	test("fails closed when reclaim returns no id", async () => {
		const fake = managerFor({ send: [{ state: "rolled_back" }] });
		await expect(
			createCocoRail(fake.manager).reclaim({ operationId: ORIGINAL_ID, spendingPath: "refund" }),
		).rejects.toMatchObject({ code: "refused_rail_operation" });
	});

	test("fails closed when reclaim returns an unknown state", async () => {
		const fake = managerFor({ send: [{ id: ORIGINAL_ID, state: "invented_terminal" }] });
		await expect(
			createCocoRail(fake.manager).reclaim({ operationId: ORIGINAL_ID, spendingPath: "refund" }),
		).rejects.toMatchObject({ code: "refused_rail_operation_state" });
	});

	test("fails closed for a missing operation", async () => {
		const fake = managerFor({ send: [null] });
		await expect(
			createCocoRail(fake.manager).reclaim({ operationId: ORIGINAL_ID, spendingPath: "refund" }),
		).rejects.toMatchObject({ code: "refused_rail_operation" });
	});

	test("fails closed for a malformed response and records no bearer-like fixture material", async () => {
		const fake = managerFor({ send: ["malformed"] });
		await expect(
			createCocoRail(fake.manager).reclaim({ operationId: ORIGINAL_ID, spendingPath: "refund" }),
		).rejects.toMatchObject({ code: "refused_rail_operation" });

		const serializedCalls = JSON.stringify(fake.calls);
		expect(serializedCalls).not.toMatch(/cashu[AB]|[0-9a-f]{64}/i);
		expect(fake.forbiddenCalls).toEqual([]);
	});
});
