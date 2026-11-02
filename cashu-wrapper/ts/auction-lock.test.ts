/**
 * auction-lock.test.ts — the strict §5.3 reader, pinned to the market's own rules.
 *
 * AUCTIONS.md §5.3 gives the exact secret; ADR-0003 names the invariants (**L2.5** the secret's lock pubkey equals
 * `child_pubkey`; **L2.6** its locktime equals the bid's `locktime`; **L2.7** its refund key equals
 * `refund_pubkey`; plus a single key, `n_sigs=1`, `n_sigs_refund=1`, `sigflag=SIG_INPUTS`), and the market's own
 * `parseAuctionLockSecret` (`market/src/lib/cashu/p2pkSecret.ts:256-320`) maps a violation onto the verdict reason
 * `bad_lock`. `auction-lock.ts` mirrors that parser's checks and reason codes; each mutation below must be refused
 * **by the market's own reason** — the reader never repairs a secret, and never accepts one the market would condemn.
 */
import { describe, expect, test } from "bun:test";

import { AuctionLockRefusedError, buildAuctionLockSecret, parseAuctionLockSecret, readAuctionLock } from "./auction-lock";

const CHILD = "02" + "cc".repeat(32);
const REFUND = "02" + "dd".repeat(32);
const LOCKTIME = 1_800_000_000;
const CONSTRAINTS = { expectedLocktime: LOCKTIME, expectedChildPubkey: CHILD, expectedRefundPubkey: REFUND };
const SECRET = buildAuctionLockSecret({ childPubkey: CHILD, locktime: LOCKTIME, refundPubkey: REFUND, nonce: "00".repeat(32) });

/** Rewrite a built secret's tags/fields for a mutation case. */
function mutate(change: (body: { nonce: string; data: string; tags: string[][] }) => void): string {
	const outer = JSON.parse(SECRET) as [string, { nonce: string; data: string; tags: string[][] }];
	change(outer[1]);
	return JSON.stringify(outer);
}

