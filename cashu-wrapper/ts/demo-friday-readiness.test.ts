import { createHash } from 'node:crypto'
import { authenticatedDemoCometState } from './demo-comet-displacement-verifier'
import { describe, test, expect } from 'bun:test'
import { FridayReadiness, createFridayReadinessProbe, type FridayHealthPins, type FridayReadinessSample } from './demo-friday-readiness'
import { validateFridayHealthConfig, matchingFridayMint, matchingFridayConsensusPins } from './demo-friday-health-config'
export const healthPins: FridayHealthPins = { deploymentId: 'deployment', chainId: 'chain', genesisSha256: 'a'.repeat(64),
 validatorsHash: 'b'.repeat(64), committeeKeysetId: 'keyset', committeeKeysetVersion: '2', dkgRunId: 'dkg',
 publicKeyPackageSha256: 'c'.repeat(64), signerRosterDigest: 'd'.repeat(64), mintUrl: 'https://mint.example' }
function fixture() {
 let now = 0
 const machine = new FridayReadiness(healthPins, () => now)
 const sample = (height: number, changes: Partial<FridayReadinessSample> = {}) => machine.observe({
  pins: healthPins, observedAt: now, height, authorityReady: true, mintReady: true, readySigners: [1, 2, 3], ...changes })
 return { machine, sample, set: (value: number) => { now = value } }
}
describe('HLT-001 elapsed progress and composite readiness', () => {
 test('cold starts false; two spaced increases; unchanged height expires and recovery warms twice', () => {
  const f = fixture(); expect(f.sample(10).ready).toBe(false)
  f.set(999); expect(f.sample(11).ready).toBe(false)
  f.set(1_000); expect(f.sample(11).ready).toBe(true)
  f.set(20_999); expect(f.sample(11).ready).toBe(true)
  f.set(21_000); expect(f.sample(11)).toMatchObject({ ready: false, reason: 'progress_expired' })
  f.set(22_000); expect(f.sample(12).ready).toBe(false)
  f.set(23_000); expect(f.sample(13).ready).toBe(true)
  expect(fixture().sample(13).ready).toBe(false)
 })
 test('stale advancing response cannot bridge long unobserved gap', () => {
  const f = fixture(); f.sample(1); f.set(1_000); f.sample(2)
  f.set(22_000); expect(f.sample(100).ready).toBe(false)
 })
 test('height regression retains high water and requires recovery above it', () => {
  const f = fixture(); f.sample(10); f.set(1_000); f.sample(11)
  f.set(2_000); expect(f.sample(9)).toMatchObject({ ready: false, height: 11 })
  f.set(3_000); expect(f.sample(12).ready).toBe(false)
  f.set(4_000); expect(f.sample(13).ready).toBe(true)
 })
 for (const [name, value] of Object.entries(healthPins)) test(`rejects wrong ${name}`, () => {
  const f = fixture(); expect(f.sample(1, { pins: { ...healthPins, [name]: value + 'wrong' } }).ready).toBe(false)
 })
 test('stale/future observations and clock rollback refuse', () => {
  const f = fixture(); f.set(10_000)
  expect(f.sample(1, { observedAt: 4_999 }).reason).toBe('sample_expired')
  expect(f.sample(1, { observedAt: 10_001 }).reason).toBe('sample_expired')
  f.set(9_999); expect(f.sample(1).reason).toBe('clock_invalid')
 })
 test('one unavailable signer permits 3/4; two unavailable or duplicates refuse', () => {
  const f = fixture(); f.sample(1, { readySigners: [1, 2, 4] }); f.set(1_000)
  expect(f.sample(2, { readySigners: [1, 2, 4] }).ready).toBe(true)
  expect(f.sample(3, { readySigners: [1, 4] }).reason).toBe('signer_threshold')
  expect(f.sample(3, { readySigners: [1, 1, 4] }).ready).toBe(false)
 })
 for (const field of ['authorityReady', 'mintReady'] as const) test(`${field} failure resets recovery streak`, () => {
  const f = fixture(); f.sample(1); f.set(1_000); f.sample(2)
  expect(f.sample(3, { [field]: false }).ready).toBe(false)
  f.set(2_000); expect(f.sample(3).ready).toBe(false)
  f.set(3_000); expect(f.sample(4).ready).toBe(true)
 })
 test('collection timeout/error fails closed; coalesces and ignores late success', async () => {
  let calls = 0, late!: (v: Omit<FridayReadinessSample, 'observedAt'>) => void
  const probe = createFridayReadinessProbe({ pins: healthPins, timeoutMs: 5,
   collect: async () => { calls++; return new Promise(resolve => { late = resolve }) } })
  const one = probe.readExact(), two = probe.readExact(); expect(one).toBe(two)
  expect((await one).ready).toBe(false); expect(calls).toBe(1)
  late({ pins: healthPins, height: 10, mintReady: true, authorityReady: true, readySigners: [1, 2, 3] })
  const errors = createFridayReadinessProbe({ pins: healthPins, collect: async () => { throw new Error('down') } })
  expect((await errors.readExact()).reason).toBe('dependency_error')
 })
 test('mint identity/keyset/denominations are independently pinned; advertised NUTs are insufficient', () => {
  const mint = { mintPublicKey: '02' + '1'.repeat(64), activeSatKeysetId: 'sat-keyset', denominationKeyDigest: 'e'.repeat(64), serverVersion: 'version' }
  const config = validateFridayHealthConfig({ schema: 'PLEBEIAN_FRIDAY_HEALTH_PINS_V1', pins: healthPins, mint,
   mintConformanceReceiptSha256: 'f'.repeat(64) }, healthPins)
  const snapshot = { ...mint, mintUrl: healthPins.mintUrl, inputFeePpk: 0, nuts: [4, 7, 9, 10, 11, 12] }
  expect(matchingFridayMint(snapshot, config)).toBe(true)
  for (const key of Object.keys(mint)) expect(matchingFridayMint({ ...snapshot, [key]: 'wrong' }, config)).toBe(false)
  expect(matchingFridayMint({ ...snapshot, nuts: [] }, config)).toBe(false)
  expect(() => validateFridayHealthConfig({ ...config, mintConformanceReceiptSha256: '' }, healthPins)).toThrow()
 })
})

