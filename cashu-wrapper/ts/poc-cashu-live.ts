#!/usr/bin/env bun
/**
 * Honest fake-money vertical slice for the Wednesday POC.
 *
 * This runs against a real Nutshell mint using its FakeWallet backend. Coco v2
 * mints two independent 10,000-sat wallets, moves bid amounts into mint-signed
 * NUT-11 locks held by one documented application committee key, pays the
 * seller by spending the winning lock, and lets the loser spend the refund
 * branch after locktime. Only hashes and public facts enter the evidence file.
 */
import { createHash, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";

import { initializeCoco, MemoryRepositories } from "@cashu/coco-core";

import { createCocoRail } from "./coco-rail";
import type { CocoRailPort } from "./coco-rail";
import { CashuMintClient } from "./nut-client";
import { createMemorySeedStore, seedGetterFor } from "./seed-store";

const MINT = process.env.MINT_URL ?? "http://127.0.0.1:3338";
const EVIDENCE = process.env.EVIDENCE_PATH ?? "../../evidence/cashu-live-20261020.json";
const FUNDED = 10_000;
const LOSING_BID = 120;
const WINNING_BID = 180;

type Wallet = {
	manager: Awaited<ReturnType<typeof initializeCoco>>;
	rail: CocoRailPort;
	balance(): Promise<number>;
};

async function wallet(): Promise<Wallet> {
	const manager = await initializeCoco({
		repo: new MemoryRepositories(),
		seedGetter: seedGetterFor(createMemorySeedStore()),
	});
	const rail = createCocoRail(manager) as CocoRailPort;
	await rail.trustMint({ mintUrl: MINT });
	return {
		manager,
		rail,
		async balance(): Promise<number> {
			const snapshot = (await manager.wallet.balances.total({ mintUrls: [MINT] })) as { spendable?: unknown };
			const value = snapshot.spendable;
			return Number(typeof value === "object" && value !== null ? String(value) : value) || 0;
		},
	};
}

function assert(label: string, condition: boolean, detail = ""): void {
	if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
	console.log(`PASS  ${label}${detail ? ` — ${detail}` : ""}`);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function inspectLoopbackTestMint(): Promise<{
	mintUrl: string;
	serverVersion: string;
	activeSatKeysetId: string;
	denominationKeyDigest: string;
	nuts: number[];
}> {
	const url = new URL(MINT);
	if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)
		|| url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
		throw new Error("local POC mint must be an exact loopback HTTP origin");
	}
	const client = new CashuMintClient({ mintUrl: url.origin });
	const [info, active] = await Promise.all([client.info(), client.activeKeyset("sat")]);
	if (active === null) throw new Error("loopback test mint has no active sat keyset");
	const keyset = (await client.keys(active.id)).keysets.find((current) => current.id === active.id && current.unit === "sat");
	if (keyset === undefined) throw new Error("loopback test mint has no keys for its active sat keyset");
	const denominations = Object.entries(keyset.keys).sort(([left], [right]) => Number(left) - Number(right));
	const nuts = Object.keys(info.nuts ?? {}).filter((nut) => /^[0-9]+$/.test(nut)).map(Number).sort((left, right) => left - right);
	return {
		mintUrl: url.origin,
		serverVersion: typeof info.version === "string" ? info.version : "unknown",
		activeSatKeysetId: active.id,
		denominationKeyDigest: sha256(JSON.stringify(denominations)),
		nuts,
	};
}

