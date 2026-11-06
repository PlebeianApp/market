/** Retry only these reviewed, body-bound reads. Unknown POSTs remain one-shot. */
const READ_SCHEMAS: Readonly<Record<string, string>> = Object.freeze({
 '/api/friday/deployment': 'PLEBEIAN_FRIDAY_TRUSTED_BROWSER_DEPLOYMENT_READ_V1',
 '/api/friday/auction-funding/read': 'PLEBEIAN_FRIDAY_TRUSTED_AUCTION_FUNDING_READ_V1',
 '/api/friday/seller-plan/pending': 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_PENDING_READ_V1',
 '/api/friday/seller-plan/challenge': 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_CHALLENGE_READ_V1',
 '/api/friday/seller-plan/read': 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_READ_V1',
})
type Transport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type Shared = { tail: Promise<void>; pending: Map<string, Promise<Response>> }
const shared = new WeakMap<Transport, Map<string, Shared>>()
export function createFridayTrustReadTransport(origin: string, fetchImpl: Transport, options: {
 now?: () => number; random?: () => number; sleep?: (ms: number) => Promise<void>;
 lock?: <T>(run: () => Promise<T>) => Promise<T>;
} = {}): Transport {
 const now = options.now ?? Date.now, random = options.random ?? Math.random
 const sleep = options.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)))
 let origins = shared.get(fetchImpl)
 if (!origins) { origins = new Map(); shared.set(fetchImpl, origins) }
 let state = origins.get(origin)
 if (!state) { state = {tail: Promise.resolve(), pending: new Map()}; origins.set(origin, state) }
 const held = state
 const lock = options.lock ?? (async <T>(run: () => Promise<T>): Promise<T> =>
  typeof navigator !== 'undefined' && navigator.locks
   ? await navigator.locks.request(`plebeian-trust-reads:${origin}`, run) : await run())
 return async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  let schema: unknown
  if (typeof init?.body === 'string') { try { schema = JSON.parse(init.body)?.schema } catch {} }
  const safe = !(input instanceof Request) && url.origin === origin && !url.search && !url.hash
   && init?.method === 'POST' && typeof schema === 'string' && READ_SCHEMAS[url.pathname] === schema
  if (!safe) return fetchImpl(input, init)
  input = url.href
  init = {...init, headers: new Headers(init?.headers)}
  init?.signal?.throwIfAborted()
  const key = JSON.stringify([url.href, init.body, [...new Headers(init.headers).entries()].sort(), init.credentials])
  const run = () => lock(async () => {
   try {
    for (let attempt = 0; ; attempt++) {
     init?.signal?.throwIfAborted()
     const response = await fetchImpl(input, {...init, redirect: 'error',
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)})
     if (response.status !== 429 || attempt >= 2) return response
     const value = response.headers.get('retry-after')
     const parsed = value === null ? 0 : /^\d+$/.test(value.trim()) ? Number(value.trim()) * 1000 : Date.parse(value) - now()
     if (Number.isFinite(parsed) && parsed > 10_000) return response
     const delay = Math.max(Number.isFinite(parsed) ? parsed : 0, 750 * 2 ** attempt)
      + Math.floor(Math.max(0, Math.min(1, random())) * 250)
     void response.body?.cancel().catch(() => {})
     await sleep(delay)
    }
   } finally { await sleep(350) }
  })
  // No settled-response cache, and never join independently cancellable reads.
  let pending = !init.signal ? held.pending.get(key) : undefined
  if (!pending) {
   pending = held.tail.then(run)
   held.tail = pending.then(() => {}, () => {})
   if (!init.signal) {
    held.pending.set(key, pending)
    void pending.finally(() => { if (held.pending.get(key) === pending) held.pending.delete(key) }).catch(() => {})
   }
  }
  return (await pending).clone()
 }
}