test('canonical state must agree with pinned mint keyset and deployment payment domain', () => {
 const pins = { authNetworkId: 'chain', chainId: 'chain', genesisSha256: 'a'.repeat(64), mintUrl: healthPins.mintUrl,
  activeKeysetId: 'keyset', committeeKeysetId: 'committee', committeePublicKey: '02' + '1'.repeat(64) }
 const state = { chain_id: 'chain', funding_abort_pins: pins }
 expect(matchingFridayConsensusPins(state, pins)).toBe(true)
 for (const field of Object.keys(pins)) expect(matchingFridayConsensusPins({ ...state,
  funding_abort_pins: { ...pins, [field]: 'wrong' } }, pins)).toBe(false)
 expect(matchingFridayConsensusPins({ ...state, funding_abort_pins: undefined }, pins)).toBe(false)
})

test('cancelled next-header collection stops without continuing the retry window', async () => {
 const abort = new AbortController(); let commits = 0
 const state = { height: 1, chain_id: 'chain' }, canonicalStateBytes = new TextEncoder().encode(JSON.stringify(state))
 const reader = {
  async readCurrentState() { return { queryHeight: 1, state, canonicalStateBytes,
   appHash: createHash('sha256').update(canonicalStateBytes).digest('hex') } },
  async readCommit() { commits++; abort.abort(); throw new Error('unavailable') },
 }
 await expect(authenticatedDemoCometState(reader as never, healthPins.validatorsHash, 1, abort.signal)).rejects.toThrow('aborted')
 expect(commits).toBe(1)
})
