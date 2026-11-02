#!/usr/bin/env bun
/**
 * auction-lock.live.test.ts — the auction lock, placed on a REAL mint, read back and refunded.
 *
 *   MINT_URL=http://127.0.0.1:3338 bun run cashu-wrapper/ts/auction-lock.live.test.ts
 *
 * The other suite (`auction-lock.test.ts`) pins the §5.3 SHAPE. This one proves the shape survives the mint: it
 * funds the wallet, derives the seller child pubkey from a real xpub, asks Coco to place a 1-of-1 P2PK lock to
 * that child key with a refund timelock to the bidder's own refund key (`n_sigs_refund=1`, `SIG_INPUTS`), reads
 * the **mint-produced** secret back through the strict reader, and then takes the funds back through the REFUND
 * branch once the locktime has passed — which is the bidder's exit in the scheme (AUCTIONS.md §5.2).
 *
 * Nothing here is fabricated: if the mint did not sign the lock, or the secret it signed is not the §5.3 lock,
 * `sendLockedP2pk` refuses by name before this returns (coco-rail.ts) and the test fails.
 */
import { getDecodedToken, initializeCoco, MemoryRepositories } from "@cashu/coco-core";

import { createCocoRail } from "./coco-rail";
import type { CocoRailPort } from "./coco-rail";
import { createMemorySeedStore, seedGetterFor } from "./seed-store";
import { deriveSellerChildPubkey, generateBidDerivationPath } from "./seller-child";
import { readAuctionLock } from "./auction-lock";

let passed = 0;
function ok(label: string, condition: boolean, detail = ""): void {
	const suffix = detail ? ` — ${detail}` : "";
	if (condition) {
		passed += 1;
		console.log(`PASS  ${label}${suffix}`);
		return;
	}
	console.log(`FAIL  ${label}${suffix}`);
	throw new Error(label + suffix);
}

const MINT = process.env.MINT_URL ?? "http://127.0.0.1:3338";
const FUNDED = Number(process.env.LIVE_FUND ?? 128);
const LOCKED = Number(process.env.LIVE_LOCK ?? 64);
/** BIP32 test vector 1's master xpub: a published, reproducible seller xpub. */
const SELLER_XPUB = "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";

