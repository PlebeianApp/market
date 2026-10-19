/**
 * Read-only adapter for the actual R4 browser `DemoAuthSignedBidStoreV2` envelope.
 *
 * The browser adapter reads the same-origin UI store. The offline adapter reads the exact
 * `OwnerLocalR4SignedEventExportV1` emitted by auction-signed-event-tool. Both return an event
 * only when every committed identity field exact-joins. Neither carries Cashu bearer material
 * or payment authority.
 */
import { verifyDemoAuthEventId } from "../../cashu-wrapper/ts/index.ts";
import {
  parseStrictJSON,
  verifySignedBidTemplate,
  type DemoSignedEvent,
  type DemoUnsignedEvent,
} from "../ts/demo-auth-bid.ts";

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;
const RECORD_STATES = new Set([
  "awaiting_signature", "signed", "submitted", "committed", "leading", "outbid",
  "closed_winner", "closed_no_sale", "attention_required",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required = allowed): boolean {
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key)) && required.every((key) => keys.includes(key));
}

function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function canonicalBidContent(raw: string): {
  operation_id: string;
  auction_id: string;
  bid_id: string;
  amount: number;
} {
  let value: unknown;
  try { value = parseStrictJSON(raw); } catch { throw new Error("demo-auth-signed-source-command"); }
  const keys = ["version", "type", "operation_id", "auction_id", "bid_id", "amount", "reservations"] as const;
  if (!record(value) || !exactKeys(value, keys) || value.version !== 1 || value.type !== "bid"
    || !text(value.operation_id) || !text(value.auction_id) || !text(value.bid_id) || !positive(value.amount)
    || !Array.isArray(value.reservations) || value.reservations.length === 0) {
    throw new Error("demo-auth-signed-source-command");
  }
  const reservations = value.reservations.map((entry) => {
    if (!record(entry) || !exactKeys(entry, ["reservation_id", "amount"])
      || typeof entry.reservation_id !== "string" || !HEX_64.test(entry.reservation_id)
      || !positive(entry.amount)) throw new Error("demo-auth-signed-source-command");
    return { reservation_id: entry.reservation_id, amount: entry.amount };
  });
  if (new Set(reservations.map((entry) => entry.reservation_id)).size !== reservations.length
    || reservations.reduce((sum, entry) => sum + entry.amount, 0) !== value.amount
    || JSON.stringify(value) !== raw) throw new Error("demo-auth-signed-source-command");
  return { operation_id: value.operation_id, auction_id: value.auction_id, bid_id: value.bid_id, amount: value.amount };
}

const EVENT_KEYS = ["pubkey", "created_at", "kind", "tags", "content", "id", "sig"] as const;
const UNSIGNED_EVENT_KEYS = ["pubkey", "created_at", "kind", "tags", "content"] as const;
const ENVELOPE_KEYS = [
  "schema", "authNetworkId", "chainId", "auctionId", "sessionSubmissionCap",
  "maxFreshBidsPerHeight", "records",
] as const;
const REQUIRED_RECORD_KEYS = [
  "schema", "profileId", "storageNamespace", "actorPubkey", "amount", "observedHeight",
  "intentNonce", "canonicalIntent", "intentDigest", "operationId", "bidId", "reservationId",
  "canonicalContent", "unsignedEvent", "submissionAttempted", "state", "revision",
] as const;
const OPTIONAL_RECORD_KEYS = [
  "signedEvent", "slot", "slotReservationId", "committedHeight", "committedAppHash",
] as const;

export interface DemoAuthSignedBidStoreV2Storage {
  getItem(key: string): string | null;
}

export interface DemoAuthSignedBidStoreV2Context {
  readonly authNetworkId: string;
  readonly chainId: string;
  readonly auctionId: string;
  readonly sessionSubmissionCap: number;
  readonly maxFreshBidsPerHeight: number;
}

export interface DemoAuthSignedBidExactQuery {
  readonly operationId: string;
  readonly bidId: string;
  readonly eventId: string;
  readonly actorId: string;
  readonly amount: number;
}

export interface DemoAuthSignedBidExactSource {
  readExact(query: DemoAuthSignedBidExactQuery): Promise<DemoSignedEvent | null>;
  /** Present for immutable exports whose complete record set is known. */
  exactRecordCount?(): number;
}

export class DemoAuthSignedBidStoreV2Source {
  private readonly storageKey: string;

  constructor(
    private readonly storage: DemoAuthSignedBidStoreV2Storage,
    private readonly context: DemoAuthSignedBidStoreV2Context,
  ) {
    if (!HEX_64.test(context.authNetworkId) || !text(context.chainId) || !text(context.auctionId)
      || !positive(context.sessionSubmissionCap) || !positive(context.maxFreshBidsPerHeight)) {
      throw new Error("demo-auth-signed-source-context");
    }
    this.storageKey = `demo-auth-signed:v2:${encodeURIComponent(context.authNetworkId)}:${encodeURIComponent(context.chainId)}:${encodeURIComponent(context.auctionId)}`;
  }

