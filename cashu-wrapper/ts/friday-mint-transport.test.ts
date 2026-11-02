import { describe, expect, test } from "bun:test";
import { createBoundedMintFetch } from "./friday-mint-transport";

describe("Friday bounded mint transport", () => {
	test("aborts a mint that accepts and never responds", async () => {
		let underlyingAborted = false;
		const hanging = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
			const signal = init?.signal;
			if (signal == null) return reject(new Error("missing abort signal"));
			signal.addEventListener("abort", () => { underlyingAborted = true; reject(signal.reason); }, { once: true });
		})) as typeof fetch;
		const bounded = createBoundedMintFetch(25, hanging);
		const started = Date.now();
		await expect(bounded("http://127.0.0.1:3338/v1/swap", { method: "POST" })).rejects.toThrow("exceeded 25ms");
		expect(underlyingAborted).toBeTrue();
		expect(Date.now()-started).toBeLessThan(1_000);
	});

	test("forwards an existing caller abort", async () => {
		const hanging = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
			init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
		})) as typeof fetch;
		const caller = new AbortController();
		const bounded = createBoundedMintFetch(1_000, hanging);
		const pending = bounded("http://127.0.0.1:3338/v1/info", { signal: caller.signal });
		caller.abort(new Error("caller cancelled"));
		await expect(pending).rejects.toThrow("caller cancelled");
	});
});