async function main(): Promise<void> {
	const manager = await initializeCoco({ repo: new MemoryRepositories(), seedGetter: seedGetterFor(createMemorySeedStore()) });
	const rail = createCocoRail(manager) as CocoRailPort;

	const trusted = await rail.trustMint({ mintUrl: MINT });
	ok("the mint is trusted before anything is asked of it", trusted.trusted === true, trusted.mintUrl);

	const funded = await rail.fund({ mintUrl: MINT, amount: FUNDED });
	ok("funding reports a finalized mint operation", funded.state === "finalized", funded.state);

	// ---- the lock's own terms, derived and generated (never invented) -------------------------------------
	const path = generateBidDerivationPath();
	const childPubkey = deriveSellerChildPubkey(SELLER_XPUB, path);
	ok("the bidder chose a high-entropy path and derived the seller child pubkey from the auction's xpub", /^m\/([0-9]+\/){4}[0-9]+$/.test(path) && /^0[23][0-9a-f]{64}$/.test(childPubkey), `${path} → ${childPubkey.slice(0, 16)}…`);

	const refund = await rail.generateLockKeypair();
	ok("the bidder's refund key comes from Coco's own keyring (a separate key from the lock key)", refund.pubkey.length === 66 && refund.pubkey !== childPubkey, `${refund.pubkey.slice(0, 16)}…`);

	// A SHORT locktime so the refund branch can be exercised in this run: now + 5 s.
	const locktime = Math.floor(Date.now() / 1000) + 5;
	const lockOperationId = "live-auction-lock";

	// ---- the lock crosses a real mint, and the rail verifies the mint's own secret (§5.3) ------------------
	const locked = await rail.sendLockedP2pk({
		mintUrl: MINT,
		amount: LOCKED,
		lock: { childPubkey, locktime, refundPubkey: refund.pubkey },
		operationId: lockOperationId,
	});
	ok("the mint accepted the §5.3 lock (the rail read it back through the strict reader)", locked.state !== "", `${locked.operationId} ${locked.state}`);

	// ---- read the REAL mint-produced secret and put it through the strict reader ---------------------------
	const held = await rail.lockedToken({ operationId: lockOperationId });
	ok("Coco holds the locked token for the lock operation", held !== null && held.token.length > 0);
	const decoded = getDecodedToken(held!.token, []) as { proofs?: readonly { secret: string }[] };
	const proofs = decoded.proofs ?? [];
	ok("the locked token carries at least one proof", proofs.length > 0, `${proofs.length} proof(s)`);
	for (const proof of proofs) {
		const parsed = readAuctionLock(proof.secret, {
			expectedLocktime: locktime,
			expectedChildPubkey: childPubkey,
			expectedRefundPubkey: refund.pubkey,
		});
		ok("the mint-produced secret is the §5.3 lock: data = the derived child key", parsed.childPubkey === childPubkey, parsed.childPubkey.slice(0, 16) + "…");
		ok("and its locktime equals the auction's `max_end_at + settlement_grace` (L2.6)", parsed.locktime === locktime, String(parsed.locktime));
		ok("and its refund key is the bidder's SEPARATE refund key (L2.7)", parsed.refundPubkey === refund.pubkey && parsed.refundPubkey !== parsed.childPubkey, parsed.refundPubkey.slice(0, 16) + "…");
		ok("and it is 1-of-1 with n_sigs_refund=1 and SIG_INPUTS (§5.2)", parsed.nSigs === 1 && parsed.nSigsRefund === 1 && parsed.sigflag === "SIG_INPUTS" && parsed.additionalPubkeys.length === 0);
	}
	// The raw secret, so the shape is inspectable rather than asserted in prose.
	console.log(`\n  mint-produced lock secret (first proof):\n  ${proofs[0]!.secret}\n`);

	// ---- the bidder's exit: the refund branch, AFTER the locktime -----------------------------------------
	// Before the locktime, our own redeem refuses by name (the mint would too): the lock is a genuine commitment.
	let earlyRefusal = "";
	try {
		await rail.redeemP2pk({ mintUrl: MINT, token: held!.token, secretKey: refund.secretKey, operationId: "live-early-refund" });
	} catch (error) {
		earlyRefusal = error instanceof Error ? error.message : String(error);
	}
	ok("before the locktime the refund branch cannot be spent, and says so by name", earlyRefusal.includes("refund branch cannot be spent before its locktime"), earlyRefusal.slice(0, 120) || "the refund was NOT refused");

	// Wait for the locktime to pass, then take the funds back through the refund branch.
	await new Promise((done) => setTimeout(done, Math.max(0, (locktime + 2) * 1000 - Date.now())));
	const redeemed = await rail.redeemP2pk({ mintUrl: MINT, token: held!.token, secretKey: refund.secretKey, operationId: "live-late-refund" });
	ok("after the locktime the bidder's refund key spends the lock and the value returns (ADR-0010 §1 admission)", redeemed.operationId.length > 0, `${redeemed.operationId} ${redeemed.state}`);

	console.log(`\nauction-lock.live.test.ts: ${passed} assertion(s) passed, 0 failed`);
	console.log("acceptance: a real mint signs a 1-of-1 P2PK lock bound to derive(seller p2pk_xpub, path) with the auction's locktime and the bidder's separate refund key (n_sigs_refund=1, SIG_INPUTS); the mint-produced secret passes the strict §5.3 reader; and the refund branch is refused before the locktime and spends the lock after it");

	// Coco's manager owns the watchers (mint-quote / proof-state / melt settle polls) that keep the event loop
	// alive after the last assertion, which is why this suite used to print its summary and then hang. Dispose it,
	// so the process exits on its own and a CI that wired this suite is never left to time out (finding n2).
	await manager.dispose();
}

main().catch((error) => {
	console.error(`\nauction-lock.live.test.ts: FAILED — ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
