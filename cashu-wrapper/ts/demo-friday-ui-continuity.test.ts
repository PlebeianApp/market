/** Actual UI timers + actual coalesced backend probe; synthetic dependency/clock/HTTP boundaries. */
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createFridayReadinessProbe, type FridayHealthPins } from './demo-friday-readiness'
class Element {
 children: unknown[] = []; textContent = ''; dataset: Record<string, string> = {}; value = ''; disabled = false
 append(...nodes: unknown[]) { this.children.push(...nodes) }
 replaceChildren(...nodes: unknown[]) { this.children = nodes }
 setAttribute(_key: string, _value: string) {}
 get lastChild() { return this.children.at(-1) }
 reset() {}
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)) }
type Timer = { at: number; run: () => unknown; period?: number; owner?: number }
function world() {
 let now = 0, nextTimer = 0, nextTab = 0, closed = false, concurrent = 0, maximumConcurrent = 0, collections = 0
 let dependenciesReady = false, httpReady = true, stoppedHeight: number | null = null, collectMs = 0
 const timers = new Map<number, Timer>(), requestTimes = new Map<number, number[]>(), contexts: vm.Context[] = []
 let sellerAuction = false
 const statuses: Array<{ tab: number; at: number; ready: boolean; reason: string; height: number }> = []
 const pins = { schema: 'PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V1', deployment_id: 'deployment', auth_network_id: 'chain', chain_id: 'chain',
  genesis_sha256: 'a'.repeat(64), cashu_mint_url: 'https://mint.example', committee_keyset_id: 'keyset', committee_keyset_version: '1', dkg_run_id: 'dkg',
  committee_public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', public_key_package_sha256: 'b'.repeat(64),
  signer_roster_digest: 'c'.repeat(64), fake_funding_policy_digest: 'd'.repeat(64) }
 const healthPins: FridayHealthPins = { deploymentId: pins.deployment_id, chainId: pins.chain_id, genesisSha256: pins.genesis_sha256,
  validatorsHash: 'e'.repeat(64), committeeKeysetId: pins.committee_keyset_id, committeeKeysetVersion: pins.committee_keyset_version,
  dkgRunId: pins.dkg_run_id, publicKeyPackageSha256: pins.public_key_package_sha256, signerRosterDigest: pins.signer_roster_digest, mintUrl: pins.cashu_mint_url }
 const height = () => stoppedHeight ?? 10 + Math.floor(now / 1000)
 const schedule = (run: () => unknown, delay: number, owner?: number, period?: number) => {
  const id = ++nextTimer; timers.set(id, { at: now + delay, run, owner, period }); return id
 }
 const sleep = (ms: number) => ms === 0 ? Promise.resolve() : new Promise<void>(resolve => { schedule(resolve, ms) })
 const probe = createFridayReadinessProbe({ pins: healthPins, now: () => now, collect: async () => {
  collections++; concurrent++; maximumConcurrent = Math.max(maximumConcurrent, concurrent)
  try {
   if (!dependenciesReady) throw new Error('dependency offline')
   await sleep(collectMs)
   return { pins: healthPins, height: height(), mintReady: dependenciesReady, authorityReady: true, readySigners: [1, 2, 3] }
  } finally { concurrent-- }
 } })
 let profile = (_request: number) => ({ outbound: 0, inbound: 0 }), request = 0
 const advance = async (target: number) => {
  if (target < now) throw new Error('fake clock cannot regress')
  let events = 0
  await settle()
  for (;;) {
   const due = [...timers].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
   if (!due) break
   if (++events > 10000) throw new Error('unbounded timer/request storm')
   const [id, timer] = due; timers.delete(id); now = timer.at
   if (timer.period && !closed) timers.set(id, { ...timer, at: now + timer.period })
   timer.run(); await settle()
  }
  now = target; await settle()
 }
 const newTab = async () => {
  const id = ++nextTab, nodes = new Map<string, Element>(); requestTimes.set(id, [])
  const element = (key: string) => { if (!nodes.has(key)) nodes.set(key, new Element()); return nodes.get(key)! }
  let connected = 0, approvalSignal: AbortSignal | undefined
  const context = vm.createContext({
   window: { nostr: { getPublicKey: async () => 'a'.repeat(64), signEvent: async () => { throw new Error('unused') } },
    plebeianFridayR20Connect: async () => { connected++; return { actor: async () => 'a'.repeat(64), pendingFakeFunding: async () => null,
     importAvailable: async () => ({ refunds: 0, winnerPayments: 0 }), balance: async () => ({ available: 0, reserved: 0, locked: 0, pending: 0, unresolved: 0 }),
     serviceSellerPlans: async (options: { signal: AbortSignal; assertActive(): Promise<void> }) => {
      await options.assertActive(); approvalSignal = options.signal
      await new Promise<never>((_resolve, reject) => {
       const cancel = () => { options.signal.removeEventListener('abort', cancel); reject(new Error('synthetic signer cancelled')) }
       if (options.signal.aborted) cancel(); else options.signal.addEventListener('abort', cancel, { once: true })
      })
     } } } },
   document: { getElementById: element, createElement: () => new Element(), createTextNode: (text: string) => ({ textContent: text }) },
   fetch: async (url: string) => {
    let value: unknown
    if (url === '/api/config') {
     requestTimes.get(id)!.push(now)
     if (!httpReady) throw new Error('HTTP unavailable')
     const timing = profile(++request)
     await sleep(timing.outbound)
     const status = await probe.readExact()
     statuses.push({ tab: id, at: now, ...status })
     value = { ...pins, threshold_custody: true, browser_threshold_wallet_ready: status.ready,
      browser_threshold_admission_ready: status.ready, recovery_only: false, fake_funding_policy: { digest: pins.fake_funding_policy_digest } }
     await sleep(timing.inbound)
    } else if (url === '/api/browser-release-pins') value = pins
    else if (url === '/api/validators') value = { validators: [] }
    else value = { state: { auctions: sellerAuction ? { test: { id: 'test', seller: 'a'.repeat(64), status: 'open', title: 'test', created_at: 1,
      end_time: 1900000000, original_end_time: 1900000000, high_bid: 0, min_increment: 1, starting_bid: 1, reserve: 0 } } : {}, bids: {}, height: height() } }
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => structuredClone(value) }
   },
   setInterval: (run: () => unknown, ms: number) => schedule(run, ms, id, ms),
   setTimeout: (run: () => unknown, ms: number) => schedule(run, ms, id), clearTimeout: (timer: number) => timers.delete(timer),
   performance: { now: () => now }, Date, AbortController, console,
  })
  contexts.push(context)
  vm.runInContext(readFileSync(new URL('../../internal/poc/static/ui-helpers.js', import.meta.url), 'utf8'), context)
  vm.runInContext(readFileSync(process.env.HLT_UI_APP ?? new URL('../../internal/poc/static/app.js', import.meta.url), 'utf8'), context)
  const run = (code: string) => vm.runInContext(code, context)
  await settle()
  return { id, run, ready: () => run('r20RuntimeReady()') as boolean, connected: () => connected, approvalSignal: () => approvalSignal,
   stop: () => { for (const [key, timer] of timers) if (timer.owner === id && timer.period) timers.delete(key) } }
 }
 const assertRateBound = () => {
  for (const times of requestTimes.values()) for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(4000)
  expect(maximumConcurrent).toBeLessThanOrEqual(1)
 }
 return { advance, newTab, statuses, requestTimes, assertRateBound, collections: () => collections,
  seller: () => { sellerAuction = true }, recover: () => { dependenciesReady = true }, fail: () => { dependenciesReady = false },
  http: (value: boolean) => { httpReady = value }, collection: (ms: number) => { collectMs = ms },
  transport: (value: typeof profile) => { profile = value }, stall: () => { stoppedHeight = height() }, resume: () => { stoppedHeight = null },
  async close() {
   closed = true
   for (const context of contexts) vm.runInContext('if (typeof stopSellerApprovals === "function") stopSellerApprovals()', context)
   for (const [id, timer] of timers) if (timer.period) timers.delete(id)
   await advance(now + 20000)
   expect(concurrent).toBe(0)
  } }
}

