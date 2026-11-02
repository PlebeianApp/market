#!/usr/bin/env bun
/**
 * coco-rail.live.test.ts — the refund, against a real mint: lock, read back, redeem, and see the sats return.
 *
 *   MINT_URL=http://127.0.0.1:3338 bun run coco-rail.live.test.ts
 *
 * The other refund suite (`bid-refund-adapter.e2e.ts`) proves the *ordering and refusals*; this one proves the money
 * actually comes back. It runs the whole bidder exit through the wallet domain only:
 *
 *   trust the mint -> fund -> P2PK lock -> read the lock back from Coco's own operation -> redeem it with the refund
 *   key -> the wallet's spendable balance returns, and the lock is gone from Coco's in-flight set.
 *
 * The one detail this run exists to pin is the witness: the mint refused the first attempt with
 * `{"detail":"Witness is missing for p2pk signature"}`, which is what NUT-11 puts on **each input proof** under
 * SIG_INPUTS rather than only at the top level of the swap.
 */
import { initializeCoco, MemoryRepositories } from "@cashu/coco-core";

import { createCocoRail } from "./coco-rail";
import { createMemorySeedStore, seedGetterFor } from "./seed-store";
import type { CocoRailPort } from "./coco-rail";

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
const FUNDED = Number(process.env.LIVE_FUND ?? 331);
const LOCKED = Number(process.env.LIVE_LOCK ?? 127);

async function main(): Promise<void> {
	const manager = await initializeCoco({ repo: new MemoryRepositories(), seedGetter: seedGetterFor(createMemorySeedStore()) });
	const rail = createCocoRail(manager) as CocoRailPort;
	const balance = async (): Promise<number> => {
		const snapshot = (await manager.wallet.balances.total({ mintUrls: [MINT] })) as { spendable?: unknown };
		const value = snapshot.spendable as unknown;
		return Number(typeof value === "object" && value !== null ? String(value) : value) || 0;
	};

	const trusted = await rail.trustMint({ mintUrl: MINT });
	ok("the mint is trusted before anything is asked of it", trusted.trusted === true, trusted.mintUrl);

	const funded = await rail.fund({ mintUrl: MINT, amount: FUNDED });
	ok("funding reports a finalized mint operation", funded.state === "finalized", funded.state);
	const afterFund = await balance();
	ok("and the funded sats are spendable", afterFund === FUNDED, `${afterFund} sat`);

	const keypair = await rail.generateLockKeypair();
	ok("a lock authority comes from Coco's own keyring", keypair.pubkey.length === 66 && keypair.secretKey.length === 64, `${keypair.pubkey.slice(0, 16)}… idx ${keypair.derivationIndex}`);

	const lockOperationId = "live-refund-lock";
	const locked = await rail.sendP2pk({ mintUrl: MINT, amount: LOCKED, pubkey: keypair.pubkey, operationId: lockOperationId });
	ok("the lock is placed under the caller's own operation id", locked.operationId === lockOperationId, locked.operationId);
	const afterLock = await balance();
	ok("the locked amount leaves the spendable balance", afterLock < afterFund, `${afterFund} -> ${afterLock}`);

	const held = await rail.lockedToken({ operationId: lockOperationId });
	ok("the lock is read back from Coco's own operation", held !== null && held.token.length > 100, `${held?.token.length ?? 0} chars`);
	ok("and it is Coco's, on the mint the lock was placed on", held?.mintUrl === MINT, held?.mintUrl ?? "");

	const redeemed = await rail.redeemP2pk({ mintUrl: MINT, token: held!.token, secretKey: keypair.secretKey });
	ok("the redeem reaches a terminal state", redeemed.state === "finalized" || redeemed.state === "pending", redeemed.state);

	const afterRefund = await balance();
	ok("the refunded value is spendable again", afterRefund > afterLock, `${afterLock} -> ${afterRefund}`);
	ok("and almost all of the lock came back, losing only the mint's own fees", afterRefund >= afterFund - 3, `${afterFund} -> ${afterRefund}`);

	console.log(`\ncoco-rail.live.test.ts: ${passed} assertion(s) passed, 0 failed`);
	console.log(`acceptance: against ${MINT}, a P2PK lock placed through the wallet domain is read back from Coco's own operation and redeemed with the refund key, and the sats return to the spendable balance`);

	// Coco's manager owns the watchers/timers that keep the event loop alive after the last assertion — the reason
	// this suite printed its summary and then hung. Dispose it so the process exits by itself (finding n2).
	await manager.dispose();
}

main().catch((error) => {
	console.error(`\ncoco-rail.live.test.ts: FAILED — ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
