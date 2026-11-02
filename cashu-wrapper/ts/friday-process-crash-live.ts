#!/usr/bin/env bun
/** Client half of the separate-process SIGKILL/restart recovery harness. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const argument = (prefix: string): string | undefined => process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
const BASE = (argument("--base=") ?? "http://127.0.0.1:18082").replace(/\/$/, "");
const MARKERS = argument("--markers=");
const EVIDENCE = argument("--evidence=");
if (MARKERS === undefined || EVIDENCE === undefined) throw new Error("--markers and --evidence are required");
const EVIDENCE_PATH: string = EVIDENCE;
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
type Event = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };
function secret(): Uint8Array { for (;;) { const key = randomBytes(32); try { secp256k1.getPublicKey(key, true); return key; } catch {} } }
function actor(key: Uint8Array): string { return bytesToHex(schnorr.getPublicKey(key)); }
function signed(key: Uint8Array, kind: number, content: unknown, nonce: string = randomUUID()): Event {
	const pubkey = actor(key), created_at = Math.floor(Date.now()/1_000), tags = [["nonce", nonce]], encoded = JSON.stringify(content);
	const id = sha256(JSON.stringify([0, pubkey, created_at, kind, tags, encoded]));
	return { id, pubkey, created_at, kind, tags, content: encoded, sig: bytesToHex(schnorr.sign(hexToBytes(id), key)) };
}
async function request(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
	const response = await fetch(BASE+path, init); return { status: response.status, body: await response.json() };
}
async function post(path: string, value: unknown) { return request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); }
function pass(label: string, condition: boolean, detail = ""): void {
	if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`); console.log(`PASS  ${label}`);
}
async function marker(name: string, value = ""): Promise<void> {
	const file = await open(`${MARKERS}/${name}`, "wx", 0o600); try { await file.writeFile(value); } finally { await file.close(); }
}
async function waitFor<T>(label: string, timeoutMs: number, read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
	const deadline = Date.now()+timeoutMs;
	for (;;) { const value = await read(); if (done(value)) return value; if (Date.now() >= deadline) throw new Error(`${label} timed out`); await Bun.sleep(250); }
}
async function waitMarker(name: string, timeoutMs = 60_000): Promise<void> {
	await waitFor(`marker ${name}`, timeoutMs, async () => Bun.file(`${MARKERS}/${name}`).exists(), Boolean);
}

async function main(): Promise<void> {
	const run = randomUUID(), started = new Date().toISOString();
	const sellerKey = secret(), bidderKey = secret(), seller = actor(sellerKey), bidder = actor(bidderKey);
	const faucetEvent = signed(bidderKey, 28643, { action: "faucet" }, "stable-faucet-event");
	let interrupted = false;
	try {
		// The browser-facing Go proxy turns a killed upstream connection into a
		// bounded 5xx JSON response; a direct coordinator client instead observes
		// a rejected fetch. Both are the same real process boundary.
		const result = await post("/api/cashu/faucet", faucetEvent);
		interrupted = result.status >= 500;
	} catch { interrupted = true; }
	pass("faucet client observed the coordinator process boundary", interrupted);
	await marker("faucet-request-returned"); await waitMarker("coordinator-restarted-faucet");
	const recoveredGrant = await post("/api/cashu/faucet", faucetEvent);
	pass("same faucet event recovers exactly one 10k grant", recoveredGrant.status === 200 && recoveredGrant.body.grant_total === 10_000,
		`HTTP ${recoveredGrant.status} ${JSON.stringify(recoveredGrant.body)}`);

	const auctionId = `process-crash-${Date.now()}`;
	const created = await post("/api/event", signed(sellerKey, 28640, { auction_id: auctionId, title: "Process crash payout",
		description: "SIGKILL boundaries over durable coordinator and Coco state", image_url: "", duration_seconds: 190,
		starting_bid: 1_000, min_increment: 100, reserve: 0 }));
	pass("crash auction created", created.status === 200);
	const reservation = await post("/api/cashu/reserve", signed(bidderKey, 28644, { auction_id: auctionId, amount: 2_500 }));
	pass("2.5k actual backing reserved", reservation.status === 200 && reservation.body.receipt?.amount === 2_500);
	const bid = await post("/api/event", signed(bidderKey, 28641, { auction_id: auctionId, amount: 2_500, reservation: reservation.body.receipt }));
	pass("reservation-backed bid committed", bid.status === 200);
	await marker("payment-scenario-ready", JSON.stringify({ schema: "PlebeianFridayCrashScenarioV1", auction_id: auctionId, seller, bidder,
		send_id: `send-payout-${auctionId}`, receive_id: `receive-payout-${auctionId}` })+"\n");
	await waitMarker("crash-sequence-complete", 360_000);

	const sellerWallet = await waitFor("seller exactly-once payout", 60_000, async () => (await request(`/api/cashu/wallet?actor=${seller}`)).body,
		(wallet) => wallet.spendable === 2_500 && wallet.backing === 2_500 && wallet.zero_pending === true);
	const bidderWallet = await waitFor("bidder exact debit", 30_000, async () => (await request(`/api/cashu/wallet?actor=${bidder}`)).body,
		(wallet) => wallet.spendable === 7_500 && wallet.backing === 7_500 && wallet.zero_pending === true);
	const conservation = (await request("/api/cashu/conservation")).body;
	const safeConservation = JSON.stringify({ conserved: conservation.conserved, observationsExact: conservation.observationsExact,
		issued: conservation.issued, accountedTotal: conservation.accountedTotal, walletBacking: conservation.walletBacking,
		walletSpendable: conservation.walletSpendable, operationLocked: conservation.operationLocked, spendable: conservation.spendable,
		reserved: conservation.reserved, inFlight: conservation.inFlight, unknown: conservation.unknown,
		incomingPending: conservation.incomingPending, fundingPending: conservation.fundingPending,
		input_fee_ppk: conservation.fees?.input_fee_ppk, error: conservation.error });
	pass("post-crash global conservation is exact", conservation.conserved === true && conservation.observationsExact === true
		&& conservation.issued === 10_000 && conservation.accountedTotal === 10_000, safeConservation);
	pass("post-crash mint metadata still proves zero active input fee", conservation.fees?.input_fee_ppk === 0, safeConservation);
	const payments = sellerWallet.payments.filter((payment: any) => payment.id === `payout-${auctionId}` && payment.status === "paid");
	pass("one durable payment reaches the seller", payments.length === 1);
	const evidence = { schema: "PlebeianFridayProcessCrashAcceptanceV1", run, started_at: started, completed_at: new Date().toISOString(),
		auction_id: auctionId, actors: { seller, bidder }, faucet: { event_id: faucetEvent.id, grant_total: recoveredGrant.body.grant_total },
		operation_ids: { send: `send-payout-${auctionId}`, receive: `receive-payout-${auctionId}` },
		balances: { seller: sellerWallet.backing, bidder: bidderWallet.backing }, paid_rows: payments.length,
		conservation, process_boundaries: ["faucet_after_mint_before_persist", "payment_after_intent", "payment_after_send_prepare",
			"mint_swap_completed_before_local_response", "payment_after_send_result", "payment_after_receive_result"],
		passed: true };
	const file = await open(EVIDENCE_PATH, "wx", 0o600); try { await file.writeFile(JSON.stringify(evidence, null, 2)+"\n"); } finally { await file.close(); }
	console.log(`friday-process-crash-live: complete; evidence ${EVIDENCE_PATH}`);
}

main().catch((error) => { console.error(`friday-process-crash-live: FAILED — ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
