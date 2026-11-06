import { expect, test } from 'bun:test'
import { createFridayTrustReadTransport } from './demo-friday-trust-read-transport'
const origin = 'https://mint.example'
const path = '/api/friday/seller-plan/pending'
const init = {method:'POST', body:JSON.stringify({schema:'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_PENDING_READ_V1',sellerActor:'a'})}
const reply = (status = 200, retry?: string) => new Response('{}', {status, headers:retry ? {'retry-after':retry} : {}})
function setup(responses: Response[]) {
 let calls = 0, time = 0; const waits: number[] = [], bodies: unknown[] = []
 const fetchImpl = async (_: unknown, i?: RequestInit) => { calls++; bodies.push(i?.body); return responses.shift()! }
 const options = {now:()=>time,random:()=>0.5,sleep:async (ms:number)=>{waits.push(ms);time+=ms}}
 return {transport:createFridayTrustReadTransport(origin, fetchImpl, options),fetchImpl,options,waits,bodies,calls:()=>calls}
}
test('read POST honors Retry-After and exact body without invoking signing', async()=>{
 const f=setup([reply(429,'2'),reply()]); expect((await f.transport(origin+path,init)).status).toBe(200)
 expect(f.waits).toEqual([2125,350]); expect(f.bodies).toEqual([init.body,init.body])
})
test('only exact reviewed path and schema may replay',async()=>{
 for(const [p,i] of [['/api/friday/seller-plan/register',init],['/api/friday/seller-plan/intent',init],['/api/friday/auction-payout/register',init],[path,{...init,body:'{}'}],[path+'?q=1',init],[path,{...init,method:'GET'}]] as const){
  const f=setup([reply(429)]); expect((await f.transport(origin+p,i)).status).toBe(429);expect(f.calls()).toBe(1)
 }
})
test('foreign origin never gains read retries',async()=>{
 const f=setup([reply(429)]);expect((await f.transport('https://other.example'+path,init)).status).toBe(429);expect(f.calls()).toBe(1)
})
test('retries bounded and long server deadlines never shortened',async()=>{
 const f=setup([reply(429),reply(429),reply(429)]);expect((await f.transport(origin+path,init)).status).toBe(429);expect(f.calls()).toBe(3)
 const long=setup([reply(429,'11')]);expect((await long.transport(origin+path,init)).status).toBe(429);expect(long.calls()).toBe(1)
})
test('coalesces identical reads across ports but not actors or completed reads',async()=>{
 const f=setup([reply(),reply(),reply()]);const other=createFridayTrustReadTransport(origin,f.fetchImpl,f.options)
 const [a,b]=await Promise.all([f.transport(origin+path,init),other(origin+path,init)])
 expect(f.calls()).toBe(1);expect(await a.json()).toEqual({});expect(await b.json()).toEqual({})
 await other(origin+path,init);await other(origin+path,{...init,body:init.body.replace('"a"','"b"')});expect(f.calls()).toBe(3)
})
test('shared scheduler and cross-tab lock seam serialize reads',async()=>{
 const f=setup([reply(),reply()]);let lockCalls=0
 const t=createFridayTrustReadTransport(origin,f.fetchImpl,{...f.options,lock:async run=>{lockCalls++;return run()}})
 await Promise.all([t(origin+path,init),t(origin+path,{...init,body:init.body.replace('"a"','"b"')})]);expect(lockCalls).toBe(2);expect(f.waits).toEqual([350,350])
})
test('abort before dispatch and after rate-limit wait prevents request replay',async()=>{
 const c=new AbortController();c.abort(new Error('cancelled'));const f=setup([])
 await expect(f.transport(origin+path,{...init,signal:c.signal})).rejects.toThrow('cancelled');expect(f.calls()).toBe(0)
 const d=new AbortController();let calls=0
 const t=createFridayTrustReadTransport(origin,async()=>{calls++;return reply(429)},{sleep:async()=>{d.abort(new Error('stopped'))}})
 await expect(t(origin+path,{...init,signal:d.signal})).rejects.toThrow('stopped');expect(calls).toBe(1)
})
test('network ambiguity and non-429 failures never replay',async()=>{
 let calls=0;const t=createFridayTrustReadTransport(origin,async()=>{calls++;throw new Error('lost')},{sleep:async()=>{}})
 await expect(t(origin+path,init)).rejects.toThrow('lost');expect(calls).toBe(1)
 const f=setup([reply(503)]);expect((await f.transport(origin+path,init)).status).toBe(503);expect(f.calls()).toBe(1)
})
test('retry dates and malformed header fallback are bounded',async()=>{
 const f=setup([reply(429,new Date(3000).toUTCString()),reply()]);await f.transport(origin+path,init);expect(f.waits).toEqual([3125,350])
 const g=setup([reply(429,'invalid'),reply()]);await g.transport(origin+path,init);expect(g.waits).toEqual([875,350])
})
test('queued read snapshots its exact body and headers',async()=>{
 const f=setup([reply()]);const mutable={...init,headers:{accept:'application/json'}}
 const done=f.transport(origin+path,mutable);mutable.body='{}';mutable.headers.accept='text/plain';await done
 expect(f.bodies).toEqual([init.body])
})
