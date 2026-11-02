/** Independent regression: executes the exact frozen nested mint reader with synthetic HTTP only. */
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { supportedNutNumbers } from './demo-sigall-live-mint'
import { CashuMintClient } from './nut-client'
import { demoDenominationKeyDigest } from './demo-sigall-settlement'
import { matchingFridayMint, validateFridayHealthConfig } from './demo-friday-health-config'
import { createFridayReadinessProbe, type FridayHealthPins } from './demo-friday-readiness'

const mintUrl = 'https://mint.example', pubkey = '02' + '1'.repeat(64)
const keys = { '1': pubkey, '2': '03' + '2'.repeat(64) }
const pins: FridayHealthPins = { deploymentId: 'deployment', chainId: 'chain', genesisSha256: 'a'.repeat(64),
 validatorsHash: 'b'.repeat(64), committeeKeysetId: 'committee', committeeKeysetVersion: '1', dkgRunId: 'dkg',
 publicKeyPackageSha256: 'c'.repeat(64), signerRosterDigest: 'd'.repeat(64), mintUrl }
const config = validateFridayHealthConfig({ schema: 'PLEBEIAN_FRIDAY_HEALTH_PINS_V1', pins,
 mint: { mintPublicKey: pubkey, serverVersion: 'version', activeSatKeysetId: 'sat-keyset', denominationKeyDigest: demoDenominationKeyDigest(keys) },
 mintConformanceReceiptSha256: 'e'.repeat(64) }, pins)
const source = readFileSync(new URL('./demo-friday-authority-cli.ts', import.meta.url), 'utf8')
const start = source.indexOf('const readLiveDeployment = async (signal?: AbortSignal) => {')
const end = source.indexOf('const browserTrust =', start)
if (start < 0 || end < start) throw new Error('exact nested reader not found')
const body = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end))
const compile = new Function('CashuMintClient', 'mintUrl', 'mintFetch', 'application', 'facts', 'demoDenominationKeyDigest', 'dkg', 'supportedNutNumbers', body + '\nreturn readLiveDeployment')
function nutSettings() { return { '4': { disabled: false, methods: [{ method: 'bolt11', unit: 'sat' }] },
 '7': { supported: true }, '9': { supported: true }, '10': { supported: true }, '11': { supported: true }, '12': { supported: true } } as Record<string, unknown> }
async function readyWith(nuts: Record<string, unknown>) {
 const calls: string[] = []
 const mintFetch = (async (url: URL | string) => {
  const path = new URL(url).pathname; calls.push(path)
  if (path === '/v1/info') return Response.json({ pubkey, version: 'version', nuts })
  if (path === '/v1/keysets') return Response.json({ keysets: [{ id: 'sat-keyset', unit: 'sat', active: true, input_fee_ppk: 0 }] })
  if (path === '/v1/keys/sat-keyset') return Response.json({ keysets: [{ id: 'sat-keyset', unit: 'sat', keys }] })
  throw new Error('unexpected synthetic route: ' + path)
 }) as typeof fetch
 const read = compile(CashuMintClient, mintUrl, mintFetch, { deployment_id: pins.deploymentId },
  { chain_id: pins.chainId, genesis_sha256: pins.genesisSha256 }, demoDenominationKeyDigest,
  { ...pins, committeePublicKey: pubkey, participants: [] }, supportedNutNumbers)
 let now = 0, height = 10
 const probe = createFridayReadinessProbe({ pins, now: () => now, collect: async () => {
  const live = await read()
  return { pins, height, authorityReady: true, readySigners: [1, 2, 3], mintReady: matchingFridayMint(live.mintSnapshot, config) }
 } })
 expect((await probe.readExact()).ready).toBe(false)
 now = 1_000; height++
 const result = await probe.readExact()
 expect(calls).toEqual(['/v1/info', '/v1/keysets', '/v1/keys/sat-keyset', '/v1/info', '/v1/keysets', '/v1/keys/sat-keyset'])
 return result.ready
}
test('control: genuinely advertised enabled capabilities can warm up', async () => {
 expect(await readyWith(nutSettings())).toBe(true)
})
test('regression: explicitly disabled minting must suppress readiness', async () => {
 const nuts = nutSettings(); nuts['4'] = { disabled: true, methods: [{ method: 'bolt11', unit: 'sat' }] }
 expect(await readyWith(nuts)).toBe(false)
})
test('regression: no supported sat bolt11 mint method must suppress readiness', async () => {
 const nuts = nutSettings(); nuts['4'] = { disabled: false, methods: [{ method: 'bolt11', unit: 'usd' }] }
 expect(await readyWith(nuts)).toBe(false)
})
for (const nut of [7, 9, 10, 11, 12]) test(`regression: explicitly unsupported NUT ${nut} must suppress readiness`, async () => {
 const nuts = nutSettings(); nuts[String(nut)] = { supported: false }
 expect(await readyWith(nuts)).toBe(false)
})
