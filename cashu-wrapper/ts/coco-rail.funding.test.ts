import { describe, expect, test } from "bun:test";
import { Amount, deriveKeysetId } from "@cashu/cashu-ts";
import { initializeCoco, MemoryRepositories } from "@cashu/coco-core";
import { createCocoRail, createOriginBoundMintFetch } from "./coco-rail";

const MINT = "https://testnut.cashu.space";
const MINT_KEY = `03${"b".repeat(64)}`;
const AMOUNT_KEY = `02${"d".repeat(64)}`;
const KEYSET = deriveKeysetId({ 1: AMOUNT_KEY, 2: AMOUNT_KEY }, { unit: "sat" });

function response(body: unknown, url: string, status = 200, options: { redirected?: boolean; responseType?: "default" | "opaqueredirect" } = {}): Response {
  const result = new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
	Object.defineProperties(result, { url: { value: url }, redirected: { value: options.redirected ?? false }, type: { value: options.responseType ?? "default" } });
  return result;
}

function manager() {
  let operation: { id: string; quoteId: string; state: string } | null = null;
  let loseExecute = false;
  const calls: string[] = [];
  const quote = { quoteId: "private-quote", mintUrl: MINT, unit: "sat", amount: { value: 120 }, state: "PAID", invoice: "not-returned" };
  const value = {
    quotes: {
      mint: {
        async create() { calls.push("quote-create"); return quote; },
        async get() { return quote; },
        async listPending() { calls.push("quote-list"); return [quote, { ...quote, quoteId: "foreign", amount: { value: 121 } }]; },
        async refresh() { calls.push("quote-refresh"); return quote; },
      },
      melt: {},
    },
    ops: {
      mint: {
        async listByQuote() { calls.push("operation-list"); return operation === null ? [] : [operation]; },
        async prepare() { calls.push("operation-prepare"); operation = { id: "coco-generated", quoteId: quote.quoteId, state: "prepared" }; return operation; },
        async get() { return operation; },
        async execute() { calls.push("operation-execute"); operation = { ...operation!, state: "finalized" }; if (loseExecute) { loseExecute = false; throw new Error("response-lost"); } return operation; },
      },
      send: {}, melt: {}, receive: {},
    },
  };
  return { value: value as never, calls, quote, loseNextExecute() { loseExecute = true; }, setOperation(next: typeof operation) { operation = next; } };
}

