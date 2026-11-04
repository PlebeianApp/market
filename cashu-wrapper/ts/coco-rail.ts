/**
 * coco-rail.ts — the ops surface Coco does not hand an adapter, so that the host's adapters can move money.
 *
 * ## Why this exists
 *
 * A `WalletApplicationAdapter` is given a `WalletAdapterContext` holding the *runtime* and the operation record.
 * The runtime's `engine` is deliberately read/reconcile-shaped (`get`, `listPrepared`, `listInFlight`, `refresh`,
 * `reclaim`) - it can report what has happened and recover it, and it cannot *act*. Anything that actually moves
 * money therefore needs a second, action-shaped surface, and the whole point of wrapping Coco behind the host is
 * that this surface exists in exactly one place. This is that place: `createCocoRail(manager)`.
 *
 * The other half of the seam is identity. Coco's `prepare` accepts a **caller-supplied `operationId`** ("a matching
 * retry joins the same prepared Send; conflicting intent or state fails closed"). Our host already claims a
 * `commandId` before it executes anything. So the adapter passes the host's command id straight through as Coco's
 * operation id, and the two sides of the boundary share one durable identity - which is what makes a crash between
 * them recoverable instead of ambiguous.
 *
 * ## What it does not do
 *
 * It never returns bearer material to a caller that only needs facts: `sendP2pk` returns the operation id and its
 * state, and the *token* only where the caller is the one that must hand it on (a payment). Locked proofs stay in
 * Coco's proof repository, which is where ADR-0010 puts them.
 */

import { getDecodedToken, getEncodedToken } from "@cashu/coco-core";
import type { Manager } from "@cashu/coco-core";

import {
	buildBlindedOutputs,
	CashuMintClient,
	compressedPublicKeyHex,
	inputFee,
	keysetPublicKey,
	parseP2PKSecret,
	signLockedSecret,
	splitAmount,
	unblindBlindedSignature,
	xOnlyPublicKeyHex,
} from "./nut-client";
import { readAuctionLock, parseAuctionLockSecret, AuctionLockRefusedError, type SigFlag } from "./auction-lock";
import { RefusedError } from "./errors";

/**
 * A refusal the rail raises. It extends `RefusedError`, so every `refused-*` message the rail throws carries a
 * `code` the host accepts (`host.ts:372-383`) and reaches the durable `failureCode` as a name instead of collapsing
 * to the generic `adapter_failure`. Before this, a bare `Error` from the rail lost its name at the boundary.
 */
export class RailRefusedError extends RefusedError {}

/**
 * The three terms that BUILD an auction lock (AUCTIONS.md §5.2/§5.3): the seller child pubkey the funds are
 * locked to, the refund timelock, and the bidder's separate refund key. Carried as first-class fields, never as a
 * display string — the lock is built from these and from nothing else.
 */
export interface AuctionLockTarget {
	/** The single lock pubkey: `derive(auction.p2pk_xpub, path)`, compressed (ADR-0003 L2.5). */
	readonly childPubkey: string;
	/** `max_end_at + settlement_grace`, in unix seconds (ADR-0003 L2.6). */
	readonly locktime: number;
	/** The bidder's own refund key, compressed (ADR-0003 L2.7) — a key the bidder can sign with, not the lock key. */
	readonly refundPubkey: string;
	/** v1 uses `SIG_INPUTS` (AUCTIONS.md §5.2/§5.3). */
	readonly sigflag?: SigFlag;
}

/** Friday fake-money 2-of-2 bidder+committee lock with one post-locktime refund key. */
export interface ThresholdSigAllLockTarget {
	readonly bidderPubkey: string;
	readonly committeePubkey: string;
	readonly refundPubkey: string;
	readonly locktime: number;
}

function assertThresholdSigAllLockTarget(lock: ThresholdSigAllLockTarget): void {
	if (!Number.isSafeInteger(lock.locktime) || lock.locktime < 1
		|| !/^0[23][0-9a-f]{64}$/.test(lock.bidderPubkey)
		|| !/^0[23][0-9a-f]{64}$/.test(lock.committeePubkey)
		|| !/^0[23][0-9a-f]{64}$/.test(lock.refundPubkey)
		|| sameLockKey(lock.bidderPubkey, lock.committeePubkey)
		|| sameLockKey(lock.bidderPubkey, lock.refundPubkey)
		|| sameLockKey(lock.committeePubkey, lock.refundPubkey)) {
		throw new RailRefusedError("refused-threshold-lock: keys or locktime are invalid");
	}
}

/**
 * Verify the token produced by Coco for one Friday threshold reservation.
 *
 * Kept as a pure exported reader so the browser composition and the live rail
 * use the same exact NUT-11 interpretation.  It never accepts a digest or a
 * client assertion in place of the mint-signed token itself.
 */
export function verifyThresholdSigAllToken(
	token: string,
	keysetId: string,
	lock: ThresholdSigAllLockTarget,
): { readonly proofCount: number; readonly amount: number } {
	assertThresholdSigAllLockTarget(lock);
	const decoded = getDecodedToken(token, [keysetId]) as { proofs?: { secret: string; amount?: unknown }[] };
	const proofs = decoded.proofs ?? [];
	if (proofs.length === 0) throw new RailRefusedError("refused-threshold-lock: token carries no proofs");
	let amount = 0;
	for (const proof of proofs) {
		const parsed = parseP2PKSecret(proof.secret);
		if (parsed === null || !sameLockKey(parsed.data, lock.bidderPubkey)) {
			throw new RailRefusedError("refused-threshold-lock: bidder key differs");
		}
		const tags = new Map(parsed.tags.map((tag) => [tag[0], tag.slice(1)]));
		if (tags.size !== parsed.tags.length || parsed.tags.some((tag) =>
			!["pubkeys", "n_sigs", "locktime", "refund", "sigflag"].includes(tag[0] ?? ""))
			|| tags.get("pubkeys")?.length !== 1 || !sameLockKey(tags.get("pubkeys")![0]!, lock.committeePubkey)
			|| tags.get("n_sigs")?.[0] !== "2" || tags.get("n_sigs")?.length !== 1
			|| tags.get("locktime")?.[0] !== String(lock.locktime) || tags.get("locktime")?.length !== 1
			|| tags.get("refund")?.length !== 1 || !sameLockKey(tags.get("refund")![0]!, lock.refundPubkey)
			|| tags.get("sigflag")?.[0] !== "SIG_ALL" || tags.get("sigflag")?.length !== 1) {
			throw new RailRefusedError("refused-threshold-lock: mint token differs from exact 2-of-2 SIG_ALL condition");
		}
		const held = amountOf(proof.amount);
		if (!Number.isSafeInteger(held) || held < 1 || !Number.isSafeInteger(amount + held)) {
			throw new RailRefusedError("refused-threshold-lock: proof amount is invalid");
		}
		amount += held;
	}
	return { proofCount: proofs.length, amount };
}

/** What a rail call reports back: the durable operation id, its state, and the reference the app may need. */
export interface RailResult {
	readonly operationId: string;
	readonly state: string;
	/** The outgoing token, where the caller must hand it to a counterparty (a payment). Never logged, never stored. */
	readonly token?: string;
	/** The settling preimage, where the rail observed one. */
	readonly preimage?: string;
	/** The mint's quote identity, where the rail created one. */
	readonly quote?: string;
}

/** Public, non-bearer facts used to seal one fake-mint run. */
export interface CocoMintSnapshot {
	readonly mintUrl: string;
	readonly mintPublicKey: string;
	readonly serverVersion: string;
	readonly activeSatKeysetId: string;
	readonly denominationKeyDigest: string;
	readonly denominationAmounts: readonly number[];
	readonly inputFeePpk: number;
	readonly nuts: readonly number[];
}

/**
 * Return only NUTs the mint explicitly advertises as usable.
 *
 * Nutshell includes disabled/unsupported entries in the public `nuts` map.
 * Treating every numeric key as supported makes the browser's live
 * inspection differ from the authority's cryptographically pinned snapshot,
 * even though both observed the same mint.  NUT-04 has its own method shape;
 * the other entries use the standard `supported: true` signal.
 */
