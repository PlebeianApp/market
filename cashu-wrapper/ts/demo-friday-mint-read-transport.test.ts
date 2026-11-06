import { expect, test } from 'bun:test'
import { createFridayMintReadTransport } from './demo-friday-mint-read-transport'
import { readFileSync } from 'node:fs'
const origin = 'https://mint.example'
function response(status = 200, retry?: string) {
 const r = new Response('{}', { status, headers: retry === undefined ? {} : {'retry-after': retry} })
 Object.defineProperty(r, 'url', {value: `${origin}/v1/info`}); return r
}
function fixture(replies: Response[]) {
 let time = 0, calls = 0; const waits: number[] = []
 const transport = createFridayMintReadTransport((async () => { calls++; return replies.shift()! }) as unknown as typeof fetch,
 {now: () => time, random: () => 0.5, sleep: async ms => { waits.push(ms); time += ms }})
 return {transport, waits, calls: () => calls}
}
test('safe reads honor Retry-After, pace and bound retries', async () => {
 const f = fixture([response(429, '2'), response(429, '0'), response()])
 expect((await f.transport(`${origin}/v1/info`)).status).toBe(200)
 expect(f.calls()).toBe(3); expect(f.waits).toEqual([2125, 1125])
 const exhausted = fixture([response(429), response(429), response(429)])
 expect((await exhausted.transport(`${origin}/v1/keysets`)).status).toBe(429)
 expect(exhausted.calls()).toBe(3)
})
test('date and long Retry-After never retry early', async () => {
 const f = fixture([response(429, new Date(3000).toUTCString()), response()])
 await f.transport(`${origin}/v1/info`); expect(f.waits).toEqual([3125])
 const long = fixture([response(429, '11')]); expect((await long.transport(`${origin}/v1/info`)).status).toBe(429)
 expect(long.calls()).toBe(1)
})
test('mutations and non-allowlisted reads are never replayed', async () => {
 for (const [path, method] of [['/v1/swap','POST'], ['/v1/mint/bolt11','POST'], ['/v1/mint/quote/bolt11','POST'], ['/v1/checkstate','POST'], ['/other','GET']]) {
  const f = fixture([response(429, '1')]); expect((await f.transport(origin + path, {method})).status).toBe(429); expect(f.calls()).toBe(1)
 }
})
test('concurrent metadata joins, completed metadata is fresh', async () => {
 const f = fixture([response(), response()])
 const [a,b] = await Promise.all([f.transport(`${origin}/v1/info`, {headers:{accept:'application/json'}}), f.transport(`${origin}/v1/info`, {headers:{accept:'application/json'}})])
 expect(f.calls()).toBe(1); expect(await a.json()).toEqual({}); expect(await b.json()).toEqual({})
 await f.transport(`${origin}/v1/info`); expect(f.calls()).toBe(2); expect(f.waits).toEqual([250])
})
test('pre-aborted requests do not reach mint', async () => {
 const f = fixture([]); const c = new AbortController(); c.abort(new Error('cancelled'))
 await expect(f.transport(`${origin}/v1/info`, {signal:c.signal})).rejects.toThrow('cancelled'); expect(f.calls()).toBe(0)
})
test('NUT-17 exact route upgrades without overriding inherited limits', () => {
 const config = readFileSync(new URL('../../deploy/sidequest-mvp/nginx-public-demo-active-r2.conf', import.meta.url), 'utf8')
 const block = config.match(/location = \/v1\/ws \{([\s\S]*?)\n\}/)![1]!
 expect(block).toContain('proxy_http_version 1.1;'); expect(block).toContain('proxy_set_header Upgrade $http_upgrade;')
 expect(block).toContain('proxy_set_header Connection "upgrade";'); expect(block).toContain('limit_except GET { deny all; }')
 expect(block).not.toMatch(/\n\s*limit_(?:req|conn)\s/)
 expect(block).toContain('proxy_pass http://[fdb2:77a9:c591:3ac6:3513:5bf8:cc3b:5a04]:3438;')
})
test('abort during Retry-After stops without a second request', async () => {
 const controller = new AbortController(); let calls = 0
 const transport = createFridayMintReadTransport((async () => { calls++; return response(429, '1') }) as unknown as typeof fetch)
 const result = transport(`${origin}/v1/info`, { signal: controller.signal })
 setTimeout(() => controller.abort(new Error('cancelled while waiting')), 10)
 await expect(result).rejects.toThrow('cancelled while waiting'); expect(calls).toBe(1)
})
test('malformed Retry-After uses bounded fallback; quote reads are not coalesced', async () => {
 const f = fixture([response(429, 'not-a-date'), response()])
 await f.transport(`${origin}/v1/mint/quote/bolt11/exact-quote`); expect(f.waits).toEqual([625]); expect(f.calls()).toBe(2)
 const quotes = fixture([response(), response()])
 await Promise.all([quotes.transport(`${origin}/v1/mint/quote/bolt11/q`), quotes.transport(`${origin}/v1/mint/quote/bolt11/q`)])
 expect(quotes.calls()).toBe(2)
})
test('queued concurrent reads recheck a newly extended shared cooldown at dispatch', async () => {
 let time = 0
 const starts: Array<{path: string; time: number}> = []
 const sleepers: Array<{at: number; resolve: () => void}> = []
 const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
 const advance = async (to: number) => {
  time = to
  const ready = sleepers.filter(s => s.at <= time)
  for (const s of ready) { sleepers.splice(sleepers.indexOf(s), 1); s.resolve() }
  await flush()
 }
 const transport = createFridayMintReadTransport((async (input: Parameters<typeof fetch>[0]) => {
  starts.push({path: String(input), time})
  return starts.length === 1 ? response(429, '2') : response()
 }) as unknown as typeof fetch, {
  now: () => time, random: () => 0,
  sleep: ms => new Promise<void>(resolve => sleepers.push({at: time + ms, resolve})),
 })
 const first = transport(`${origin}/v1/info`)
 const second = transport(`${origin}/v1/keysets`)
 const third = transport(`${origin}/v1/keys/exact`)
 await flush()
 await advance(250)
 expect(starts).toHaveLength(1)
 await advance(500)
 expect(starts).toHaveLength(1)
 await advance(1999)
 expect(starts).toHaveLength(1)
 for (const at of [2000, 2250, 2500, 2750]) await advance(at)
 await Promise.all([first, second, third])
 expect(starts.map(s => s.time)).toEqual([0, 2000, 2250, 2500])
})