describe("Coco rail durable funding lifecycle", () => {
  test("seals public mint metadata and rejects redirects", async () => {
    const requests: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input); requests.push(url);
      if (url.endsWith("/v1/info")) return response({ pubkey: MINT_KEY, version: "cdk-mintd/0.18.1", nuts: { 4: {}, 7: {}, 9: {}, 10: {}, 11: {}, 12: {} } }, url);
      if (url.endsWith("/v1/keysets")) return response({ keysets: [{ id: KEYSET, unit: "sat", active: true, input_fee_ppk: 100 }] }, url);
      return response({ keysets: [{ id: KEYSET, unit: "sat", keys: { 1: AMOUNT_KEY, 2: AMOUNT_KEY, "9223372036854775808": AMOUNT_KEY } }] }, url);
    }) as typeof fetch;
    const rail = createCocoRail(manager().value, { fetchImpl });
    const snapshot = await rail.inspectMint({ mintUrl: MINT });
    expect(snapshot).toMatchObject({ mintUrl: MINT, mintPublicKey: MINT_KEY, serverVersion: "cdk-mintd/0.18.1", activeSatKeysetId: KEYSET, denominationAmounts: [1, 2], inputFeePpk: 100, nuts: [4, 7, 9, 10, 11, 12] });
    expect(snapshot.denominationKeyDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(requests).toHaveLength(3);
    const redirected = createCocoRail(manager().value, { fetchImpl: (async (input) => response({}, String(input), 302)) as typeof fetch });
    await expect(redirected.inspectMint({ mintUrl: MINT })).rejects.toThrow("refused-mint-transport-redirect");
    for (const variant of [`${MINT}/`, "http://testnut.cashu.space", "https://testnut.cashu.space:443", `${MINT}/path`, `${MINT}?query=1`]) await expect(rail.inspectMint({ mintUrl: variant })).rejects.toThrow("refused-mint-transport-origin");
  });

	test("origin-bound fetch forces redirect error and rejects every redirect/final-origin ambiguity", async () => {
		for (const status of [301, 302, 303, 307, 308]) {
			let calls = 0;
			const guarded = createOriginBoundMintFetch(MINT, (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				calls += 1; expect(init?.redirect).toBe("error"); return response({}, String(input), status);
			}) as unknown as typeof fetch);
			await expect(guarded(`${MINT}/v1/info`)).rejects.toThrow("refused-mint-transport-redirect"); expect(calls).toBe(1);
		}
		for (const finalUrl of ["", "https://evil.example/v1/info"]) {
			const guarded = createOriginBoundMintFetch(MINT, (async () => response({}, finalUrl)) as unknown as typeof fetch);
			await expect(guarded(`${MINT}/v1/info`)).rejects.toThrow(finalUrl === "" ? "final-url" : "origin");
		}
		for (const options of [{ redirected: true }, { responseType: "opaqueredirect" as const }]) {
			const guarded = createOriginBoundMintFetch(MINT, (async (input) => response({}, String(input), 200, options)) as typeof fetch);
			await expect(guarded(`${MINT}/v1/info`)).rejects.toThrow("refused-mint-transport-redirect");
		}
		for (const variant of ["http://testnut.cashu.space", "https://user@testnut.cashu.space", "https://testnut.cashu.space:443", `${MINT}/path`, `${MINT}?q=1`, `${MINT}#x`]) expect(() => createOriginBoundMintFetch(variant, fetch)).toThrow("refused-mint-transport-origin");
		let calls = 0;
		const guarded = createOriginBoundMintFetch(MINT, (async (input) => { calls += 1; return response({ reason: "unchanged" }, String(input), 503); }) as typeof fetch);
		await expect(guarded("https://evil.example/v1/info")).rejects.toThrow("refused-mint-transport-origin"); expect(calls).toBe(0);
		const unavailable = await guarded(`${MINT}/v1/info`); expect(unavailable.status).toBe(503); expect(await unavailable.json()).toEqual({ reason: "unchanged" });
	});

  test("quote and operation references expose no payment request and preserve distinct Coco identity", async () => {
    const fake = manager(); const rail = createCocoRail(fake.value, { sleep: async () => {} });
    const created = await rail.createMintQuote({ mintUrl: MINT, amount: 120, unit: "sat" });
    expect(created).toEqual({ quoteId: "private-quote", mintUrl: MINT, unit: "sat", amount: 120, state: "PAID" });
    expect(JSON.stringify(created)).not.toContain("not-returned");
    expect(await rail.listPendingMintQuotes({ mintUrl: MINT, amount: 120, unit: "sat" })).toEqual([created]);
    const prepared = await rail.prepareMintOperation({ mintUrl: MINT, quoteId: created.quoteId, amount: 120 });
    expect(prepared).toEqual({ operationId: "coco-generated", quoteId: "private-quote", state: "prepared" });
    expect(prepared.operationId).not.toBe(created.quoteId);
    expect(await rail.resumeMintOperation({ operationId: prepared.operationId, quoteId: created.quoteId })).toEqual({ ...prepared, state: "finalized" });
    expect(fake.calls.filter((call) => call === "operation-prepare")).toHaveLength(1);
  });

  test("response loss resumes the exact operation and ambiguity fails before prepare", async () => {
    const fake = manager(); const rail = createCocoRail(fake.value, { sleep: async () => {} });
    const prepared = await rail.prepareMintOperation({ mintUrl: MINT, quoteId: "private-quote", amount: 120 });
    fake.loseNextExecute();
    await expect(rail.resumeMintOperation({ operationId: prepared.operationId, quoteId: prepared.quoteId })).rejects.toThrow("response-lost");
    expect(await rail.resumeMintOperation({ operationId: prepared.operationId, quoteId: prepared.quoteId })).toEqual({ ...prepared, state: "finalized" });
    fake.setOperation({ id: "one", quoteId: "private-quote", state: "prepared" });
    const ambiguous = manager();
    (ambiguous.value as unknown as { ops: { mint: { listByQuote: () => Promise<unknown[]> } } }).ops.mint.listByQuote = async () => [{ id: "one", quoteId: "private-quote", state: "prepared" }, { id: "two", quoteId: "private-quote", state: "executing" }];
    await expect(createCocoRail(ambiguous.value).prepareMintOperation({ mintUrl: MINT, quoteId: "private-quote", amount: 120 })).rejects.toThrow("refused-mint-operation-ambiguous");
  });
});

