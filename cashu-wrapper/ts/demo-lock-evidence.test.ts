import { expect, test } from "bun:test";
import { createDemoLockEvidenceReader, type DemoLockEvidencePorts } from "./demo-lock-evidence";
import { createMemoryLockAuthorityStore } from "./lock-authority-store";
import type { CocoRailPort } from "./coco-rail";

const child = `02${"a".repeat(64)}`, refund = `03${"b".repeat(64)}`, locktime = 1_900_001_920;
const secret = JSON.stringify(["P2PK", { nonce: "01", data: child, tags: [["sigflag", "SIG_INPUTS"], ["locktime", String(locktime)], ["refund", refund], ["n_sigs_refund", "1"]] }]);
const proof = (amount: number, i: number) => ({ id: "ks", amount, secret, C: `02${String(i).repeat(64)}`, dleq: { e: "1", s: "2", r: "3" } });
async function fixture(amounts = [8, 4, 1], fee = 100, state = "UNSPENT", options: { verify?: boolean; active?: boolean; omitAmountKey?: number; omitDleq?: boolean; secretForIndex?: (index: number) => string; stateRows?: number; states?: readonly string[]; stateError?: Error; mutateStateRequest?: boolean; lockedTokenGate?: Promise<void>; authorityReadGate?: Promise<void>; onAuthorityRead?: () => void; checkStatesGate?: Promise<void>; timeoutMs?: number; duplicateY?: boolean; foreignState?: boolean } = {}) {
  const authorities = createMemoryLockAuthorityStore(); await authorities.save({ commandId: "op", applicationId: "plebeian-market", auctionRef: "auction", bidRef: "bid", mintUrl: "http://127.0.0.1:3338", unit: "sat", amount: amounts.reduce((a, b) => a + b, 0), childPubkey: child, locktime, refundPubkey: refund, path: "m/private", createdAt: 1, revision: 4 });
  if (options.authorityReadGate) { const originalRead = authorities.read.bind(authorities); authorities.read = async (id) => { options.onAuthorityRead?.(); await options.authorityReadGate; return originalRead(id); }; }
  const proofs = amounts.map((amount, index) => { const value = { ...proof(amount, index), secret: options.secretForIndex?.(index) ?? secret }; if (options.omitDleq) delete (value as { dleq?: unknown }).dleq; return value; }); const ys = proofs.map((_value, i) => `02${(options.duplicateY ? 1 : i + 1).toString(16).padStart(64, "0")}`);
  const yByC = new Map(proofs.map((value, index) => [value.C, ys[index]!]));
  const ports: DemoLockEvidencePorts = { rail: { async lockedToken() { if (options.lockedTokenGate) await options.lockedTokenGate; return { token: "bearer-never-output", unit: "sat", mintUrl: "http://127.0.0.1:3338" }; } } as unknown as CocoRailPort, authorities, timeoutMs: options.timeoutMs, async readKeysets() { return [{ id: "ks", unit: "sat", active: options.active ?? true, inputFeePpk: fee, keys: Object.fromEntries(amounts.filter((amount) => amount !== options.omitAmountKey).map((amount) => [String(amount), "key"])) }]; }, async checkStates(_mintUrl, proofYs) { if (options.checkStatesGate) await options.checkStatesGate; if (options.stateError) throw options.stateError; const requested = proofYs as string[]; if (options.mutateStateRequest) requested.splice(1); return requested.slice(0, options.stateRows ?? requested.length).map((Y, index) => ({ Y: options.foreignState && index === 0 ? `02${"f".repeat(64)}` : Y, state: options.states?.[index] ?? state })); }, decodeToken() { return { mint: "http://127.0.0.1:3338", unit: "sat", proofs }; }, verifyDleq() { return options.verify ?? true; }, proofY(value) { return yByC.get(value.C)!; } };
  const read = createDemoLockEvidenceReader(ports);
  return { read, ports, proofs, request: { operationId: "op", mintUrl: "http://127.0.0.1:3338", unit: "sat" as const, amount: amounts.reduce((a, b) => a + b, 0), auctionId: "auction", bidId: "bid" } };
}

