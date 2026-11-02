#!/usr/bin/env bun
/** Browser-equivalent acceptance flow through the site's public HTTP APIs. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const argument = (prefix: string): string | undefined => process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
const BASE = (argument("--base=") ?? process.env.POC_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const EVIDENCE = argument("--evidence=") ?? process.env.EVIDENCE_PATH ?? "../../evidence/site-cashu-comet-20261020.json";
const EXTERNAL_OFFLINE = process.argv.includes("--external-offline") || process.env.POC_EXTERNAL_OFFLINE === "true";
const now = (): number => Math.floor(Date.now() / 1000);
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

type NostrEvent = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };
function key(): Uint8Array {
	for (;;) { const candidate = randomBytes(32); try { secp256k1.getPublicKey(candidate, true); return candidate; } catch {} }
}
function pubkey(secret: Uint8Array): string { return bytesToHex(schnorr.getPublicKey(secret)); }
function event(secret: Uint8Array, kind: number, content: unknown, tags: string[][] = []): NostrEvent {
	const actor = pubkey(secret); const createdAt = now(); const encoded = JSON.stringify(content);
	const id = sha256(JSON.stringify([0, actor, createdAt, kind, tags, encoded]));
	return { id, pubkey: actor, created_at: createdAt, kind, tags, content: encoded, sig: bytesToHex(schnorr.sign(hexToBytes(id), secret)) };
}
async function request(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
	const response = await fetch(BASE + path, init); return { status: response.status, body: await response.json() };
}
async function post(path: string, value: unknown): Promise<{ status: number; body: any }> {
	return request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
}
function pass(label: string, condition: boolean, detail = ""): void {
	if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
	console.log(`PASS  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main(): Promise<void> {
	const startedAt = new Date().toISOString(); const run = randomUUID();
	const sellerKey = key(), loserKey = key(), winnerKey = key();
	const seller = pubkey(sellerKey), loser = pubkey(loserKey), winner = pubkey(winnerKey);
	const faucetA = await post("/api/cashu/faucet", event(loserKey, 28643, { action: "faucet" }));
	const faucetB = await post("/api/cashu/faucet", event(winnerKey, 28643, { action: "faucet" }));
	pass("site faucet finalizes 10,000 real test proofs for both bidders", faucetA.status === 200 && faucetB.status === 200
		&& faucetA.body.spendable === 10_000 && faucetB.body.spendable === 10_000);

	const auctionId = `site-${Date.now()}`; const duration = 12;
	const create = event(sellerKey, 28640, { auction_id: auctionId, title: "Site-wired Cashu/Comet POC", duration_seconds: duration, starting_bid: 100, reserve: 150 },
		[["t", "plebeian-auctions-poc"], ["auction", auctionId]]);
	const created = await post("/api/event", create);
	pass("site auction creation commits", created.status === 200 && created.body.height > 0);

	const lockA = await post("/api/cashu/lock", event(loserKey, 28644, { auction_id: auctionId, amount: 120 }, [["auction", auctionId]]));
	pass("site creates a Coco NUT-11 loser lock", lockA.status === 200 && lockA.body.receipt?.amount === 120, JSON.stringify(lockA.body).slice(0, 240));
	const bidA = await post("/api/event", event(loserKey, 28641, { auction_id: auctionId, amount: 120, cashu_lock: lockA.body.receipt }, [["auction", auctionId]]));
	pass("validators commit the coordinator-attested first lock", bidA.status === 200);

	const untrusted = { ...lockA.body.receipt, amount: 170, token_sha256: "00".repeat(32), signature: "00".repeat(64) };
	const assertion = await post("/api/event", event(winnerKey, 28641, { auction_id: auctionId, amount: 170, cashu_lock: untrusted }, [["auction", auctionId]]));
	pass("validators reject a client-asserted lock without committee attestation", assertion.status === 422, String(assertion.body.error).slice(0, 120));

	const lockB = await post("/api/cashu/lock", event(winnerKey, 28644, { auction_id: auctionId, amount: 180 }, [["auction", auctionId]]));
	pass("site creates a Coco NUT-11 winner lock", lockB.status === 200 && lockB.body.receipt?.amount === 180, JSON.stringify(lockB.body).slice(0, 240));
	const bidB = await post("/api/event", event(winnerKey, 28641, { auction_id: auctionId, amount: 180, cashu_lock: lockB.body.receipt }, [["auction", auctionId]]));
	pass("validators commit the winning mint-backed lock", bidB.status === 200);

	const before = (await request("/api/validators")).body.validators as any[];
	pass("four distinct nodes and validators are online", before.length === 4 && before.every((node) => node.online)
		&& new Set(before.map((node) => node.node_id)).size === 4 && new Set(before.map((node) => node.validator_address)).size === 4);
	const state = (await request(`/api/state?actor=${seller}`)).body;
	const endTime = state.state.auctions[auctionId].end_time as number;
	while (now() <= endTime) await Bun.sleep(250);
	if (EXTERNAL_OFFLINE) {
		console.log("READY_FOR_EXTERNAL_OFFLINE validator=4");
		const deadline = Date.now() + 45_000;
		for (;;) {
			const observed = (await request("/api/validators")).body.validators as any[];
			if (observed[3]?.online === false) break;
			if (Date.now() >= deadline) throw new Error("validator four did not become offline within 45 seconds");
			await Bun.sleep(500);
		}
		pass("validator four is stopped through the pinned operator channel", true);
	} else {
		const offline = await post("/api/admin/offline", { slot: 4 });
		pass("validator four is stopped through the local fault control", offline.status === 200);
	}
	const close = await post("/api/close", { auction_id: auctionId });
	pass("three validators commit auction close", close.status === 200);
	const closed = (await request(`/api/state?actor=${seller}`)).body;
	const auction = closed.state.auctions[auctionId]; const winningBid = closed.state.bids[auction.leader_bid_id];
	pass("consensus chooses the exact 180-sat Cashu token digest", auction.winner === winner
		&& winningBid.cashu_token_sha256 === lockB.body.receipt.token_sha256);

	const settlement = await post("/api/cashu/settle", event(sellerKey, 28645, { auction_id: auctionId }, [["auction", auctionId]]));
	pass("site spends the consensus winner and pays seller Coco wallet", settlement.status === 200
		&& settlement.body.state === "finalized" && settlement.body.amount === 180
		&& settlement.body.spendable > 0 && settlement.body.spendable <= 180,
		`HTTP ${settlement.status} ${JSON.stringify(settlement.body).slice(0, 240)}`);
	const locktime = lockA.body.receipt.locktime as number;
	const early = await post("/api/cashu/refund", event(loserKey, 28646, { token_sha256: lockA.body.receipt.token_sha256 }));
	pass("early loser refund is refused", early.status === 409);
	while (now() <= locktime) await Bun.sleep(250);
	const refund = await post("/api/cashu/refund", event(loserKey, 28646, { token_sha256: lockA.body.receipt.token_sha256 }));
	pass("site loser refund spends the timelocked branch and recovers the locked test value", refund.status === 200
		&& refund.body.state === "finalized" && refund.body.spendable >= 9_998 && refund.body.spendable <= 10_000,
		`HTTP ${refund.status} ${JSON.stringify(refund.body).slice(0, 240)}`);
	const winnerWallet = (await request(`/api/cashu/wallet?actor=${winner}`)).body;
	pass("winner paid the 180-sat lock plus no more than two sats of observed mint fees", winnerWallet.spendable >= 9_818 && winnerWallet.spendable <= 9_820,
		`spendable=${winnerWallet.spendable}`);
	await Bun.sleep(2_000);
	const after = (await request("/api/validators")).body.validators as any[];
	pass("network continues committing with one validator offline", after.filter((node) => node.online).length === 3
		&& after[3]?.online === false && after.slice(0, 3).every((node) => node.commit_signatures >= 3));

	const evidence = {
		schema: "PlebeianAuctionsPOCSiteEvidenceV1", run, started_at: startedAt, completed_at: new Date().toISOString(),
		auction_id: auctionId, mint: { implementation: "Nutshell 0.19.2", backend: "FakeWallet", coco_v2: true, nut_11: true },
		actors: { seller, loser, winner }, balances: { seller: settlement.body.spendable, loser: refund.body.spendable, winner: winnerWallet.spendable },
		cashu: { losing_token_sha256: lockA.body.receipt.token_sha256, winning_token_sha256: lockB.body.receipt.token_sha256,
			locktime, early_refund_http_status: early.status, settlement_state: settlement.body.state,
			observed_fees: { seller_receive: 180 - settlement.body.spendable, loser_round_trip: 10_000 - refund.body.spendable,
				winner_lock: 10_000 - winnerWallet.spendable - 180 } },
		consensus: { create_height: created.body.height, bid_a_height: bidA.body.height, bid_b_height: bidB.body.height,
			close_height: close.body.height, invalid_assertion_http_status: assertion.status, winner: auction.winner,
			winning_token_sha256: winningBid.cashu_token_sha256, validators_before_offline: before, validators_after_offline: after },
		trust_boundary: "validators verify one coordinator signature over public lock facts; they do not independently verify Cashu bearer proofs",
		fault_control: EXTERNAL_OFFLINE ? "pinned operator SSH channel" : "local supervisor API",
		shortcuts: ["single in-memory application-level coordinator and committee key; NOT FROST or threshold custody"], passed: true,
	};
	const file = await open(EVIDENCE, "wx", 0o600); try { await file.writeFile(JSON.stringify(evidence, null, 2) + "\n"); } finally { await file.close(); }
	console.log(`poc-site-live.ts: complete; evidence ${EVIDENCE}`);
}

main().catch((error) => { console.error(`poc-site-live.ts: FAILED — ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
