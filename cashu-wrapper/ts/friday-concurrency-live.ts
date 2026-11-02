#!/usr/bin/env bun
/** Full public-API/consensus concurrency acceptance for Friday reservations. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const argument = (prefix: string): string | undefined => process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
const BASE = (argument("--base=") ?? "http://127.0.0.1:18080").replace(/\/$/, "");
const EVIDENCE = argument("--evidence=");
if (EVIDENCE === undefined) throw new Error("--evidence is required");
const EVIDENCE_PATH: string = EVIDENCE;
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
type Event = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };
function secret(): Uint8Array { for (;;) { const key = randomBytes(32); try { secp256k1.getPublicKey(key, true); return key; } catch {} } }
function actor(key: Uint8Array): string { return bytesToHex(schnorr.getPublicKey(key)); }
function signed(key: Uint8Array, kind: number, content: unknown, nonce = randomUUID()): Event {
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
async function faucet(key: Uint8Array): Promise<void> {
	const result = await post("/api/cashu/faucet", signed(key, 28643, { action: "faucet" }));
	pass("real 10k faucet grant", result.status === 200 && result.body.grant_total === 10_000, JSON.stringify(result.body));
}
async function createAuction(seller: Uint8Array, id: string): Promise<void> {
	const result = await post("/api/event", signed(seller, 28640, { auction_id: id, title: id, description: "Friday concurrency acceptance",
		image_url: "", duration_seconds: 600, starting_bid: 1_000, min_increment: 100, reserve: 0 }));
	pass(`create ${id}`, result.status === 200, JSON.stringify(result.body));
}
async function reserve(key: Uint8Array, auctionId: string, amount: number): Promise<{ status: number; body: any; event: Event }> {
	const event = signed(key, 28644, { auction_id: auctionId, amount });
	return { ...(await post("/api/cashu/reserve", event)), event };
}
async function submitBid(key: Uint8Array, auctionId: string, amount: number, receipt: unknown): Promise<{ status: number; body: any }> {
	return post("/api/event", signed(key, 28641, { auction_id: auctionId, amount, reservation: receipt }));
}

async function main(): Promise<void> {
	const started = new Date().toISOString(), run = randomUUID();
	const sellerKey = secret(), crossKey = secret(), raiseKey = secret(), challengerKey = secret();
	const cross = actor(crossKey), raise = actor(raiseKey), challenger = actor(challengerKey);
	await Promise.all([crossKey, raiseKey, challengerKey].map(faucet));
	const prefix = `race-${Date.now()}`;
	const ids = { anchor: `${prefix}-anchor`, crossA: `${prefix}-a`, crossB: `${prefix}-b`, raise: `${prefix}-raise`, duel: `${prefix}-duel` };
	for (const id of Object.values(ids)) await createAuction(sellerKey, id);

	const anchor = await reserve(crossKey, ids.anchor, 7_000);
	pass("anchor reservation consumes 7k of actual backing", anchor.status === 200);
	const anchorCommit = await submitBid(crossKey, ids.anchor, 7_000, anchor.body.receipt);
	pass("anchor bid commits", anchorCommit.status === 200, `HTTP ${anchorCommit.status} ${JSON.stringify(anchorCommit.body)}`);
	const crossRace = await Promise.all([reserve(crossKey, ids.crossA, 2_000), reserve(crossKey, ids.crossB, 2_000)]);
	const crossWinners = crossRace.filter((result) => result.status === 200);
	pass("two public reservations against one remaining 3k admit exactly one", crossWinners.length === 1
		&& crossRace.filter((result) => result.status === 422).length === 1, JSON.stringify(crossRace.map((result) => result.status)));
	const crossWinner = crossWinners[0]!;
	const crossAuction = crossWinner.body.receipt.auction_id as string;
	pass("the admitted cross-auction receipt commits through consensus",
		(await submitBid(crossKey, crossAuction, 2_000, crossWinner.body.receipt)).status === 200);
	const crossWallet = (await request(`/api/cashu/wallet?actor=${cross}`)).body;
	pass("actual 10k wallet has one 7k and one 2k committed reservation", crossWallet.backing === 10_000 && crossWallet.reserved === 9_000 && crossWallet.spendable === 1_000);

	const firstRaise = await reserve(raiseKey, ids.raise, 1_000);
	pass("initial own-bid reservation commits", firstRaise.status === 200 && (await submitBid(raiseKey, ids.raise, 1_000, firstRaise.body.receipt)).status === 200);
	const ownRace = await Promise.all([reserve(raiseKey, ids.raise, 1_500), reserve(raiseKey, ids.raise, 2_000)]);
	const ownWinners = ownRace.filter((result) => result.status === 200);
	pass("parallel public own-raise proposals admit one replacement", ownWinners.length === 1 && ownRace.filter((result) => result.status === 422).length === 1);
	const ownWinner = ownWinners[0]!;
	pass("winning own raise commits", (await submitBid(raiseKey, ids.raise, ownWinner.body.receipt.amount, ownWinner.body.receipt)).status === 200);

	const duelFirst = await reserve(raiseKey, ids.duel, 1_000);
	pass("duel leader commits", duelFirst.status === 200 && (await submitBid(raiseKey, ids.duel, 1_000, duelFirst.body.receipt)).status === 200);
	const [raiseReservation, outbidReservation] = await Promise.all([reserve(raiseKey, ids.duel, 2_000), reserve(challengerKey, ids.duel, 2_500)]);
	pass("raise and outbid both reserve independently funded value", raiseReservation.status === 200 && outbidReservation.status === 200);
	const submissions = await Promise.all([
		submitBid(raiseKey, ids.duel, 2_000, raiseReservation.body.receipt),
		submitBid(challengerKey, ids.duel, 2_500, outbidReservation.body.receipt),
	]);
	pass("raise/outbid race has no transport failure", submissions.every((result) => [200, 422].includes(result.status)) && submissions.some((result) => result.status === 200));
	const state = (await request(`/api/state?actor=${challenger}`)).body.state;
	const duel = state.auctions[ids.duel];
	pass("raise/outbid consensus result is the fully funded 2.5k challenger", duel.high_bid === 2_500 && duel.leader_bid_id
		&& state.bids[duel.leader_bid_id].bidder === challenger);
	const committedReservations = Object.values(state.custody_reservations) as any[];
	const duelActive = committedReservations.filter((reservation) => reservation.auction_id === ids.duel && reservation.status === "reserved");
	pass("raise/outbid leaves exactly one committed active reservation", duelActive.length === 1 && duelActive[0].bidder === challenger);

	const conservation = (await request("/api/cashu/conservation")).body;
	pass("global conservation remains exclusive after concurrent paths", conservation.conserved === true
		&& conservation.issued === conservation.accountedTotal && conservation.fees?.input_fee_ppk === 0);
	const evidence = { schema: "PlebeianFridayConcurrencyAcceptanceV1", run, started_at: started, completed_at: new Date().toISOString(),
		actors: { cross, raise, challenger }, auctions: ids,
		cross_auction: { statuses: crossRace.map((result) => result.status), committed: crossAuction, backing: crossWallet.backing,
			reserved: crossWallet.reserved, spendable: crossWallet.spendable },
		own_raise: { statuses: ownRace.map((result) => result.status), committed_amount: ownWinner.body.receipt.amount },
		raise_vs_outbid: { submission_statuses: submissions.map((result) => result.status), final_amount: duel.high_bid,
			final_bidder: state.bids[duel.leader_bid_id].bidder, active_reservations: duelActive.length },
		conservation, passed: true };
	const file = await open(EVIDENCE_PATH, "wx", 0o600); try { await file.writeFile(JSON.stringify(evidence, null, 2)+"\n"); } finally { await file.close(); }
	console.log(`friday-concurrency-live: complete; evidence ${EVIDENCE_PATH}`);
}

main().catch((error) => { console.error(`friday-concurrency-live: FAILED — ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
