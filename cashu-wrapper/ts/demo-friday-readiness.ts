/** Availability only: authenticated adapters own trust, this machine owns elapsed time. */
export interface FridayHealthPins {
 deploymentId: string; chainId: string; genesisSha256: string; validatorsHash: string
 committeeKeysetId: string; committeeKeysetVersion: string; dkgRunId: string
 publicKeyPackageSha256: string; signerRosterDigest: string; mintUrl: string
}
export interface FridayReadinessSample {
 pins: FridayHealthPins; observedAt: number; height: number; authorityReady: boolean
 mintReady: boolean; readySigners: number[]
}
export interface FridayReadinessStatus { ready: boolean; reason: string; height: number }
export const HEALTH_SAMPLE_MS = 5_000, HEALTH_PROGRESS_MS = 20_000, HEALTH_SPACING_MS = 1_000
export function sameHealthPins(a: FridayHealthPins, b: FridayHealthPins): boolean {
 return Object.keys(b).length === 10 && Object.keys(a).length === 10
  && Object.entries(b).every(([k, v]) => typeof v === 'string' && v.length > 0 && a[k as keyof FridayHealthPins] === v)
}
export class FridayReadiness {
 private high = 0; private lastClock = -Infinity; private lastSample = -Infinity
 private progressed = -Infinity; private streak = 0
 private status: FridayReadinessStatus = { ready: false, reason: 'startup', height: 0 }
 constructor(private readonly pins: FridayHealthPins, private readonly now = () => performance.now()) {
  if (!sameHealthPins(pins, pins)) throw new Error('HEALTH_PINS_INVALID')
 }
 fail(reason: string): FridayReadinessStatus {
  this.streak = 0; this.lastSample = -Infinity
  return this.status = { ready: false, reason, height: this.high }
 }
 observe(sample: FridayReadinessSample): FridayReadinessStatus {
  const now = this.now()
  if (!Number.isFinite(now) || now < this.lastClock) return this.fail('clock_invalid')
  this.lastClock = now
  if (!Number.isFinite(sample.observedAt) || sample.observedAt > now || now - sample.observedAt > HEALTH_SAMPLE_MS
   || sample.observedAt < this.lastSample) return this.fail('sample_expired')
  if (!sameHealthPins(sample.pins, this.pins) || !sample.authorityReady || !sample.mintReady) return this.fail('dependency_unready')
  const ids = new Set(sample.readySigners)
  if (ids.size !== sample.readySigners.length || ids.size < 3 || [...ids].some(id => ![1, 2, 3, 4].includes(id))) return this.fail('signer_threshold')
  if (!Number.isSafeInteger(sample.height) || sample.height < 1 || sample.height < this.high) return this.fail('height_invalid')
  if (sample.height === this.high) {
   if (now - this.progressed >= HEALTH_PROGRESS_MS) return this.fail('progress_expired')
   return this.status
  }
  // A large gap invalidates continuity, even when the newly sampled height increased.
  if (now - this.progressed >= HEALTH_PROGRESS_MS) this.streak = 0
  if (sample.observedAt - this.lastSample < HEALTH_SPACING_MS) return this.status
  this.high = sample.height; this.progressed = sample.observedAt; this.lastSample = sample.observedAt; this.streak++
  return this.status = { ready: this.streak >= 2, reason: this.streak >= 2 ? 'ready' : 'warming', height: this.high }
 }
}
/** Bounded, coalesced request-time collection. Late results cannot mutate the machine. */
export function createFridayReadinessProbe(options: {
 pins: FridayHealthPins; collect(signal: AbortSignal): Promise<Omit<FridayReadinessSample, 'observedAt'>>
 now?: () => number; timeoutMs?: number
}) {
 const now = options.now ?? (() => performance.now()), machine = new FridayReadiness(options.pins, now)
 const timeout = options.timeoutMs ?? HEALTH_SAMPLE_MS
 if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > HEALTH_SAMPLE_MS) throw new Error('HEALTH_TIMEOUT_INVALID')
 let pending: Promise<FridayReadinessStatus> | undefined
 return { readExact(): Promise<FridayReadinessStatus> {
  if (pending !== undefined) return pending
  pending = (async () => {
   const started = now(), abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
   try {
    const sample = await Promise.race([options.collect(abort.signal), new Promise<never>((_, reject) => {
     timer = setTimeout(() => { abort.abort(); reject(new Error('timeout')) }, timeout)
    })])
    if (abort.signal.aborted) return machine.fail('dependency_timeout')
    return machine.observe({ ...sample, observedAt: started })
   } catch { return machine.fail('dependency_error') }
   finally { clearTimeout(timer); abort.abort(); pending = undefined }
  })()
  return pending
 } }
}
