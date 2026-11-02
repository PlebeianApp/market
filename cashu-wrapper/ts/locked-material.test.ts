import { describe, expect, test } from "bun:test";
import { getEncodedToken } from "@cashu/coco-core";

import { buildAuctionLockSecret } from "./auction-lock";
import { lockedMaterialFromToken } from "./locked-material";

/**
 * The decode `lockedMaterialFromToken` performs — `getDecodedToken → parseP2PKSecret → proofPoint` — exercised on a
 * REAL, library-encoded Cashu token (audit N2). Until this test the branch ran in no suite: the fixture rails'
 * `lockedToken` returns `null`, so a bid's material was never decoded from a token, and a change in the lock key's
 * FORM (compressed vs x-only) would have made a bid refuse only AFTER the money was locked.
 *
 * HONESTY about "real". The token here is encoded by the cashu library's own `getEncodedToken` and decoded by its
 * own `getDecodedToken` — the exact round trip the production path uses. It is NOT mint-produced: the proof's `C`
 * is a placeholder, because a mint-produced proof differs from this one ONLY in its `C` signature, and the decode
 * never reads `C` (`proofPoint` hashes the `secret`; `parseP2PKSecret` reads the `secret`). A mint-produced proof
 * over a live mint is exercised only in work item 5's live end-to-end run; what this test pins is the decode of a
 * real token with a real compressed P2PK secret.
 */

const CHILD = "02" + "cc".repeat(32);
const REFUND = "02" + "dd".repeat(32);
const LOCKTIME = 2_000_000_000;
/** A §5.3 auction lock: 1-of-1 to the child key, with a refund timelock to the bidder's separate refund key. */
const auctionLock = (nonce: string): string => buildAuctionLockSecret({ childPubkey: CHILD, locktime: LOCKTIME, refundPubkey: REFUND, nonce });

/** A real Cashu token (library-encoded) whose every proof carries `secret`. */
function encodedToken(secret: string, coins = 1): string {
	return getEncodedToken({
		mint: "http://127.0.0.1:3338",
		proofs: Array.from({ length: coins }, () => ({ amount: 1, id: "00".repeat(8), secret, C: "02" + "ab".repeat(32) })),
		unit: "sat",
	} as never);
}

describe("lockedMaterialFromToken — the real-token decode (audit N2), strict about §5.3", () => {
	test("decodes a real auction-lock token into { child key, locktime, refund key, secrets, proof Ys }", () => {
		const secret = auctionLock("00".repeat(32));
		const material = lockedMaterialFromToken(encodedToken(secret));
		expect(material).not.toBeNull();
		expect(material!.childPubkey).toBe(CHILD);
		expect(material!.locktime).toBe(LOCKTIME);
		expect(material!.refundPubkey).toBe(REFUND);
		expect(material!.lockSecrets).toEqual([secret]);
		expect(material!.proofYs.length).toBe(1);
		// A public curve point in compressed form — the same shape the bid wire's `proof_y` carries.
		expect(material!.proofYs[0]).toMatch(/^0[23][0-9a-f]{64}$/);
	});

	test("maps every proof of a multi-proof token", () => {
		const secret = auctionLock("11".repeat(32));
		const material = lockedMaterialFromToken(encodedToken(secret, 3));
		expect(material).not.toBeNull();
		expect(material!.lockSecrets.length).toBe(3);
		expect(material!.proofYs.length).toBe(3);
		expect(new Set(material!.lockSecrets).size).toBe(1);
	});

	test("a token whose secret is not a NUT-10 P2PK condition is refused BY NAME, never read as a lock", () => {
		expect(() => lockedMaterialFromToken(encodedToken("not-a-lock-at-all"))).toThrow(/refused-bid-lock: secret_not_p2pk/);
	});

	test("a secret that is a P2PK condition but NOT a conforming §5.3 lock is refused BY NAME", () => {
		// A plain 1-of-1 P2PK with a locktime and no refund branch (what the defect built): no refund key to take
		// the funds back, so it is not the auction's lock.
		const noRefund = JSON.stringify(["P2PK", { nonce: "n", data: CHILD, tags: [["locktime", String(LOCKTIME)]] }]);
		expect(() => lockedMaterialFromToken(encodedToken(noRefund))).toThrow(/refused-bid-lock: lock_refund_count_invalid/);
		// A P2PK with a refund key but no locktime: the bidder has no unconditional backstop.
		const noLocktime = JSON.stringify(["P2PK", { nonce: "n", data: CHILD, tags: [["refund", REFUND]] }]);
		expect(() => lockedMaterialFromToken(encodedToken(noLocktime))).toThrow(/refused-bid-lock: lock_missing_locktime/);
	});

	test("a malformed token string reads null (the decode refuses, it does not throw)", () => {
		expect(lockedMaterialFromToken("cashuA-not-a-real-token")).toBeNull();
		expect(lockedMaterialFromToken("")).toBeNull();
	});
});