function supportedMintNutNumbers(value: unknown): number[] {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
	const supported: number[] = [];
	for (const [rawNut, rawSettings] of Object.entries(value as Record<string, unknown>)) {
		if (!/^(?:0|[1-9][0-9]*)$/.test(rawNut) || rawSettings === null
			|| typeof rawSettings !== "object" || Array.isArray(rawSettings)) continue;
		const nut = Number(rawNut);
		if (!Number.isSafeInteger(nut)) continue;
		const settings = rawSettings as Record<string, unknown>;
		if (nut === 4) {
			if (settings.disabled === true || !Array.isArray(settings.methods)) continue;
			if (settings.methods.some((method) => method !== null && typeof method === "object"
				&& !Array.isArray(method) && (method as Record<string, unknown>).method === "bolt11"
				&& (method as Record<string, unknown>).unit === "sat")) supported.push(nut);
			continue;
		}
		if (settings.supported === true) supported.push(nut);
	}
	return supported.sort((left, right) => left - right);
}

/** Private funding references. Callers must keep these out of logs, DOM and public stores. */
export interface CocoMintQuoteRef {
	readonly quoteId: string;
	readonly mintUrl: string;
	readonly unit: string;
	readonly amount: number;
	readonly state: string;
}

export interface CocoMintOperationRef {
	readonly operationId: string;
	readonly quoteId: string;
	readonly state: string;
}

/**
 * A lock authority: the keypair that can reclaim a P2PK lock.
 *
 * Coco's keyring returns `{ publicKeyHex, secretKey: Uint8Array, derivationIndex, purpose }` - seed-derived and
 * counter-managed, which is what makes the *reference* (purpose + derivation index) the thing worth recording:
 * ADR-0010 §7 asks the app to keep "derivation paths and lock/refund condition metadata" beside the operation
 * link, and this is exactly that. The secret is handed up as hex and is the caller's to place durably.
 */
export interface LockKeypair {
	readonly pubkey: string;
	readonly secretKey: string;
	readonly derivationIndex: number | null;
	readonly purpose: string | null;
}

export interface CocoRailPort {
	/**
	 * Trust a mint, which Coco requires before it will quote or mint against it. Who may be trusted is the app's
	 * authority configuration (ADR-0010), so this is explicit and named rather than a default the rail assumes.
	 */
	trustMint(input: { mintUrl: string }): Promise<{ mintUrl: string; trusted: boolean }>;
	/** Read the pinned mint's public metadata without exposing a payment request or quote. */
	inspectMint(input: { mintUrl: string }): Promise<CocoMintSnapshot>;
	/** Durable quote lifecycle used by the demo funding journal. */
	createMintQuote(input: { mintUrl: string; amount: number; unit: string }): Promise<CocoMintQuoteRef>;
	listPendingMintQuotes(input: { mintUrl: string; amount: number; unit: string }): Promise<readonly CocoMintQuoteRef[]>;
	refreshMintQuote(input: { mintUrl: string; quoteId: string }): Promise<CocoMintQuoteRef>;
	/** Coco mint-operation identity is distinct from the app funding command identity. */
	listMintOperations(input: { mintUrl: string; quoteId: string }): Promise<readonly CocoMintOperationRef[]>;
	prepareMintOperation(input: { mintUrl: string; quoteId: string; amount: number }): Promise<CocoMintOperationRef>;
	resumeMintOperation(input: { operationId: string; quoteId: string }): Promise<CocoMintOperationRef>;
	/** Mint proofs into this wallet. The vendored pin is fake-funds-only, so this is the test mint's path. */
	fund(input: { mintUrl: string; amount: number; unit?: string; operationId?: string }): Promise<RailResult>;
	/** Send a plain token, for a payment a counterparty will receive. */
	send(input: { mintUrl: string; amount: number; unit?: string; operationId: string }): Promise<RailResult>;
	/**
	 * Durably reserve the exact inputs for a plain send without contacting the mint. Repeating the same
	 * caller-owned operation id and intent joins Coco's prepared operation; a different intent fails closed.
	 */
	prepareSendOperation(input: { mintUrl: string; amount: number; unit?: string; operationId: string }): Promise<RailResult>;
	/**
	 * Execute or recover the same caller-owned send. The complete immutable intent is required again so a
	 * recovered pending token can never be attached to a different amount, mint, or unit.
	 */
	resumeSendOperation(input: { mintUrl: string; amount: number; unit?: string; operationId: string }): Promise<RailResult>;
	/** Lock proofs to a public key: a plain 1-of-1 P2PK send (a seller's Cashu rail), NOT an auction lock. */
	sendP2pk(input: { mintUrl: string; amount: number; unit?: string; pubkey: string; operationId: string }): Promise<RailResult>;
	/**
	 * Place an **auction bid lock** (AUCTIONS.md §5.2): 1-of-1 P2PK to the seller child pubkey, with a refund
	 * timelock to the bidder's separate refund key (`n_sigs_refund=1`, `sigflag=SIG_INPUTS`). The lock is built
	 * from the three typed terms in `lock` and from nothing else, and the result is read back and put through the
	 * strict §5.3 reader before this returns — a lock the spec rejects is refused here, by name, while the money
	 * is still under this caller's control.
	 */
	sendLockedP2pk(input: { mintUrl: string; amount: number; unit?: string; operationId: string; lock: AuctionLockTarget }): Promise<RailResult>;
	/**
	 * Coco-owned preparation/execution for the Friday threshold lock. The
	 * result remains a durable Coco send operation; exact bearer material is
	 * read back only through `lockedToken` by the private package builder.
	 */
	sendThresholdSigAll(input: { mintUrl: string; amount: number; unit?: string; operationId: string; lock: ThresholdSigAllLockTarget }): Promise<RailResult>;
	/**
	 * Persist (or rejoin) the exact Coco threshold-send operation without
	 * executing it. The application records this operation identity before it
	 * permits mint I/O.
	 */
	prepareThresholdSigAll(input: { mintUrl: string; amount: number; unit?: string; operationId: string; lock: ThresholdSigAllLockTarget }): Promise<RailResult>;
	/**
	 * Create the exact threshold send if absent, otherwise resume Coco's
	 * already-journaled operation. This is the crash-safe browser entry point:
	 * a lost response or proof-policy refusal must never create a replacement
	 * send for the same application operation.
	 */
	ensureThresholdSigAll(input: { mintUrl: string; amount: number; unit?: string; operationId: string; lock: ThresholdSigAllLockTarget }): Promise<RailResult>;
	/**
	 * Rejoin the exact caller-owned threshold send after reload. The complete
	 * immutable lock intent is checked against Coco's durable operation before
	 * execution/recovery; no new send is prepared by this method.
	 */
	resumeThresholdSigAll(input: { mintUrl: string; amount: number; unit?: string; operationId: string; lock: ThresholdSigAllLockTarget }): Promise<RailResult>;
	/** Melt to a bolt11 invoice: the Lightning rail for paying a seller who asks in Lightning. */
	melt(input: { mintUrl: string; invoice: string; unit?: string; operationId: string }): Promise<RailResult>;
	/** Receive a token into this wallet - a seller's claim, or a counterparty returning funds. */
	receive(input: { token: string; operationId?: string }): Promise<RailResult>;
	/** Roll a send or a melt back. A P2PK refund always reclaims the original send operation in place. */
	reclaim(input: { operationId: string; family?: "send" | "melt"; spendingPath?: "refund" }): Promise<RailResult>;
	/** A fresh lock authority from Coco's own keyring. Seed-derived and counter-managed, never invented here. */
	generateLockKeypair(): Promise<LockKeypair>;
	/**
	 * Read back the token a send produced **from Coco's own durable operation** - never from app storage. ADR-0010's
	 * split puts locked material in Coco, and its §7 list of what the auction side may keep does not include a token.
	 * Returns `null` when Coco holds no such operation, rather than an empty token.
	 */
	lockedToken(input: { operationId: string }): Promise<{ token: string; unit: string; mintUrl: string } | null>;
	/**
	 * Redeem a P2PK-locked token with its refund key, and admit the result back through Coco's receive path.
	 *
	 * This is what a losing bidder's exit is. It is *not* a rollback: Coco refuses to roll back a pending send
	 * ("Cannot rollback operation in state pending"), correctly, because a token that has been handed out must not be
	 * un-sent. So the holder of the refund key spends the lock at the mint, and the recovered value re-enters the
	 * wallet through `receive` - which is ADR-0010 §1's rule that external proof material becomes locally
	 * authoritative only after admission through the wallet boundary.
	 */
	redeemP2pk(input: { mintUrl: string; token: string; secretKey: string; unit?: string; operationId?: string }): Promise<RailResult>;
}

/** Read a state without narrowing Coco's unions away: the rail reports Coco's own word for it. */
function stateOf(operation: unknown): string {
	if (operation === null || typeof operation !== "object") return "unknown";
	const state = (operation as { state?: unknown }).state;
	return typeof state === "string" ? state : "unknown";
}

