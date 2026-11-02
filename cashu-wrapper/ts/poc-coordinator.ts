#!/usr/bin/env bun
/**
 * Test-only Cashu coordinator for the Friday POC candidate.
 *
 * Every balance and transition below is backed by a Coco wallet talking to the
 * pinned local Nutshell/FakeWallet mint.  The coordinator is deliberately one
 * application-level custodian: it sees bearer tokens and signs public lock
 * receipts.  CometBFT validators verify those receipts, not the Cashu proofs.
 * This is NOT FROST, threshold custody, or a production wallet architecture.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { chmod, mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

import { initializeCoco } from "@cashu/coco-core";
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { createCocoRail } from "./coco-rail";
import type { CocoMintSnapshot, CocoRailPort } from "./coco-rail";
import { FridayFundingJournal } from "./friday-funding";
import type { FridayFundingRecord } from "./friday-funding";
import { migrateFridayFundingCheckpoint } from "./friday-funding-migration";
import { FridayCustodyLedger, FridayWalletSerializers } from "./friday-ledger";
import type { FridayLedgerState } from "./friday-ledger";
import { FridaySqliteRepositories } from "./friday-sqlite";
import { createBoundedMintFetch } from "./friday-mint-transport";
const LISTEN_HOST = process.env.POC_COORDINATOR_HOST ?? "127.0.0.1";
const LISTEN_PORT = Number(process.env.POC_COORDINATOR_PORT ?? "3339");
const CONSENSUS = (process.env.POC_CONSENSUS_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const MINT = process.env.MINT_URL ?? "http://127.0.0.1:3338";
const COMMITTEE_KEY_PATH = process.env.COMMITTEE_KEY_PATH ?? "../../.local-run/cashu-network/cashu-committee.key";
const STATE_PATH: string = process.env.POC_COORDINATOR_STATE ?? "../../.local-run/coordinator/state.enc.json";
const WALLET_DB_DIR = process.env.POC_WALLET_DB_DIR ?? join(dirname(STATE_PATH), "wallets");
const FAUCET_AMOUNT = 10_000;
const FAUCET_CAP = 50_000;
const RESERVATION_TTL_SECONDS = 300;
const MINT_REQUEST_TIMEOUT_MS = Number(process.env.POC_MINT_REQUEST_TIMEOUT_MS ?? "5000");
const FRIDAY_WORKER_INTERVAL_MS = Number(process.env.POC_FRIDAY_WORKER_INTERVAL_MS ?? "2000");
// Remote CometBFT close requires multiple blocks and an operator-observed
// validator fault. Keep the committee path open long enough to finalize the
// winner before the unconditional bidder refund path becomes valid.
const SETTLEMENT_GRACE_SECONDS = 60;
const MAX_BODY = 64 * 1024;
const FRIDAY_FAILPOINT = process.env.POC_FRIDAY_FAILPOINT ?? "";
const FRIDAY_FAILPOINT_DIR = process.env.POC_FRIDAY_FAILPOINT_DIR ?? "";
const FRIDAY_WORKER_PAUSED = process.env.POC_FRIDAY_WORKER_PAUSED === "true";
const FRIDAY_FAILPOINTS = new Set([
	"faucet_after_mint_before_persist",
	"payment_after_intent",
	"payment_after_send_prepare",
	"payment_after_send_result",
	"payment_after_receive_result",
]);

function requireLoopbackHTTP(label: string, value: string): void {
	const parsed = new URL(value);
	if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.username !== "" || parsed.password !== "") {
		throw new Error(`${label} must be an explicit loopback HTTP origin`);
	}
}
if (LISTEN_HOST !== "127.0.0.1") throw new Error("coordinator listener must stay on IPv4 loopback");
requireLoopbackHTTP("consensus site", CONSENSUS);
requireLoopbackHTTP("test mint", MINT);
if (!Number.isSafeInteger(MINT_REQUEST_TIMEOUT_MS) || MINT_REQUEST_TIMEOUT_MS < 250 || MINT_REQUEST_TIMEOUT_MS > 30_000) {
	throw new Error("POC_MINT_REQUEST_TIMEOUT_MS must be an integer from 250 through 30000");
}
if (!Number.isSafeInteger(FRIDAY_WORKER_INTERVAL_MS) || FRIDAY_WORKER_INTERVAL_MS < 250 || FRIDAY_WORKER_INTERVAL_MS > 30_000) {
	throw new Error("POC_FRIDAY_WORKER_INTERVAL_MS must be an integer from 250 through 30000");
}
if (FRIDAY_FAILPOINT !== "" && (!FRIDAY_FAILPOINTS.has(FRIDAY_FAILPOINT)
	|| !/^\/tmp\/plebeian-friday-crash\.[A-Za-z0-9_-]+$/.test(FRIDAY_FAILPOINT_DIR))) {
	throw new Error("Friday failpoints require a known name and a dedicated /tmp/plebeian-friday-crash.* directory");
}
if (FRIDAY_WORKER_PAUSED && !/^\/tmp\/plebeian-friday-crash\.[A-Za-z0-9_-]+$/.test(FRIDAY_FAILPOINT_DIR)) {
	throw new Error("pausing the Friday worker is permitted only inside the dedicated process-crash harness");
}

type NostrEvent = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };
type CashuReceipt = {
	schema: "PlebeianAuctionsPOCCashuLockV1"; mint_url: string; auction_id: string; bidder: string;
	amount: number; operation_id: string; token_sha256: string; committee_public_key: string;
	refund_public_key: string; locktime: number; signature: string;
};
type ReservationReceipt = {
	schema: "PlebeianAuctionsPOCCustodyReservationV1"; mint_url: string; auction_id: string; bidder: string;
	amount: number; reservation_id: string; replaces_reservation_id: string; expires_at: number;
	committee_public_key: string; signature: string;
};
type WalletBalance = { spendable: number; reserved: number; total: number };
type Wallet = { manager: Awaited<ReturnType<typeof initializeCoco>>; database: Database; rail: CocoRailPort;
	ensureMint(): Promise<void>; mintSnapshot(): CocoMintSnapshot | null; balances(): Promise<WalletBalance>; balance(): Promise<number> };
type LockRecord = {
	actor: string; auctionId: string; amount: number; operationId: string; token: string; tokenHash: string;
	refundSecret: string; refundPublic: string; locktime: number; receipt: CashuReceipt;
	status: "locked" | "refunded" | "settled";
};
type PersistedState = {
	schema: "PlebeianAuctionsPOCCoordinatorStateV1" | "PlebeianAuctionsPOCCoordinatorStateV2" | "PlebeianAuctionsPOCCoordinatorStateV3";
	committeeSeed: string;
	walletSeeds: Record<string, string>;
	faucetActors: string[];
	faucetGrants?: Record<string, number>;
	quarantinedFundingActors?: string[];
	locks: LockRecord[];
	settledAuctions: Record<string, { seller: string; amount: number; tokenSha256: string }>;
	fridayLedger?: FridayLedgerState;
	funding?: FridayFundingRecord[];
};

type EncryptedState = {
	schema: "PlebeianAuctionsPOCEncryptedStateV1";
	nonce: string;
	tag: string;
	ciphertext: string;
};

const wallets = new Map<string, Promise<Wallet>>();
const walletSeeds = new Map<string, string>();
const faucetActors = new Set<string>();
const locks = new Map<string, LockRecord>();
const settledAuctions = new Map<string, { seller: string; amount: number; tokenSha256: string }>();
let queue: Promise<unknown> = Promise.resolve();
const walletSerializers = new FridayWalletSerializers();
let fridayLedger = new FridayCustodyLedger();
let fridayFunding = new FridayFundingJournal(FAUCET_AMOUNT, FAUCET_CAP);

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const now = (): number => Math.floor(Date.now() / 1000);

const boundedMintFetch = createBoundedMintFetch(MINT_REQUEST_TIMEOUT_MS);

async function hitFailpoint(point: string): Promise<void> {
	if (FRIDAY_FAILPOINT !== point) return;
	await mkdir(FRIDAY_FAILPOINT_DIR, { recursive: true, mode: 0o700 });
	await chmod(FRIDAY_FAILPOINT_DIR, 0o700);
	const marker = join(FRIDAY_FAILPOINT_DIR, `${point}.json`);
	const file = await open(marker, "wx", 0o600);
	try {
		await file.writeFile(JSON.stringify({ schema: "PlebeianFridayFailpointV1", point, pid: process.pid, reached_at: new Date().toISOString() }) + "\n");
		await file.sync();
	} finally {
		await file.close();
	}
	const directory = await open(FRIDAY_FAILPOINT_DIR, "r");
	try { await directory.sync(); } finally { await directory.close(); }
	await new Promise<never>(() => undefined);
}

const rawCommittee = (await readFile(COMMITTEE_KEY_PATH, "utf8")).trim();
if (!/^[0-9a-f]{64}$/.test(rawCommittee)) throw new Error("committee key file is not one lowercase secp256k1 scalar");
const committeeSecret = hexToBytes(rawCommittee);
const committeePublic = bytesToHex(secp256k1.getPublicKey(committeeSecret, true));
const stateKey = createHash("sha256").update("plebeian-poc-coordinator-state-v1\0").update(committeeSecret).digest();

function seedHex(): string {
	return randomBytes(64).toString("hex");
}

function isSeed(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{128}$/.test(value) && !/^0+$/.test(value);
}

function validatePersisted(value: unknown): PersistedState {
	if (value === null || typeof value !== "object") throw new Error("coordinator checkpoint is not an object");
	const state = value as Partial<PersistedState>;
	if (!["PlebeianAuctionsPOCCoordinatorStateV1", "PlebeianAuctionsPOCCoordinatorStateV2", "PlebeianAuctionsPOCCoordinatorStateV3"].includes(String(state.schema)) || !isSeed(state.committeeSeed)
		|| state.walletSeeds === null || typeof state.walletSeeds !== "object" || Array.isArray(state.walletSeeds)
		|| !Array.isArray(state.faucetActors) || !Array.isArray(state.locks)
		|| state.settledAuctions === null || typeof state.settledAuctions !== "object" || Array.isArray(state.settledAuctions)) {
		throw new Error("coordinator checkpoint schema is invalid");
	}
	for (const [actor, seed] of Object.entries(state.walletSeeds)) {
		if (!validActor(actor) || !isSeed(seed)) throw new Error("coordinator checkpoint contains an invalid wallet seed record");
	}
	for (const actor of state.faucetActors) if (!validActor(actor)) throw new Error("coordinator checkpoint contains an invalid faucet actor");
	if (state.faucetGrants !== undefined) {
		if (state.faucetGrants === null || typeof state.faucetGrants !== "object" || Array.isArray(state.faucetGrants)) throw new Error("coordinator checkpoint faucet grants are invalid");
		for (const [actor, amount] of Object.entries(state.faucetGrants)) if (!validActor(actor) || !Number.isSafeInteger(amount) || amount < 0 || amount > FAUCET_CAP) throw new Error("coordinator checkpoint contains an invalid faucet grant");
	}
	if (state.quarantinedFundingActors !== undefined) {
		if (!Array.isArray(state.quarantinedFundingActors) || state.quarantinedFundingActors.some((actor) => !validActor(actor))) {
			throw new Error("coordinator checkpoint funding quarantine is invalid");
		}
	}
	for (const lock of state.locks) {
		if (lock === null || typeof lock !== "object" || !validActor(lock.actor) || !/^[0-9a-f]{64}$/.test(lock.tokenHash)
			|| typeof lock.token !== "string" || lock.token.length < 16 || !/^[0-9a-f]{64}$/.test(lock.refundSecret)
			|| !["locked", "refunded", "settled"].includes(lock.status)) throw new Error("coordinator checkpoint contains an invalid lock");
	}
	if (state.fridayLedger !== undefined) new FridayCustodyLedger(state.fridayLedger);
	new FridayFundingJournal(FAUCET_AMOUNT, FAUCET_CAP, state.funding ?? [], state.faucetGrants ?? {}, state.quarantinedFundingActors ?? []);
	return state as PersistedState;
}

async function loadCheckpoint(): Promise<PersistedState | null> {
	let encoded: string;
	try {
		encoded = await readFile(STATE_PATH, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const envelope = JSON.parse(encoded) as Partial<EncryptedState>;
	if (envelope.schema !== "PlebeianAuctionsPOCEncryptedStateV1"
		|| typeof envelope.nonce !== "string" || typeof envelope.tag !== "string" || typeof envelope.ciphertext !== "string") {
		throw new Error("encrypted coordinator checkpoint envelope is invalid");
	}
	const decipher = createDecipheriv("aes-256-gcm", stateKey, Buffer.from(envelope.nonce, "hex"));
	decipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
	const clear = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
	return validatePersisted(JSON.parse(clear.toString("utf8")));
}

let committeeSeed = seedHex();

function snapshot(): PersistedState {
	const fundingState = fridayFunding.snapshot();
	return {
		schema: "PlebeianAuctionsPOCCoordinatorStateV3",
		committeeSeed,
		walletSeeds: Object.fromEntries(walletSeeds),
		faucetActors: [...faucetActors].sort(),
		faucetGrants: fundingState.grants,
		quarantinedFundingActors: fundingState.quarantinedActors,
		locks: [...locks.values()],
		settledAuctions: Object.fromEntries(settledAuctions),
		fridayLedger: fridayLedger.snapshot(),
		funding: fundingState.records,
	};
}

async function persistCheckpoint(): Promise<void> {
	const clear = Buffer.from(JSON.stringify(snapshot()));
	const nonce = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", stateKey, nonce);
	const encrypted = Buffer.concat([cipher.update(clear), cipher.final()]);
	const envelope: EncryptedState = {
		schema: "PlebeianAuctionsPOCEncryptedStateV1",
		nonce: nonce.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ciphertext: encrypted.toString("base64"),
	};
	const directory = dirname(STATE_PATH);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	const temporary = `${STATE_PATH}.tmp`;
	const file = await open(temporary, "w", 0o600);
	try {
		await file.writeFile(JSON.stringify(envelope) + "\n");
		await file.sync();
	} finally {
		await file.close();
	}
	await chmod(temporary, 0o600);
	await rename(temporary, STATE_PATH);
	const directoryHandle = await open(directory, "r");
	try {
		await directoryHandle.sync();
	} finally {
		await directoryHandle.close();
	}
}

const loaded = await loadCheckpoint();
if (loaded !== null) {
	committeeSeed = loaded.committeeSeed;
	for (const [actor, seed] of Object.entries(loaded.walletSeeds)) walletSeeds.set(actor, seed);
	for (const actor of loaded.faucetActors) faucetActors.add(actor);
	const migratedFunding = migrateFridayFundingCheckpoint(loaded, FAUCET_AMOUNT);
	fridayFunding = new FridayFundingJournal(FAUCET_AMOUNT, FAUCET_CAP, loaded.funding ?? [], migratedFunding.grants, migratedFunding.quarantinedActors);
	for (const lock of loaded.locks) locks.set(lock.tokenHash, lock);
	for (const [auction, settlement] of Object.entries(loaded.settledAuctions)) settledAuctions.set(auction, settlement);
	fridayLedger = new FridayCustodyLedger(loaded.fridayLedger);
} else {
	await persistCheckpoint();
}

function serialized<T>(action: () => Promise<T>): Promise<T> {
	const next = queue.then(action, action);
	queue = next.then(() => undefined, () => undefined);
	return next;
}

async function newWallet(seed: string, restore: boolean, walletID: string): Promise<Wallet> {
	if (!/^(?:[0-9a-f]{64}|committee)$/.test(walletID)) throw new Error("invalid persistent wallet identity");
	const seedBytes = hexToBytes(seed);
	await mkdir(WALLET_DB_DIR, { recursive: true, mode: 0o700 });
	await chmod(WALLET_DB_DIR, 0o700);
	const databasePath = join(WALLET_DB_DIR, `${walletID}.sqlite`);
	const existed = existsSync(databasePath);
	const database = new Database(databasePath, { create: true, strict: true });
	database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
	await chmod(databasePath, 0o600);
	const repositories = new FridaySqliteRepositories(database);
	const manager = await initializeCoco({ repo: repositories, seedGetter: async () => Uint8Array.from(seedBytes),
		authority: { namespace: `plebeian-friday-${walletID}`, ownerId: `coordinator-${process.pid}-${randomBytes(8).toString("hex")}` },
		requestFetch: boundedMintFetch });
	// The pinned adapter configures NORMAL during schema initialization. The
	// coordinator requires FULL after that initialization and verifies the
	// effective connection setting rather than claiming the earlier pragma won.
	database.exec("PRAGMA synchronous=FULL;");
	const durability = database.query<{ synchronous: number }, []>("PRAGMA synchronous").get();
	if (durability?.synchronous !== 2) throw new Error("Coco SQLite synchronous mode is not FULL");
	const rail = createCocoRail(manager, { fetchImpl: boundedMintFetch, allowLoopbackHttp: true }) as CocoRailPort;
	let mintTrusted = false;
	let verifiedMint: CocoMintSnapshot | null = null;
	const ensureMint = async (): Promise<void> => {
		if (mintTrusted) return;
		const result = await rail.trustMint({ mintUrl: MINT });
		if (!result.trusted) throw new Error("the configured fake mint is not trusted by this wallet");
		const inspected = await rail.inspectMint({ mintUrl: MINT });
		if (inspected.inputFeePpk !== 0) throw new Error(`configured fake mint active keyset fee is ${inspected.inputFeePpk} ppk, expected zero`);
		verifiedMint = inspected;
		mintTrusted = true;
	};
	// Migration from the Wednesday memory-only wallet uses NUT-09 once. A
	// reopened Friday SQLite wallet recovers its canonical operations/proofs
	// directly and must not silently replace them with a second restoration.
	if (restore && !existed) { await ensureMint(); await manager.wallet.restore(MINT); }
	else await ensureMint().catch(() => undefined); // Local balances and pending state remain readable through a mint outage.
	const balances = async (): Promise<WalletBalance> => {
		const snapshot = (await manager.wallet.balances.total({ mintUrls: [MINT] })) as { spendable?: unknown; reserved?: unknown; total?: unknown };
		const exact = (value: unknown, label: string): number => {
			const number = Number(typeof value === "object" && value !== null ? String(value) : value);
			if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Coco reported an invalid ${label} balance`);
			return number;
		};
		const spendable = exact(snapshot.spendable ?? 0, "spendable");
		const reserved = exact(snapshot.reserved ?? 0, "reserved");
		const total = exact(snapshot.total ?? spendable+reserved, "total");
		if (spendable+reserved !== total) throw new Error("Coco balance components do not equal total ownership");
		return { spendable, reserved, total };
	};
	return {
		manager, database, rail, ensureMint, mintSnapshot: () => verifiedMint,
		balances,
		async balance(): Promise<number> { return (await balances()).spendable; },
	};
}

function wallet(actor: string): Promise<Wallet> {
	let current = wallets.get(actor);
	if (current === undefined) {
		const existing = walletSeeds.get(actor);
		const seed = existing ?? seedHex();
		if (existing === undefined) {
			walletSeeds.set(actor, seed);
			current = persistCheckpoint().then(() => newWallet(seed, false, actor));
		} else {
			current = newWallet(seed, true, actor).then(async (restored) => {
				// A mint-restored positive balance is enough to fail closed against
				// issuing a second faucet grant after a crash between mint and checkpoint.
				const backing = (await restored.balances()).total;
				if (backing > 0 && fridayFunding.pending(actor).length === 0
					&& !fridayLedger.explainsWalletBacking(actor, fridayFunding.grant(actor), backing)) {
					faucetActors.add(actor);
					fridayFunding.quarantineLegacyBalance(actor);
					await persistCheckpoint();
				}
				return restored;
			});
		}
		wallets.set(actor, current);
	}
	return current;
}

function validActor(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function verifyEvent(value: unknown, expectedKind: number): NostrEvent {
	if (value === null || typeof value !== "object") throw new Error("a signed Nostr event is required");
	const event = value as Partial<NostrEvent>;
	if (!validActor(event.pubkey) || event.kind !== expectedKind || !Number.isInteger(event.created_at)
		|| Math.abs(now() - Number(event.created_at)) > 300 || !Array.isArray(event.tags)
		|| typeof event.content !== "string" || !/^[0-9a-f]{64}$/.test(event.id ?? "")
		|| !/^[0-9a-f]{128}$/.test(event.sig ?? "")) throw new Error("invalid bounded Nostr event");
	const id = event.id as string;
	const sig = event.sig as string;
	const canonical = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
	if (sha256(canonical) !== id || !schnorr.verify(hexToBytes(sig), hexToBytes(id), hexToBytes(event.pubkey))) {
		throw new Error("Nostr signature verification failed");
	}
	return event as NostrEvent;
}

function parseContent(event: NostrEvent): Record<string, unknown> {
	const value = JSON.parse(event.content) as unknown;
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("event content must be an object");
	return value as Record<string, unknown>;
}

function receiptDigest(receipt: Omit<CashuReceipt, "signature">): Uint8Array {
	return hexToBytes(sha256(JSON.stringify([
		receipt.schema, receipt.mint_url, receipt.auction_id, receipt.bidder, receipt.amount,
		receipt.operation_id, receipt.token_sha256, receipt.committee_public_key,
		receipt.refund_public_key, receipt.locktime,
	])));
}

function reservationReceiptDigest(receipt: Omit<ReservationReceipt, "signature">): Uint8Array {
	return hexToBytes(sha256(JSON.stringify([
		receipt.schema, receipt.mint_url, receipt.auction_id, receipt.bidder, receipt.amount,
		receipt.reservation_id, receipt.replaces_reservation_id, receipt.expires_at, receipt.committee_public_key,
	])));
}

function json(value: unknown, status = 200): Response {
	return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

async function body(request: Request): Promise<unknown> {
	const length = Number(request.headers.get("content-length") ?? "0");
	if (length > MAX_BODY) throw new Error("request body is too large");
	return request.json();
}

async function consensusState(actor: string): Promise<any> {
	const response = await fetch(`${CONSENSUS}/api/state?actor=${actor}`);
	if (!response.ok) throw new Error(`consensus state HTTP ${response.status}`);
	return response.json();
}

const committee = await newWallet(committeeSeed, loaded !== null, "committee");

async function reconcileLedger(view: any): Promise<void> {
	let changed = fridayLedger.expireUncommitted(Number(view?.state?.last_consensus_time ?? now())).length > 0;
	const committed = view?.state?.custody_reservations ?? {};
	for (const [id, chainValue] of Object.entries(committed) as [string, any][]) {
		let local = fridayLedger.reservation(id);
		if (local === null) throw new Error(`committed reservation ${id} is absent from coordinator custody`);
		if (local.status === "proposed") {
			fridayLedger.commit(id, String(chainValue.bid_id)); changed = true; local = fridayLedger.reservation(id)!;
		}
		if (chainValue.status === "release_entitled" && local.status === "reserved") {
			fridayLedger.releaseEntitlement(id); changed = true; local = fridayLedger.reservation(id)!;
		}
		if (chainValue.status === "release_entitled" && local.status === "release_entitled") {
			fridayLedger.release(id); changed = true; local = fridayLedger.reservation(id)!;
		}
		if (chainValue.status === "payout_entitled" && local.status === "reserved") {
			fridayLedger.payoutEntitlement(id); changed = true; local = fridayLedger.reservation(id)!;
		}
		if (chainValue.status === "payout_entitled" && local.status === "payout_entitled") {
			const auction = view?.state?.auctions?.[chainValue.auction_id];
			if (!validActor(auction?.seller)) throw new Error(`payout reservation ${id} has no valid seller`);
			if (fridayLedger.payment(`payout-${chainValue.auction_id}`) === null) {
				fridayLedger.preparePayment({ id: `payout-${chainValue.auction_id}`, reservationId: id, recipient: auction.seller }); changed = true;
			}
		}
	}
	if (changed) await persistCheckpoint();
}

async function drainPayment(paymentId: string): Promise<void> {
	let payment = fridayLedger.payment(paymentId);
	if (payment === null || payment.status === "paid" || payment.status === "failed") return;
	const sender = await wallet(payment.sender);
	const recipient = await wallet(payment.recipient);
	if (payment.status === "prepared") {
		fridayLedger.markSending(payment.id, await sender.balance(), await recipient.balance()); await persistCheckpoint();
		await hitFailpoint("payment_after_intent");
		payment = fridayLedger.payment(payment.id)!;
	}
	if (payment.status === "sending" || (payment.status === "unknown" && payment.token === undefined)) {
		try {
			await sender.ensureMint();
			// The app intent is already durable. Coco now durably reserves the exact inputs under the same operation
			// identity before any mint I/O; retry joins that intent, and resume replays only Coco's persisted request.
			await sender.rail.prepareSendOperation({ mintUrl: MINT, amount: payment.amount, operationId: payment.sendOperationId });
			await hitFailpoint("payment_after_send_prepare");
			const sent = await sender.rail.resumeSendOperation({ mintUrl: MINT, amount: payment.amount, operationId: payment.sendOperationId });
			await hitFailpoint("payment_after_send_result");
			const token = sent.token;
			if (token === undefined) throw new Error("exact outgoing token is not recoverable by operation identity");
			fridayLedger.checkpointToken(payment.id, token, await sender.balance()); await persistCheckpoint();
		} catch (error) {
			fridayLedger.markUnknown(payment.id, error instanceof Error ? error.message : String(error), await sender.balance()); await persistCheckpoint();
			return;
		}
		payment = fridayLedger.payment(payment.id)!;
	}
	if (payment.status === "unknown") {
		const recovered = payment.token ?? (await sender.rail.lockedToken({ operationId: payment.sendOperationId }))?.token;
		if (recovered === undefined) return;
		fridayLedger.checkpointToken(payment.id, recovered, await sender.balance()); await persistCheckpoint();
		payment = fridayLedger.payment(payment.id)!;
	}
	if (payment.status === "token_checkpointed") {
		fridayLedger.markReceiving(payment.id); await persistCheckpoint();
		payment = fridayLedger.payment(payment.id)!;
	}
	if (payment.status === "receiving") {
		try {
			await recipient.ensureMint();
			if (payment.recipientBeforeBalance === undefined) throw new Error("payout recovery balance is missing");
			const before = await recipient.balance();
			if (before !== payment.recipientBeforeBalance+payment.amount) {
				if (payment.token === undefined) throw new Error("checkpointed payout token is missing");
				const received = await recipient.rail.receive({ token: payment.token, operationId: payment.receiveOperationId });
				if (received.state !== "finalized") throw new Error(`seller receive is not finalized: ${received.state}`);
			}
			const after = await recipient.balance();
			if (after !== payment.recipientBeforeBalance+payment.amount) throw new Error("seller wallet did not receive the exact payout amount");
			await hitFailpoint("payment_after_receive_result");
			fridayLedger.markPaid(payment.id); await persistCheckpoint();
		} catch (error) {
			fridayLedger.markUnknown(payment.id, error instanceof Error ? error.message : String(error), payment.senderBalanceObserved ?? await sender.balance()); await persistCheckpoint();
		}
	}
}

async function runFridayWorker(): Promise<void> {
	let view = await consensusState("");
	const consensusTime = Number(view?.state?.last_consensus_time ?? 0);
	for (const auction of Object.values(view?.state?.auctions ?? {}) as any[]) {
		if (auction?.status === "open" && consensusTime >= Number(auction.end_time)) {
			const response = await fetch(`${CONSENSUS}/api/close`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ auction_id: auction.id }) });
			if (!response.ok && response.status !== 422) throw new Error(`automatic close HTTP ${response.status}`);
		}
	}
	view = await consensusState("");
	await reconcileLedger(view);
	const blocked = new Set<string>();
	for (const payment of fridayLedger.snapshot().payments) {
		if (payment.status === "paid" || payment.status === "failed") continue;
		if (blocked.has(payment.sender) || blocked.has(payment.recipient)
			|| fridayFunding.pending(payment.sender).length !== 0 || fridayFunding.pending(payment.recipient).length !== 0) continue;
		await walletSerializers.run(payment.sender, async () => walletSerializers.run(payment.recipient, async () => drainPayment(payment.id)));
		const after = fridayLedger.payment(payment.id);
		if (after !== null && after.status !== "paid" && after.status !== "failed") {
			blocked.add(after.sender); blocked.add(after.recipient);
		}
	}
}

async function handleWallet(url: URL): Promise<Response> {
	const actor = url.searchParams.get("actor");
	if (!validActor(actor)) return json({ error: "actor must be a lowercase 32-byte Nostr public key" }, 400);
	const view = await consensusState(actor);
	await reconcileLedger(view);
	const current = await wallet(actor);
	const observed = await current.balances();
	const availableBacking = fridayFunding.availableBacking(actor, observed.spendable);
	const withheldFunding = observed.spendable-availableBacking;
	const effectiveTotal = observed.total-withheldFunding;
	const conservation = fridayLedger.conservation(actor, effectiveTotal, availableBacking);
	const fundingPending = fridayFunding.pending(actor);
	const actorLocks = [...locks.values()].filter((lock) => lock.actor === actor).map((lock) => ({
		auction_id: lock.auctionId, amount: lock.amount, token_sha256: lock.tokenHash,
		locktime: lock.locktime, status: lock.status, refundable_now: lock.status === "locked" && now() > lock.locktime,
	}));
	const reservations = fridayLedger.snapshot().reservations.filter((reservation) => reservation.actor === actor);
	const payments = fridayLedger.snapshot().payments
		.filter((payment) => payment.sender === actor || payment.recipient === actor)
		.map((payment) => ({ id: payment.id, reservation_id: payment.reservationId, direction: payment.sender === actor ? "outgoing" : "incoming",
			counterparty: payment.sender === actor ? payment.recipient : payment.sender, amount: payment.amount, status: payment.status,
			send_operation_id: payment.sendOperationId, receive_operation_id: payment.receiveOperationId }));
	return json({ actor, spendable: conservation.spendable, reserved: conservation.reserved, operation_locked: conservation.operationLocked, in_flight: conservation.inFlight,
		unknown: conservation.unknown, incoming_pending: conservation.incomingPending, backing: observed.total, wallet_spendable: observed.spendable, wallet_reserved: observed.reserved, available_backing: availableBacking,
		funding_pending: fundingPending.reduce((sum, record) => sum+record.amount, 0),
		conserved: conservation.conserved && fridayFunding.backingExact(actor, observed.spendable), reservations, payments,
		zero_pending: fridayLedger.zeroPending() && fundingPending.length === 0, locks: actorLocks,
		authority: "custodial-coco-v2-nutshell-fakewallet", reservation_authority: "application-ledger-not-mint-lock" });
}

async function handleGlobalConservation(): Promise<Response> {
	const funding = fridayFunding.snapshot();
	const effectiveBackings: Record<string, number> = {};
	const effectiveSpendables: Record<string, number> = {};
	let actualWalletBacking = 0;
	let actualWalletSpendable = 0;
	let actualWalletReserved = 0;
	let issued = Object.values(funding.grants).reduce((sum, amount) => sum+amount, 0);
	let fundingPending = 0;
	let fundingObservationsExact = true;
	for (const actor of [...walletSeeds.keys()].sort()) {
		const observed = await (await wallet(actor)).balances();
		actualWalletBacking += observed.total;
		actualWalletSpendable += observed.spendable;
		actualWalletReserved += observed.reserved;
		let availableTotal = observed.total;
		let availableSpendable = observed.spendable;
		const pending = fridayFunding.pending(actor);
		if (pending.length > 1) fundingObservationsExact = false;
		const record = pending[0];
		if (record !== undefined) {
			const movement = observed.spendable-record.beforeBalance;
			if (movement === record.amount) {
				availableTotal -= record.amount; availableSpendable -= record.amount; issued += record.amount; fundingPending += record.amount;
			} else if (movement !== 0) {
				fundingObservationsExact = false;
			}
		}
		effectiveBackings[actor] = availableTotal;
		effectiveSpendables[actor] = availableSpendable;
	}
	const conservation = fridayLedger.globalConservation(effectiveBackings, issued, fundingPending, effectiveSpendables);
	return json({ ...conservation, actual_wallet_backing: actualWalletBacking,
		actual_wallet_spendable: actualWalletSpendable, actual_wallet_reserved: actualWalletReserved,
		observationsExact: conservation.observationsExact && fundingObservationsExact,
		conserved: conservation.conserved && fundingObservationsExact,
		fees: { input_fee_ppk: committee.mintSnapshot()?.inputFeePpk ?? null, required: 0 },
		observation: "coordinator SQLite balances plus encrypted funding/payment journals" });
}

async function handleFaucet(request: Request): Promise<Response> {
	const event = verifyEvent(await body(request), 28643);
	const content = parseContent(event);
	if (content.action !== "faucet" || Object.keys(content).length !== 1) throw new Error("invalid faucet request");
	if (fridayLedger.hasPendingMutation(event.pubkey)) return json({ error: "the wallet has an unresolved payout operation" }, 409);
	return walletSerializers.run(event.pubkey, async () => {
		const current = await wallet(event.pubkey);
		let record = fridayFunding.record(event.id);
		if (record?.status === "finalized") {
			const backing = await current.balance();
			const view = fridayLedger.conservation(event.pubkey, backing);
			return json({ operation_id: record.operationId, state: "finalized", spendable: view.spendable, grant_total: fridayFunding.grant(event.pubkey) });
		}
		if (record === null) {
			try {
				record = fridayFunding.begin({ eventId: event.id, actor: event.pubkey, beforeBalance: await current.balance() });
			} catch (error) {
				if (error instanceof Error && error.message === "friday-funding-identity-cap") return json({ error: "faucet identity cap is 50,000 fake sats" }, 409);
				if (error instanceof Error && error.message === "friday-funding-pending-operation") return json({ error: "the prior faucet operation must be recovered before another grant" }, 409);
				throw error;
			}
			await persistCheckpoint();
		} else if (record.actor !== event.pubkey || record.amount !== FAUCET_AMOUNT) {
			throw new Error("faucet operation identity conflict");
		}
		try {
			await current.ensureMint();
			if (record.quoteId === undefined) {
				const candidates = await current.rail.listPendingMintQuotes({ mintUrl: MINT, amount: FAUCET_AMOUNT, unit: "sat" });
				if (candidates.length > 1) throw new Error("faucet quote recovery is ambiguous");
				const quote = candidates[0] ?? await current.rail.createMintQuote({ mintUrl: MINT, amount: FAUCET_AMOUNT, unit: "sat" });
				record = fridayFunding.attachQuote(event.id, quote.quoteId); await persistCheckpoint();
			}
			const quoteId = record.quoteId;
			if (quoteId === undefined) throw new Error("faucet quote identity is missing");
			let quote = await current.rail.refreshMintQuote({ mintUrl: MINT, quoteId });
			for (let attempt = 0; attempt < 40 && !["PAID", "ISSUED"].includes(quote.state); attempt += 1) {
				await new Promise((resolve) => setTimeout(resolve, 250));
				quote = await current.rail.refreshMintQuote({ mintUrl: MINT, quoteId });
			}
			if (!["PAID", "ISSUED"].includes(quote.state)) throw new Error("faucet quote did not become paid");
			if (record.operationId === undefined) {
				const operation = await current.rail.prepareMintOperation({ mintUrl: MINT, quoteId, amount: FAUCET_AMOUNT });
				record = fridayFunding.attachOperation(event.id, operation.operationId); await persistCheckpoint();
			}
			const operationId = record.operationId;
			if (operationId === undefined) throw new Error("faucet mint operation identity is missing");
			const operation = await current.rail.resumeMintOperation({ operationId, quoteId });
			await hitFailpoint("faucet_after_mint_before_persist");
			const after = await current.balance();
			if (operation.state !== "finalized" || after !== record.beforeBalance+FAUCET_AMOUNT) throw new Error("test mint did not finalize the exact faucet amount");
			faucetActors.add(event.pubkey);
			record = fridayFunding.finalize(event.id, after); await persistCheckpoint();
			const view = fridayLedger.conservation(event.pubkey, after);
			return json({ operation_id: operation.operationId, state: operation.state, spendable: view.spendable, grant_total: fridayFunding.grant(event.pubkey) });
		} catch (error) {
			fridayFunding.markUnknown(event.id, error instanceof Error ? error.message : String(error)); await persistCheckpoint();
			throw error;
		}
	});
}

async function handleReserve(request: Request): Promise<Response> {
	const event = verifyEvent(await body(request), 28644);
	const content = parseContent(event);
	const auctionId = content.auction_id;
	const amount = content.amount;
	if (typeof auctionId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(auctionId)
		|| !Number.isSafeInteger(amount) || Number(amount) <= 0 || Object.keys(content).length !== 2) throw new Error("invalid reservation request");
	return walletSerializers.run(event.pubkey, async () => {
		const view = await consensusState(event.pubkey);
		await reconcileLedger(view);
		const auction = view?.state?.auctions?.[auctionId];
		const consensusTime = Number(view?.state?.last_consensus_time ?? 0);
		const minimum = auction?.leader_bid_id ? Number(auction.high_bid) + Number(auction.min_increment || 100) : Number(auction?.starting_bid);
		if (auction?.status !== "open" || auction.funding_mode !== "custodial_reservation_v1" || auction.seller === event.pubkey || consensusTime >= Number(auction.end_time)
			|| Number(amount) < minimum) throw new Error("auction does not accept this reservation-backed bid");
		const priorBid = auction.leader_bid_id ? view?.state?.bids?.[auction.leader_bid_id] : null;
		const replaces = priorBid?.bidder === event.pubkey && typeof priorBid?.reservation_id === "string" ? priorBid.reservation_id : "";
		const current = await wallet(event.pubkey);
		const backing = await current.balance();
		if (!fridayFunding.backingExact(event.pubkey, backing)) throw new Error("wallet funding recovery is ambiguous; reservations are disabled");
		const availableBacking = fridayFunding.availableBacking(event.pubkey, backing);
		const reservationId = `reserve-${event.id}`;
		const expiresAt = consensusTime + RESERVATION_TTL_SECONDS;
		fridayLedger.propose({ id: reservationId, actor: event.pubkey, auctionId, amount: Number(amount),
			replacesReservationId: replaces, expiresAt, now: consensusTime, walletBacking: availableBacking });
		await persistCheckpoint();
		const unsigned: Omit<ReservationReceipt, "signature"> = {
			schema: "PlebeianAuctionsPOCCustodyReservationV1", mint_url: MINT, auction_id: auctionId,
			bidder: event.pubkey, amount: Number(amount), reservation_id: reservationId,
			replaces_reservation_id: replaces, expires_at: expiresAt, committee_public_key: committeePublic,
		};
		const receipt: ReservationReceipt = { ...unsigned, signature: bytesToHex(schnorr.sign(reservationReceiptDigest(unsigned), committeeSecret)) };
		const conservation = fridayLedger.conservation(event.pubkey, availableBacking);
		return json({ receipt, spendable: conservation.spendable, reserved: conservation.reserved,
			funding: "custodial-reservation-not-mint-lock" });
	});
}

async function handleLock(request: Request): Promise<Response> {
	const event = verifyEvent(await body(request), 28644);
	if (fridayLedger.hasPendingMutation(event.pubkey) || fridayFunding.pending(event.pubkey).length !== 0) throw new Error("wallet has an unresolved Friday payment or funding operation");
	const content = parseContent(event);
	const auctionId = content.auction_id;
	const amount = content.amount;
	if (typeof auctionId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(auctionId)
		|| !Number.isSafeInteger(amount) || Number(amount) <= 0 || Object.keys(content).length !== 2) throw new Error("invalid lock request");
	const view = await consensusState(event.pubkey);
	const auction = view?.state?.auctions?.[auctionId];
	if (auction?.status !== "open" || auction.funding_mode !== "legacy" || auction.seller === event.pubkey || now() >= auction.end_time
		|| Number(amount) < auction.starting_bid || Number(amount) <= auction.high_bid) throw new Error("auction does not accept this bid");
	const current = await wallet(event.pubkey);
	await current.ensureMint();
	const refund = await current.rail.generateLockKeypair();
	const operationId = `bid-${event.id}`;
	const locktime = Number(auction.end_time) + SETTLEMENT_GRACE_SECONDS;
	const sent = await current.rail.sendLockedP2pk({ mintUrl: MINT, amount: Number(amount), operationId,
		lock: { childPubkey: committeePublic, refundPubkey: refund.pubkey, locktime } });
	// A handed-out locked token remains Coco `pending` until one of its mint
	// spending branches wins. `finalized` here would incorrectly imply that the
	// winner/refund spend already happened.
	if (sent.state !== "pending") throw new Error(`Coco lock did not enter the exact pending state: ${sent.state}`);
	const material = await current.rail.lockedToken({ operationId });
	if (material === null) throw new Error("Coco did not read back the mint-signed lock");
	const tokenHash = sha256(material.token);
	if (locks.has(tokenHash)) throw new Error("Cashu token digest replay");
	const unsigned: Omit<CashuReceipt, "signature"> = {
		schema: "PlebeianAuctionsPOCCashuLockV1", mint_url: MINT, auction_id: auctionId,
		bidder: event.pubkey, amount: Number(amount), operation_id: operationId, token_sha256: tokenHash,
		committee_public_key: committeePublic, refund_public_key: refund.pubkey, locktime,
	};
	const receipt: CashuReceipt = { ...unsigned, signature: bytesToHex(schnorr.sign(receiptDigest(unsigned), committeeSecret)) };
	locks.set(tokenHash, { actor: event.pubkey, auctionId, amount: Number(amount), operationId, token: material.token,
		tokenHash, refundSecret: refund.secretKey, refundPublic: refund.pubkey, locktime, receipt, status: "locked" });
	await persistCheckpoint();
	return json({ receipt, spendable: await current.balance() });
}

async function handleRefund(request: Request): Promise<Response> {
	const event = verifyEvent(await body(request), 28646);
	if (fridayLedger.hasPendingMutation(event.pubkey) || fridayFunding.pending(event.pubkey).length !== 0) throw new Error("wallet has an unresolved Friday payment or funding operation");
	const content = parseContent(event);
	const tokenHash = content.token_sha256;
	if (typeof tokenHash !== "string" || !/^[0-9a-f]{64}$/.test(tokenHash) || Object.keys(content).length !== 1) throw new Error("invalid refund request");
	const lock = locks.get(tokenHash);
	if (lock === undefined || lock.actor !== event.pubkey || lock.status !== "locked") throw new Error("refund lock is unavailable");
	if (now() <= lock.locktime) return json({ error: "mint timelock has not expired" }, 409);
	const current = await wallet(event.pubkey);
	await current.ensureMint();
	const result = await current.rail.redeemP2pk({ mintUrl: MINT, token: lock.token, secretKey: lock.refundSecret,
		operationId: `refund-${event.id}` });
	if (result.state !== "finalized") throw new Error(`Cashu refund was not finalized: ${result.state}`);
	lock.status = "refunded";
	await persistCheckpoint();
	return json({ operation_id: result.operationId, state: result.state, spendable: await current.balance() });
}

async function handleSettle(request: Request): Promise<Response> {
	const event = verifyEvent(await body(request), 28645);
	if (fridayLedger.hasPendingMutation(event.pubkey) || fridayFunding.pending(event.pubkey).length !== 0) throw new Error("wallet has an unresolved Friday payment or funding operation");
	const content = parseContent(event);
	const auctionId = content.auction_id;
	if (typeof auctionId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(auctionId) || Object.keys(content).length !== 1) throw new Error("invalid settlement request");
	const prior = settledAuctions.get(auctionId);
	if (prior !== undefined) return json({ ...prior, state: "already_settled" });
	const view = await consensusState(event.pubkey);
	const auction = view?.state?.auctions?.[auctionId];
	if (auction?.status !== "closed" || auction.seller !== event.pubkey || typeof auction.leader_bid_id !== "string") throw new Error("only the seller can settle a consensus-closed auction");
	const bid = view?.state?.bids?.[auction.leader_bid_id];
	if (auction.winner !== bid?.bidder || typeof bid?.cashu_token_sha256 !== "string") throw new Error("consensus has no Cashu-backed winner");
	const lock = locks.get(bid.cashu_token_sha256);
	if (lock === undefined || lock.status !== "locked" || lock.auctionId !== auctionId || lock.actor !== auction.winner
		|| lock.amount !== bid.amount) throw new Error("coordinator does not hold the exact consensus winner lock");
	if (await committee.balance() < lock.amount) {
		await committee.ensureMint();
		const redeemed = await committee.rail.redeemP2pk({ mintUrl: MINT, token: lock.token, secretKey: rawCommittee,
			operationId: `winner-${auctionId}` });
		if (redeemed.state !== "finalized") throw new Error(`winner redeem was not finalized: ${redeemed.state}`);
	}
	await committee.ensureMint();
	const payout = await committee.rail.send({ mintUrl: MINT, amount: lock.amount, operationId: `payout-${auctionId}` });
	if (payout.token === undefined) throw new Error("seller payout produced no Cashu token");
	const seller = await wallet(event.pubkey);
	await seller.ensureMint();
	const received = await seller.rail.receive({ token: payout.token, operationId: `seller-${auctionId}` });
	if (received.state !== "finalized") throw new Error(`seller receive was not finalized: ${received.state}`);
	lock.status = "settled";
	const result = { seller: event.pubkey, amount: lock.amount, tokenSha256: lock.tokenHash };
	settledAuctions.set(auctionId, result);
	await persistCheckpoint();
	return json({ ...result, state: "finalized", spendable: await seller.balance() });
}

const server = Bun.serve({
	hostname: LISTEN_HOST,
	port: LISTEN_PORT,
	async fetch(request): Promise<Response> {
		const url = new URL(request.url);
		try {
			if (request.method === "GET" && url.pathname === "/health") {
				const mint = committee.mintSnapshot();
				return json({ status: mint?.inputFeePpk === 0 ? "ok" : "mint_unverified", mint_url: MINT, committee_public_key: committeePublic,
					checkpoint: "encrypted-intent-plus-sqlite-coco-repositories", state_loaded: loaded !== null, wallets_persistent: true,
					friday_worker_paused: FRIDAY_WORKER_PAUSED,
					mint_snapshot: mint === null ? null : { active_sat_keyset_id: mint.activeSatKeysetId, input_fee_ppk: mint.inputFeePpk,
						server_version: mint.serverVersion, nuts: mint.nuts } });
			}
			if (request.method === "GET" && url.pathname === "/api/cashu/wallet") return await serialized(() => handleWallet(url));
			if (request.method === "GET" && url.pathname === "/api/cashu/conservation") return await serialized(handleGlobalConservation);
			if (request.method === "POST" && url.pathname === "/api/cashu/faucet") return await serialized(() => handleFaucet(request));
			if (request.method === "POST" && url.pathname === "/api/cashu/reserve") return await serialized(() => handleReserve(request));
			if (request.method === "POST" && url.pathname === "/api/cashu/lock") return await serialized(() => handleLock(request));
			if (request.method === "POST" && url.pathname === "/api/cashu/refund") return await serialized(() => handleRefund(request));
			if (request.method === "POST" && url.pathname === "/api/cashu/settle") return await serialized(() => handleSettle(request));
			return json({ error: "not found" }, 404);
		} catch (error) {
			return json({ error: error instanceof Error ? error.message : String(error) }, 422);
		}
	},
});

console.log(JSON.stringify({ event: "cashu_coordinator_ready", listen: server.url.origin, mint_url: MINT,
	committee_public_key: committeePublic, checkpoint: STATE_PATH,
	warning: "single POC custodian with encrypted intent checkpoint and restricted SQLite Coco repositories; NOT FROST or threshold custody" }));

const fridayWorker = FRIDAY_WORKER_PAUSED ? null : setInterval(() => {
	void serialized(runFridayWorker).catch((error) => console.error(JSON.stringify({ event: "friday_worker_blocked", error: error instanceof Error ? error.message : String(error) })));
}, FRIDAY_WORKER_INTERVAL_MS);

async function shutdown(): Promise<void> {
	if (fridayWorker !== null) clearInterval(fridayWorker);
	server.stop(true);
	await Promise.all([...wallets.values(), Promise.resolve(committee)].map(async (current) => {
		const wallet = await current;
		await wallet.manager.dispose();
		wallet.database.close();
	}));
	process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
