/** Challenge-bound, nonce-free signer status. This protocol never claims a signing journal. */
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import type { DemoSignerDurableBindingV1, DemoSignerCoordinatorAnchorPort } from './demo-signer-rpc'
import { sameHealthPins, type FridayHealthPins } from './demo-friday-readiness'
function canonical(v: unknown): string {
 if (v === null || typeof v !== 'object') return JSON.stringify(v)
 if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
 const r = v as Record<string, unknown>
 return `{${Object.keys(r).sort().map(k => `${JSON.stringify(k)}:${canonical(r[k])}`).join(',')}}`
}
function digest(domain: string, value: unknown): Uint8Array { return sha256(utf8ToBytes(domain + '\n' + canonical(value))) }
interface Request { schema: 'FRIDAY_SIGNER_HEALTH_REQUEST_V1'; challenge: string; participantId: number; issuedAt: number; signature: string }
interface Reply { schema: 'FRIDAY_SIGNER_HEALTH_REPLY_V1'; challenge: string; pins: FridayHealthPins; binding: DemoSignerDurableBindingV1; ready: boolean; processInstanceId: string; signature: string }
export function createFridaySignerHealthHandler(options: {
 pins: FridayHealthPins; participantId: number; coordinatorIdentity: string; signerPrivate: Uint8Array; processInstanceId: string
 binding(): Promise<DemoSignerDurableBindingV1>; assertReady(): Promise<void>; now?: () => number
 serialize?<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T>
}) {
 return async (raw: unknown, signal: AbortSignal = new AbortController().signal): Promise<Reply> => {
  const r = raw as Request, now = (options.now ?? Date.now)()
  if (!Number.isFinite(now) || r?.schema !== 'FRIDAY_SIGNER_HEALTH_REQUEST_V1' || !/^[0-9a-f]{64}$/.test(r.challenge)
   || r.participantId !== options.participantId || !Number.isSafeInteger(r.issuedAt) || Math.abs(now - r.issuedAt) > 5_000
   || Object.keys(r).sort().join(',') !== 'challenge,issuedAt,participantId,schema,signature') throw new Error('HEALTH_AUTHENTICATION')
  const { signature, ...unsigned } = r
  if (!schnorr.verify(hexToBytes(signature), digest('FRIDAY_HEALTH_REQUEST', unsigned), hexToBytes(options.coordinatorIdentity))) throw new Error('HEALTH_AUTHENTICATION')
  const read = async (): Promise<Reply> => {
  if (signal.aborted || Math.abs((options.now ?? Date.now)() - r.issuedAt) > 5_000) throw new Error('HEALTH_CANCELLED_OR_EXPIRED')
  let ready = false
  try { await options.assertReady(); ready = true } catch { /* signed false; no safety state reset */ }
  const reply = { schema: 'FRIDAY_SIGNER_HEALTH_REPLY_V1' as const, challenge: r.challenge,
   pins: options.pins, binding: await options.binding(), ready, processInstanceId: options.processInstanceId }
  if (signal.aborted) throw new Error('HEALTH_CANCELLED')
  return { ...reply, signature: bytesToHex(schnorr.sign(digest('FRIDAY_HEALTH_REPLY', reply), options.signerPrivate)) }
  }
  return options.serialize ? options.serialize(signal, read) : read()
 }
}
export async function probeFridaySignerHealth(options: {
 endpoint: string; participantId: number; signerIdentity: string; coordinatorSecret: Uint8Array
 pins: FridayHealthPins; enrollment: DemoSignerDurableBindingV1; anchor: DemoSignerCoordinatorAnchorPort
 signal: AbortSignal; fetch?: typeof fetch; now?: () => number
}): Promise<number | null> {
 const url = new URL(options.endpoint), host = url.hostname.replaceAll('[', '').replaceAll(']', '')
 if (url.protocol !== 'http:' || isIP(host) !== 6 || !/^(fc|fd)/i.test(host) || host.includes('%')
  || url.username || url.password || url.search || url.hash || url.pathname !== '/v1/frost') throw new Error('HEALTH_ENDPOINT_BINDING')
 url.pathname = '/v1/health'
 const unsigned = { schema: 'FRIDAY_SIGNER_HEALTH_REQUEST_V1' as const, challenge: randomBytes(32).toString('hex'),
  participantId: options.participantId, issuedAt: (options.now ?? Date.now)() }
 const request: Request = { ...unsigned, signature: bytesToHex(schnorr.sign(digest('FRIDAY_HEALTH_REQUEST', unsigned), options.coordinatorSecret)) }
 const response = await (options.fetch ?? fetch)(url, { method: 'POST', redirect: 'error', signal: options.signal,
  headers: { 'content-type': 'application/json', 'x-plebeian-fips-plaintext-probe': 'PLEBEIAN-FRIDAY-SIGNER-TRANSPORT-V1' }, body: JSON.stringify(request) })
 if (options.signal.aborted || !response.ok || response.body === null) throw new Error('HEALTH_RESPONSE')
 const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
 try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length
  if (size > 16_384) { await reader.cancel(); throw new Error('HEALTH_RESPONSE_SIZE') }; chunks.push(part.value) } }
 finally { reader.releaseLock() }
 const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
 const reply = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Reply
 const { signature, ...value } = reply
 if (reply.schema !== 'FRIDAY_SIGNER_HEALTH_REPLY_V1' || reply.challenge !== request.challenge || !sameHealthPins(reply.pins, options.pins)
  || !/^[0-9a-f]{64}$/.test(reply.processInstanceId) || typeof reply.ready !== 'boolean' || !schnorr.verify(hexToBytes(signature), digest('FRIDAY_HEALTH_REPLY', value), hexToBytes(options.signerIdentity))) throw new Error('HEALTH_RESPONSE_BINDING')
 const expected = options.enrollment, binding = reply.binding
 for (const key of Object.keys(expected) as (keyof DemoSignerDurableBindingV1)[]) {
  if (key !== 'restartEpoch' && binding[key] !== expected[key]) throw new Error('HEALTH_ENROLLMENT_BINDING')
 }
 if (binding.keysetId !== options.pins.committeeKeysetId || binding.keysetVersion !== options.pins.committeeKeysetVersion
  || binding.dkgRunId !== options.pins.dkgRunId || binding.publicKeyPackageSha256 !== options.pins.publicKeyPackageSha256
  || binding.signerRosterDigest !== options.pins.signerRosterDigest
  || binding.participantId !== options.participantId || binding.processIdentity !== options.signerIdentity
  || !Number.isSafeInteger(binding.restartEpoch) || binding.restartEpoch !== expected.restartEpoch) throw new Error('HEALTH_EPOCH_BINDING')
 // Health observes only the epoch already usable by the active transport.
 // Signed false cannot initialize or change coordinator epoch/process state.
 if (options.signal.aborted) throw new Error('HEALTH_CANCELLED')
 if (!reply.ready) return null
 await options.anchor.assertCurrent(binding)
 if (options.signal.aborted) throw new Error('HEALTH_CANCELLED')
 await options.anchor.observeProcess(binding, reply.processInstanceId)
 if (options.signal.aborted) throw new Error('HEALTH_CANCELLED')
 return options.participantId
}

/** One unavailable/hung participant cannot withhold a healthy three-member set. */
export async function collectFridayReadySigners(
 readers: Array<(signal: AbortSignal) => Promise<number | null>>, signal: AbortSignal,
): Promise<number[]> {
 const results = await Promise.all(readers.map(async read => {
  const stop = new AbortController(), abort = () => stop.abort()
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) stop.abort()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
   return await Promise.race([read(stop.signal), new Promise<null>(resolve => {
    timer = setTimeout(() => { stop.abort(); resolve(null) }, 2_000)
   })])
  } catch { return null }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort); stop.abort() }
 }))
 return results.filter((id): id is number => id !== null)
}