/**
 * Whether two NUT-11 lock keys are the SAME key. Comparison is by the x coordinate, because a NUT-11 P2PK lock is
 * spent with a **BIP340 schnorr** signature and schnorr verification takes only the x coordinate — so `02<X>` and
 * `03<X>` name the same spending key. That matters here: Coco's keyring returns a compressed pubkey whose prefix is
 * not always the true parity of its own secret (`"02" + schnorr.getPublicKey(...)` — AUCTIONS.md's refund keys are
 * per-bid throwaway keys, so both parities occur), and a strict byte comparison would call the bidder's own key
 * "not ours" half the time and refuse a refund it can actually sign.
 */
function sameLockKey(left: string, right: string): boolean {
	const xOnly = (key: string): string => (key.length === 66 ? key.slice(2) : key).toLowerCase();
	return xOnly(left) === xOnly(right);
}

/**
 * A token as a string, whether a caller hands back an encoded string or the token object itself.
 *
 * The vendored pin has one interop wrinkle worth naming: a token produced by Coco's own `execute` carries
 * `Amount` instances from the cashu-ts copy bundled inside coco-core, while the encoder re-exported from
 * `@cashu/coco-core` is the standalone cashu-ts copy — it does not recognise the foreign `Amount` and throws
 * *"Unsupported amount input type"*. So when the direct encode fails, the proof amounts are flattened to plain
 * numbers and the encode is retried; the proof fields themselves are passed through untouched.
 */
function encodeToken(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (value !== null && typeof value === "object") {
		try {
			return getEncodedToken(value as never);
		} catch {
			try {
				const token = value as { proofs?: readonly { amount?: unknown }[] };
				if (!Array.isArray(token.proofs)) return undefined;
				const proofs = token.proofs.map((proof) => ({ ...proof, amount: amountOf(proof.amount) }));
				return getEncodedToken({ ...(value as object), proofs } as never);
			} catch {
				return undefined;
			}
		}
	}
	return undefined;
}

/** A token as a string, from an *operation* that carries one under its own `token` field. */
function tokenOf(operation: unknown): string | undefined {
	if (operation === null || typeof operation !== "object") return undefined;
	return encodeToken((operation as { token?: unknown }).token);
}

/**
 * Coco's `execute` returns the operation *and* whatever the operation produced: a send yields `{ operation, token }`,
 * while other families return the operation directly. One reader for both, so a caller never has to know which.
 */
function unwrap(executed: unknown): { operation: unknown; token?: string } {
	if (executed !== null && typeof executed === "object" && "operation" in executed) {
		const nested = (executed as { operation: unknown }).operation;
		if (nested !== null && nested !== undefined) {
			// `executed.token` here is the Token **itself**, not an operation carrying one — so it is encoded
			// directly. (Passing it through `tokenOf` was the bug: that helper reads an operation's own `token`
			// field, so a send's token never came back and `send`/`sendP2pk` silently returned none.)
			const token = encodeToken((executed as { token?: unknown }).token);
			return { operation: nested, ...(token !== undefined ? { token } : {}) };
		}
	}
	const token = tokenOf(executed);
	return { operation: executed, ...(token !== undefined ? { token } : {}) };
}

function preimageOf(operation: unknown): string | undefined {
	if (operation === null || typeof operation !== "object") return undefined;
	const preimage = (operation as { preimage?: unknown }).preimage;
	return typeof preimage === "string" ? preimage : undefined;
}

/**
 * A number for a proof's amount, whatever shape it arrives in.
 *
 * cashu-ts and Coco hand amounts back as `Amount` values, which stringify like numbers but are **not** numbers: a
 * sum over them concatenates ("128" + "2" + "1" = "12821"), and a mint sees a swap whose outputs do not balance.
 * That is exactly how a refund came to ask a mint for 12820 sat against 131 sat of inputs.
 */
function amountOf(value: unknown): number {
	if (typeof value === "number") return Number.isFinite(value) ? value : 0;
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	if (typeof value === "bigint") return Number(value);
	if (value !== null && typeof value === "object") {
		const held = (value as { value?: unknown }).value;
		if (held !== undefined) return amountOf(held);
	}
	return 0;
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function quoteRef(value: unknown): CocoMintQuoteRef {
	if (value === null || typeof value !== "object") throw new RailRefusedError("refused-mint-quote-shape");
	const quote = value as { quoteId?: unknown; quote?: unknown; mintUrl?: unknown; unit?: unknown; amount?: unknown; state?: unknown; amountPaid?: unknown; amountIssued?: unknown };
	const quoteId = typeof quote.quoteId === "string" ? quote.quoteId : typeof quote.quote === "string" ? quote.quote : "";
	const amount = amountOf(quote.amount);
	const issued = amountOf(quote.amountIssued);
	const paid = amountOf(quote.amountPaid);
	const state = issued >= amount && amount > 0 ? "ISSUED" : paid >= amount && amount > 0 ? "PAID" : typeof quote.state === "string" ? quote.state : "UNKNOWN";
	if (quoteId.length === 0 || typeof quote.mintUrl !== "string" || typeof quote.unit !== "string" || amount <= 0) throw new RailRefusedError("refused-mint-quote-shape");
	return { quoteId, mintUrl: quote.mintUrl, unit: quote.unit, amount, state };
}

function mintOperationRef(value: unknown, expectedQuoteId?: string): CocoMintOperationRef {
	if (value === null || typeof value !== "object") throw new RailRefusedError("refused-mint-operation-shape");
	const operation = value as { quoteId?: unknown };
	const quoteId = typeof operation.quoteId === "string" ? operation.quoteId : "";
	if (quoteId.length === 0 || (expectedQuoteId !== undefined && quoteId !== expectedQuoteId)) throw new RailRefusedError("refused-mint-operation-quote");
	return { operationId: idOf(value), quoteId, state: stateOf(value) };
}

function idOf(operation: unknown): string {
	if (operation === null || typeof operation !== "object") throw new RailRefusedError("refused-rail-operation: the rail did not return an operation");
	const id = (operation as { id?: unknown }).id;
	if (typeof id !== "string" || id.length === 0) throw new RailRefusedError("refused-rail-operation: the rail returned an operation with no id");
	return id;
}

/** Every durable state Coco may return from a send or melt reclaim, without inventing a terminal result. */
const RECLAIM_STATES: ReadonlySet<string> = new Set([
	"init",
	"prepared",
	"executing",
	"pending",
	"failed",
	"finalized",
	"rolling_back",
	"rolled_back",
]);

function reclaimResult(operation: unknown, expectedOperationId: string): RailResult {
	const operationId = idOf(operation);
	if (operationId !== expectedOperationId) {
		throw new RailRefusedError("refused-rail-operation-id: reclaim returned a different operation identity");
	}
	const state = stateOf(operation);
	if (!RECLAIM_STATES.has(state)) {
		throw new RailRefusedError("refused-rail-operation-state: reclaim returned no known durable operation state");
	}
	return { operationId: expectedOperationId, state };
}

function exactMintOrigin(value: string, options: { allowLoopbackHttp?: boolean; allowFipsUlaHttp?: boolean } = {}): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new RailRefusedError("refused-mint-transport-origin");
	}
	const exactOrigin = value === url.origin && url.username === "" && url.password === "" && url.pathname === "/" && url.search === "" && url.hash === "";
	const publicHttps = url.protocol === "https:" && url.port === "";
	const isolatedLoopback = options.allowLoopbackHttp && url.protocol === "http:" && url.hostname === "127.0.0.1" && /^[0-9]+$/.test(url.port)
		&& Number(url.port) >= 1024 && Number(url.port) <= 65535;
	const fipsUla = options.allowFipsUlaHttp && url.protocol === "http:"
		&& /^(?:fc|fd)[0-9a-f:]+$/i.test(url.hostname.replace(/^\[/, "").replace(/\]$/, ""))
		&& /^[0-9]+$/.test(url.port) && Number(url.port) >= 1024 && Number(url.port) <= 65535;
	if (!exactOrigin || (!publicHttps && !isolatedLoopback && !fipsUla)) throw new RailRefusedError("refused-mint-transport-origin");
	return url;
}

const MINT_RESPONSE_CONTENT_ENCODING_REFUSED = "mint-response-content-encoding-refused";
const MINT_BODY_CANCEL_GRACE_MS = 1_000;

