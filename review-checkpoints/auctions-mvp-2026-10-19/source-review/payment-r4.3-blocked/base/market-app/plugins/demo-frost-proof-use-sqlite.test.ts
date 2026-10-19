import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { DemoFrostSqliteProofUsePort } from "./demo-frost-proof-use-sqlite.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "coco-frost-proof-use-"));
  directories.push(directory);
  const databasePath = join(directory, "participant-1.sqlite");
  const options = { databasePath, participantId: "participant-1", committeeKeysetId: "demo-keyset-v1" };
  const request = {
    network: "41".repeat(32), chainId: "demo-chain", mintUrl: "https://testnut.example", unit: "sat" as const,
    activeKeysetId: "keyset-1", auctionId: "auction-1", operationId: "operation-1", bidId: "bid-1",
    policyPackageDigest: "51".repeat(32), proofStateRefs: [`02${"61".repeat(32)}`],
  };
  return { databasePath, options, request };
}

describe("participant-local SQLite proof-use authority", () => {
  test("survives reconstruction and exact replay while storing public bindings only", async () => {
    const f = fixture();
    const first = new DemoFrostSqliteProofUsePort(f.options);
    await first.assertExclusive(f.request);
    first.close();
    const reconstructed = new DemoFrostSqliteProofUsePort(f.options);
    await expect(reconstructed.assertExclusive(structuredClone(f.request))).resolves.toBeUndefined();
    reconstructed.close();
    expect(statSync(f.databasePath).mode & 0o777).toBe(0o600);
    const bytes = readFileSync(f.databasePath).toString("latin1");
    expect(bytes).toContain(f.request.proofStateRefs[0]!);
    expect(bytes).not.toContain("proof-secret");
    expect(bytes).not.toContain("cashu-token");
  });

  test("two child processes race one proof and SQLite retains exactly one owner", async () => {
    const f = fixture();
    const initialized = new DemoFrostSqliteProofUsePort(f.options); initialized.close();
    const barrier = join(f.databasePath, "..", "start");
    const firstReady = join(f.databasePath, "..", "first-ready");
    const secondReady = join(f.databasePath, "..", "second-ready");
    const helper = join(import.meta.dir, "demo-frost-proof-use-sqlite.child.ts");
    const child = (ready: string, operationId: string, bidId: string, digest: string) => Bun.spawn([
      process.execPath, helper, f.databasePath, barrier, ready, f.request.network, f.request.chainId,
      f.request.activeKeysetId, operationId, bidId, digest,
    ], { stdout: "pipe", stderr: "pipe" });
    const first = child(firstReady, "operation-1", "bid-1", "51".repeat(32));
    const second = child(secondReady, "operation-2", "bid-2", "52".repeat(32));
    for (let wait = 0; wait < 2_000 && (!existsSync(firstReady) || !existsSync(secondReady)); wait += 1) {
      await Bun.sleep(1);
    }
    const bothReady = existsSync(firstReady) && existsSync(secondReady);
    writeFileSync(barrier, "go", { mode: 0o600 });
    const [firstOutput, secondOutput, firstExit, secondExit] = await Promise.all([
      new Response(first.stdout).text(), new Response(second.stdout).text(), first.exited, second.exited,
    ]);
    expect(bothReady).toBe(true);
    expect([firstExit, secondExit]).toEqual([0, 0]);
    expect([firstOutput.trim(), secondOutput.trim()].sort()).toEqual([
      "fulfilled", "rejected:demo-frost-proof-use-conflict",
    ].sort());
    const database = new Database(f.databasePath, { readonly: true, strict: true });
    expect(database.query("SELECT COUNT(*) AS count FROM proof_uses").get()).toEqual({ count: 1 });
    database.close();
  });

  test("the same mint proof cannot be reclaimed under a changed network, chain, or keyset label", async () => {
    const f = fixture();
    const port = new DemoFrostSqliteProofUsePort(f.options);
    await port.assertExclusive(f.request);
    for (const changed of [
      { ...f.request, network: "42".repeat(32) },
      { ...f.request, chainId: "other-chain" },
      { ...f.request, activeKeysetId: "other-keyset" },
    ]) {
      await expect(port.assertExclusive(changed)).rejects.toThrow("demo-frost-proof-use-conflict");
    }
    port.close();
  });

  test("binds one database to one participant/keyset and fails closed on malformed scope", async () => {
    const f = fixture();
    const first = new DemoFrostSqliteProofUsePort(f.options);
    await first.assertExclusive(f.request);
    first.close();
    expect(() => new DemoFrostSqliteProofUsePort({ ...f.options, participantId: "participant-2" }))
      .toThrow("database-identity-conflict");
    const reopened = new DemoFrostSqliteProofUsePort(f.options);
    await expect(reopened.assertExclusive({ ...f.request, mintUrl: "http://testnut.example" }))
      .rejects.toThrow("demo-frost-proof-use-mint");
    await expect(reopened.assertExclusive({ ...f.request, token: "cashu-token" } as typeof f.request))
      .rejects.toThrow("demo-frost-proof-use-request-fields");
    reopened.close();
  });
});