test("returns only public verified evidence for 13 and 15", async () => {
  for (const amounts of [[8, 4, 1], [8, 4, 2, 1]]) { const { read, request } = await fixture(amounts); const evidence = await read(request); expect(evidence?.proofs).toHaveLength(amounts.length); expect(evidence?.totalAmount).toBe(amounts.reduce((a, b) => a + b, 0)); const raw = JSON.stringify(evidence); for (const forbidden of ["bearer", "m/private", "secret", "dleq", "refundSecret"]) expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase()); }
});
test("distinct proof nonces with identical NUT-11 conditions remain valid", async () => {
  const { read, request } = await fixture([8, 4, 1], 100, "UNSPENT", { secretForIndex: (index) => JSON.stringify(["P2PK", { nonce: String(index + 1), data: child, tags: [["sigflag", "SIG_INPUTS"], ["locktime", String(locktime)], ["refund", refund], ["n_sigs_refund", "1"]] }]) });
  expect((await read(request))?.proofs).toHaveLength(3);
});
test("five proofs, excessive fee, spent state and amount mismatch fail closed", async () => {
  for (const [amounts, fee, state, override] of [[[16, 8, 4, 2, 1], 100, "UNSPENT", undefined], [[8, 4, 1], 101, "UNSPENT", undefined], [[8, 4, 1], 100, "SPENT", undefined], [[8, 4, 1], 100, "UNSPENT", 14]] as const) { const { read, request } = await fixture([...amounts], fee, state); await expect(read({ ...request, ...(override === undefined ? {} : { amount: override }) })).rejects.toThrow("demo-lock-evidence"); }
});
test("DLEQ, keyset and authority mismatches fail", async () => {
  const authority = await fixture(); await expect(authority.read({ ...authority.request, bidId: "other" })).rejects.toThrow("authority-mismatch");
  for (const options of [{ verify: false }, { omitDleq: true }, { active: false }, { omitAmountKey: 8 }, { stateRows: 2 }, { duplicateY: true }, { foreignState: true }]) { const { read, request } = await fixture([8, 4, 1], 100, "UNSPENT", options); await expect(read(request)).rejects.toThrow("demo-lock-evidence"); }
  const other = JSON.stringify(["P2PK", { nonce: "02", data: child, tags: [["sigflag", "SIG_INPUTS"], ["locktime", String(locktime + 1)], ["refund", refund], ["n_sigs_refund", "1"]] }]);
  const mixed = await fixture([8, 4, 1], 100, "UNSPENT", { secretForIndex: (index) => index === 1 ? other : secret }); await expect(mixed.read(mixed.request)).rejects.toThrow("mixed-conditions");
});
test("only a complete all-UNSPENT NUT-07 set is admissible", async () => {
  const valid = await fixture([8, 4, 1], 100, "UNSPENT");
  await expect(valid.read(valid.request)).resolves.toMatchObject({ totalAmount: 13 });
  for (const options of [
    { states: ["UNSPENT", "SPENT", "UNSPENT"] },
    { states: ["UNSPENT", "UNKNOWN", "UNSPENT"] },
    { states: ["UNSPENT", "", "UNSPENT"] },
    { stateRows: 2 },
    { stateError: new Error("nut-07-timeout") },
    { mutateStateRequest: true },
  ]) {
    const candidate = await fixture([8, 4, 1], 100, "UNSPENT", options);
    await expect(candidate.read(candidate.request)).rejects.toThrow();
  }
});
test("snapshots request, methods, decoded proofs and keysets before security-sensitive awaits", async () => {
  let releaseToken!: () => void;
  const tokenGate = new Promise<void>((resolve) => { releaseToken = resolve; });
  const first = await fixture([8, 4, 1], 100, "UNSPENT", { lockedTokenGate: tokenGate });
  const mutableRequest = { ...first.request };
  const pending = first.read(mutableRequest);
  mutableRequest.operationId = "substituted-operation";
  (first.ports as { checkStates: DemoLockEvidencePorts["checkStates"] }).checkStates = async (_mint, proofYs) => proofYs.map((Y) => ({ Y, state: "SPENT" }));
  releaseToken();
  await expect(pending).resolves.toMatchObject({ totalAmount: 13 });

  let releaseAuthority!: () => void;
  let authorityStarted!: () => void;
  const authorityGate = new Promise<void>((resolve) => { releaseAuthority = resolve; });
  const authoritySeen = new Promise<void>((resolve) => { authorityStarted = resolve; });
  const second = await fixture([8, 4, 1], 100, "UNSPENT", { authorityReadGate: authorityGate, onAuthorityRead: authorityStarted });
  const duringAuthority = second.read(second.request);
  await authoritySeen;
  second.proofs[0]!.amount = 16;
  releaseAuthority();
  await expect(duringAuthority).resolves.toMatchObject({ totalAmount: 13 });
});
test("bounds a never-settling NUT-07 state read", async () => {
  const never = new Promise<void>(() => {});
  const candidate = await fixture([8, 4, 1], 100, "UNSPENT", { checkStatesGate: never, timeoutMs: 10 });
  await expect(candidate.read(candidate.request)).rejects.toThrow("demo-lock-evidence-check-states-timeout");
});
