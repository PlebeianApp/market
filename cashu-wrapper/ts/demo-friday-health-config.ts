/** Independent reviewed mint identity input. Live observations never establish these pins. */
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { sameHealthPins, type FridayHealthPins } from './demo-friday-readiness'
export const FRIDAY_HEALTH_CONFIG = '/etc/plebeian-auctions-friday/health-r20-pins.json'
export interface FridayMintHealthPins {
 mintPublicKey: string; activeSatKeysetId: string; denominationKeyDigest: string; serverVersion: string
}
export interface FridayHealthConfig {
 schema: 'PLEBEIAN_FRIDAY_HEALTH_PINS_V1'; pins: FridayHealthPins
 mint: FridayMintHealthPins; mintConformanceReceiptSha256: string
}
export function validateFridayHealthConfig(value: FridayHealthConfig, pins: FridayHealthPins): FridayHealthConfig {
 if (value?.schema !== 'PLEBEIAN_FRIDAY_HEALTH_PINS_V1' || !sameHealthPins(value.pins, pins)
  || !/^[0-9a-f]{64}$/.test(value.mintConformanceReceiptSha256)
  || !/^(02|03)[0-9a-f]{64}$/.test(value.mint?.mintPublicKey)
  || !/^[A-Za-z0-9_-]{1,160}$/.test(value.mint?.activeSatKeysetId)
  || !/^[0-9a-f]{64}$/.test(value.mint?.denominationKeyDigest)
  || typeof value.mint?.serverVersion !== 'string' || value.mint.serverVersion.length < 1
  || Object.keys(value).sort().join(',') !== 'mint,mintConformanceReceiptSha256,pins,schema'
  || Object.keys(value.mint).sort().join(',') !== 'activeSatKeysetId,denominationKeyDigest,mintPublicKey,serverVersion') throw new Error('HEALTH_CONFIG_BINDING')
 return structuredClone(value)
}
export async function loadFridayHealthConfig(pins: FridayHealthPins): Promise<FridayHealthConfig | undefined> {
 const expected = process.env.POC_FRIDAY_HEALTH_PINS_SHA256 ?? ''
 if (!/^[0-9a-f]{64}$/.test(expected)) return undefined
 try {
  const file = await open(FRIDAY_HEALTH_CONFIG, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
   const before = await file.stat()
   if (!before.isFile() || before.nlink !== 1 || before.uid !== 0 || before.gid !== process.getegid!()
    || (before.mode & 0o777) !== 0o640 || before.size > 16_384) throw new Error('HEALTH_CONFIG_FILE')
   const data = Buffer.alloc(16_385); const { bytesRead } = await file.read(data, 0, data.length, 0)
   const after = await file.stat(), raw = data.subarray(0, bytesRead)
   if (bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
    || after.ctimeMs !== before.ctimeMs || createHash('sha256').update(raw).digest('hex') !== expected) throw new Error('HEALTH_CONFIG_HASH')
   return validateFridayHealthConfig(JSON.parse(raw.toString('utf8')) as FridayHealthConfig, pins)
  } finally { await file.close() }
 } catch { return undefined }
}
export function matchingFridayMint(snapshot: FridayMintHealthPins & { mintUrl: string; inputFeePpk: number; nuts: number[] }, config: FridayHealthConfig): boolean {
 return snapshot.mintUrl === config.pins.mintUrl && snapshot.inputFeePpk === 0
  && [4, 7, 9, 10, 11, 12].every(nut => snapshot.nuts.includes(nut))
  && Object.entries(config.mint).every(([key, value]) => snapshot[key as keyof FridayMintHealthPins] === value)
}

/** The current canonical application must agree with the independently held pins. */
export function matchingFridayConsensusPins(state: unknown, expected: Record<string, string>): boolean {
 if (state === null || typeof state !== 'object') return false
 const raw = state as Record<string, unknown>, pins = raw.funding_abort_pins
 if (raw.chain_id !== expected.chainId || pins === null || typeof pins !== 'object' || Array.isArray(pins)) return false
 const observed = pins as Record<string, unknown>
 return Object.entries(expected).every(([key, value]) => observed[key] === value)
}
