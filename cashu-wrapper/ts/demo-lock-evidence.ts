import { getDecodedToken } from "@cashu/coco-core";
import { hasValidDleq } from "@cashu/cashu-ts";
import { parseAuctionLockSecret } from "./auction-lock";
import type { CocoRailPort } from "./coco-rail";
import type { LockAuthorityRecord, LockAuthorityStore } from "./lock-authority-store";
import { proofPoint } from "./nut-client";

export interface DemoEvidenceKeyset { readonly id: string; readonly unit: string; readonly active: boolean; readonly inputFeePpk?: number; readonly keys: Readonly<Record<string, string>>; }
export interface DemoEvidenceProof { readonly id: string; readonly amount: unknown; readonly secret: string; readonly C: string; readonly dleq?: unknown; }
export interface DemoLockEvidence {
  readonly mintUrl: string; readonly unit: "sat"; readonly totalAmount: number;
  readonly proofs: readonly { readonly amount: number; readonly reservationId: string; readonly keysetId: string; readonly inputFeePpk: number }[];
  readonly conditionFingerprint: string; readonly locktime: number; readonly authorityGeneration: number;
}
export interface DemoLockEvidencePorts {
  readonly rail: CocoRailPort; readonly authorities: LockAuthorityStore;
  readonly readKeysets: (mintUrl: string) => Promise<readonly DemoEvidenceKeyset[]>;
  readonly checkStates: (mintUrl: string, proofYs: readonly string[]) => Promise<readonly { readonly Y: string; readonly state: string }[]>;
  readonly timeoutMs?: number;
  readonly decodeToken?: (token: string) => { readonly mint: string; readonly unit?: string; readonly proofs: readonly DemoEvidenceProof[] };
  readonly verifyDleq?: (proof: DemoEvidenceProof, keyset: DemoEvidenceKeyset) => boolean;
  readonly proofY?: (proof: DemoEvidenceProof) => string;
}
export interface DemoLockEvidenceRequest { readonly operationId: string; readonly mintUrl: string; readonly unit: "sat"; readonly amount: number; readonly auctionId: string; readonly bidId: string; }

const enc = new TextEncoder();
const sha = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource))].map((v) => v.toString(16).padStart(2, "0")).join("");
const amountOf = (value: unknown): number => typeof value === "number" ? value : typeof value === "string" ? Number(value) : value !== null && typeof value === "object" && "value" in value ? amountOf((value as { value: unknown }).value) : Number.NaN;
const normalizeMint = (value: string) => new URL(value).href.replace(/\/$/, "");
async function bounded<T>(work: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`demo-lock-evidence-${label}-timeout`)), timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
async function reservationId(mintUrl: string, y: string): Promise<string> {
  if (!/^0[23][0-9a-f]{64}$/i.test(y)) throw new Error("demo-lock-evidence-proof-y");
  const domain = enc.encode("DEMO_AUTH_V1/reservation\0"), mint = enc.encode(normalizeMint(mintUrl)), unit = enc.encode("sat"), point = Uint8Array.from(y.match(/../g)!.map((v) => Number.parseInt(v, 16)));
  const input = new Uint8Array(domain.length + mint.length + 1 + unit.length + 1 + point.length); let offset = 0;
  input.set(domain, offset); offset += domain.length; input.set(mint, offset); offset += mint.length; input[offset++] = 0; input.set(unit, offset); offset += unit.length; input[offset++] = 0; input.set(point, offset);
  return sha(input);
}
function authorityMatches(authority: LockAuthorityRecord | null, request: DemoLockEvidenceRequest, terms: { childPubkey: string; refundPubkey: string; locktime: number }): asserts authority is LockAuthorityRecord {
  if (authority === null || authority.commandId !== request.operationId || authority.auctionRef !== request.auctionId || authority.bidRef !== request.bidId || normalizeMint(authority.mintUrl) !== normalizeMint(request.mintUrl) || authority.unit !== "sat" || authority.amount !== request.amount || authority.childPubkey.toLowerCase() !== terms.childPubkey.toLowerCase() || authority.refundPubkey.toLowerCase() !== terms.refundPubkey.toLowerCase() || authority.locktime !== terms.locktime) throw new Error("demo-lock-evidence-authority-mismatch");
}

