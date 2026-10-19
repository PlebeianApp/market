import { existsSync, writeFileSync } from "node:fs";

import { DemoFrostSqliteProofUsePort } from "./demo-frost-proof-use-sqlite.ts";

const [databasePath, barrierPath, readyPath, network, chainId, activeKeysetId, operationId, bidId, digest] = process.argv.slice(2);
if ([databasePath, barrierPath, readyPath, network, chainId, activeKeysetId, operationId, bidId, digest]
  .some((value) => value === undefined)) process.exit(2);

const port = new DemoFrostSqliteProofUsePort({
  databasePath: databasePath!, participantId: "participant-1", committeeKeysetId: "demo-keyset-v1",
});
writeFileSync(readyPath!, "ready", { mode: 0o600 });
while (!existsSync(barrierPath!)) await Bun.sleep(1);
try {
  await port.assertExclusive({
    network: network!, chainId: chainId!, mintUrl: "https://testnut.example", unit: "sat",
    activeKeysetId: activeKeysetId!, auctionId: "auction-1", operationId: operationId!, bidId: bidId!,
    policyPackageDigest: digest!, proofStateRefs: [`02${"61".repeat(32)}`],
  });
  console.log("fulfilled");
} catch (error) {
  console.log(`rejected:${error instanceof Error ? error.message : "unknown"}`);
} finally {
  port.close();
}