/**
 * Preserve native Request/init header replacement semantics, then force the
 * only representation for which body bytes and Content-Length have the same
 * meaning in Bun. Browsers may treat Accept-Encoding as a forbidden header;
 * the separated nginx route independently clears it before proxying to the
 * mint, so browser Coco and server-side Coco share the same identity boundary.
 */
function identityMintRequestInit(input: Parameters<typeof fetch>[0], init: RequestInit | undefined,
	controller: AbortController): RequestInit {
	const headers = init?.headers !== undefined
		? new Headers(init.headers)
		: new Headers(input instanceof Request ? input.headers : undefined);
	headers.set("accept-encoding", "identity");
	const inherited = init?.signal ?? (input instanceof Request ? input.signal : undefined);
	const signal = inherited === undefined ? controller.signal : AbortSignal.any([inherited, controller.signal]);
	return { ...init, headers, redirect: "error", signal };
}

async function cancelMintBodyBounded(body: ReadableStream<Uint8Array>, reason: Error): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			body.cancel(reason).catch(() => undefined),
			new Promise<void>((resolve) => { timer = setTimeout(resolve, MINT_BODY_CANCEL_GRACE_MS); }),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

async function requireIdentityMintResponse(response: Response, controller: AbortController): Promise<void> {
	const encoding = response.headers.get("content-encoding");
	if (encoding === null || encoding.trim().toLowerCase() === "identity") return;
	const refusal = new RailRefusedError(MINT_RESPONSE_CONTENT_ENCODING_REFUSED);
	controller.abort(refusal);
	if (response.body !== null) await cancelMintBodyBounded(response.body, refusal);
	throw refusal;
}

/**
 * Bind every Coco mint request to one exact origin and fail closed on redirect
 * evidence. HTTP is accepted only for an explicit unprivileged 127.0.0.1 test
 * mint when the caller opts in; HTTPS remains the default and only remote mode.
 */
export function createOriginBoundMintFetch(mintUrl: string, fetchImpl: typeof fetch, options: {
	readonly allowLoopbackHttp?: boolean;
	readonly allowFipsUlaHttp?: boolean;
} = {}): typeof fetch {
	const expected = exactMintOrigin(mintUrl, options);
	return (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
		let requestUrl: URL;
		try {
			const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
			requestUrl = new URL(raw);
		} catch {
			throw new RailRefusedError("refused-mint-transport-url");
		}
		if (requestUrl.protocol !== expected.protocol || requestUrl.origin !== expected.origin || requestUrl.username !== "" || requestUrl.password !== "" || requestUrl.hash !== "") throw new RailRefusedError("refused-mint-transport-origin");
		const controller = new AbortController();
		const response = await fetchImpl(input, identityMintRequestInit(input, init, controller));
		if (response.status >= 300 && response.status < 400 || response.type === "opaqueredirect" || response.redirected) throw new RailRefusedError("refused-mint-transport-redirect");
		if (response.url === "") throw new RailRefusedError("refused-mint-transport-final-url");
		let finalUrl: URL;
		try {
			finalUrl = new URL(response.url);
		} catch {
			throw new RailRefusedError("refused-mint-transport-final-url");
		}
		if (finalUrl.origin !== expected.origin || finalUrl.protocol !== expected.protocol || finalUrl.username !== "" || finalUrl.password !== "") throw new RailRefusedError("refused-mint-transport-origin");
		await requireIdentityMintResponse(response, controller);
		return response;
	}) as typeof fetch;
}

/**
 * Keep the Cashu token/receipt identity on one public HTTPS origin while a
 * trusted server reaches the same mint over one fixed, non-public transport.
 * The mapping is configuration, never request data: path and query are copied
 * byte-for-byte and redirects or a final origin change fail closed.
 *
 * Browser Coco wallets must use the public origin directly.  This adapter is
 * only for the authority and participant-local signer processes inside the
 * reviewed FIPS network.
 */
export function createPinnedMintTransportFetch(logicalMintUrl: string, transportMintUrl: string,
	fetchImpl: typeof fetch): typeof fetch {
	const logical = exactMintOrigin(logicalMintUrl)
	const transport = exactMintOrigin(transportMintUrl, { allowLoopbackHttp: true, allowFipsUlaHttp: true })
	return (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
		let requestUrl: URL
		try {
			const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url
			requestUrl = new URL(raw)
		} catch {
			throw new RailRefusedError("refused-mint-transport-url")
		}
		if (requestUrl.origin !== logical.origin || requestUrl.protocol !== logical.protocol
			|| requestUrl.username !== "" || requestUrl.password !== "" || requestUrl.hash !== "") {
			throw new RailRefusedError("refused-mint-transport-origin")
		}
		const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, transport)
		const mappedInput = input instanceof Request
			? new Request(target, input)
			: target
		const controller = new AbortController()
		const response = await fetchImpl(mappedInput, identityMintRequestInit(mappedInput, init, controller))
		if (response.status >= 300 && response.status < 400 || response.type === "opaqueredirect"
			|| response.redirected) throw new RailRefusedError("refused-mint-transport-redirect")
		if (response.url === "") throw new RailRefusedError("refused-mint-transport-final-url")
		let finalUrl: URL
		try { finalUrl = new URL(response.url) }
		catch { throw new RailRefusedError("refused-mint-transport-final-url") }
		if (finalUrl.origin !== transport.origin || finalUrl.protocol !== transport.protocol
			|| finalUrl.username !== "" || finalUrl.password !== "") {
			throw new RailRefusedError("refused-mint-transport-origin")
		}
		await requireIdentityMintResponse(response, controller)
		return response
	}) as typeof fetch
}

/**
 * The rail over a Coco manager. Coco's four families are reached through the same structural reads the runtime
 * uses, for the same reason: this module is the only place that knows Coco's shape, and what it exposes upward is
 * our own.
 */
