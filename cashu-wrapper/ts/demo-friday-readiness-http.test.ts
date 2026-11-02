import { expect, test } from 'bun:test'
import { createDemoFridayFixedAuthorityService } from './demo-friday-authority-service'
import { createDemoFridayRecoveryOnlyGuard } from './demo-friday-recovery-only'
import { createFridayReadinessProbe } from './demo-friday-readiness'
import { healthPins } from './demo-friday-readiness.test'
const origin = 'https://mint.example'
function fixture() {
 let now = 0, height = 10, mintReady = true, signers = [1, 2, 3]; const calls: string[] = []
 const phases = new Map([['a'.repeat(64), 'broadcast' as const], ['b'.repeat(64), 'prepared' as const]])
 const degradedRecovery = createDemoFridayRecoveryOnlyGuard({
  readFundingRecoveryPhaseExact: event => phases.get(event) ?? null,
  hasTerminalNoticeExact: () => true, hasSellerPlanExact: operation => operation === 'recorded',
  readAbortCapsuleExact: async () => { throw new Error('not used') },
 })
 const readiness = createFridayReadinessProbe({ pins: healthPins, now: () => now, collect: async () => ({
  pins: healthPins, height, authorityReady: true, mintReady, readySigners: signers,
 }) })
 const service = createDemoFridayFixedAuthorityService({ publicOrigin: origin,
  authNetworkId: 'chain', chainId: 'chain', mintUrl: origin, nowSeconds: () => 1_000,
  readiness, readinessPins: healthPins, degradedRecovery,
  health: { readExact: async () => ({ deploymentId: healthPins.deploymentId, quarantined: false, queuePending: 2, lastCommittedHeight: height, consensusAvailable: true }) },
  terminalSource: { nextExact: async () => null, markQueuedExact: async () => {} },
  terminalRuntime: { queueTerminal: async () => { throw new Error('not used') } },
  fundingAdmission: {
   prepareExact: async () => { calls.push('prepare'); return {} as never },
   confirmExact: async () => { calls.push('confirm'); return {} as never },
   readExact: async () => { calls.push('status'); return {} as never },
  },
  terminalExchange: { readExact: () => { calls.push('terminal-read'); return {} as never },
   acknowledgeExact: () => { calls.push('terminal-ack'); return {} as never } },
  fundingAbort: {
   registerBrowserCapsuleExact: async () => ({ capsuleDigest: 'c'.repeat(64) }),
   prepareBrowserExact: async () => { calls.push('abort-prepare'); return {} as never },
   submitBrowserExact: async () => { calls.push('abort-request'); return {} as never },
   readBrowserExact: async () => { calls.push('abort-status'); return {} as never },
  },
 })
 const post = (path: string, body: unknown = {}) => service.handle(new Request(`http://127.0.0.1:8181/api/friday/${path}`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
 }))
 const status = () => service.handle(new Request('http://127.0.0.1:8181/api/friday/status'))
 return { post, status, calls, advance: () => { now += 1_000; height++ },
  stall: () => { now += 21_000 }, mint: (value: boolean) => { mintReady = value }, signers: (ids: number[]) => { signers = ids } }
}
test('direct admission closes on startup/stall/mint/signer loss; recovery requires two advances', async () => {
 const f = fixture()
 expect((await f.status()).status).toBe(503)
 expect((await f.post('funding')).status).toBe(503); expect(f.calls).toEqual([])
 f.advance(); expect((await f.status()).status).toBe(200)
 expect((await f.post('funding')).status).toBe(202)
 f.stall(); expect((await f.status()).status).toBe(503)
 expect((await f.post('funding')).status).toBe(503)
 f.advance(); expect((await f.status()).status).toBe(503)
 f.advance(); expect((await f.status()).status).toBe(200)
 f.mint(false); expect((await f.post('funding')).status).toBe(503)
 f.mint(true); f.advance(); expect((await f.status()).status).toBe(503)
 f.advance(); expect((await f.status()).status).toBe(200)
 f.signers([1, 2]); expect((await f.post('funding')).status).toBe(503)
})
test('degraded confirmation requires already-broadcast journal; terminal/status/abort APIs remain accessible', async () => {
 const f = fixture(); f.mint(false)
 for (const id of ['b', 'c']) expect((await f.post('funding/confirm', { fundingAuthorizationEventId: id.repeat(64) })).status).toBe(503)
 expect((await f.post('funding/confirm', { fundingAuthorizationEventId: 'a'.repeat(64) })).status).toBe(201)
 for (const [path, status] of [['funding/status', 200], ['terminal/read', 200], ['terminal/ack', 200],
  ['funding-abort/prepare', 201], ['funding-abort/request', 202], ['funding-abort/status', 200]] as const) {
  expect((await f.post(path)).status).toBe(status)
 }
 expect(f.calls).toEqual(['confirm', 'status', 'terminal-read', 'terminal-ack', 'abort-prepare', 'abort-request', 'abort-status'])
})
test('missing readiness capability defaults to unready', async () => {
 const service = createDemoFridayFixedAuthorityService({ publicOrigin: origin, authNetworkId: 'chain', chainId: 'chain',
  mintUrl: origin, nowSeconds: () => 1_000,
  health: { readExact: async () => ({ deploymentId: 'deployment', quarantined: false, queuePending: 0, lastCommittedHeight: 1 }) },
  terminalSource: { nextExact: async () => null, markQueuedExact: async () => {} },
  terminalRuntime: { queueTerminal: async () => { throw new Error('not used') } },
 })
 const response = await service.handle(new Request('http://127.0.0.1:8181/api/friday/status'))
 expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ newOperationsReady: false })
})