  location(): string { return this.storageKey; }

  async readExact(query: DemoAuthSignedBidExactQuery): Promise<DemoSignedEvent | null> {
    if (!text(query.operationId) || !text(query.bidId) || !HEX_64.test(query.eventId)
      || !HEX_64.test(query.actorId) || !positive(query.amount)) throw new Error("demo-auth-signed-source-query");
    const raw = this.storage.getItem(this.storageKey);
    if (raw === null) return null;
    if (new TextEncoder().encode(raw).byteLength > 262_144) throw new Error("demo-auth-signed-source-size");
    let value: unknown;
    try { value = parseStrictJSON(raw); } catch { throw new Error("demo-auth-signed-source-corrupt"); }
    if (!record(value) || !exactKeys(value, ENVELOPE_KEYS)
      || value.schema !== "DemoAuthSignedBidStoreV2"
      || value.authNetworkId !== this.context.authNetworkId
      || value.chainId !== this.context.chainId
      || value.auctionId !== this.context.auctionId
      || value.sessionSubmissionCap !== this.context.sessionSubmissionCap
      || value.maxFreshBidsPerHeight !== this.context.maxFreshBidsPerHeight
      || !Array.isArray(value.records) || value.records.length > this.context.sessionSubmissionCap) {
      throw new Error("demo-auth-signed-source-context");
    }

    let match: DemoSignedEvent | null = null;
    const operations = new Set<string>();
    for (const candidate of value.records) {
      if (!record(candidate)
        || !exactKeys(candidate, [...REQUIRED_RECORD_KEYS, ...OPTIONAL_RECORD_KEYS], REQUIRED_RECORD_KEYS)
        || candidate.schema !== "DemoAuthSignedBidRecordV2"
        || !text(candidate.profileId) || !text(candidate.storageNamespace)
        || typeof candidate.actorPubkey !== "string" || !HEX_64.test(candidate.actorPubkey)
        || !positive(candidate.amount) || !positive(candidate.observedHeight)
        || typeof candidate.intentNonce !== "string" || !HEX_64.test(candidate.intentNonce)
        || !text(candidate.canonicalIntent)
        || typeof candidate.intentDigest !== "string" || !HEX_64.test(candidate.intentDigest)
        || !text(candidate.operationId) || !text(candidate.bidId)
        || typeof candidate.reservationId !== "string" || !HEX_64.test(candidate.reservationId)
        || !text(candidate.canonicalContent)
        || !record(candidate.unsignedEvent)
        || typeof candidate.submissionAttempted !== "boolean"
        || typeof candidate.state !== "string" || !RECORD_STATES.has(candidate.state)
        || !positive(candidate.revision)) throw new Error("demo-auth-signed-source-record");
      if (operations.has(candidate.operationId)) throw new Error("demo-auth-signed-source-operation-conflict");
      operations.add(candidate.operationId);
      if (!exactKeys(candidate.unsignedEvent, UNSIGNED_EVENT_KEYS)) throw new Error("demo-auth-signed-source-event");
      const mentions = candidate.operationId === query.operationId || candidate.bidId === query.bidId
        || (record(candidate.signedEvent) && candidate.signedEvent.id === query.eventId);
      if (!mentions) continue;
      if (!record(candidate.signedEvent) || !exactKeys(candidate.signedEvent, EVENT_KEYS)
        || candidate.operationId !== query.operationId || candidate.bidId !== query.bidId
        || candidate.actorPubkey !== query.actorId || candidate.amount !== query.amount
        || candidate.signedEvent.id !== query.eventId || candidate.signedEvent.pubkey !== query.actorId
        || candidate.canonicalContent !== candidate.signedEvent.content
        || typeof candidate.signedEvent.sig !== "string" || !HEX_128.test(candidate.signedEvent.sig)) {
        throw new Error("demo-auth-signed-source-join-conflict");
      }
      const signed = structuredClone(candidate.signedEvent) as unknown as DemoSignedEvent;
      const unsigned = structuredClone(candidate.unsignedEvent) as unknown as DemoUnsignedEvent;
      await verifySignedBidTemplate(unsigned, signed);
      if (!verifyDemoAuthEventId(signed.sig, signed.id, signed.pubkey)) throw new Error("demo-auth-signed-source-signature");
      const command = canonicalBidContent(signed.content);
      if (command.operation_id !== query.operationId || command.auction_id !== this.context.auctionId
        || command.bid_id !== query.bidId || command.amount !== query.amount) {
        throw new Error("demo-auth-signed-source-command-join");
      }
      if (match !== null) throw new Error("demo-auth-signed-source-ambiguous");
      match = signed;
    }
    return match;
  }
}

/** Verification-only source for the exact offline raw signed-event export. */
export class OwnerLocalR4SignedEventExportV1Source implements DemoAuthSignedBidExactSource {
  private readonly records: readonly { readonly event: DemoSignedEvent; readonly command: ReturnType<typeof canonicalBidContent> }[];

