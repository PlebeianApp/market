#!/usr/bin/env bun
/** One end-to-end proof: Coco/Nutshell payments bound into four-node CometBFT. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { open, readFile } from "node:fs/promises";

import { initializeCoco, MemoryRepositories } from "@cashu/coco-core";
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { createCocoRail } from "./coco-rail";
import type { CocoRailPort } from "./coco-rail";
import { createMemorySeedStore, seedGetterFor } from "./seed-store";

const BASE = (process.env.POC_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const MINT = process.env.MINT_URL ?? "http://127.0.0.1:3338";
const COMMITTEE_KEY_PATH = process.env.COMMITTEE_KEY_PATH ?? "../../.local-run/cashu-network/cashu-committee.key";
const EVIDENCE = process.env.EVIDENCE_PATH ?? "../../evidence/integrated-cashu-comet-20261020.json";
const FAUCET = 10_000;

type Wallet = {
	manager: Awaited<ReturnType<typeof initializeCoco>>;
	rail: CocoRailPort;
	balance(): Promise<number>;
};

type NostrEvent = {
	id: string;
	pubkey: string;
	created_at: number;
	kind: number;
	tags: string[][];
	content: string;
	sig: string;
};

type CashuReceipt = {
	schema: "PlebeianAuctionsPOCCashuLockV1";
	mint_url: string;
	auction_id: string;
	bidder: string;
	amount: number;
	operation_id: string;
	token_sha256: string;
	committee_public_key: string;
	refund_public_key: string;
	locktime: number;
	signature: string;
};

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const now = (): number => Math.floor(Date.now() / 1000);

function privateKey(): Uint8Array {
	for (;;) {
		const candidate = randomBytes(32);
		try {
			secp256k1.getPublicKey(candidate, true);
			return candidate;
		} catch { /* retry the vanishingly unlikely invalid scalar */ }
	}
}

function nostrPubkey(secret: Uint8Array): string {
	return bytesToHex(schnorr.getPublicKey(secret));
}

function nostrEvent(secret: Uint8Array, kind: number, content: unknown, tags: string[][]): NostrEvent {
	const pubkey = nostrPubkey(secret);
	const createdAt = now();
	const encodedContent = JSON.stringify(content);
	const id = sha256(JSON.stringify([0, pubkey, createdAt, kind, tags, encodedContent]));
	return {
		id, pubkey, created_at: createdAt, kind, tags, content: encodedContent,
		sig: bytesToHex(schnorr.sign(hexToBytes(id), secret)),
	};
}

async function wallet(): Promise<Wallet> {
	const manager = await initializeCoco({ repo: new MemoryRepositories(), seedGetter: seedGetterFor(createMemorySeedStore()) });
	const rail = createCocoRail(manager) as CocoRailPort;
	await rail.trustMint({ mintUrl: MINT });
	return {
		manager, rail,
		async balance(): Promise<number> {
			const snapshot = (await manager.wallet.balances.total({ mintUrls: [MINT] })) as { spendable?: unknown };
			const value = snapshot.spendable;
			return Number(typeof value === "object" && value !== null ? String(value) : value) || 0;
		},
	};
}

async function request(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
	const response = await fetch(BASE + path, init);
	const body = await response.json();
	return { status: response.status, body };
}

async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
	return request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function event(value: NostrEvent): Promise<any> {
	const result = await post("/api/event", value);
	if (result.status !== 200) throw new Error(`event kind ${value.kind} HTTP ${result.status}: ${JSON.stringify(result.body)}`);
	return result.body;
}

function receiptDigest(receipt: Omit<CashuReceipt, "signature">): Uint8Array {
	const material = [
		receipt.schema, receipt.mint_url, receipt.auction_id, receipt.bidder, receipt.amount,
		receipt.operation_id, receipt.token_sha256, receipt.committee_public_key,
		receipt.refund_public_key, receipt.locktime,
	];
	return hexToBytes(sha256(JSON.stringify(material)));
}

function signReceipt(input: Omit<CashuReceipt, "signature">, committeeSecret: Uint8Array): CashuReceipt {
	return { ...input, signature: bytesToHex(schnorr.sign(receiptDigest(input), committeeSecret)) };
}