test('sole ordinary tab recovers after a prolonged dependency outage, without an external observer', async () => {
 const w = world()
 try {
  const tab = await w.newTab(); await w.advance(120000); expect(tab.ready()).toBe(false)
  w.recover(); await w.advance(140000); expect(tab.ready()).toBe(true)
  await tab.run('connect()'); expect(tab.connected()).toBe(1); w.assertRateBound()
  const restored = w.statuses.filter(status => status.at > 120000)
  expect(restored[0]?.reason).toBe('warming'); expect(restored.some(status => status.ready)).toBe(true)
 } finally { await w.close() }
})
test('sole tab exits capped HTTP-failure backoff and warms the backend after the first valid response', async () => {
 const w = world(); w.http(false)
 try {
  const tab = await w.newTab(); await w.advance(120000); expect(tab.ready()).toBe(false); expect(w.collections()).toBe(0)
  w.http(true); w.recover(); await w.advance(148000); expect(tab.ready()).toBe(true)
  expect(w.statuses[0]?.reason).toBe('warming'); expect(w.statuses.some(status => status.ready)).toBe(true); w.assertRateBound()
 } finally { await w.close() }
})
test('slow bounded collection and asymmetric transport do not add a completion-based warmup cooldown', async () => {
 const w = world(); w.collection(5000)
 try {
  await w.advance(100); const tab = await w.newTab(); await w.advance(120100)
  w.transport(request => request % 2 ? { outbound: 0, inbound: 2999 } : { outbound: 2999, inbound: 0 })
  w.recover(); await w.advance(180100); expect(tab.ready()).toBe(true); w.assertRateBound()
  const positive = w.statuses.filter(status => status.at > 120100)
  expect(positive.some(status => status.reason === 'warming')).toBe(true)
  expect(positive.some(status => status.ready)).toBe(true)
 } finally { await w.close() }
})
test('multiple tabs share backend collection, and one remaining tab can recover without the others', async () => {
 const w = world()
 try {
  const tabs = [await w.newTab(), await w.newTab(), await w.newTab()]
  await w.advance(60000); w.recover(); await w.advance(80000)
  for (const tab of tabs) expect(tab.ready()).toBe(true)
  tabs[1]!.stop(); tabs[2]!.stop()
  const stoppedCounts = [w.requestTimes.get(tabs[1]!.id)!.length, w.requestTimes.get(tabs[2]!.id)!.length]
  w.fail(); await w.advance(200000); expect(tabs[0]!.ready()).toBe(false)
  w.recover(); await w.advance(220000); expect(tabs[0]!.ready()).toBe(true)
  expect(w.requestTimes.get(tabs[1]!.id)!.length).toBe(stoppedCounts[0]); expect(w.requestTimes.get(tabs[2]!.id)!.length).toBe(stoppedCounts[1])
  w.assertRateBound()
 } finally { await w.close() }
})
test('real stopped height still expires and two new advances restore readiness without reviving consent', async () => {
 const w = world(); w.recover()
 try {
  const tab = await w.newTab(); await w.advance(20000); expect(tab.ready()).toBe(true); await tab.run('connect()')
  w.seller(); await w.advance(24000)
  const pay = tab.run('typeof stopSellerApprovals === "function"')
  if (pay) { tab.run('toggleSellerApprovals("test")'); await settle(); expect(tab.approvalSignal()).toBeDefined() }
  w.stall(); await w.advance(48000); expect(tab.ready()).toBe(false)
  expect(w.statuses.some(status => status.reason === 'progress_expired')).toBe(true)
  if (pay) {
   expect(tab.run('state.sellerAuctions.size')).toBe(0); expect(tab.approvalSignal()?.aborted).toBe(true)
  }
  w.resume(); await w.advance(52000); expect(tab.ready()).toBe(false)
  await w.advance(56000); expect(tab.ready()).toBe(true)
  if (pay) expect(tab.run('state.sellerAuctions.size')).toBe(0)
  w.assertRateBound()
 } finally { await w.close() }
})
test('renewed dependency failure closes a recovered sole tab and restoration still needs two advances', async () => {
 const w = world()
 try {
  const tab = await w.newTab(); await w.advance(60000); w.recover(); await w.advance(80000); expect(tab.ready()).toBe(true)
  w.fail(); await w.advance(84000); expect(tab.ready()).toBe(false)
  w.recover(); await w.advance(88000); expect(tab.ready()).toBe(false)
  await w.advance(92000); expect(tab.ready()).toBe(true); w.assertRateBound()
 } finally { await w.close() }
})
