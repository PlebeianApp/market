/**
 * Participant-local durable proof-use authority for the demo FROST policy.
 *
 * This adapter stores only public proof-state references and public identity/digest bindings. It
 * never accepts Cashu secrets, proofs, tokens, witnesses, key shares, nonces, or output openings.
 * SQLite BEGIN IMMEDIATE provides the cross-process claim boundary for one participant database.
 */
import { chmodSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";
import { Database } from "bun:sqlite";

import type {
  DemoFrostParticipantProofUsePort,
} from "../../cashu-wrapper/ts/demo-frost-participant-policy.ts";

const HEX_64 = /^[0-9a-f]{64}$/;
const COMPRESSED_POINT = /^(02|03)[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_KEYS = [
  "network", "chainId", "mintUrl", "unit", "activeKeysetId", "auctionId", "operationId",
  "bidId", "policyPackageDigest", "proofStateRefs",
] as const;

export interface DemoFrostSqliteProofUseOptions {
  readonly databasePath: string;
  readonly participantId: string;
  readonly committeeKeysetId: string;
}

export class DemoFrostSqliteProofUseError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DemoFrostSqliteProofUseError";
  }
}

function refuse(code: string): never { throw new DemoFrostSqliteProofUseError(code); }

function exactRequestKeys(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return refuse("demo-frost-proof-use-request");
  }
  const actual = Object.keys(value).sort();
  const expected = [...REQUEST_KEYS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return refuse("demo-frost-proof-use-request-fields");
  }
}

function text(value: string, field: string): string {
  if (value.length === 0 || value.trim() !== value || value.length > 1024 || value.includes("\0")) {
    return refuse(`demo-frost-proof-use-${field}`);
  }
  return value;
}

function mintOrigin(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return refuse("demo-frost-proof-use-mint"); }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== ""
    || parsed.search !== "" || parsed.hash !== "" || (parsed.pathname !== "" && parsed.pathname !== "/")) {
    return refuse("demo-frost-proof-use-mint");
  }
  return parsed.origin;
}

function canonicalDatabasePath(value: string): string {
  if (!isAbsolute(value) || value.includes("\0") || !value.endsWith(".sqlite")) {
    return refuse("demo-frost-proof-use-database-path");
  }
  const canonical = normalize(value);
  if (canonical !== value || canonical === "/" || canonical === "/tmp" || canonical === "/tmp/") {
    return refuse("demo-frost-proof-use-database-path");
  }
  return canonical;
}

export class DemoFrostSqliteProofUsePort implements DemoFrostParticipantProofUsePort {
  private readonly database: Database;

  constructor(options: DemoFrostSqliteProofUseOptions) {
    const databasePath = canonicalDatabasePath(options.databasePath);
    if (!SAFE_ID.test(options.participantId) || !SAFE_ID.test(options.committeeKeysetId)) {
      refuse("demo-frost-proof-use-identity");
    }
    this.database = new Database(databasePath, { create: true, strict: true });
    let transactionOpen = false;
    try {
      chmodSync(databasePath, 0o600);
      this.database.exec("PRAGMA journal_mode = WAL");
      this.database.exec("PRAGMA synchronous = FULL");
      this.database.exec("PRAGMA busy_timeout = 5000");
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS participant_identity (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          participant_id TEXT NOT NULL,
          committee_keyset_id TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS proof_uses (
          network TEXT NOT NULL,
          chain_id TEXT NOT NULL,
          mint_url TEXT NOT NULL,
          unit TEXT NOT NULL CHECK (unit = 'sat'),
          active_keyset_id TEXT NOT NULL,
          proof_state_ref TEXT NOT NULL,
          auction_id TEXT NOT NULL,
          operation_id TEXT NOT NULL,
          bid_id TEXT NOT NULL,
          policy_package_digest TEXT NOT NULL,
          PRIMARY KEY (mint_url, unit, proof_state_ref)
        );
      `);
      this.database.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
      const identity = this.database.query(
        "SELECT participant_id, committee_keyset_id FROM participant_identity WHERE singleton = 1",
      ).get() as { participant_id: string; committee_keyset_id: string } | null;
      if (identity === null) {
        this.database.query(
          "INSERT INTO participant_identity(singleton, participant_id, committee_keyset_id) VALUES (1, ?, ?)",
        ).run(options.participantId, options.committeeKeysetId);
      } else if (identity.participant_id !== options.participantId
        || identity.committee_keyset_id !== options.committeeKeysetId) {
        refuse("demo-frost-proof-use-database-identity-conflict");
      }
      this.database.exec("COMMIT");
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) {
        try { this.database.exec("ROLLBACK"); } catch { /* preserve the original error */ }
      }
      try { this.database.close(); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  async assertExclusive(request: Parameters<DemoFrostParticipantProofUsePort["assertExclusive"]>[0]): Promise<void> {
    exactRequestKeys(request);
    if (!HEX_64.test(request.network) || request.unit !== "sat"
      || !HEX_64.test(request.policyPackageDigest) || request.proofStateRefs.length === 0
      || new Set(request.proofStateRefs).size !== request.proofStateRefs.length
      || request.proofStateRefs.some((proof) => !COMPRESSED_POINT.test(proof))) {
      return refuse("demo-frost-proof-use-request");
    }
    const values = {
      network: request.network,
      chainId: text(request.chainId, "chain"),
      mintUrl: mintOrigin(request.mintUrl),
      unit: request.unit,
      activeKeysetId: text(request.activeKeysetId, "keyset"),
      auctionId: text(request.auctionId, "auction"),
      operationId: text(request.operationId, "operation"),
      bidId: text(request.bidId, "bid"),
      policyPackageDigest: request.policyPackageDigest,
      proofStateRefs: [...request.proofStateRefs].sort(),
    };
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const read = this.database.query(`
        SELECT network, chain_id, active_keyset_id, auction_id, operation_id, bid_id,
          policy_package_digest
        FROM proof_uses
        WHERE mint_url = ? AND unit = ? AND proof_state_ref = ?
      `);
      const insert = this.database.query(`
        INSERT INTO proof_uses(
          network, chain_id, mint_url, unit, active_keyset_id, proof_state_ref,
          auction_id, operation_id, bid_id, policy_package_digest
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const proofStateRef of values.proofStateRefs) {
        const existing = read.get(values.mintUrl, values.unit, proofStateRef) as {
          network: string;
          chain_id: string;
          active_keyset_id: string;
          auction_id: string;
          operation_id: string;
          bid_id: string;
          policy_package_digest: string;
        } | null;
        if (existing !== null) {
          if (existing.network !== values.network || existing.chain_id !== values.chainId
            || existing.active_keyset_id !== values.activeKeysetId
            || existing.auction_id !== values.auctionId || existing.operation_id !== values.operationId
            || existing.bid_id !== values.bidId || existing.policy_package_digest !== values.policyPackageDigest) {
            return refuse("demo-frost-proof-use-conflict");
          }
          continue;
        }
        insert.run(
          values.network, values.chainId, values.mintUrl, values.unit, values.activeKeysetId, proofStateRef,
          values.auctionId, values.operationId, values.bidId, values.policyPackageDigest,
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  close(): void { this.database.close(); }
}