test("the packed Coco package consumes the guarded fetch and null WebSocket seam with polling only", async () => {
	const requests: Array<{ path: string; redirect: RequestInit["redirect"] }> = [];
	const quoteId = "packed-seam-quote";
	const baseFetch = (async (input, init) => {
		const url = new URL(String(input)); requests.push({ path: url.pathname, redirect: init?.redirect });
		let body: unknown;
		if (url.pathname === "/v1/info") body = { name: "Packed Seam Mint", version: "1.0.0", pubkey: MINT_KEY, contact: [], nuts: { 4: { methods: [{ method: "bolt11", unit: "sat" }], disabled: false } } };
		else if (url.pathname === "/v1/keysets") body = { keysets: [{ id: KEYSET, unit: "sat", active: true, input_fee_ppk: 0 }] };
		else if (url.pathname === `/v1/keys/${KEYSET}`) body = { keysets: [{ id: KEYSET, unit: "sat", keys: { 1: AMOUNT_KEY, 2: AMOUNT_KEY } }] };
		else if (url.pathname === "/v1/mint/quote/bolt11" && init?.method === "POST") body = { quote: quoteId, request: "lnbc1packed", state: "UNPAID", expiry: Math.floor(Date.now() / 1000) + 3600, amount: 1, amount_paid: 0, amount_issued: 0, unit: "sat" };
		else if (url.pathname === `/v1/mint/quote/bolt11/${quoteId}`) body = { quote: quoteId, request: "lnbc1packed", state: "UNPAID", expiry: Math.floor(Date.now() / 1000) + 3600, amount: 1, amount_paid: 0, amount_issued: 0, unit: "sat" };
		else throw new Error(`unexpected-packed-seam-request:${url.pathname}`);
		return response(body, url.href);
	}) as typeof fetch;
	const manager = await initializeCoco({
		repo: new MemoryRepositories(), seedGetter: async () => new Uint8Array(64), requestFetch: createOriginBoundMintFetch(MINT, baseFetch), webSocketFactory: null,
		watchers: { proofStateWatcher: { disabled: true }, meltQuoteWatcher: { disabled: true } }, processors: { mintOperationProcessor: { disabled: true }, meltSettlementProcessor: { disabled: true } },
		subscriptions: { fastPollingIntervalMs: 5, slowPollingIntervalMs: 5 },
	});
	let unsubscribe: (() => Promise<void>) | undefined;
	try {
		await manager.mint.addMint(MINT, { trusted: true });
		const quote = await manager.quotes.mint.create({ mintUrl: MINT, method: "bolt11", amount: Amount.from(1) });
		({ unsubscribe } = await manager.subscriptions.subscribe(MINT, "bolt11_mint_quote", [quote.quoteId]));
		for (let attempt = 0; attempt < 50 && requests.filter(({ path }) => path.endsWith(`/${quoteId}`)).length < 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 2));
		expect(requests.some(({ path }) => path === "/v1/info")).toBeTrue();
		expect(requests.some(({ path }) => path === "/v1/mint/quote/bolt11")).toBeTrue();
		expect(requests.some(({ path }) => path.endsWith(`/${quoteId}`))).toBeTrue();
		expect(requests.every(({ redirect }) => redirect === "error")).toBeTrue();
	} finally {
		await unsubscribe?.(); await manager.dispose();
	}
});