function assert(label: string, condition: boolean, detail = ""): void {
	if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
	console.log(`PASS  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main(): Promise<void> {
	const startedAt = new Date().toISOString();
	const run = randomUUID();
	const rawCommittee = (await readFile(COMMITTEE_KEY_PATH, "utf8")).trim();
	if (!/^[0-9a-f]{64}$/.test(rawCommittee)) throw new Error("committee key file is not one lowercase secp256k1 scalar");
	const committeeSecret = hexToBytes(rawCommittee);
	const committeePublic = bytesToHex(secp256k1.getPublicKey(committeeSecret, true));
	const config = await request("/api/config");
	assert("site is connected to the expected Cashu test mint", config.status === 200 && config.body.cashu_mint_url === MINT);
	assert("consensus trusts the payment coordinator's public key", config.body.committee_public_key === committeePublic);

	const sellerNostr = privateKey();
	const bidderANostr = privateKey();
	const bidderBNostr = privateKey();
	const sellerActor = nostrPubkey(sellerNostr);
	const bidderAActor = nostrPubkey(bidderANostr);
	const bidderBActor = nostrPubkey(bidderBNostr);
	const bidderA = await wallet();
	const bidderB = await wallet();
	const committee = await wallet();
	const seller = await wallet();
	const managers = [bidderA.manager, bidderB.manager, committee.manager, seller.manager];
	try {
		for (const [name, current] of [["bidder A", bidderA], ["bidder B", bidderB]] as const) {
			const funded = await current.rail.fund({ mintUrl: MINT, amount: FAUCET, operationId: `${run}-${name}-faucet` });
			assert(`${name} receives 10,000 real test-mint sats`, funded.state === "finalized" && await current.balance() === FAUCET);
		}

		const auctionID = `cashu-comet-${Date.now()}`;
		const duration = 15;
		const create = nostrEvent(sellerNostr, 28640, {
			auction_id: auctionID, title: "Integrated Cashu/Comet POC", duration_seconds: duration,
			starting_bid: 100, reserve: 150,
		}, [["t", "plebeian-auctions-poc"], ["auction", auctionID]]);
		const createResult = await event(create);
		const stateAfterCreate = (await request(`/api/state?actor=${sellerActor}`)).body;
		const auctionEnd = stateAfterCreate.state.auctions[auctionID].end_time as number;
		const locktime = auctionEnd + 10;
		assert("auction creation committed before locks", createResult.height > 0 && auctionEnd === create.created_at + duration);

		const refundA = await bidderA.rail.generateLockKeypair();
		const refundB = await bidderB.rail.generateLockKeypair();
		const operationA = `${run}-cashu-lock-a`;
		const operationB = `${run}-cashu-lock-b`;
		await bidderA.rail.sendLockedP2pk({ mintUrl: MINT, amount: 120, operationId: operationA,
			lock: { childPubkey: committeePublic, refundPubkey: refundA.pubkey, locktime } });
		await bidderB.rail.sendLockedP2pk({ mintUrl: MINT, amount: 180, operationId: operationB,
			lock: { childPubkey: committeePublic, refundPubkey: refundB.pubkey, locktime } });
		const lockedA = await bidderA.rail.lockedToken({ operationId: operationA });
		const lockedB = await bidderB.rail.lockedToken({ operationId: operationB });
		if (lockedA === null || lockedB === null) throw new Error("Coco did not retain both Cashu bid locks");
		const tokenHashA = sha256(lockedA.token);
		const tokenHashB = sha256(lockedB.token);
		const receiptA = signReceipt({
			schema: "PlebeianAuctionsPOCCashuLockV1", mint_url: MINT, auction_id: auctionID, bidder: bidderAActor,
			amount: 120, operation_id: operationA, token_sha256: tokenHashA, committee_public_key: committeePublic,
			refund_public_key: refundA.pubkey, locktime,
		}, committeeSecret);
		const receiptB = signReceipt({
			schema: "PlebeianAuctionsPOCCashuLockV1", mint_url: MINT, auction_id: auctionID, bidder: bidderBActor,
			amount: 180, operation_id: operationB, token_sha256: tokenHashB, committee_public_key: committeePublic,
			refund_public_key: refundB.pubkey, locktime,
		}, committeeSecret);

		const bidA = nostrEvent(bidderANostr, 28641, { auction_id: auctionID, amount: 120, cashu_lock: receiptA }, [["auction", auctionID]]);
		const bidAResult = await event(bidA);
		const forged = { ...receiptB, amount: 160, token_sha256: "00".repeat(32) };
		const invalidBid = nostrEvent(bidderBNostr, 28641, { auction_id: auctionID, amount: 160, cashu_lock: forged }, [["auction", auctionID]]);
		const invalidResult = await post("/api/event", invalidBid);
		assert("forged/unfunded Cashu bid is rejected by validators", invalidResult.status === 422, JSON.stringify(invalidResult.body).slice(0, 120));
		const bidB = nostrEvent(bidderBNostr, 28641, { auction_id: auctionID, amount: 180, cashu_lock: receiptB }, [["auction", auctionID]]);
		const bidBResult = await event(bidB);

		const before = (await request("/api/validators")).body.validators as any[];
		assert("four distinct validators report online before the fault", before.length === 4 && before.every((node) => node.online)
			&& new Set(before.map((node) => node.node_id)).size === 4 && new Set(before.map((node) => node.validator_address)).size === 4);
		while (now() <= auctionEnd) await Bun.sleep(250);
		const offline = await post("/api/admin/offline", { slot: 4 });
		assert("validator 4 is deliberately stopped", offline.status === 200);
		const close = await post("/api/close", { auction_id: auctionID });
		assert("three validators close the auction", close.status === 200, JSON.stringify(close.body));
		const consensus = (await request(`/api/state?actor=${sellerActor}`)).body;
		const closed = consensus.state.auctions[auctionID];
		const winningBid = consensus.state.bids[closed.leader_bid_id];
		assert("consensus chooses the Cashu-backed 180-sat bid", closed.winner === bidderBActor && winningBid.cashu_token_sha256 === tokenHashB);

		const winnerRedeem = await committee.rail.redeemP2pk({ mintUrl: MINT, token: lockedB.token,
			secretKey: rawCommittee, operationId: `${run}-committee-winner-redeem` });
		assert("shared committee spends exactly the consensus winner lock", winnerRedeem.state === "finalized" && await committee.balance() === 180);
		const payout = await committee.rail.send({ mintUrl: MINT, amount: 180, operationId: `${run}-seller-payout` });
		if (payout.token === undefined) throw new Error("seller payout produced no transferable Cashu token");
		const sellerReceive = await seller.rail.receive({ token: payout.token, operationId: `${run}-seller-receive` });
		assert("seller receives actual Cashu proofs worth 180", sellerReceive.state === "finalized" && await seller.balance() === 180);

		while (now() <= locktime) await Bun.sleep(250);
		const loserRefund = await bidderA.rail.redeemP2pk({ mintUrl: MINT, token: lockedA.token,
			secretKey: refundA.secretKey, operationId: `${run}-loser-refund` });
		assert("loser spends the timelocked refund path and recovers 10,000", loserRefund.state === "finalized" && await bidderA.balance() === FAUCET);
		assert("winner paid 180 from their test wallet", await bidderB.balance() === FAUCET - 180, `${await bidderB.balance()} sat`);

		await Bun.sleep(2_000);
		const after = (await request("/api/validators")).body.validators as any[];
		assert("the network keeps committing with one validator offline", after.filter((node) => node.online).length === 3
			&& after[3]?.online === false && after.slice(0, 3).every((node) => node.commit_signatures >= 3));
		const finalState = (await request(`/api/state?actor=${sellerActor}`)).body;

		const evidence = {
			schema: "PlebeianAuctionsPOCIntegratedEvidenceV1", started_at: startedAt, completed_at: new Date().toISOString(),
			auction_id: auctionID, seller: sellerActor, bidder_a: bidderAActor, bidder_b: bidderBActor,
			mint_url: MINT, committee_public_key: committeePublic,
			cashu: {
				coco_v2: true, nutshell_fake_wallet: true, nut_11: true,
				losing_token_sha256: tokenHashA, winning_token_sha256: tokenHashB, locktime,
				balances: { seller: await seller.balance(), loser: await bidderA.balance(), winner: await bidderB.balance() },
				operations: { winning_redeem: winnerRedeem.operationId, seller_payout: payout.operationId,
					seller_receive: sellerReceive.operationId, loser_refund: loserRefund.operationId },
			},
			consensus: {
				create_height: createResult.height, bid_a_height: bidAResult.height, bid_b_height: bidBResult.height,
				close_height: close.body.height, winner: closed.winner, winning_token_sha256: winningBid.cashu_token_sha256,
				invalid_bid_http_status: invalidResult.status, invalid_bid_error: invalidResult.body.error,
				validators_before_offline: before, validators_after_offline: after, final_app_hash: finalState.app_hash,
			},
			shortcuts: ["one shared application-level committee key; NOT FROST or threshold custody"],
			passed: true,
		};
		const file = await open(EVIDENCE, "wx", 0o600);
		try { await file.writeFile(JSON.stringify(evidence, null, 2) + "\n"); }
		finally { await file.close(); }
		console.log(`\npoc-integrated-live.ts: complete; evidence ${EVIDENCE}`);
	} finally {
		await Promise.all(managers.map((manager) => manager.dispose()));
	}
}

main().catch((error) => {
	console.error(`poc-integrated-live.ts: FAILED — ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
