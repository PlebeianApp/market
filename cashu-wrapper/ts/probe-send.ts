import { initializeCoco, MemoryRepositories } from "@cashu/coco-core";
import { createCocoRail } from "./coco-rail";
import { createMemorySeedStore, seedGetterFor } from "./seed-store";

const MINT = "http://127.0.0.1:3338";
const manager = await initializeCoco({ repo: new MemoryRepositories(), seedGetter: seedGetterFor(createMemorySeedStore()) });
const rail = createCocoRail(manager);
await rail.trustMint({ mintUrl: MINT });
await rail.fund({ mintUrl: MINT, amount: 100 });
const kp = await rail.generateLockKeypair();
console.log("keypair:", kp.pubkey.slice(0, 18), "idx", kp.derivationIndex, kp.purpose, "secretHexLen", kp.secretKey.length);

const ops = manager.ops as unknown as { send: { prepare(i: Record<string, unknown>): Promise<unknown>; execute(o: unknown): Promise<unknown> } };
const prepared = await ops.send.prepare({ mintUrl: MINT, amount: 50, target: { type: "p2pk", pubkey: kp.pubkey }, operationId: "probe-lock-2" });
console.log("prepared keys:", Object.keys(prepared as object).join(","));
console.log("prepared:", JSON.stringify(prepared).slice(0, 400));
const executed = await ops.send.execute(prepared);
console.log("executed keys:", Object.keys(executed as object).join(","));
console.log("executed state:", (executed as { state?: unknown }).state, "token? ", typeof (executed as { token?: unknown }).token);
console.log("balance:", JSON.stringify(await manager.wallet.balances.total({ mintUrls: [MINT] })));