describe("the strict §5.3 auction-lock reader", () => {
	test("the built secret is exactly the §5.3 shape: data + sigflag + locktime + refund + n_sigs_refund", () => {
		const outer = JSON.parse(SECRET) as [string, { nonce: string; data: string; tags: string[][] }];
		expect(outer[0]).toBe("P2PK");
		expect(outer[1].data).toBe(CHILD);
		expect(outer[1].tags).toEqual([
			["sigflag", "SIG_INPUTS"],
			["locktime", String(LOCKTIME)],
			["refund", REFUND],
			["n_sigs_refund", "1"],
		]);
	});

	test("accepts the conforming lock and returns its three terms", () => {
		const parsed = readAuctionLock(SECRET, CONSTRAINTS);
		expect(parsed.childPubkey).toBe(CHILD);
		expect(parsed.locktime).toBe(LOCKTIME);
		expect(parsed.refundPubkey).toBe(REFUND);
		expect(parsed.nSigs).toBe(1);
		expect(parsed.nSigsRefund).toBe(1);
		expect(parsed.sigflag).toBe("SIG_INPUTS");
		expect(parsed.additionalPubkeys).toEqual([]);
	});

	// ---- mutations: each must be refused by the market's own reason (the `bad_lock` family) -------------------
	test("a secret that is not JSON at all is refused secret_not_json", () => {
		expect(parseAuctionLockSecret("not-a-lock")).toEqual({ ok: false, reason: "secret_not_json", detail: expect.anything() });
	});

	test("a secret of the wrong shape/kind/inner shape is refused", () => {
		expect(parseAuctionLockSecret('["P2PK"]')).toMatchObject({ ok: false, reason: "secret_shape" });
		expect(parseAuctionLockSecret('["P2PKH",{}]')).toMatchObject({ ok: false, reason: "secret_kind" });
		expect(parseAuctionLockSecret('["P2PK",5]')).toMatchObject({ ok: false, reason: "secret_inner_shape" });
	});

	test("a missing nonce or data is refused", () => {
		expect(parseAuctionLockSecret(mutate((b) => { b.nonce = ""; }))).toMatchObject({ ok: false, reason: "missing_nonce" });
		expect(parseAuctionLockSecret(mutate((b) => { b.data = ""; }))).toMatchObject({ ok: false, reason: "missing_data_pubkey" });
	});

	test("a data that is not a compressed secp256k1 key is refused invalid_pubkey_format", () => {
		expect(parseAuctionLockSecret(mutate((b) => { b.data = "aa".repeat(32); }))).toMatchObject({ ok: false, reason: "invalid_pubkey_format" });
	});

	test("MUTATION no locktime → lock_missing_locktime (the exact shape the defect built)", () => {
		const noLocktime = mutate((b) => { b.tags = b.tags.filter((tag) => tag[0] !== "locktime"); });
		expect(parseAuctionLockSecret(noLocktime, CONSTRAINTS)).toMatchObject({ ok: false, reason: "lock_missing_locktime" });
		expect(() => readAuctionLock(noLocktime, CONSTRAINTS)).toThrow(AuctionLockRefusedError);
		expect(() => readAuctionLock(noLocktime, CONSTRAINTS)).toThrow(/refused-bid-lock: lock_missing_locktime/);
	});

	test("MUTATION a wrong locktime → lock_locktime_mismatch (ADR-0003 L2.6)", () => {
		const wrong = mutate((b) => { b.tags = b.tags.map((tag) => (tag[0] === "locktime" ? ["locktime", String(LOCKTIME + 1)] : tag)); });
		expect(parseAuctionLockSecret(wrong, CONSTRAINTS)).toMatchObject({ ok: false, reason: "lock_locktime_mismatch" });
	});

	test("MUTATION no refund key → lock_refund_count_invalid (ADR-0003 L2.7)", () => {
		const noRefund = mutate((b) => { b.tags = b.tags.filter((tag) => tag[0] !== "refund"); });
		expect(parseAuctionLockSecret(noRefund, CONSTRAINTS)).toMatchObject({ ok: false, reason: "lock_refund_count_invalid" });
	});

	test("MUTATION two refund keys → lock_refund_count_invalid (exactly one, §5.2)", () => {
		const two = mutate((b) => { b.tags = b.tags.map((tag) => (tag[0] === "refund" ? ["refund", REFUND, "03" + "ee".repeat(32)] : tag)); });
		expect(parseAuctionLockSecret(two, CONSTRAINTS)).toMatchObject({ ok: false, reason: "lock_refund_count_invalid" });
	});

	test("MUTATION the refund key is a different key → lock_refund_mismatch (ADR-0003 L2.7)", () => {
		const other = mutate((b) => { b.tags = b.tags.map((tag) => (tag[0] === "refund" ? ["refund", "03" + "ee".repeat(32)] : tag)); });
		expect(parseAuctionLockSecret(other, CONSTRAINTS)).toMatchObject({ ok: false, reason: "lock_refund_mismatch" });
	});

	test("MUTATION the lock pubkey is a different key → lock_pubkey_mismatch (ADR-0003 L2.5, P3.9)", () => {
		const other = mutate((b) => { b.data = "03" + "ee".repeat(32); });
		expect(parseAuctionLockSecret(other, CONSTRAINTS)).toMatchObject({ ok: false, reason: "lock_pubkey_mismatch" });
	});

	test("MUTATION a second lock pubkey (a `pubkeys` tag) → lock_multi_key (1-of-1, §5.2)", () => {
		const multi = mutate((b) => { b.tags = [["pubkeys", REFUND], ...b.tags]; });
		expect(parseAuctionLockSecret(multi, CONSTRAINTS)).toMatchObject({ ok: false, reason: "lock_multi_key" });
	});

	test("MUTATION n_sigs=2 → lock_n_sigs_invalid (the lock is 1-of-1)", () => {
		const two = mutate((b) => { b.tags = [["n_sigs", "2"], ...b.tags]; });
		expect(parseAuctionLockSecret(two, CONSTRAINTS)).toMatchObject({ ok: false, reason: "lock_n_sigs_invalid" });
	});

	test("MUTATION n_sigs_refund=2 → lock_n_sigs_refund_invalid (§5.2: n_sigs_refund=1)", () => {
		const two = mutate((b) => { b.tags = b.tags.map((tag) => (tag[0] === "n_sigs_refund" ? ["n_sigs_refund", "2"] : tag)); });
		expect(parseAuctionLockSecret(two, CONSTRAINTS)).toMatchObject({ ok: false, reason: "lock_n_sigs_refund_invalid" });
	});

	test("MUTATION sigflag=SIG_ALL → lock_sigflag_invalid (§5.2: v1 uses SIG_INPUTS)", () => {
		const sigAll = mutate((b) => { b.tags = b.tags.map((tag) => (tag[0] === "sigflag" ? ["sigflag", "SIG_ALL"] : tag)); });
		expect(parseAuctionLockSecret(sigAll, CONSTRAINTS)).toMatchObject({ ok: false, reason: "lock_sigflag_invalid" });
	});

	test("a secret with no sigflag tag defaults to SIG_INPUTS and a missing n_sigs_refund to 1 (as cashu-ts emits them)", () => {
		// cashu-ts writes `n_sigs_refund` only above 1 and `sigflag` only for SIG_ALL — so the mint-produced secret
		// carries neither, and the market's parser (and this one) defaults them to 1 / SIG_INPUTS.
		const minimal = JSON.stringify(["P2PK", { nonce: "ab", data: CHILD, tags: [["locktime", String(LOCKTIME)], ["refund", REFUND]] }]);
		const parsed = readAuctionLock(minimal, CONSTRAINTS);
		expect(parsed.sigflag).toBe("SIG_INPUTS");
		expect(parsed.nSigsRefund).toBe(1);
	});
});
