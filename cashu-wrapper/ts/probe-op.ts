import { initializeCoco, MemoryRepositories } from "@cashu/coco-core";
import { createCocoRail } from "./coco-rail";
import { createMemorySeedStore, seedGetterFor } from "./seed-store";

const MINT = "http://127.0.0.1:3338";
const manager = await initializeCoco({ repo: new MemoryRepositories(), seedGetter: seedGetterFor(createMemorySeedStore()) });
const rail = createCocoRail(manager);
await rail.trustMint({ mintUrl: MINT });
await rail.fund({ mintUrl: MINT, amount: 149 });
const kp = await rail.generateLockKeypair();
const locked = await rail.sendP2pk({ mintUrl: MINT, amount: 71, pubkey: kp.pubkey, operationId: "probe-lock-5" });
console.log("locked:", JSON.stringify(locked));

// Does Coco's own operation record still carry the locked token? If yes, nothing bearer needs to live in the app.
const got = await (manager.ops.send as unknown as { get(id: string): Promise<unknown> }).get("probe-lock-5");
const keys = got === null ? [] : Object.keys(got as object);
console.log("operation keys:", keys.join(","));
const token = (got as { token?: unknown } | null)?.token;
console.log("operation carries a token:", token !== undefined && token !== null, "type:", typeof token);
if (token !== null && typeof token === "object") console.log("token keys:", Object.keys(token as object).join(","));
console.log("state:", (got as { state?: unknown } | null)?.state);
// And can the proof repository still see the locked proofs as inflight (i.e. Coco owns them, not the app)?
const inflight = await (manager as unknown as { repo: { proofRepository: { getInflightProofs(mints?: string[]): Promise<unknown[]> } } }).repo?.proofRepository?.getInflightProofs([MINT]).catch(() => null);
console.log("inflight proofs visible:", Array.isArray(inflight) ? inflight.length : "no repo accessor");
