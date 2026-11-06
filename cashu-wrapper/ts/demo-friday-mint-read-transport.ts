/** Per-wallet safe-read pacing. Never caches completed metadata or replays mutations. */
export function createFridayMintReadTransport(fetchImpl: typeof fetch, options: {
 now?: () => number; random?: () => number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
} = {}): typeof fetch {
 const now = options.now ?? Date.now;
 const random = options.random ?? Math.random;
 const sleep = options.sleep ?? ((ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal?.throwIfAborted();
  const abort = () => { clearTimeout(timer); reject(signal?.reason); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
 }));
 let nextRead = 0;
 const pending = new Map<string, Promise<Response>>();
 return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined) ?? undefined;
  signal?.throwIfAborted();
  const metadata = /^\/v1\/(?:info|keysets|keys(?:\/[A-Za-z0-9_-]+)?)$/.test(url.pathname) && !url.search;
  const safe = method === 'GET' && (metadata || /^\/v1\/mint\/quote\/bolt11\/[A-Za-z0-9_-]+$/.test(url.pathname) && !url.search);
  if (!safe) return fetchImpl(input, init);
  const run = async () => {
   for (let attempt = 0; ; attempt++) {
    // Do not reserve a stale future slot: another response may extend the
    // shared cooldown while this caller sleeps. Recheck on every wake, then
    // claim the next slot synchronously so concurrent waiters stay spaced.
    for (;;) {
     signal?.throwIfAborted();
     const remaining = nextRead - now();
     if (remaining <= 0) break;
     await sleep(remaining, signal);
    }
    signal?.throwIfAborted();
    nextRead = now() + 250;
    const response = await fetchImpl(input, init);
    if (response.status !== 429 || attempt >= 2) return response;
    const header = response.headers.get('retry-after');
    let retryAfter = 0;
    if (header !== null) {
     retryAfter = /^\d+$/.test(header.trim()) ? Number(header.trim()) * 1000 : Date.parse(header) - now();
     // Never retry earlier than a server deadline beyond our bounded wait budget.
     if (Number.isFinite(retryAfter) && retryAfter > 10_000) return response;
     if (!Number.isFinite(retryAfter)) retryAfter = 0;
    }
    const delay = Math.max(Math.max(0, retryAfter), 500 * 2 ** attempt) + Math.floor(Math.min(1, Math.max(0, random())) * 250);
    nextRead = Math.max(nextRead, now() + delay);
    void response.body?.cancel().catch(() => {});
   }
  };
  // Requests with credentials or cancellation stay independent.
  // A caller's abort must not cancel another caller's shared request.
  const share = metadata && !(input instanceof Request) && !signal && !init?.credentials;
  if (!share) return run();
  const key = JSON.stringify([url.href, [...new Headers(init?.headers).entries()].sort()]);
  let held = pending.get(key);
  if (!held) {
   held = run(); pending.set(key, held);
   void held.finally(() => { if (pending.get(key) === held) pending.delete(key); }).catch(() => {});
  }
  return (await held).clone();
 }) as typeof fetch;
}
