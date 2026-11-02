import { Database } from 'bun:sqlite'
import { DemoSignerCoordinatorAnchorSqlite } from './demo-signer-coordinator-anchor-sqlite'
import { expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { createFridaySignerHealthHandler, probeFridaySignerHealth, collectFridayReadySigners } from './demo-friday-signer-health'
import type { DemoSignerDurableBindingV1 } from './demo-signer-rpc'
import { healthPins } from './demo-friday-readiness.test'
const secret = (n: number) => { const bytes = new Uint8Array(32); bytes[31] = n; return bytes }
const coordinator = secret(1), signer = secret(2), signerIdentity = bytesToHex(schnorr.getPublicKey(signer))
const binding: DemoSignerDurableBindingV1 = { schema: 'COCO_DEMO_SIGNER_DURABLE_BINDING_V1', participantId: 1,
 keysetId: healthPins.committeeKeysetId, keysetVersion: healthPins.committeeKeysetVersion,
 dkgRunId: healthPins.dkgRunId, publicKeyPackageSha256: healthPins.publicKeyPackageSha256,
 signerRosterDigest: healthPins.signerRosterDigest, restartEpoch: 1, journalGeneration: 'e'.repeat(64),
 stateDirectory: '/private/not-read', stateDirectoryIdentity: 'f'.repeat(64), processIdentity: signerIdentity, verifyingShare: '02' + '1'.repeat(64) }
function fixture(change: { down?: boolean; binding?: DemoSignerDurableBindingV1; now?: number; processInstanceId?: string } = {}) {
 let checks = 0, anchors = 0
 const handle = createFridaySignerHealthHandler({ pins: healthPins, participantId: 1,
  coordinatorIdentity: bytesToHex(schnorr.getPublicKey(coordinator)), signerPrivate: signer,
  processInstanceId: change.processInstanceId ?? 'a'.repeat(64), binding: async () => change.binding ?? binding, now: () => change.now ?? 1_000,
  assertReady: async () => { checks++; if (change.down) throw new Error('quarantined') } })
 const options = { endpoint: 'http://[fd00::1]:39101/v1/frost', participantId: 1, signerIdentity,
  coordinatorSecret: coordinator, pins: healthPins, enrollment: binding,
  anchor: { async assertCurrent() { anchors++ }, async observeProcess() {} },
  signal: new AbortController().signal, now: () => 1_000,
  fetch: (async (_url, init) => Response.json(await handle(JSON.parse(String(init?.body))))) as typeof fetch }
 return { options, handle, counts: () => ({ checks, anchors }) }
}
test('authenticated health is bound to challenge, participant and enrollment; performs no signing claim', async () => {
 const f = fixture(); expect(await probeFridaySignerHealth(f.options)).toBe(1)
 expect(f.counts()).toEqual({ checks: 1, anchors: 1 })
 expect(await probeFridaySignerHealth(fixture({ down: true }).options)).toBeNull()
})
test('tampered reply, wrong identity, enrollment, keyset and stale authentication refuse', async () => {
 const f = fixture()
 const corrupt = { ...f.options, fetch: (async (_url, init) => {
  const reply = await f.handle(JSON.parse(String(init?.body))); return Response.json({ ...reply, challenge: '0'.repeat(64) })
 }) as typeof fetch }
 await expect(probeFridaySignerHealth(corrupt)).rejects.toThrow()
 await expect(probeFridaySignerHealth({ ...f.options, signerIdentity: bytesToHex(schnorr.getPublicKey(secret(3))) })).rejects.toThrow()
 await expect(probeFridaySignerHealth(fixture({ binding: { ...binding, keysetId: 'wrong' } }).options)).rejects.toThrow()
 await expect(probeFridaySignerHealth(fixture({ binding: { ...binding, restartEpoch: 0 } }).options)).rejects.toThrow()
 await expect(probeFridaySignerHealth(fixture({ now: 10_000 }).options)).rejects.toThrow()
})
test('an earlier signed response cannot satisfy a fresh request; anchor refusal remains refusal', async () => {
 const f = fixture(); let held: unknown
 const replayFetch = (async (_url, init) => { held ??= await f.handle(JSON.parse(String(init?.body))); return Response.json(held) }) as typeof fetch
 expect(await probeFridaySignerHealth({ ...f.options, fetch: replayFetch })).toBe(1)
 await expect(probeFridaySignerHealth({ ...f.options, fetch: replayFetch })).rejects.toThrow()
 await expect(probeFridaySignerHealth({ ...f.options, anchor: {
  async assertCurrent() { throw new Error('rollback') }, async observeProcess() {},
 } })).rejects.toThrow('rollback')
})

test('three healthy signers remain available when the fourth probe hangs', async () => {
 const ids = await collectFridayReadySigners([
  async () => 1, async () => 2, async () => 3, async () => new Promise<number>(() => {}),
 ], new AbortController().signal)
 expect(ids).toEqual([1, 2, 3])
})

test('wrong coordinator authentication performs no safety observation', async () => {
 const f = fixture()
 await expect(probeFridaySignerHealth({ ...f.options, coordinatorSecret: secret(3) })).rejects.toThrow()
 expect(f.counts()).toEqual({ checks: 0, anchors: 0 })
})
test('health cannot reuse an anchored restart epoch from another live process', async () => {
 const db = new Database(':memory:')
 try {
  const anchor = new DemoSignerCoordinatorAnchorSqlite(db)
  expect(await probeFridaySignerHealth({ ...fixture().options, anchor })).toBe(1)
  await expect(probeFridaySignerHealth({ ...fixture({ processInstanceId: 'b'.repeat(64) }).options, anchor })).rejects.toThrow('reused')
 } finally { db.close(false) }
})
