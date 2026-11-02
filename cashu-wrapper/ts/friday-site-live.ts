#!/usr/bin/env bun
/** Isolated Friday acceptance through the same public site/coordinator APIs. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const argument = (prefix: string): string | undefined => process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
const BASE = (argument("--base=") ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const EVIDENCE = argument("--evidence=") ?? "../../evidence/friday-site-local.json";
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

type SignedEvent = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };
function secret(): Uint8Array {
	for (;;) { const candidate = randomBytes(32); try { secp256k1.getPublicKey(candidate, true); return candidate; } catch {} }
}
function actor(key: Uint8Array): string { return bytesToHex(schnorr.getPublicKey(key)); }
function signed(key: Uint8Array, kind: number, content: unknown, tags: string[][] = []): SignedEvent {
	const pubkey = actor(key); const createdAt = Math.floor(Date.now()/1_000); const encoded = JSON.stringify(content);
	const id = sha256(JSON.stringify([0, pubkey, createdAt, kind, tags, encoded]));
	return { id, pubkey, created_at: createdAt, kind, tags, content: encoded, sig: bytesToHex(schnorr.sign(hexToBytes(id), key)) };
}
async function request(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
	const response = await fetch(BASE+path, init); return { status: response.status, body: await response.json() };
}
async function post(path: string, value: unknown) {
	return request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
}
function pass(label: string, condition: boolean, detail = ""): void {
	if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
	console.log(`PASS  ${label}${detail ? ` — ${detail}` : ""}`);
}
async function waitFor<T>(label: string, timeoutMs: number, read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
	const deadline = Date.now()+timeoutMs;
	for (;;) {
		const value = await read();
		if (done(value)) return value;
		if (Date.now() >= deadline) throw new Error(`${label} timed out`);
		await Bun.sleep(500);
	}
}

async function reserveAndBid(key: Uint8Array, auctionId: string, amount: number) {
	const reservation = await post("/api/cashu/reserve", signed(key, 28644, { auction_id: auctionId, amount }, [["auction", auctionId]]));
	pass(`reserve ${amount} from real wallet backing`, reservation.status === 200 && reservation.body.receipt?.amount === amount,
		`HTTP ${reservation.status} ${JSON.stringify(reservation.body).slice(0, 160)}`);
	const bid = await post("/api/event", signed(key, 28641,
		{ auction_id: auctionId, amount, reservation: reservation.body.receipt }, [["auction", auctionId]]));
	pass(`commit reservation-backed bid ${amount}`, bid.status === 200, `HTTP ${bid.status} ${JSON.stringify(bid.body).slice(0, 200)}`);
	return { reservation: reservation.body.receipt, height: bid.body.height };
}

async function main(): Promise<void> {
	const startedAt = new Date().toISOString(); const run = randomUUID();
	const sellerKey = secret(), bKey = secret(), cKey = secret(), dKey = secret();
	const seller = actor(sellerKey), b = actor(bKey), c = actor(cKey), d = actor(dKey);

	for (let index = 1; index <= 5; index += 1) {
		const grant = await post("/api/cashu/faucet", signed(bKey, 28643, { action: "faucet" }, [["request", String(index)]]));
		pass(`B faucet grant ${index}/5`, grant.status === 200 && grant.body.grant_total === index*10_000,
			`HTTP ${grant.status} ${JSON.stringify(grant.body).slice(0, 320)}`);
	}
	const capped = await post("/api/cashu/faucet", signed(bKey, 28643, { action: "faucet" }, [["request", "6"]]));
	pass("B sixth faucet grant is refused at 50,000", capped.status === 409);
	for (const [name, key] of [["C", cKey], ["D", dKey]] as const) {
		const grant = await post("/api/cashu/faucet", signed(key, 28643, { action: "faucet" }));
		pass(`${name} faucet mints 10,000 real test proofs`, grant.status === 200 && grant.body.grant_total === 10_000);
	}

	const auctionId = `friday-${Date.now()}`;
	const created = await post("/api/event", signed(sellerKey, 28640, { auction_id: auctionId, title: "Friday proof-backed lot",
		description: "Isolated custodial reservation acceptance", image_url: "https://example.invalid/friday.png",
		duration_seconds: 190, starting_bid: 1_000, min_increment: 100, reserve: 0 }, [["auction", auctionId]]));
	pass("seller creates product auction", created.status === 200 && created.body.height > 0);
	const noSaleAuctionId = `reserve-${Date.now()}`;
	const noSaleCreated = await post("/api/event", signed(sellerKey, 28640, { auction_id: noSaleAuctionId, title: "Friday reserve-not-met lot",
		description: "Real backing must return when reserve is not met", image_url: "",
		duration_seconds: 190, starting_bid: 1_000, min_increment: 100, reserve: 5_000 }, [["auction", noSaleAuctionId]]));
	pass("seller creates reserve 5,000 no-sale auction", noSaleCreated.status === 200 && noSaleCreated.body.height > 0);
	await reserveAndBid(cKey, noSaleAuctionId, 3_000);

	const unattested = await post("/api/event", signed(cKey, 28641,
		{ auction_id: auctionId, amount: 1_000, reservation: { schema: "PlebeianAuctionsPOCCustodyReservationV1" } }, [["auction", auctionId]]));
	pass("unattested client funding assertion is rejected", unattested.status === 422);
	const self = await post("/api/cashu/reserve", signed(sellerKey, 28644, { auction_id: auctionId, amount: 1_000 }, [["auction", auctionId]]));
	pass("seller self-bid reservation is rejected", self.status === 422);
	const insufficient = await post("/api/cashu/reserve", signed(dKey, 28644, { auction_id: auctionId, amount: 20_000 }, [["auction", auctionId]]));
	pass("insufficient real wallet backing is rejected", insufficient.status === 422);

	await reserveAndBid(bKey, auctionId, 1_000);
	const lower = await post("/api/cashu/reserve", signed(cKey, 28644, { auction_id: auctionId, amount: 1_000 }, [["auction", auctionId]]));
	pass("equal/lower bid reservation is rejected", lower.status === 422);
	await reserveAndBid(cKey, auctionId, 1_500);
	const bReleased = await waitFor("B prompt outbid release", 15_000, async () => (await request(`/api/cashu/wallet?actor=${b}`)).body,
		(wallet) => wallet.spendable === 50_000 && wallet.reserved === 0);
	pass("outbid B backing becomes spendable without a mint call", bReleased.spendable === 50_000);

	const lateState = await waitFor("late-bid window", 30_000, async () => (await request(`/api/state?actor=${b}`)).body,
		(view) => Number(view.state.last_consensus_time) >= Number(view.state.auctions[auctionId].end_time)-180);
	const endBeforeLate = Number(lateState.state.auctions[auctionId].end_time);
	await reserveAndBid(bKey, auctionId, 2_000);
	await reserveAndBid(dKey, auctionId, 2_500);
	const afterLate = (await request(`/api/state?actor=${seller}`)).body;
	pass("late bids extend committed end without browser time authority",
		Number(afterLate.state.auctions[auctionId].end_time) > endBeforeLate
		&& Number(afterLate.state.auctions[auctionId].end_time) <= Number(afterLate.state.auctions[auctionId].original_end_time)+1_800);

	const closed = await waitFor("automatic consensus close", 210_000, async () => (await request(`/api/state?actor=${seller}`)).body,
		(view) => view.state.auctions[auctionId].status === "closed");
	const auction = closed.state.auctions[auctionId];
	pass("automatic close chooses D at exactly 2,500", auction.winner === d && auction.high_bid === 2_500);
	const sellerWallet = await waitFor("seller outbox delivery", 30_000, async () => (await request(`/api/cashu/wallet?actor=${seller}`)).body,
		(wallet) => wallet.spendable === 2_500 && wallet.payments?.some((payment: any) => payment.direction === "incoming" && payment.amount === 2_500 && payment.status === "paid"));
	const noSale = await waitFor("reserve-unmet automatic close", 30_000, async () => (await request(`/api/state?actor=${seller}`)).body,
		(view) => view.state.auctions[noSaleAuctionId].status === "closed");
	pass("reserve 5,000 with top bid 3,000 closes without a winner",
		!noSale.state.auctions[noSaleAuctionId].winner && noSale.state.auctions[noSaleAuctionId].high_bid === 3_000,
		JSON.stringify(noSale.state.auctions[noSaleAuctionId]));
	const cReleased = await waitFor("reserve-unmet backing release", 15_000, async () => (await request(`/api/cashu/wallet?actor=${c}`)).body,
		(wallet) => wallet.spendable === 10_000 && wallet.reserved === 0);
	pass("reserve-unmet bidder recovers all usable backing without mint settlement", cReleased.payments.length === 0);
	const [bWallet, cWallet, dWallet] = await Promise.all([b, c, d].map(async (npub) => (await request(`/api/cashu/wallet?actor=${npub}`)).body));
	pass("seller owns actual 2,500 proofs", sellerWallet.backing === 2_500 && sellerWallet.spendable === 2_500);
	pass("outbid wallets recover full usable value", bWallet.spendable === 50_000 && cWallet.spendable === 10_000);
	pass("winner pays exactly 2,500 usable proofs", dWallet.spendable === 7_500 && dWallet.backing === 7_500);
	pass("all wallet conservation views are exact", [sellerWallet, bWallet, cWallet, dWallet].every((wallet) => wallet.conserved === true));
	const conservation = (await request("/api/cashu/conservation")).body;
	pass("all 70,000 issued fake sats are in mutually exclusive global buckets", conservation.issued === 70_000
		&& conservation.accountedTotal === 70_000 && conservation.conserved === true
		&& conservation.inFlight === 0 && conservation.unknown === 0 && conservation.incomingPending === 0 && conservation.fundingPending === 0);
	pass("the active fake-mint keyset is verified zero-fee", conservation.fees?.input_fee_ppk === 0 && conservation.fees?.required === 0);
	const validators = (await request("/api/validators")).body.validators as any[];
	pass("four distinct validators sign live commits", validators.length === 4 && validators.every((node) => node.online && node.commit_signatures === 4)
		&& new Set(validators.map((node) => node.node_id)).size === 4 && new Set(validators.map((node) => node.validator_address)).size === 4);

	const evidence = { schema: "PlebeianFridayLocalAcceptanceV1", run, started_at: startedAt, completed_at: new Date().toISOString(),
		auction_id: auctionId, actors: { seller, b, c, d }, faucet: { b_total: 50_000, sixth_http_status: capped.status },
		auction: { winner: auction.winner, amount: auction.high_bid, original_end_time: auction.original_end_time, end_time: auction.end_time },
		reserve_no_sale: { auction_id: noSaleAuctionId, reserve: 5_000, top_bid: 3_000, winner: noSale.state.auctions[noSaleAuctionId].winner, bidder_spendable: cReleased.spendable },
		balances: { seller: sellerWallet.spendable, b: bWallet.spendable, c: cWallet.spendable, d: dWallet.spendable },
		payments: sellerWallet.payments, conservation, validators, mint: { implementation: "Nutshell 0.19.2", backend: "FakeWallet", input_fee_ppk: conservation.fees.input_fee_ppk, coco_v2: true },
		trust_boundary: "custodial server-held proofs; validators verify one coordinator reservation signature, not Cashu bearer proofs; shared committee key is not FROST; not FIPS",
		passed: true };
	const file = await open(EVIDENCE, "wx", 0o600); try { await file.writeFile(JSON.stringify(evidence, null, 2)+"\n"); } finally { await file.close(); }
	console.log(`friday-site-live.ts: complete; evidence ${EVIDENCE}`);
}

main().catch((error) => { console.error(`friday-site-live.ts: FAILED — ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