export function createDemoLockEvidenceReader(ports: DemoLockEvidencePorts) {
  const lockedToken = ports.rail.lockedToken.bind(ports.rail);
  const readAuthority = ports.authorities.read.bind(ports.authorities);
  const readKeysets = ports.readKeysets.bind(ports);
  const checkStates = ports.checkStates.bind(ports);
  const decodeToken = ports.decodeToken ?? ((token: string) => getDecodedToken(token, []) as never);
  const verifyDleq = ports.verifyDleq ?? ((proof: DemoEvidenceProof, keyset: DemoEvidenceKeyset) => hasValidDleq(proof as never, keyset as never, { require: true }));
  const proofY = ports.proofY ?? ((proof: DemoEvidenceProof) => proofPoint(proof as never).toHex());
  const timeoutMs = ports.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error("demo-lock-evidence-timeout-range");
  return async (callerRequest: DemoLockEvidenceRequest): Promise<DemoLockEvidence | null> => {
    const request = structuredClone(callerRequest);
    const heldValue = await bounded(lockedToken({ operationId: request.operationId }), "locked-token", timeoutMs); if (heldValue === null) return null;
    const held = structuredClone(heldValue);
    if (normalizeMint(held.mintUrl) !== normalizeMint(request.mintUrl) || held.unit !== "sat") throw new Error("demo-lock-evidence-token-scope");
    const decoded = structuredClone(decodeToken(held.token));
    if (normalizeMint(decoded.mint) !== normalizeMint(request.mintUrl) || (decoded.unit ?? "sat") !== "sat" || decoded.proofs.length < 1 || decoded.proofs.length > 4) throw new Error("demo-lock-evidence-token-shape");
    const keysets = structuredClone(await bounded(readKeysets(request.mintUrl), "keysets", timeoutMs));
    const parsed = decoded.proofs.map((proof) => { const lock = parseAuctionLockSecret(proof.secret); if (!lock.ok) throw new Error(`demo-lock-evidence-${lock.reason}`); return lock.value; });
    const condition = (lock: (typeof parsed)[number]) => JSON.stringify({ childPubkey: lock.childPubkey.toLowerCase(), additionalPubkeys: lock.additionalPubkeys.map((key) => key.toLowerCase()), nSigs: lock.nSigs, locktime: lock.locktime, refundPubkey: lock.refundPubkey.toLowerCase(), nSigsRefund: lock.nSigsRefund, sigflag: lock.sigflag });
    const first = parsed[0]!; if (parsed.some((lock) => condition(lock) !== condition(first))) throw new Error("demo-lock-evidence-mixed-conditions");
    const authorityValue = await bounded(readAuthority(request.operationId), "authority", timeoutMs);
    const authority = authorityValue === null ? null : structuredClone(authorityValue); authorityMatches(authority, request, first);
    let sum = 0; const ys: string[] = []; const seenYs = new Set<string>(); const projected: { amount: number; reservationId: string; keysetId: string; inputFeePpk: number }[] = [];
    for (const proof of decoded.proofs) {
      const amount = amountOf(proof.amount); const keyset = keysets.find((entry) => entry.id === proof.id);
      if (!Number.isSafeInteger(amount) || amount <= 0 || keyset === undefined || !keyset.active || keyset.unit !== "sat" || typeof keyset.keys[String(amount)] !== "string") throw new Error("demo-lock-evidence-keyset");
      const fee = keyset.inputFeePpk ?? 0; if (!Number.isSafeInteger(fee) || fee < 0 || fee > 100) throw new Error("demo-lock-evidence-fee");
      if (proof.dleq === undefined || !verifyDleq(proof, keyset)) throw new Error("demo-lock-evidence-dleq");
      const y = proofY(proof).toLowerCase(); if (seenYs.has(y)) throw new Error("demo-lock-evidence-duplicate-proof"); seenYs.add(y); ys.push(y); sum += amount; projected.push({ amount, reservationId: await reservationId(request.mintUrl, y), keysetId: keyset.id, inputFeePpk: fee });
    }
    if (!Number.isSafeInteger(request.amount) || request.amount <= 0 || !Number.isSafeInteger(sum) || sum !== request.amount) throw new Error("demo-lock-evidence-amount");
    const expectedYs = Object.freeze([...ys]);
    const states = structuredClone(await bounded(checkStates(request.mintUrl, [...expectedYs]), "check-states", timeoutMs)); const stateMap = new Map<string, string>();
    for (const state of states) { const y = state.Y.toLowerCase(); if (stateMap.has(y) || !seenYs.has(y)) throw new Error("demo-lock-evidence-spent-or-unknown"); stateMap.set(y, state.state.toUpperCase()); }
    if (stateMap.size !== seenYs.size || expectedYs.some((y) => stateMap.get(y) !== "UNSPENT")) throw new Error("demo-lock-evidence-spent-or-unknown");
    return { mintUrl: normalizeMint(request.mintUrl), unit: "sat", totalAmount: sum, proofs: projected.sort((a, b) => a.reservationId.localeCompare(b.reservationId)), conditionFingerprint: await sha(enc.encode(condition(first))), locktime: first.locktime, authorityGeneration: authority.revision };
  };
}
