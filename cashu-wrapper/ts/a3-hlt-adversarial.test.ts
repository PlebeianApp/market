import { expect, test } from 'bun:test'
import { FridayReadiness, createFridayReadinessProbe, type FridayHealthPins } from './demo-friday-readiness'
import { createDemoFridayFixedAuthorityService } from './demo-friday-authority-service'
import { createDemoFridayRecoveryOnlyGuard } from './demo-friday-recovery-only'
const pins: FridayHealthPins = { deploymentId: 'deployment', chainId: 'chain', genesisSha256: 'a'.repeat(64),
 validatorsHash: 'b'.repeat(64), committeeKeysetId: 'committee', committeeKeysetVersion: '1', dkgRunId: 'dkg',
 publicKeyPackageSha256: 'c'.repeat(64), signerRosterDigest: 'd'.repeat(64), mintUrl: 'https://mint.example' }
function fixture() {
 let now = 0
 const machine = new FridayReadiness(pins, () => now)
 const sample = (height: number, changes: Record<string, unknown> = {}) => machine.observe({ pins, observedAt: now,
  height, authorityReady: true, mintReady: true, readySigners: [1, 2, 3], ...changes })
 sample(10); now = 1_000; expect(sample(11).ready).toBe(true)
 return { sample, set: (value: number) => { now = value } }
}
for (const height of [-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 9]) test(`bad height ${height} closes an already-ready gate`, () => {
 const f = fixture(); f.set(2_000); expect(f.sample(height).ready).toBe(false)
 f.set(3_000); expect(f.sample(12).ready).toBe(false)
 f.set(4_000); expect(f.sample(13).ready).toBe(true)
})
for (const readySigners of [[], [1, 2], [1, 1, 2, 3], [1, 2, 5], [1, 2, NaN]]) test(`invalid signer set ${readySigners} closes an already-ready gate`, () => {
 const f = fixture(); expect(f.sample(12, { readySigners }).ready).toBe(false)
})
for (const key of Object.keys(pins)) test(`signed adapter pin drift ${key} closes an already-ready gate`, () => {
 const f = fixture(); expect(f.sample(12, { pins: { ...pins, [key]: 'wrong' } }).ready).toBe(false)
})
test('same-height fresh polls do not perpetually renew progress', () => {
 const f = fixture()
 for (let now = 2_000; now < 21_000; now += 1_000) { f.set(now); expect(f.sample(11).ready).toBe(true) }
 f.set(21_000); expect(f.sample(11).ready).toBe(false)
 f.set(22_000); expect(f.sample(11).ready).toBe(false)
 f.set(23_000); expect(f.sample(12).ready).toBe(false)
 f.set(24_000); expect(f.sample(13).ready).toBe(true)
})
test('timeout after readiness closes gate; late response cannot restore it; recovery needs fresh advances', async () => {
 let now = 0, height = 10, mode: 'good' | 'hang' = 'good', late!: (v: unknown) => void
 const sample = () => ({ pins, height, authorityReady: true, mintReady: true, readySigners: [1, 2, 3] })
 const probe = createFridayReadinessProbe({ pins, timeoutMs: 5, now: () => now,
  collect: async () => mode === 'good' ? sample() : new Promise(resolve => { late = resolve as never }) })
 expect((await probe.readExact()).ready).toBe(false)
 now = 1_000; height++; expect((await probe.readExact()).ready).toBe(true)
 mode = 'hang'; expect((await probe.readExact()).ready).toBe(false)
 late(sample()); await Promise.resolve(); mode = 'good'
 now = 2_000; height++; expect((await probe.readExact()).ready).toBe(false)
 now = 3_000; height++; expect((await probe.readExact()).ready).toBe(true)
})
const origin = 'https://mint.example'
function serviceFixture(phase: string | null, recordedSeller = true, explicitRecovery = false) {
 const calls: string[] = []
 const guard = createDemoFridayRecoveryOnlyGuard({ readFundingRecoveryPhaseExact: () => phase as never,
  hasSellerPlanExact: operation => recordedSeller && operation === 'recorded', hasTerminalNoticeExact: () => true,
  readAbortCapsuleExact: async () => { throw new Error('not recorded') } })
 const service = createDemoFridayFixedAuthorityService({ publicOrigin: origin, authNetworkId: 'chain', chainId: 'chain', mintUrl: origin,
  nowSeconds: () => 1_000, readiness: { readExact: async () => ({ ready: false, height: 0, reason: 'down' }) },
  health: { readExact: async () => ({ deploymentId: 'deployment', quarantined: false, queuePending: 0, lastCommittedHeight: 10 }) },
  terminalSource: { nextExact: async () => null, markQueuedExact: async () => {} }, terminalRuntime: {} as never,
  degradedRecovery: guard, recoveryOnly: explicitRecovery ? guard : undefined,
  fundingAdmission: { prepareExact: async () => { calls.push('prepare'); return {} as never },
   confirmExact: async () => { calls.push('confirm-auth'); throw new Error('normal authorization refused') },
   readExact: async () => { calls.push('funding-status'); return {} as never } },
  browserTrust: { registerSellerPlanExact: async () => { calls.push('seller-auth'); throw new Error('normal authorization refused') },
   issueSellerPlanChallengeExact: async () => { calls.push('intent'); return {} } } as never,
  terminalExchange: { readExact: () => { calls.push('terminal-read-auth'); throw new Error('normal authorization refused') },
   acknowledgeExact: () => { calls.push('terminal-ack-auth'); throw new Error('normal authorization refused') } },
  fundingAbort: { prepareBrowserExact: async () => { calls.push('abort-auth'); throw new Error('normal authorization refused') } } as never,
 })
 const post = (path: string, body: unknown, requestOrigin = origin) => service.handle(new Request('http://127.0.0.1:8181/api/friday/' + path,
  { method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify(body) }))
 return { post, calls }
}
for (const phase of ['claimed', 'prepared', 'signed', 'quarantined', null]) test(`degraded confirm cannot newly broadcast phase ${phase}`, async () => {
 const f = serviceFixture(phase)
 expect((await f.post('funding/confirm', { fundingAuthorizationEventId: 'a'.repeat(64) })).status).toBe(503)
 expect(f.calls).toEqual([])
})
for (const phase of ['broadcasting', 'broadcast', 'admitted']) test(`recorded ${phase} is not a bypass of normal confirm authorization`, async () => {
 const f = serviceFixture(phase)
 expect((await f.post('funding/confirm', { fundingAuthorizationEventId: 'a'.repeat(64) })).status).toBe(422)
 expect(f.calls).toEqual(['confirm-auth'])
})
test('recorded seller scope still invokes normal seller authorization; unknown scope cannot enter it', async () => {
 const f = serviceFixture(null)
 expect((await f.post('seller-plan/register', { plan: { fundingOperationId: 'new' } })).status).toBe(503)
 expect(f.calls).toEqual([])
 expect((await f.post('seller-plan/register', { plan: { fundingOperationId: 'recorded' } })).status).toBe(422)
 expect(f.calls).toEqual(['seller-auth'])
})
test('degraded routes retain same-origin and normal terminal/abort authorization checks', async () => {
 const f = serviceFixture('broadcast')
 expect((await f.post('funding/confirm', { fundingAuthorizationEventId: 'a'.repeat(64) }, 'https://evil.example')).status).toBe(403)
 for (const path of ['terminal/read', 'terminal/ack', 'funding-abort/prepare']) expect((await f.post(path, {})).status).toBe(422)
 expect(f.calls).toEqual(['terminal-read-auth', 'terminal-ack-auth', 'abort-auth'])
})
test('explicit recovery-only mode never admits new preparation or seller intent', async () => {
 const f = serviceFixture('broadcast', true, true)
 for (const path of ['funding', 'seller-plan/intent']) expect((await f.post(path, {})).status).toBe(409)
 expect(f.calls).toEqual([])
})