  constructor(raw: string, context: DemoAuthSignedBidStoreV2Context) {
    if (!HEX_64.test(context.authNetworkId) || !text(context.chainId) || !text(context.auctionId)
      || !positive(context.sessionSubmissionCap) || !positive(context.maxFreshBidsPerHeight)) {
      throw new Error("demo-auth-signed-source-context");
    }
    if (new TextEncoder().encode(raw).byteLength > 262_144) throw new Error("demo-auth-signed-source-size");
    let value: unknown;
    try { value = parseStrictJSON(raw); } catch { throw new Error("demo-auth-signed-source-corrupt"); }
    const keys = ["schema", "auth_network_id", "chain_id", "auction_id", "records"] as const;
    if (!record(value) || !exactKeys(value, keys)
      || value.schema !== "OwnerLocalR4SignedEventExportV1"
      || value.auth_network_id !== context.authNetworkId || value.chain_id !== context.chainId
      || value.auction_id !== context.auctionId || !Array.isArray(value.records)
      || value.records.length > context.sessionSubmissionCap) throw new Error("demo-auth-signed-source-context");
    const operations = new Set<string>(); const bids = new Set<string>(); const events = new Set<string>();
    this.records = value.records.map((candidate) => {
      if (!record(candidate) || !exactKeys(candidate, ["committed_event_id", "signed_event"])
        || typeof candidate.committed_event_id !== "string" || !HEX_64.test(candidate.committed_event_id)
        || !record(candidate.signed_event) || !exactKeys(candidate.signed_event, EVENT_KEYS)) {
        throw new Error("demo-auth-signed-source-record");
      }
      const signed = structuredClone(candidate.signed_event) as unknown as DemoSignedEvent;
      if (signed.id !== candidate.committed_event_id || typeof signed.pubkey !== "string" || !HEX_64.test(signed.pubkey)
        || typeof signed.sig !== "string" || !HEX_128.test(signed.sig) || signed.kind !== 28642
        || !Number.isSafeInteger(signed.created_at) || signed.created_at < 0
        || JSON.stringify(signed.tags) !== JSON.stringify([
          ["protocol", "plebeian-auction-auth-demo"], ["version", "1"],
          ["environment", context.authNetworkId], signed.tags?.[3],
        ])
        || !Array.isArray(signed.tags?.[3]) || signed.tags[3]?.length !== 2 || signed.tags[3]?.[0] !== "valid_until"
        || !/^[1-9][0-9]{0,15}$/.test(signed.tags[3]?.[1] ?? "")) throw new Error("demo-auth-signed-source-event");
      const validUntil = Number(signed.tags[3]![1]);
      if (!Number.isSafeInteger(validUntil) || validUntil <= signed.created_at || validUntil > signed.created_at + 300) throw new Error("demo-auth-signed-source-event");
      const command = canonicalBidContent(signed.content);
      if (command.auction_id !== context.auctionId || operations.has(command.operation_id) || bids.has(command.bid_id) || events.has(signed.id)) throw new Error("demo-auth-signed-source-operation-conflict");
      operations.add(command.operation_id); bids.add(command.bid_id); events.add(signed.id);
      return { event: signed, command };
    });
  }

  async readExact(query: DemoAuthSignedBidExactQuery): Promise<DemoSignedEvent | null> {
    if (!text(query.operationId) || !text(query.bidId) || !HEX_64.test(query.eventId)
      || !HEX_64.test(query.actorId) || !positive(query.amount)) throw new Error("demo-auth-signed-source-query");
    let match: DemoSignedEvent | null = null;
    for (const record of this.records) {
      const mentions = record.command.operation_id === query.operationId || record.command.bid_id === query.bidId || record.event.id === query.eventId;
      if (!mentions) continue;
      if (record.command.operation_id !== query.operationId || record.command.bid_id !== query.bidId
        || record.command.amount !== query.amount || record.event.id !== query.eventId || record.event.pubkey !== query.actorId) {
        throw new Error("demo-auth-signed-source-join-conflict");
      }
      const unsigned: DemoUnsignedEvent = { pubkey: record.event.pubkey, created_at: record.event.created_at, kind: record.event.kind, tags: structuredClone(record.event.tags), content: record.event.content };
      await verifySignedBidTemplate(unsigned, record.event);
      if (!verifyDemoAuthEventId(record.event.sig, record.event.id, record.event.pubkey)) throw new Error("demo-auth-signed-source-signature");
      if (match !== null) throw new Error("demo-auth-signed-source-ambiguous");
      match = structuredClone(record.event);
    }
    return match;
  }

  exactRecordCount(): number { return this.records.length; }
}

export function createBrowserDemoAuthSignedBidStoreV2Source(
  context: DemoAuthSignedBidStoreV2Context,
): DemoAuthSignedBidStoreV2Source {
  const root = globalThis as unknown as { localStorage?: DemoAuthSignedBidStoreV2Storage };
  if (root.localStorage === undefined) throw new Error("demo-auth-signed-source-storage-unavailable");
  return new DemoAuthSignedBidStoreV2Source(root.localStorage, context);
}
