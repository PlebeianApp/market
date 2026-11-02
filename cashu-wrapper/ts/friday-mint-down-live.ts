#!/usr/bin/env bun
/** Local-only close/outbox recovery with the throwaway mint stopped and validator four offline. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const argument = (prefix: string): string | undefined => process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
const BASE = (argument("--base=") ?? "http://127.0.0.1:18081").replace(/\/$/, "");
const MARKERS = argument("--markers=");
const EVIDENCE = argument("--evidence=");
const FAULT = argument("--fault=") ?? "stopped";
if (MARKERS === undefined || EVIDENCE === undefined) throw new Error("--markers and --evidence are required");
if (!new Set(["stopped", "stalled"]).has(FAULT)) throw new Error("--fault must be stopped or stalled");
const EVIDENCE_PATH: string = EVIDENCE;
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
type SignedEvent = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };
function secret(): Uint8Array { for (;;) { const key = randomBytes(32); try { secp256k1.getPublicKey(key, true); return key; } catch {} } }
function actor(key: Uint8Array): string { return bytesToHex(schnorr.getPublicKey(key)); }
function signed(key: Uint8Array, kind: number, content: unknown, tags: string[][] = []): SignedEvent {
	const pubkey = actor(key), created_at = Math.floor(Date.now()/1_000), encoded = JSON.stringify(content);
	const id = sha256(JSON.stringify([0, pubkey, created_at, kind, tags, encoded]));
	return { id, pubkey, created_at, kind, tags, content: encoded, sig: bytesToHex(schnorr.sign(hexToBytes(id), key)) };
}
async function request(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
	const response = await fetch(BASE+path, init); return { status: response.status, body: await response.json() };
}
async function post(path: string, value: unknown) { return request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); }
function pass(label: string, condition: boolean, detail = ""): void {
	if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`); console.log(`PASS  ${label}${detail ? ` — ${detail}` : ""}`);
}
async function waitFor<T>(label: string, timeoutMs: number, read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
	const deadline = Date.now()+timeoutMs;
	for (;;) { const value = await read(); if (done(value)) return value; if (Date.now() >= deadline) throw new Error(`${label} timed out`); await Bun.sleep(500); }
}
async function marker(name: string): Promise<void> { const file = await open(`${MARKERS}/${name}`, "wx", 0o600); await file.close(); }
async function waitMarker(name: string, timeoutMs = 30_000): Promise<void> {
	await waitFor(`marker ${name}`, timeoutMs, async () => Bun.file(`${MARKERS}/${name}`).exists(), Boolean);
}

async function main(): Promise<void> {
	const run = randomUUID(), started = new Date().toISOString();
	const sellerKey = secret(), bidderKey = secret(), seller = actor(sellerKey), bidder = actor(bidderKey);
	const grant = await post("/api/cashu/faucet", signed(bidderKey, 28643, { action: "faucet" }));
	pass("bidder receives 10,000 actual fake-mint proofs", grant.status === 200 && grant.body.grant_total === 10_000);
	const auctionId = `mint-down-${Date.now()}`;
	const created = await post("/api/event", signed(sellerKey, 28640, { auction_id: auctionId, title: "Mint-down close lot",
		description: "Outbox must recover after mint outage", image_url: "", duration_seconds: 190,
		starting_bid: 1_000, min_increment: 100, reserve: 0 }, [["auction", auctionId]]));
	pass("seller creates isolated auction", created.status === 200);
	const reservation = await post("/api/cashu/reserve", signed(bidderKey, 28644, { auction_id: auctionId, amount: 2_500 }, [["auction", auctionId]]));
	pass("2,500 bid is reserved against actual backing", reservation.status === 200 && reservation.body.receipt?.amount === 2_500);
	const bid = await post("/api/event", signed(bidderKey, 28641, { auction_id: auctionId, amount: 2_500, reservation: reservation.body.receipt }, [["auction", auctionId]]));
	pass("reservation-backed bid commits", bid.status === 200, `HTTP ${bid.status} ${JSON.stringify(bid.body).slice(0, 240)}`);
	const before = (await request("/api/validators")).body.validators as any[];
	pass("four distinct validators sign before the fault", before.length === 4 && before.every((node) => node.online && node.commit_signatures === 4));
	const offline = await post("/api/admin/offline", { slot: 4 });
	pass("local-only supervisor stops designated validator four", offline.status === 200);
	const three = await waitFor("three-validator commit", 45_000, async () => (await request("/api/validators")).body.validators as any[],
		(nodes) => nodes.filter((node) => node.online).length === 3 && nodes.filter((node) => node.online).every((node) => node.commit_signatures === 3));
	const heightBeforeDown = Math.max(...three.filter((node) => node.online).map((node) => Number(node.height)));
	await marker("ready-to-stop-mint"); await waitMarker("mint-stopped");

	const closed = await waitFor("consensus close while mint is down", 230_000, async () => (await request(`/api/state?actor=${seller}`)).body,
		(view) => view.state.auctions[auctionId]?.status === "closed");
	pass("three validators close auction while mint is down", closed.state.auctions[auctionId].winner === bidder && closed.state.auctions[auctionId].high_bid === 2_500);
	let longestStatusMs = 0;
	const unavailable = await waitFor("failed-closed payout", 20_000, async () => {
		const startedStatus = Date.now(); const result = (await request(`/api/cashu/wallet?actor=${seller}`)).body;
		longestStatusMs = Math.max(longestStatusMs, Date.now()-startedStatus); return result;
	}, (wallet) => wallet.spendable === 0 && wallet.zero_pending === false
		&& wallet.payments?.some((payment: any) => payment.amount === 2_500 && payment.status === "unknown"));
	pass("mint outage is shown pending/unknown, never paid or spendable", unavailable.spendable === 0 && unavailable.backing === 0);
	if (FAULT === "stalled") pass("status remains bounded while the mint accepts and withholds a response", longestStatusMs < 7_500, `${longestStatusMs}ms`);
	const outageConservation = (await request("/api/cashu/conservation")).body;
	pass("unknown mint outcome occupies one exclusive conserved bucket", outageConservation.conserved === true
		&& outageConservation.observationsExact === true && outageConservation.issued === 10_000
		&& outageConservation.accountedTotal === 10_000 && outageConservation.unknown === 2_500
		&& outageConservation.inFlight === 0 && outageConservation.incomingPending === 0
		&& outageConservation.fees?.input_fee_ppk === 0,
		JSON.stringify({ issued: outageConservation.issued, accountedTotal: outageConservation.accountedTotal,
			inFlight: outageConservation.inFlight, unknown: outageConservation.unknown,
			incomingPending: outageConservation.incomingPending, observationsExact: outageConservation.observationsExact,
			conserved: outageConservation.conserved, inputFeePpk: outageConservation.fees?.input_fee_ppk }));
	await marker("closed-with-mint-down"); await waitMarker("mint-restarted");

	await waitFor("exactly-once payout recovery", 45_000, async () => (await request(`/api/cashu/wallet?actor=${seller}`)).body,
		(wallet) => wallet.spendable === 2_500 && wallet.zero_pending === true && wallet.payments?.some((payment: any) => payment.amount === 2_500 && payment.status === "paid"));
	const bidderWallet = await waitFor("winner wallet settled", 20_000, async () => (await request(`/api/cashu/wallet?actor=${bidder}`)).body,
		(wallet) => wallet.spendable === 7_500 && wallet.zero_pending === true);
	await Bun.sleep(6_000);
	const sellerStable = (await request(`/api/cashu/wallet?actor=${seller}`)).body;
	const conservation = (await request("/api/cashu/conservation")).body;
	const validatorsAfter = (await request("/api/validators")).body.validators as any[];
	const paidRows = sellerStable.payments.filter((payment: any) => payment.direction === "incoming" && payment.amount === 2_500 && payment.status === "paid");
	pass("recovery delivers one and only one actual 2,500 token payment", paidRows.length === 1 && sellerStable.spendable === 2_500 && sellerStable.backing === 2_500);
	const paid = paidRows[0];
	pass("terminal payment exposes one stable send/receive operation identity", typeof paid?.send_operation_id === "string"
		&& typeof paid?.receive_operation_id === "string" && paid.send_operation_id.length > 8 && paid.receive_operation_id.length > 8);
	pass("actual recipient ownership and conservation are exact", bidderWallet.backing === 7_500 && sellerStable.backing+bidderWallet.backing === 10_000 && sellerStable.conserved && bidderWallet.conserved);
	pass("global conservation and active zero-fee keyset are exact", conservation.conserved === true && conservation.issued === 10_000
		&& conservation.accountedTotal === 10_000 && conservation.fees?.input_fee_ppk === 0);
	pass("network keeps committing with validator four offline", validatorsAfter.filter((node) => node.online).length === 3
		&& validatorsAfter.filter((node) => node.online).every((node) => node.commit_signatures === 3)
		&& Math.max(...validatorsAfter.filter((node) => node.online).map((node) => Number(node.height))) > heightBeforeDown);

	const evidence = { schema: "PlebeianFridayMintDownCloseV2", run, started_at: started, completed_at: new Date().toISOString(), fault_mode: FAULT,
		actors: { seller, bidder }, operation_ids: { send: paid.send_operation_id, receive: paid.receive_operation_id },
		auction: { id: auctionId, winner: bidder, amount: 2_500, closed_while_mint_down: true },
		outage_observation: { seller_spendable: unavailable.spendable, seller_backing: unavailable.backing, payment_statuses: unavailable.payments.map((payment: any) => payment.status), longest_status_ms: longestStatusMs,
			conservation: outageConservation },
		recovery: { seller_spendable: sellerStable.spendable, bidder_spendable: bidderWallet.spendable, paid_rows: paidRows.length, zero_pending: sellerStable.zero_pending && bidderWallet.zero_pending }, conservation,
		validators_before: before, validators_after: validatorsAfter, mint: { implementation: "Nutshell 0.19.2", backend: "FakeWallet", restarted_same_database_and_seed: FAULT === "stopped", stalled_response_released: FAULT === "stalled" },
		trust_boundary: "custodial server-held proofs; coordinator-trusted reservation attestations; shared committee key is not FROST; not FIPS", passed: true };
	const file = await open(EVIDENCE_PATH, "wx", 0o600); try { await file.writeFile(JSON.stringify(evidence, null, 2)+"\n"); } finally { await file.close(); }
	console.log(`friday-mint-down-live.ts: complete; evidence ${EVIDENCE_PATH}`);
}

main().catch((error) => { console.error(`friday-mint-down-live.ts: FAILED — ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
