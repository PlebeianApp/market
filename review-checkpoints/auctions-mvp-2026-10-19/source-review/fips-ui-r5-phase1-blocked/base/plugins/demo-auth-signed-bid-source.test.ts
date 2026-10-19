import { expect, test } from "bun:test";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import { decodeCommittedBidBatch } from "./committed-bid-consumer.ts";
import { DemoAuthSignedBidStoreV2Source, OwnerLocalR4SignedEventExportV1Source } from "./demo-auth-signed-bid-source.ts";
import type { DemoUnsignedEvent } from "../ts/demo-auth-bid.ts";

const privateKey = "02".padStart(64, "0");
const actor = bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey)));
const network = "ab".repeat(32);
const operationId = "da1o:actual-store-join";
const bidId = "da1b:actual-store-join";
const content = JSON.stringify({ version: 1, type: "bid", operation_id: operationId, auction_id: "auction-1", bid_id: bidId, amount: 8, reservations: [{ reservation_id: "cd".repeat(32), amount: 8 }] });
const unsigned: DemoUnsignedEvent = { pubkey: actor, created_at: 1_900_000_000, kind: 28642, tags: [["protocol", "plebeian-auction-auth-demo"], ["version", "1"], ["environment", network], ["valid_until", "1900000300"]], content };
const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content]))));
const signedEvent = { ...unsigned, id, sig: bytesToHex(schnorr.sign(hexToBytes(id), hexToBytes(privateKey))) };
const context = { authNetworkId: network, chainId: "chain-1", auctionId: "auction-1", sessionSubmissionCap: 20, maxFreshBidsPerHeight: 5 };
const record = {
  schema: "DemoAuthSignedBidRecordV2", profileId: "bidder", storageNamespace: "bidder-scope", actorPubkey: actor,
  amount: 8, observedHeight: 2, intentNonce: "ef".repeat(32), canonicalIntent: "canonical-intent",
  intentDigest: "12".repeat(32), operationId, bidId, reservationId: "cd".repeat(32), canonicalContent: content,
  unsignedEvent: unsigned, signedEvent, submissionAttempted: true, state: "committed", revision: 2,
  committedHeight: 2, committedAppHash: "34".repeat(32),
};
const envelope = { schema: "DemoAuthSignedBidStoreV2", ...context, records: [record] };
const storageKey = `demo-auth-signed:v2:${encodeURIComponent(network)}:${encodeURIComponent(context.chainId)}:${encodeURIComponent(context.auctionId)}`;

function source(value: unknown = envelope): DemoAuthSignedBidStoreV2Source {
  return new DemoAuthSignedBidStoreV2Source({ getItem(key) { return key === storageKey ? JSON.stringify(value) : null; } }, context);
}

test("exact-joins an actual CommittedAuctionBatchV2 entry to DemoAuthSignedBidStoreV2.signedEvent", async () => {
  const batch = decodeCommittedBidBatch(JSON.stringify({
    schema: "CommittedAuctionBatchV2", auth_profile: "DEMO_AUTH_V1", auth_network_id: network, chain_id: "chain-1",
    height: 2, pbts_seconds: 1_900_000_010, app_hash: "34".repeat(32),
    bids: [{ actor_id: actor, operation_id: operationId, auction_id: "auction-1", bid_id: bidId, event_id: id, amount: 8, displaced_refund_eligible: false }], closures: [],
  }));
  const bid = batch.bids[0]!;
  await expect(source().readExact({ operationId: bid.operation_id, bidId: bid.bid_id, eventId: bid.event_id, actorId: bid.actor_id, amount: bid.amount })).resolves.toEqual(signedEvent);
});

test("missing export/store returns null and any partial identity or event mutation fails closed", async () => {
  const missing = new DemoAuthSignedBidStoreV2Source({ getItem() { return null; } }, context);
  await expect(missing.readExact({ operationId, bidId, eventId: id, actorId: actor, amount: 8 })).resolves.toBeNull();
  await expect(source().readExact({ operationId, bidId, eventId: "ff".repeat(32), actorId: actor, amount: 8 })).rejects.toThrow("join-conflict");
  await expect(source({ ...envelope, records: [{ ...record, signedEvent: { ...signedEvent, content: `${content} ` } }] }).readExact({ operationId, bidId, eventId: id, actorId: actor, amount: 8 })).rejects.toThrow();
});

test("a valid signature over a different bid command cannot be joined through mutable record columns", async () => {
  const otherContent = JSON.stringify({ version: 1, type: "bid", operation_id: "da1o:other", auction_id: "auction-1", bid_id: "da1b:other", amount: 9, reservations: [{ reservation_id: "dc".repeat(32), amount: 9 }] });
  const otherUnsigned: DemoUnsignedEvent = { ...unsigned, content: otherContent };
  const otherId = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, otherUnsigned.pubkey, otherUnsigned.created_at, otherUnsigned.kind, otherUnsigned.tags, otherUnsigned.content]))));
  const otherSigned = { ...otherUnsigned, id: otherId, sig: bytesToHex(schnorr.sign(hexToBytes(otherId), hexToBytes(privateKey))) };
  const alteredRecord = { ...record, canonicalContent: otherContent, unsignedEvent: otherUnsigned, signedEvent: otherSigned };
  await expect(source({ ...envelope, records: [alteredRecord] }).readExact({ operationId, bidId, eventId: otherId, actorId: actor, amount: 8 })).rejects.toThrow("command-join");
});

test("exact raw signed-event export verifies and joins without browser storage", async () => {
  const raw = JSON.stringify({
    schema: "OwnerLocalR4SignedEventExportV1", auth_network_id: network, chain_id: context.chainId,
    auction_id: context.auctionId, records: [{ committed_event_id: id, signed_event: signedEvent }],
  });
  const exported = new OwnerLocalR4SignedEventExportV1Source(raw, context);
  await expect(exported.readExact({ operationId, bidId, eventId: id, actorId: actor, amount: 8 })).resolves.toEqual(signedEvent);
  await expect(exported.readExact({ operationId: "missing", bidId: "missing", eventId: "ff".repeat(32), actorId: actor, amount: 8 })).resolves.toBeNull();
});

test("raw signed-event export refuses missing, conflicting, and mutated exact joins", async () => {
  const exported = (records: unknown[]) => new OwnerLocalR4SignedEventExportV1Source(JSON.stringify({
    schema: "OwnerLocalR4SignedEventExportV1", auth_network_id: network, chain_id: context.chainId,
    auction_id: context.auctionId, records,
  }), context);
  await expect(exported([]).readExact({ operationId, bidId, eventId: id, actorId: actor, amount: 8 })).resolves.toBeNull();
  expect(() => exported([{ committed_event_id: "ff".repeat(32), signed_event: signedEvent }])).toThrow("event");
  const mutated = { ...signedEvent, content: `${signedEvent.content} ` };
  expect(() => exported([{ committed_event_id: id, signed_event: mutated }])).toThrow();
  expect(() => exported([
    { committed_event_id: id, signed_event: signedEvent },
    { committed_event_id: id, signed_event: signedEvent },
  ])).toThrow("operation-conflict");
});