export function createCocoRail(manager: Manager, options: {
	readonly fetchImpl?: typeof fetch;
	readonly sleep?: (milliseconds: number) => Promise<void>;
	readonly allowLoopbackHttp?: boolean;
	readonly allowFipsUlaHttp?: boolean;
} = {}): CocoRailPort {
	const quotes = manager.quotes as unknown as {
		mint: {
			create(input: Record<string, unknown>): Promise<unknown>;
			get(identity: { mintUrl: string; quoteId: string }): Promise<unknown>;
			listPending(input?: { method?: string }): Promise<readonly unknown[]>;
			refresh(identity: { mintUrl: string; quoteId: string }): Promise<unknown>;
		};
		melt: {
			create(input: Record<string, unknown>): Promise<unknown>;
		};
	};
	const ops = manager.ops as unknown as {
		mint: {
			prepare(input: Record<string, unknown>): Promise<unknown>;
			execute(operationOrId: unknown): Promise<unknown>;
			get(operationId: string): Promise<unknown>;
			listByQuote(input: { mintUrl: string; quoteId: string }): Promise<readonly unknown[]>;
			checkPayment?(operationId: string): Promise<unknown>;
		};
		send: {
			prepare(input: Record<string, unknown>): Promise<unknown>;
			execute(operationOrId: unknown): Promise<unknown>;
			get(operationId: string): Promise<unknown>;
			refresh(operationId: string): Promise<unknown>;
			recovery: { run(): Promise<unknown>; inProgress?(): boolean };
			reclaim(operationId: string, options?: { spendingPath: "refund" }): Promise<unknown>;
			cancel?(operationId: string): Promise<unknown>;
		};
		melt: {
			prepare(input: Record<string, unknown>): Promise<unknown>;
			execute(operationOrId: unknown): Promise<unknown>;
			reclaim(operationId: string): Promise<unknown>;
		};
		receive: {
			prepare(input: Record<string, unknown>): Promise<unknown>;
			execute(operationOrId: unknown): Promise<unknown>;
		};
	};

	const scope = (unit?: string) => (unit === undefined ? {} : { unit });
	const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
	const sameMint = (left: string, right: string): boolean => left.replace(/\/+$/, "") === right.replace(/\/+$/, "");
	const assertPlainSendIntent = (operation: unknown, input: { mintUrl: string; amount: number; unit?: string; operationId: string }): void => {
		if (operation === null || typeof operation !== "object") throw new RailRefusedError("refused-send-operation-shape");
		const view = operation as { id?: unknown; mintUrl?: unknown; unit?: unknown; amount?: unknown; method?: unknown };
		if (view.id !== input.operationId || typeof view.mintUrl !== "string" || !sameMint(view.mintUrl, input.mintUrl)
			|| (typeof view.unit === "string" ? view.unit : "sat") !== (input.unit ?? "sat") || amountOf(view.amount) !== input.amount
			|| (view.method !== undefined && view.method !== "default")) {
			throw new RailRefusedError("refused-send-operation-intent-conflict");
		}
	};
	const preparePlainSend = async (input: { mintUrl: string; amount: number; unit?: string; operationId: string }): Promise<unknown> => {
		const existing = await ops.send.get(input.operationId);
		if (existing !== null && existing !== undefined) {
			assertPlainSendIntent(existing, input);
			return existing;
		}
		const prepared = await ops.send.prepare({ mintUrl: input.mintUrl, amount: input.amount, ...scope(input.unit), operationId: input.operationId });
		assertPlainSendIntent(prepared, input);
		return prepared;
	};
	const railResult = (operation: unknown, expectedOperationId: string, explicitToken?: string): RailResult => {
		const operationId = idOf(operation);
		if (operationId !== expectedOperationId) throw new RailRefusedError("refused-rail-operation-id: send returned a different operation identity");
		const token = explicitToken ?? tokenOf(operation);
		return { operationId, state: stateOf(operation), ...(token !== undefined ? { token } : {}) };
	};
	const resumePlainSend = async (input: { mintUrl: string; amount: number; unit?: string; operationId: string }): Promise<RailResult> => {
		let operation = await preparePlainSend(input);
		let state = stateOf(operation);
		if (state === "prepared") {
			const executed = unwrap(await ops.send.execute(input.operationId));
			assertPlainSendIntent(executed.operation, input);
			return railResult(executed.operation, input.operationId, executed.token);
		}
		if (state === "executing") {
			// Coco persisted the exact swap request before mint I/O. Its recovery replays that request rather than
			// inventing another Send. If another startup recovery is already active, leave the operation unavailable
			// and let the next bounded worker pass observe it.
			if (!(ops.send.recovery.inProgress?.() ?? false)) await ops.send.recovery.run();
			operation = await ops.send.get(input.operationId);
			if (operation === null || operation === undefined) throw new RailRefusedError("refused-send-operation-lost");
			assertPlainSendIntent(operation, input);
			state = stateOf(operation);
		}
		if (state === "pending" || state === "finalized") {
			const result = railResult(operation, input.operationId);
			if (result.token === undefined) throw new RailRefusedError("refused-send-token-unrecoverable");
			return result;
		}
		throw new RailRefusedError(`refused-send-unfinished:${state}`);
	};
	const thresholdTarget = (lock: ThresholdSigAllLockTarget) => ({ type: "p2pk", options: {
		kind: "P2PK", data: lock.bidderPubkey, pubkeys: [lock.committeePubkey],
		requiredSignatures: 2, locktime: lock.locktime,
		refundKeys: [lock.refundPubkey], requiredRefundSignatures: 1, sigFlag: "SIG_ALL",
	} });
	const assertThresholdSendIntent = (operation: unknown, input: {
		mintUrl: string; amount: number; unit?: string; operationId: string; lock: ThresholdSigAllLockTarget
	}): void => {
		if (operation === null || typeof operation !== "object") throw new RailRefusedError("refused-threshold-operation-shape");
		const view = operation as { id?: unknown; mintUrl?: unknown; unit?: unknown; amount?: unknown; method?: unknown; methodData?: unknown };
		const methodData = view.methodData;
		const methodRecord = methodData !== null && typeof methodData === "object" && !Array.isArray(methodData)
			? methodData as Record<string, unknown> : null;
		const optionsValue = methodRecord?.options;
		const optionsRecord = optionsValue !== null && typeof optionsValue === "object" && !Array.isArray(optionsValue)
			? optionsValue as Record<string, unknown> : null;
		const exactMethod = methodRecord !== null
			&& JSON.stringify(Object.keys(methodRecord).sort()) === JSON.stringify(["options"])
			&& optionsRecord !== null
			&& JSON.stringify(Object.keys(optionsRecord).sort()) === JSON.stringify([
				"data", "kind", "locktime", "pubkeys", "refundKeys", "requiredRefundSignatures",
				"requiredSignatures", "sigFlag",
			])
			&& optionsRecord.kind === "P2PK"
			&& optionsRecord.data === input.lock.bidderPubkey
			&& JSON.stringify(optionsRecord.pubkeys) === JSON.stringify([input.lock.committeePubkey])
			&& optionsRecord.requiredSignatures === 2
			&& optionsRecord.locktime === input.lock.locktime
			&& JSON.stringify(optionsRecord.refundKeys) === JSON.stringify([input.lock.refundPubkey])
			&& optionsRecord.requiredRefundSignatures === 1
			&& optionsRecord.sigFlag === "SIG_ALL";
		if (view.id !== input.operationId || typeof view.mintUrl !== "string" || !sameMint(view.mintUrl, input.mintUrl)
			|| (typeof view.unit === "string" ? view.unit : "sat") !== (input.unit ?? "sat")
			|| amountOf(view.amount) !== input.amount || view.method !== "p2pk" || !exactMethod) {
			throw new RailRefusedError("refused-threshold-operation-intent-conflict");
		}
	};

	return {
		async trustMint(input): Promise<{ mintUrl: string; trusted: boolean }> {
			const mintApi = manager.mint as unknown as {
				addMint(mintUrl: string, options?: Record<string, unknown>): Promise<unknown>;
				trustMint(mintUrl: string): Promise<void>;
				isTrustedMint(mintUrl: string): Promise<boolean>;
			};
			// Coco will only quote against a mint it knows *and* trusts, so both steps happen here, in that order,
			// and the result is read back rather than assumed.
			await mintApi.addMint(input.mintUrl).catch(async (error: unknown) => {
				if (await mintApi.isTrustedMint(input.mintUrl).catch(() => false)) return;
				throw error;
			});
			await mintApi.trustMint(input.mintUrl);
			const trusted = await mintApi.isTrustedMint(input.mintUrl);
			if (!trusted) throw new RailRefusedError(`refused-mint-untrusted: ${input.mintUrl} was added but is still not trusted`);
			return { mintUrl: input.mintUrl, trusted };
		},

		async inspectMint(input): Promise<CocoMintSnapshot> {
			const expected = exactMintOrigin(input.mintUrl, options);
			const strictFetch = createOriginBoundMintFetch(expected.origin, options.fetchImpl ?? fetch, {
				allowLoopbackHttp: options.allowLoopbackHttp,
				allowFipsUlaHttp: options.allowFipsUlaHttp,
			});
			const client = new CashuMintClient({ mintUrl: expected.href, fetchImpl: strictFetch });
			const info = await client.info();
			const { keysets } = await client.keysets();
			const active = keysets.filter((keyset) => keyset.unit === "sat" && keyset.active);
			if (active.length !== 1) throw new RailRefusedError("refused-mint-snapshot-active-keyset");
			const { keysets: keys } = await client.keys(active[0]!.id);
			const selected = keys.filter((keyset) => keyset.id === active[0]!.id && keyset.unit === "sat");
			if (selected.length !== 1) throw new RailRefusedError("refused-mint-snapshot-keys");
			// NUT-01 denominations are uint64 powers of two. A conforming mint may therefore advertise
			// keys above JavaScript's safe-integer range (Nutshell does, through 2^63). Keep their exact
			// decimal spelling in the seal/digest, and expose only exactly representable amounts to callers
			// that use the legacy number[] projection. Reject non-canonical or out-of-uint64 keys rather
			// than rounding two distinct denominations onto the same Number.
			const denominations = Object.entries(selected[0]!.keys).map(([amount, key]) => {
				if (!/^[1-9][0-9]*$/.test(amount)) throw new RailRefusedError("refused-mint-snapshot-keys");
				const exactAmount = BigInt(amount);
				if (exactAmount > 0xffff_ffff_ffff_ffffn || !/^0[23][0-9a-f]{64}$/.test(key.toLowerCase())) throw new RailRefusedError("refused-mint-snapshot-keys");
				return [amount, key.toLowerCase()] as const;
			}).sort((left, right) => BigInt(left[0]) < BigInt(right[0]) ? -1 : BigInt(left[0]) > BigInt(right[0]) ? 1 : 0);
			if (denominations.length === 0) throw new RailRefusedError("refused-mint-snapshot-keys");
			const safeDenominationAmounts = denominations.map(([amount]) => BigInt(amount)).filter((amount) => amount <= BigInt(Number.MAX_SAFE_INTEGER)).map(Number);
			if (safeDenominationAmounts.length === 0) throw new RailRefusedError("refused-mint-snapshot-keys");
			const nuts = supportedMintNutNumbers(info.nuts);
			if (typeof info.pubkey !== "string" || !/^0[23][0-9a-f]{64}$/.test(info.pubkey) || typeof info.version !== "string" || info.version.length === 0) throw new RailRefusedError("refused-mint-snapshot-info");
			const inputFeePpk = active[0]!.input_fee_ppk ?? 0;
			if (!Number.isSafeInteger(inputFeePpk) || inputFeePpk < 0) throw new RailRefusedError("refused-mint-snapshot-fee");
			return { mintUrl: expected.href.replace(/\/$/, ""), mintPublicKey: info.pubkey, serverVersion: info.version, activeSatKeysetId: active[0]!.id, denominationKeyDigest: await sha256Hex(JSON.stringify(denominations)), denominationAmounts: safeDenominationAmounts, inputFeePpk, nuts };
		},

		async createMintQuote(input): Promise<CocoMintQuoteRef> {
			return quoteRef(await quotes.mint.create({ mintUrl: input.mintUrl, method: "bolt11", amount: input.amount, unit: input.unit }));
		},

		async listPendingMintQuotes(input): Promise<readonly CocoMintQuoteRef[]> {
			const listed = await quotes.mint.listPending({ method: "bolt11" });
			return listed.map(quoteRef).filter((quote) => quote.mintUrl === input.mintUrl && quote.unit === input.unit && quote.amount === input.amount);
		},

		async refreshMintQuote(input): Promise<CocoMintQuoteRef> {
			const held = await quotes.mint.get(input);
			if (held === null || held === undefined) throw new RailRefusedError("refused-mint-quote-missing");
			return quoteRef(await quotes.mint.refresh(input));
		},

		async listMintOperations(input): Promise<readonly CocoMintOperationRef[]> {
			const listed = await ops.mint.listByQuote(input);
			return listed.filter((operation) => !["failed", "rolled_back"].includes(stateOf(operation))).map((operation) => mintOperationRef(operation, input.quoteId));
		},

		async prepareMintOperation(input): Promise<CocoMintOperationRef> {
			const prior = await this.listMintOperations({ mintUrl: input.mintUrl, quoteId: input.quoteId });
			if (prior.length > 1) throw new RailRefusedError("refused-mint-operation-ambiguous");
			if (prior.length === 1) return prior[0]!;
			const pending = await ops.mint.prepare({ quote: { mintUrl: input.mintUrl, quoteId: input.quoteId, method: "bolt11" }, amount: input.amount });
			return mintOperationRef(pending, input.quoteId);
		},

		async resumeMintOperation(input): Promise<CocoMintOperationRef> {
			let operation = await ops.mint.get(input.operationId);
			if (operation === null || operation === undefined) throw new RailRefusedError("refused-mint-operation-missing");
			let projected = mintOperationRef(operation, input.quoteId);
			if (projected.state !== "finalized" && projected.state !== "failed") {
				operation = unwrap(await ops.mint.execute(input.operationId)).operation;
				projected = mintOperationRef(operation, input.quoteId);
			}
			for (let attempt = 0; attempt < 60 && projected.state !== "finalized" && projected.state !== "failed"; attempt += 1) {
				await sleep(250);
				operation = (await ops.mint.get(input.operationId)) ?? operation;
				projected = mintOperationRef(operation, input.quoteId);
			}
			if (projected.state !== "finalized") throw new RailRefusedError("refused-mint-operation-unfinished");
			return projected;
		},

		async fund(input): Promise<RailResult> {
			// Minting is quote-backed: create the quote, wait for the mint to consider it paid, then mint against it.
			const created = (await quotes.mint.create({
				mintUrl: input.mintUrl,
				method: "bolt11",
				amount: input.amount,
				...scope(input.unit),
			})) as { quoteId?: unknown; state?: unknown; invoice?: unknown };
			const quoteId = typeof created?.quoteId === "string" ? created.quoteId : undefined;
			if (quoteId === undefined) throw new RailRefusedError("refused-mint-quote: the mint accepted no quote");

			// The vendored mint is a FakeWallet: it settles a quote as soon as it is asked to. A real mint would
			// wait for the invoice to be paid, and this loop is where that wait belongs - it fails closed, loudly.
			let paid = false;
			for (let attempt = 0; attempt < 40 && !paid; attempt += 1) {
				const refreshed = (await quotes.mint.refresh({ mintUrl: input.mintUrl, quoteId }).catch(() => null)) as { state?: unknown } | null;
				paid = refreshed?.state === "PAID" || refreshed?.state === "ISSUED";
					if (!paid) await sleep(250);
			}
				if (!paid) throw new RailRefusedError("refused-mint-unpaid");

			// Coco's own mint watcher may already have tracked this quote the moment it was paid - that is what
			// "watchExistingPendingQuotesOnStart" is for - in which case preparing again is refused ("already tracked
			// by operation ... in state executing") and the right move is to follow the operation that exists rather
			// than to insist on creating one. Funding is a test-mint convenience, so it is idempotent by design.
			// The watcher and this caller can reach for the same paid quote at the same moment, and an operation in
			// `init` is not persisted yet, so a lookup can miss it and `prepare` can then be refused as "already
			// tracked". Both are the same race, and the honest handling is to wait for whichever one settles and
			// follow it - bounded, and refused by name if neither does.
			const claim = async (): Promise<unknown | null> => {
				const tracked = (await ops.mint.listByQuote({ mintUrl: input.mintUrl, quoteId }).catch(() => [])) as readonly unknown[];
				const found = tracked.find((candidate) => stateOf(candidate) !== "rolled_back" && stateOf(candidate) !== "failed");
				if (found !== undefined) return found;
				try {
					const pending = await ops.mint.prepare({ quote: { mintUrl: input.mintUrl, quoteId, method: "bolt11" }, amount: input.amount });
					return unwrap(await ops.mint.execute(idOf(pending))).operation;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (!/already tracked/i.test(message)) throw error;
					return null;
				}
			};
			let started: unknown = null;
			for (let attempt = 0; attempt < 24 && started === null; attempt += 1) {
				started = await claim();
					if (started === null) await sleep(250);
			}
			if (started === null) {
					throw new RailRefusedError("refused-mint-claimed");
			}

			// Minting is not finished when the operation exists: it is finished when the mint has *finalized* it, and
			// until then the proofs are not ready to spend. Returning early here is what made a funded wallet read 0
			// and the very next send fail with "Not enough proofs to send" - so this waits, and says so if it cannot.
			let operation = started;
			for (let attempt = 0; attempt < 60 && stateOf(operation) !== "finalized"; attempt += 1) {
				if (stateOf(operation) === "rolled_back" || stateOf(operation) === "failed") break;
					await sleep(250);
				operation = (await ops.mint.get(idOf(operation))) ?? operation;
			}
			const finalState = stateOf(operation);
			if (finalState !== "finalized") {
					throw new RailRefusedError("refused-mint-unfinished");
			}
			return { operationId: idOf(operation), state: finalState, quote: quoteId };
		},

		async send(input): Promise<RailResult> {
			await preparePlainSend(input);
			return resumePlainSend(input);
		},

		async prepareSendOperation(input): Promise<RailResult> {
			return railResult(await preparePlainSend(input), input.operationId);
		},

		async resumeSendOperation(input): Promise<RailResult> {
			return resumePlainSend(input);
		},

		async sendP2pk(input): Promise<RailResult> {
			const expected = exactMintOrigin(input.mintUrl, options);
			const strictFetch = createOriginBoundMintFetch(expected.origin, options.fetchImpl ?? fetch, {
				allowLoopbackHttp: options.allowLoopbackHttp,
				allowFipsUlaHttp: options.allowFipsUlaHttp,
			});
			const prepared = await ops.send.prepare({
				mintUrl: input.mintUrl,
				amount: input.amount,
				...scope(input.unit),
				// Coco's P2PK target: the direct shorthand for one lock key, or full NUT-11 options.
				target: { type: "p2pk", pubkey: input.pubkey },
				operationId: input.operationId,
			});
			const locked = unwrap(await ops.send.execute(idOf(prepared)));
			const operationId = idOf(locked.operation);

			// Assert the invariant here, at the lock, rather than discovering it at refund time: the token Coco
			// produced must be locked to the very key this caller asked for. A lock to any other key is money the
			// bidder cannot take back, so it fails closed *now*, by name, while the fact is still cheap to see.
			const held = this.lockedToken({ operationId });
			const token = (await held)?.token;
			if (token !== undefined) {
				const client = new CashuMintClient({ mintUrl: expected.href, fetchImpl: strictFetch });
				const keyset = await client.activeKeyset(input.unit ?? "sat");
				if (keyset !== null) {
					const decoded = getDecodedToken(token, [keyset.id]) as { proofs?: { secret: string }[] };
					const expected = [input.pubkey, input.pubkey.replace(/^0[23]/, "")];
					for (const proof of decoded.proofs ?? []) {
						const parsed = parseP2PKSecret(proof.secret);
						if (parsed === null || !expected.some((key) => sameLockKey(key, parsed.data))) {
							throw new RailRefusedError(
								`refused-lock-mismatch: the lock was placed on ${parsed?.data ?? "no P2PK condition"} but the caller asked for ${input.pubkey}, so this lock could not be taken back`,
							);
						}
					}
				}
			}
			return { operationId, state: stateOf(locked.operation) };
		},

		async sendLockedP2pk(input): Promise<RailResult> {
			const lock = input.lock;
			const prepared = await ops.send.prepare({
				mintUrl: input.mintUrl,
				amount: input.amount,
				...scope(input.unit),
				// Full NUT-11 conditions, built from the three typed terms and nothing else. Coco/cashu-ts turn this
				// into the §5.3 tags: `data` = the child pubkey, one `locktime` tag, one `refund` tag, with
				// `n_sigs`/`n_sigs_refund` (1) and `sigflag` (SIG_INPUTS) at their NUT-11 defaults.
				target: {
					type: "p2pk",
					options: {
						kind: "P2PK",
						data: lock.childPubkey,
						locktime: lock.locktime,
						refundKeys: [lock.refundPubkey],
						requiredRefundSignatures: 1,
						sigFlag: lock.sigflag ?? "SIG_INPUTS",
					},
				},
				operationId: input.operationId,
			});
			const locked = unwrap(await ops.send.execute(idOf(prepared)));
			const operationId = idOf(locked.operation);

			// Assert the invariant HERE, at the lock, rather than discovering it at refund time: the token the mint
			// produced must be locked to exactly the three terms asked for, under the market's own §5.3 rules. The
			// strict reader returns the market's own reason codes, so a secret the market would condemn as
			// `bad_lock` is refused here **by name** while the lock is still cheap to inspect. This is what keeps a
			// build from ever leaving a lock the spec rejects: if it cannot be read back and verified, it fails.
			// The locked token comes back from the send itself (Coco's `execute` returns `{ operation, token }`),
			// falling back to the durable operation read — either way, never a token this app stored.
			const heldToken = locked.token ?? (await this.lockedToken({ operationId }))?.token;
			if (heldToken === undefined) {
				throw new AuctionLockRefusedError(
					"lock_unverifiable",
					`the mint produced no readable locked token for ${operationId}, so the lock cannot be verified against §5.3`,
				);
			}
			const expected = exactMintOrigin(input.mintUrl, options);
			const strictFetch = createOriginBoundMintFetch(expected.origin, options.fetchImpl ?? fetch, {
				allowLoopbackHttp: options.allowLoopbackHttp,
				allowFipsUlaHttp: options.allowFipsUlaHttp,
			});
			const client = new CashuMintClient({ mintUrl: expected.href, fetchImpl: strictFetch });
			const keyset = await client.activeKeyset(input.unit ?? "sat");
			if (keyset === null) {
				throw new AuctionLockRefusedError("lock_unverifiable", `${input.mintUrl} reports no active keyset, so the lock cannot be verified`);
			}
			const decoded = getDecodedToken(heldToken, [keyset.id]) as { proofs?: { secret: string }[] };
			const proofs = decoded.proofs ?? [];
			if (proofs.length === 0) throw new AuctionLockRefusedError("lock_no_proofs", `the lock ${operationId} produced no proofs`);
			for (const proof of proofs) {
				readAuctionLock(proof.secret, {
					expectedLocktime: lock.locktime,
					expectedChildPubkey: lock.childPubkey,
					expectedRefundPubkey: lock.refundPubkey,
					expectedSigflag: lock.sigflag ?? "SIG_INPUTS",
				});
			}
			return { operationId, state: stateOf(locked.operation) };
		},

		async sendThresholdSigAll(input): Promise<RailResult> {
			await this.prepareThresholdSigAll(input);
			return this.resumeThresholdSigAll(input);
		},

		async prepareThresholdSigAll(input): Promise<RailResult> {
			assertThresholdSigAllLockTarget(input.lock);
			const existing = await ops.send.get(input.operationId);
			if (existing !== null && existing !== undefined) {
				assertThresholdSendIntent(existing, input);
				const state = stateOf(existing);
				if (!["prepared", "executing", "pending"].includes(state)) {
					throw new RailRefusedError(`refused-threshold-operation-unfinished:${state}`);
				}
				return { operationId: input.operationId, state };
			}
			const prepared = await ops.send.prepare({
				mintUrl: input.mintUrl, amount: input.amount, ...scope(input.unit), operationId: input.operationId,
				target: thresholdTarget(input.lock),
			});
			assertThresholdSendIntent(prepared, input);
			const state = stateOf(prepared);
			if (state !== "prepared") {
				throw new RailRefusedError(`refused-threshold-operation-not-prepared:${state}`);
			}
			return { operationId: input.operationId, state };
		},

		async ensureThresholdSigAll(input): Promise<RailResult> {
			await this.prepareThresholdSigAll(input);
			return this.resumeThresholdSigAll(input);
		},

		async resumeThresholdSigAll(input): Promise<RailResult> {
			assertThresholdSigAllLockTarget(input.lock);
			let operation = await ops.send.get(input.operationId);
			if (operation === null || operation === undefined) {
				throw new RailRefusedError("refused-threshold-operation-absent");
			}
			assertThresholdSendIntent(operation, input);
			let state = stateOf(operation);
			if (state === "prepared") {
				operation = unwrap(await ops.send.execute(input.operationId)).operation;
				assertThresholdSendIntent(operation, input);
				state = stateOf(operation);
			} else if (state === "executing") {
				if (!(ops.send.recovery.inProgress?.() ?? false)) await ops.send.recovery.run();
				operation = await ops.send.get(input.operationId);
				if (operation === null || operation === undefined) throw new RailRefusedError("refused-threshold-operation-lost");
				assertThresholdSendIntent(operation, input);
				state = stateOf(operation);
			}
			if (state !== "pending") {
				throw new RailRefusedError(`refused-threshold-operation-unfinished:${state}`);
			}
			const held = await this.lockedToken({ operationId: input.operationId });
			if (held === null || !sameMint(held.mintUrl, input.mintUrl) || held.unit !== (input.unit ?? "sat")) {
				throw new RailRefusedError("refused-threshold-token-unrecoverable");
			}
			const expected = exactMintOrigin(input.mintUrl, options);
			const strictFetch = createOriginBoundMintFetch(expected.origin, options.fetchImpl ?? fetch, {
				allowLoopbackHttp: options.allowLoopbackHttp, allowFipsUlaHttp: options.allowFipsUlaHttp,
			});
			const keyset = await new CashuMintClient({ mintUrl: expected.href, fetchImpl: strictFetch })
				.activeKeyset(input.unit ?? "sat");
			if (keyset === null || verifyThresholdSigAllToken(held.token, keyset.id, input.lock).amount !== input.amount) {
				throw new RailRefusedError("refused-threshold-token-intent-conflict");
			}
			return { operationId: input.operationId, state, token: held.token };
		},

		async melt(input): Promise<RailResult> {
			// Melting is quote-backed too, and the bolt11 goes in as the quote's method data (NUT-05).
			const created = (await quotes.melt.create({
				mintUrl: input.mintUrl,
				method: "bolt11",
				methodData: { request: input.invoice },
				...scope(input.unit),
			})) as { quoteId?: unknown };
			const quoteId = typeof created?.quoteId === "string" ? created.quoteId : undefined;
			if (quoteId === undefined) throw new RailRefusedError("refused-melt-quote: the mint accepted no melt quote");
			const prepared = await ops.melt.prepare({ quote: { mintUrl: input.mintUrl, quoteId, method: "bolt11" } });
			const melted = unwrap(await ops.melt.execute(idOf(prepared)));
			return {
				operationId: idOf(melted.operation),
				state: stateOf(melted.operation),
				...(preimageOf(melted.operation) !== undefined ? { preimage: preimageOf(melted.operation)! } : {}),
				quote: quoteId,
			};
		},

		async receive(input): Promise<RailResult> {
			const prepared = await ops.receive.prepare({ token: input.token, ...(input.operationId !== undefined ? { operationId: input.operationId } : {}) });
			const received = unwrap(await ops.receive.execute(idOf(prepared)));
			return { operationId: idOf(received.operation), state: stateOf(received.operation) };
		},

		async reclaim(input): Promise<RailResult> {
			const family = input.family ?? "send";
			if (family === "melt" && input.spendingPath === "refund") {
				throw new RailRefusedError("refused-reclaim-path: the refund spending path belongs to send operations only");
			}
			const reclaimed =
				family === "melt"
					? await ops.melt.reclaim(input.operationId)
					: input.spendingPath === "refund"
						? await ops.send.reclaim(input.operationId, { spendingPath: "refund" })
						: await ops.send.reclaim(input.operationId);
			return reclaimResult(unwrap(reclaimed).operation, input.operationId);
		},

		async lockedToken(input) {
			const got = (await ops.send.get(input.operationId)) as { token?: unknown; unit?: unknown; mintUrl?: unknown; state?: unknown } | null;
			if (got === null || got === undefined) return null;
			const token = tokenOf(got);
			if (token === undefined) return null;
			return {
				token,
				unit: typeof got.unit === "string" ? got.unit : "sat",
				mintUrl: typeof got.mintUrl === "string" ? got.mintUrl : "",
			};
		},

		async redeemP2pk(input): Promise<RailResult> {
			// The token carries its mint; the caller's `mintUrl` is the fallback. The keyset is needed both to decode
			// the token (cashu-ts takes the keyset ids) and to swap against, so it is fetched first.
			const expected = exactMintOrigin(input.mintUrl, options);
			const strictFetch = createOriginBoundMintFetch(expected.origin, options.fetchImpl ?? fetch, {
				allowLoopbackHttp: options.allowLoopbackHttp,
				allowFipsUlaHttp: options.allowFipsUlaHttp,
			});
			const client = new CashuMintClient({ mintUrl: expected.href, fetchImpl: strictFetch });
			const unit = input.unit ?? "sat";
			const activeKeyset = await client.activeKeyset(unit);
			if (activeKeyset === null) throw new RailRefusedError(`refused-redeem: ${input.mintUrl} reports no active keyset for ${unit}`);
			const decoded = getDecodedToken(input.token, [activeKeyset.id]) as { mint?: unknown; proofs?: unknown; unit?: unknown };
			const mintUrl = typeof decoded.mint === "string" ? decoded.mint : input.mintUrl;
			if (exactMintOrigin(mintUrl, options).origin !== expected.origin) {
				throw new RailRefusedError("refused-redeem: token mint differs from the fixed wallet mint");
			}
			const proofs = Array.isArray(decoded.proofs) ? (decoded.proofs as { secret: string; amount: unknown; id: string }[]) : [];
			if (proofs.length === 0) throw new RailRefusedError("refused-redeem: the token carries no proofs to redeem");

			// Every proof must be spendable by the key we were given, or this is not ours to spend. Two branches:
			//
			//   - the key IS the lock's own pubkey (`data`) — the plain 1-of-1 P2PK case; or
			//   - the key is the lock's **refund** branch and its locktime has passed — the auction bid's exit
			//     (AUCTIONS.md §5.2: "After `locktime`, the bidder refund pubkey can additionally spend"). The mint
			//     enforces the timelock; this checks it locally too, so an early attempt is refused **by name**
			//     rather than sent to a mint that will reject it.
			//
			// A NUT-11 lock is spent with a BIP340 schnorr signature over the x coordinate, so the comparison is by
			// the x coordinate: `02<X>` and `03<X>` are the same spending key (`sameLockKey`). Coco's keyring hands
			// back a compressed key whose prefix is not always its own secret's true parity, so a byte comparison
			// would refuse half of the bidder's own refunds.
			const ourKeyX = xOnlyPublicKeyHex(input.secretKey);
			const isOurs = (key: string): boolean => sameLockKey(key, ourKeyX);
			const nowSeconds = Math.floor(Date.now() / 1000);
			const witnesses: string[] = [];
			for (const proof of proofs) {
				const parsed = parseP2PKSecret(proof.secret);
				if (parsed === null) {
					throw new RailRefusedError("refused-redeem: a proof in this token carries no NUT-10 P2PK condition, so it is not a lock this wallet can spend");
				}
				if (!isOurs(parsed.data)) {
					// Not the lock key — the only other way our key may spend is the refund branch, after locktime.
					const strict = parseAuctionLockSecret(proof.secret);
					const refundBranch = strict.ok && isOurs(strict.value.refundPubkey);
					if (!refundBranch) {
						// Name both keys in the refusal. Public keys are not secret, and a refusal that cannot be
						// diagnosed is a refusal that costs another mint-funded run to understand.
						throw new RailRefusedError(
							`refused-redeem: this token is not locked to the refund key that was supplied (lock names ${parsed.data}, the key we hold is ${compressedPublicKeyHex(input.secretKey)} or ${ourKeyX} x-only)`,
						);
					}
					if (nowSeconds <= strict.value.locktime) {
						throw new RailRefusedError(
							`refused-redeem: this lock's refund branch cannot be spent before its locktime (${strict.value.locktime}, now ${nowSeconds})`,
						);
					}
				}
				witnesses.push(signLockedSecret(proof.secret, input.secretKey));
			}

			const keyset = activeKeyset;
			const keys = (await client.keys(keyset.id)).keysets[0];
			if (keys === undefined) throw new RailRefusedError("refused-redeem: the mint returned no keys for its active keyset");

			// A swap must balance exactly: sum(inputs) == sum(outputs) + fee. The fee is the mint's own, and the sum is
			// taken numerically - `amountOf` is what keeps `Amount` values from concatenating into a nonsense total.
			let gross = 0;
			for (const proof of proofs) gross += amountOf(proof.amount);
			const fee = inputFee(keyset.input_fee_ppk ?? 0, proofs.length);
			const net = gross - fee;
			if (net <= 0) throw new RailRefusedError(`refused-redeem: ${gross} sat does not cover the mint's ${fee} sat input fee`);
			const { outputs, blindings } = buildBlindedOutputs(splitAmount(net), keyset.id);

			// NUT-11 carries the witness **on each input proof**: with SIG_INPUTS every input signs, and the
			// signature travels in that input's own `witness`. A top-level witness as well is what some mints accept,
			// but the per-proof form is the one the spec describes, so it is the one this sends.
			const signedInputs = proofs.map((proof, index) => ({
				...proof,
				witness: JSON.stringify({ signatures: [witnesses[index]!] }),
			}));
			const swapped = await client.swap(signedInputs as never, outputs);
			const recovered = swapped.signatures.map((signature, index) =>
				unblindBlindedSignature(signature, blindings[index]!, keysetPublicKey(keys, outputs[index]!.amount)),
			);

			// Admission: the recovered value enters Coco through its own receive path, so Coco stays the authority.
			const encoded = getEncodedToken({ mint: mintUrl, proofs: recovered, unit } as never);
			const prepared = await ops.receive.prepare({ token: encoded, ...(input.operationId !== undefined ? { operationId: input.operationId } : {}) });
			const received = unwrap(await ops.receive.execute(idOf(prepared)));
			return { operationId: idOf(received.operation), state: stateOf(received.operation) };
		},

		async generateLockKeypair(): Promise<LockKeypair> {
			const keyring = manager.keyring as unknown as { generateKeyPair(dumpSecretKey?: boolean): Promise<unknown> };
			const generated = (await keyring.generateKeyPair(true)) as {
				publicKeyHex?: unknown;
				secretKey?: unknown;
				derivationIndex?: unknown;
				purpose?: unknown;
			};
			const pubkey = typeof generated?.publicKeyHex === "string" ? generated.publicKeyHex : undefined;
			const secret = generated?.secretKey;
			const secretKey =
				typeof secret === "string"
					? secret
					: secret instanceof Uint8Array
						? Array.from({ length: secret.length }, (_unused, index) =>
								(secret as Uint8Array)[index]!.toString(16).padStart(2, "0"),
							).join("")
						: undefined;
			if (pubkey === undefined || secretKey === undefined || secretKey.length === 0) {
				throw new RailRefusedError("refused-lock-authority: Coco's keyring returned no usable P2PK keypair");
			}
			return {
				pubkey,
				secretKey,
				derivationIndex: typeof generated?.derivationIndex === "number" ? generated.derivationIndex : null,
				purpose: typeof generated?.purpose === "string" ? generated.purpose : null,
			};
		},
	};
}