async function main(): Promise<void> {
	const startedAt = new Date().toISOString();
	const run = randomUUID();
	const bidderA = await wallet();
	const bidderB = await wallet();
	const committee = await wallet();
	const seller = await wallet();
	const managers = [bidderA.manager, bidderB.manager, committee.manager, seller.manager];
	try {
		const mint = await inspectLoopbackTestMint();
		assert("Nutshell exposes an active sat keyset", mint.activeSatKeysetId.length > 0, mint.serverVersion);
		assert("the mint advertises NUT-11", mint.nuts.includes(11), `NUTs ${mint.nuts.join(",")}`);

		for (const [name, current] of [["bidder A", bidderA], ["bidder B", bidderB]] as const) {
			const funded = await current.rail.fund({ mintUrl: MINT, amount: FUNDED, operationId: `${run}-${name}-faucet` });
			assert(`${name} receives real mint proofs`, funded.state === "finalized", funded.state);
			assert(`${name} has 10,000 spendable fake sats`, await current.balance() === FUNDED);
		}

		const committeeKey = await committee.rail.generateLockKeypair();
		const refundA = await bidderA.rail.generateLockKeypair();
		const refundB = await bidderB.rail.generateLockKeypair();
		assert("committee and refund consensus identities are distinct",
			new Set([committeeKey.pubkey, refundA.pubkey, refundB.pubkey]).size === 3);

		const locktime = Math.floor(Date.now() / 1000) + 8;
		const lockAOperation = `${run}-bid-a-lock`;
		const lockBOperation = `${run}-bid-b-lock`;
		await bidderA.rail.sendLockedP2pk({
			mintUrl: MINT, amount: LOSING_BID, operationId: lockAOperation,
			lock: { childPubkey: committeeKey.pubkey, refundPubkey: refundA.pubkey, locktime },
		});
		await bidderB.rail.sendLockedP2pk({
			mintUrl: MINT, amount: WINNING_BID, operationId: lockBOperation,
			lock: { childPubkey: committeeKey.pubkey, refundPubkey: refundB.pubkey, locktime },
		});
		const lockedA = await bidderA.rail.lockedToken({ operationId: lockAOperation });
		const lockedB = await bidderB.rail.lockedToken({ operationId: lockBOperation });
		assert("both bids are represented by mint-signed conditional tokens", lockedA !== null && lockedB !== null);
		assert("locking removes the exact bid values from bidder spendable balances",
			await bidderA.balance() === FUNDED - LOSING_BID && await bidderB.balance() === FUNDED - WINNING_BID,
			`${await bidderA.balance()} / ${await bidderB.balance()}`);

		// The application committee spends only the consensus winner's token, then
		// transfers plain Cashu proofs to the seller's independent Coco wallet.
		const winnerRedeem = await committee.rail.redeemP2pk({
			mintUrl: MINT, token: lockedB!.token, secretKey: committeeKey.secretKey,
			operationId: `${run}-winner-redeem`,
		});
		assert("committee spends the winning lock before expiry", winnerRedeem.state === "finalized", winnerRedeem.state);
		assert("winning value reaches the committee wallet", await committee.balance() === WINNING_BID);
		const payout = await committee.rail.send({
			mintUrl: MINT, amount: WINNING_BID, operationId: `${run}-seller-payout`,
		});
		assert("seller payout produces transferable Cashu proofs", typeof payout.token === "string" && payout.token.length > 100);
		const received = await seller.rail.receive({ token: payout.token!, operationId: `${run}-seller-receive` });
		assert("seller Coco wallet admits the payout", received.state === "finalized", received.state);
		assert("seller spendable balance is the winning bid", await seller.balance() === WINNING_BID, `${await seller.balance()} sat`);

		// The losing token remains unspent until its explicit timelocked branch.
		let earlyRefund = "";
		try {
			await bidderA.rail.redeemP2pk({
				mintUrl: MINT, token: lockedA!.token, secretKey: refundA.secretKey,
				operationId: `${run}-early-loser-refund`,
			});
		} catch (error) {
			earlyRefund = error instanceof Error ? error.message : String(error);
		}
		assert("loser refund is refused before locktime", earlyRefund.includes("before its locktime"));
		await new Promise((resolve) => setTimeout(resolve, Math.max(0, (locktime + 2) * 1000 - Date.now())));
		const refund = await bidderA.rail.redeemP2pk({
			mintUrl: MINT, token: lockedA!.token, secretKey: refundA.secretKey,
			operationId: `${run}-loser-refund`,
		});
		assert("loser refund branch spends after locktime", refund.state === "finalized", refund.state);
		assert("loser recovers the full 10,000 fake sats", await bidderA.balance() === FUNDED, `${await bidderA.balance()} sat`);

		const evidence = {
			schema: "PlebeianAuctionsPOCCashuEvidenceV1",
			started_at: startedAt,
			completed_at: new Date().toISOString(),
			mint: {
				url: mint.mintUrl,
				server_version: mint.serverVersion,
				active_sat_keyset_id: mint.activeSatKeysetId,
				denomination_key_digest: mint.denominationKeyDigest,
				nuts: mint.nuts,
			},
			mechanics: {
				coco_v2: true,
				nutshell_fake_wallet: true,
				nut_11_conditional_proofs: true,
				committee_threshold: false,
				committee_shortcut: "one shared application-level key; NOT FROST or threshold custody",
			},
			amounts: {
				faucet_each: FUNDED,
				losing_bid: LOSING_BID,
				winning_bid: WINNING_BID,
				seller_after_payout: await seller.balance(),
				loser_after_refund: await bidderA.balance(),
				winner_after_close: await bidderB.balance(),
			},
			locks: {
				locktime,
				committee_public_key: committeeKey.pubkey,
				losing_refund_public_key: refundA.pubkey,
				winning_refund_public_key: refundB.pubkey,
				losing_token_sha256: sha256(lockedA!.token),
				winning_token_sha256: sha256(lockedB!.token),
			},
			operations: {
				winning_lock: lockBOperation,
				winning_redeem: winnerRedeem.operationId,
				seller_payout: payout.operationId,
				seller_receive: received.operationId,
				losing_lock: lockAOperation,
				losing_refund: refund.operationId,
			},
			passed: true,
		};
		const file = await open(EVIDENCE, "wx", 0o600);
		try {
			await file.writeFile(JSON.stringify(evidence, null, 2) + "\n");
		} finally {
			await file.close();
		}
		console.log(`\npoc-cashu-live.ts: complete; evidence ${EVIDENCE}`);
	} finally {
		await Promise.all(managers.map((manager) => manager.dispose()));
	}
}

main().catch((error) => {
	console.error(`poc-cashu-live.ts: FAILED — ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
