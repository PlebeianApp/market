/** A3 coupled probe, with only the clock driver repaired to run actual UI intervals. Original liveness assertions retained; obsolete R2-specific count=8 becomes a bounded-cadence assertion. */
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { FridayReadiness, type FridayHealthPins } from './demo-friday-readiness'
class Element {
 children: unknown[] = []; textContent = ''; dataset = {}; value = ''; disabled = false
 append(...nodes: unknown[]) { this.children.push(...nodes) }
 replaceChildren(...nodes: unknown[]) { this.children = nodes }
 setAttribute(_k: string, _v: string) {}
 get lastChild() { return this.children.at(-1) }
 reset() {}
}
const pause = () => new Promise(resolve => setImmediate(resolve))
async function settle() { for (let i = 0; i < 12; i++) await pause() }
async function fixture() {
 let now = 0, dependenciesReady = false, configCalls = 0, connected = 0
 const pins = { schema: 'PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V1', deployment_id: 'deployment', auth_network_id: 'chain', chain_id: 'chain',
  genesis_sha256: 'a'.repeat(64), cashu_mint_url: 'https://mint.example', committee_keyset_id: 'keyset', committee_keyset_version: '1', dkg_run_id: 'dkg',
  committee_public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', public_key_package_sha256: 'b'.repeat(64),
  signer_roster_digest: 'c'.repeat(64), fake_funding_policy_digest: 'd'.repeat(64) }
 const healthPins: FridayHealthPins = { deploymentId: pins.deployment_id, chainId: pins.chain_id, genesisSha256: pins.genesis_sha256,
  validatorsHash: 'e'.repeat(64), committeeKeysetId: pins.committee_keyset_id, committeeKeysetVersion: pins.committee_keyset_version,
  dkgRunId: pins.dkg_run_id, publicKeyPackageSha256: pins.public_key_package_sha256, signerRosterDigest: pins.signer_roster_digest, mintUrl: pins.cashu_mint_url }
 const machine = new FridayReadiness(healthPins, () => now), statuses: unknown[] = []
 function observe() {
  const value = machine.observe({ pins: healthPins, observedAt: now, height: 10 + Math.floor(now / 1000),
   authorityReady: true, mintReady: dependenciesReady, readySigners: [1, 2, 3] })
  statuses.push({ at: now, ...value }); return value
 }
 const nodes = new Map<string, Element>(), timers = new Map<number, unknown>(); let timer = 0
 const intervals: Array<{ run: () => unknown; ms: number; next: number }> = []
 const element = (id: string) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id) }
 const context = vm.createContext({
  window: { nostr: { getPublicKey: async () => 'a'.repeat(64), signEvent: async () => { throw Error('unused') } },
   plebeianFridayR20Connect: async () => { connected++; return { actor: async () => 'a'.repeat(64), pendingFakeFunding: async () => null,
    importAvailable: async () => ({ refunds: 0, winnerPayments: 0 }), balance: async () => ({ available: 0, reserved: 0, locked: 0, pending: 0, unresolved: 0 }) } } },
  document: { getElementById: element, createElement: () => new Element(), createTextNode: (text: string) => ({ textContent: text }) },
  fetch: async (url: string) => {
   let value: unknown
   if (url === '/api/config') { configCalls++; const ready = observe().ready; value = { ...pins, threshold_custody: true,
    browser_threshold_wallet_ready: ready, browser_threshold_admission_ready: ready, recovery_only: false,
    fake_funding_policy: { digest: pins.fake_funding_policy_digest } } }
   else if (url === '/api/browser-release-pins') value = pins
   else if (url === '/api/validators') value = { validators: [] }
   else value = { state: { auctions: {}, bids: {}, height: 10 + Math.floor(now / 1000) } }
   return { ok: true, headers: { get: () => 'application/json' }, json: async () => structuredClone(value) }
  },
  setInterval(run: () => unknown, ms: number) { intervals.push({ run, ms, next: now + ms }) }, setTimeout(run: unknown) { const id = ++timer; timers.set(id, run); return id }, clearTimeout(id: number) { timers.delete(id) },
  performance: { now: () => now }, Date, AbortController, console,
 })
 const app = process.env.HLT_UI_APP ?? new URL('../../internal/poc/static/app.js', import.meta.url)
 vm.runInContext(readFileSync(new URL('../../internal/poc/static/ui-helpers.js', import.meta.url), 'utf8'), context)
 vm.runInContext(readFileSync(app, 'utf8'), context)
 const run = (source: string) => vm.runInContext(source, context)
 await settle()
 return { run, statuses, count: () => configCalls, connected: () => connected, recover: () => { dependenciesReady = true },
  async at(time: number) {
   for (;;) {
    for (const item of intervals) while (item.next < now) item.next += item.ms
    const due = intervals.filter(item => item.next <= time).sort((a, b) => a.next - b.next)[0]
    if (!due) break
    now = due.next; due.next += due.ms; due.run(); await settle()
   }
   now = time; await run('refresh()'); await settle()
  },
  async externalObservation(time: number) { now = time; observe(); await settle() } }
}
test('control: healthy restoration before backoff growth can complete ordinary warmup', async () => {
 const f = await fixture(); f.recover(); await f.at(4_000); await f.at(12_000)
 expect(f.run('r20RuntimeReady()')).toBe(true)
 await f.run('connect()'); expect(f.connected()).toBe(1)
})
test('desired regression: one tab must recover after capped outage backoff without another readiness client', async () => {
 const f = await fixture()
 for (const at of [4_000, 12_000, 28_000]) await f.at(at)
 f.recover()
 for (const at of [58_000, 88_000, 118_000, 148_000]) await f.at(at)
 expect(f.count()).toBeLessThanOrEqual(Math.floor(148_000 / 4_000) + 1)
 console.log('A3_LONG_OUTAGE_TRACE', JSON.stringify(f.statuses))
 expect(f.run('r20RuntimeReady()')).toBe(true)
 await f.run('connect()'); expect(f.connected()).toBe(1)
})
test('control: an external readiness observer can mask the capped-backoff deadlock', async () => {
 const f = await fixture(); for (const at of [4_000, 12_000, 28_000]) await f.at(at)
 f.recover(); await f.at(58_000); await f.externalObservation(59_000); await f.externalObservation(87_000); await f.externalObservation(88_000)
 await f.at(88_000); expect(f.run('r20RuntimeReady()')).toBe(true)
})
