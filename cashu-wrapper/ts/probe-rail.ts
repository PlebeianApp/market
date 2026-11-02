import { initializeCoco, MemoryRepositories } from "@cashu/coco-core";
import { createCocoRail } from "./coco-rail";
import { createMemorySeedStore, seedGetterFor } from "./seed-store";

const MINT = "http://127.0.0.1:3338";
const manager = await initializeCoco({ repo: new MemoryRepositories(), seedGetter: seedGetterFor(createMemorySeedStore()) });
const rail = createCocoRail(manager);

console.log("0 trust:", JSON.stringify(await rail.trustMint({ mintUrl: MINT })));
const funded = await rail.fund({ mintUrl: MINT, amount: 100 });
console.log("1 funded:", JSON.stringify(funded));
console.log("2 balance:", JSON.stringify(await manager.wallet.balances.total({ mintUrls: [MINT] })));

const kp = await rail.generateLockKeypair();
console.log("3 lock keypair: pub", kp.pubkey.slice(0, 20), "secretLen", kp.secretKey.length);

const locked = await rail.sendP2pk({ mintUrl: MINT, amount: 50, pubkey: kp.pubkey, operationId: "probe-lock-1" });
console.log("4 locked:", JSON.stringify(locked));
console.log("5 balance after lock:", JSON.stringify(await manager.wallet.balances.total({ mintUrls: [MINT] })));

const reclaimed = await rail.reclaim({ operationId: locked.operationId });
console.log("6 reclaimed:", JSON.stringify(reclaimed));
console.log("7 final balance:", JSON.stringify(await manager.wallet.balances.total({ mintUrls: [MINT] })));
