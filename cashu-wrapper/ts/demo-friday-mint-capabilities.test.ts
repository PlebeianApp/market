import { expect, test } from 'bun:test'
import { supportedNutNumbers } from './demo-sigall-live-mint'
import { createFridayReadinessProbe, type FridayHealthPins } from './demo-friday-readiness'
const required = [4, 7, 9, 10, 11, 12]
const enabled = (): Record<string, unknown> => ({ 4: { disabled: false, methods: [{ method: 'bolt11', unit: 'sat' }] },
 7: { supported: true }, 9: { supported: true }, 10: { supported: true }, 11: { supported: true }, 12: { supported: true } })
const ready = (raw: unknown) => required.every(nut => supportedNutNumbers(raw).includes(nut))
test('only explicit enabled and supported settings count toward mint readiness', () => {
 expect(ready(enabled())).toBe(true)
 for (const raw of [undefined, null, [], true, 'supported', {}]) expect(ready(raw)).toBe(false)
 for (const settings of [undefined, null, [], false, {}, { methods: [{ method: 'bolt11', unit: 'sat' }] },
  { disabled: 'false', methods: [{ method: 'bolt11', unit: 'sat' }] }, { disabled: true, methods: [{ method: 'bolt11', unit: 'sat' }] },
  { disabled: false, methods: [null, [], { method: 'bolt11', unit: 'usd' }] }, { disabled: false, methods: 'bolt11' }]) {
  expect(ready({ ...enabled(), 4: settings })).toBe(false)
 }
 for (const nut of required.filter(n => n !== 4)) for (const setting of [undefined, null, [], true, {}, { supported: false }, { supported: 'true' }, { supported: 1 }]) {
  expect(ready({ ...enabled(), [nut]: setting })).toBe(false)
 }
})
test('restored capabilities require two fresh advancing observations', async () => {
 const pins: FridayHealthPins = { deploymentId: 'demo', chainId: 'chain', genesisSha256: 'a'.repeat(64), validatorsHash: 'b'.repeat(64),
  committeeKeysetId: 'keyset', committeeKeysetVersion: '1', dkgRunId: 'dkg', publicKeyPackageSha256: 'c'.repeat(64),
  signerRosterDigest: 'd'.repeat(64), mintUrl: 'https://mint.example' }
 let settings = enabled(), now = 0, height = 10
 const probe = createFridayReadinessProbe({ pins, now: () => now, collect: async () => ({ pins, height,
  authorityReady: true, mintReady: ready(settings), readySigners: [1, 2, 3] }) })
 expect((await probe.readExact()).ready).toBe(false)
 now += 1_000; height++; expect((await probe.readExact()).ready).toBe(true)
 settings['11'] = { supported: false }; expect((await probe.readExact()).ready).toBe(false)
 settings = enabled(); now += 1_000; height++; expect((await probe.readExact()).ready).toBe(false)
 now += 1_000; height++; expect((await probe.readExact()).ready).toBe(true)
})