test("the packed Manager refuses later quote redirects and foreign finals after clean metadata preflight", async () => {
	for (const attack of ["redirect", "foreign"] as const) {
		let quoteCalls = 0; let foreignTargetCalls = 0;
		const baseFetch = (async (input, init) => {
			const url = new URL(String(input));
			if (url.origin !== MINT) foreignTargetCalls += 1;
			if (url.pathname === "/v1/info") return response({ name: "Guard Attack Mint", version: "1.0.0", pubkey: MINT_KEY, contact: [], nuts: { 4: { methods: [{ method: "bolt11", unit: "sat" }], disabled: false } } }, url.href);
			if (url.pathname === "/v1/keysets") return response({ keysets: [{ id: KEYSET, unit: "sat", active: true, input_fee_ppk: 0 }] }, url.href);
			if (url.pathname === `/v1/keys/${KEYSET}`) return response({ keysets: [{ id: KEYSET, unit: "sat", keys: { 1: AMOUNT_KEY, 2: AMOUNT_KEY } }] }, url.href);
			if (url.pathname === "/v1/mint/quote/bolt11" && init?.method === "POST") {
				quoteCalls += 1;
				return attack === "redirect" ? response({}, url.href, 307) : response({ quote: "foreign", request: "secret", state: "UNPAID", expiry: 1, amount: 1, unit: "sat" }, "https://evil.example/capture");
			}
			throw new Error(`unexpected-guard-attack-request:${url.pathname}`);
		}) as typeof fetch;
		const manager = await initializeCoco({ repo: new MemoryRepositories(), seedGetter: async () => new Uint8Array(64), requestFetch: createOriginBoundMintFetch(MINT, baseFetch), webSocketFactory: null, watchers: { proofStateWatcher: { disabled: true }, meltQuoteWatcher: { disabled: true } }, processors: { mintOperationProcessor: { disabled: true }, meltSettlementProcessor: { disabled: true } } });
		try {
			await manager.mint.addMint(MINT, { trusted: true });
			await expect(manager.quotes.mint.create({ mintUrl: MINT, method: "bolt11", amount: Amount.from(1) })).rejects.toThrow(attack === "redirect" ? "refused-mint-transport-redirect" : "refused-mint-transport-origin");
			expect(quoteCalls).toBe(1); expect(foreignTargetCalls).toBe(0);
		} finally { await manager.dispose(); }
	}
});

test("the packed Manager routes mint-operation Wallet HTTP through the same refusing guard", async () => {
	let mintPostCalls = 0;
	const baseFetch = (async (input, init) => {
		const url = new URL(String(input));
		if (url.pathname === "/v1/info") return response({ name: "Mint Operation Guard", version: "1.0.0", pubkey: MINT_KEY, contact: [], nuts: { 4: { methods: [{ method: "bolt11", unit: "sat" }], disabled: false } } }, url.href);
		if (url.pathname === "/v1/keysets") return response({ keysets: [{ id: KEYSET, unit: "sat", active: true, input_fee_ppk: 0 }] }, url.href);
		if (url.pathname === `/v1/keys/${KEYSET}`) return response({ keysets: [{ id: KEYSET, unit: "sat", keys: { 1: AMOUNT_KEY, 2: AMOUNT_KEY } }] }, url.href);
		if (url.pathname === "/v1/mint/quote/bolt11" && init?.method === "POST") return response({ quote: "paid-quote", request: "lnbc1paid", state: "PAID", expiry: Math.floor(Date.now() / 1000) + 3600, amount: 1, amount_paid: 1, amount_issued: 0, unit: "sat" }, url.href);
		if (url.pathname === "/v1/mint/bolt11" && init?.method === "POST") { mintPostCalls += 1; return response({}, url.href, 308); }
		throw new Error(`unexpected-mint-operation-request:${init?.method ?? "GET"}:${url.pathname}`);
	}) as typeof fetch;
	const manager = await initializeCoco({ repo: new MemoryRepositories(), seedGetter: async () => new Uint8Array(64), requestFetch: createOriginBoundMintFetch(MINT, baseFetch), webSocketFactory: null, watchers: { proofStateWatcher: { disabled: true }, meltQuoteWatcher: { disabled: true } }, processors: { mintOperationProcessor: { disabled: true }, meltSettlementProcessor: { disabled: true } } });
	try {
		await manager.mint.addMint(MINT, { trusted: true });
		const quote = await manager.quotes.mint.create({ mintUrl: MINT, method: "bolt11", amount: Amount.from(1) });
		const operation = await manager.ops.mint.prepare({ quote: { mintUrl: MINT, quoteId: quote.quoteId, method: "bolt11" }, amount: Amount.from(1) });
		await expect(manager.ops.mint.execute(operation)).rejects.toThrow("refused-mint-transport-redirect");
		const persisted = await manager.ops.mint.get(operation.id); expect(persisted?.id).toBe(operation.id);
		expect((await manager.ops.mint.listByQuote({ mintUrl: MINT, quoteId: quote.quoteId })).map(({ id }) => id)).toEqual([operation.id]);
		const joined = await createCocoRail(manager).prepareMintOperation({ mintUrl: MINT, quoteId: quote.quoteId, amount: 1 });
		expect(joined.operationId).toBe(operation.id);
		expect((await manager.ops.mint.listByQuote({ mintUrl: MINT, quoteId: quote.quoteId })).map(({ id }) => id)).toEqual([operation.id]);
		expect(mintPostCalls).toBe(1);
	} finally { await manager.dispose(); }
});
