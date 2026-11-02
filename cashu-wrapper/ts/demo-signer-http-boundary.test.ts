/** Native Request/ReadableStream + production dispatcher, Bun.serve intercepted.
 * No listener/proxy or global connection/RSS bound is claimed. */
import { expect, spyOn, test } from 'bun:test'
import { createDemoSignerRpcHttpServer } from './demo-signer-rpc-server'
const MAX = 256 * 1024
const paths = ['/v1/frost', '/v1/admission', '/v1/funding-abort', '/v1/health']
const headers = { 'content-type': 'application/json', 'x-plebeian-fips-plaintext-probe': 'PLEBEIAN-FRIDAY-SIGNER-TRANSPORT-V1' }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a,b) => { resolve=a;reject=b }); return {promise,resolve,reject} }
function fixture(requestTimeoutMs=500) {
 let dispatch!: (r:Request)=>Promise<Response>, options: any, calls=0, received: unknown, signal: AbortSignal | undefined
 const handler=async(body:unknown,s:AbortSignal)=>{calls++;received=body;signal=s;return {ok:true} as never}
 const serve=spyOn(Bun,'serve').mockImplementation((value:any)=>{options=value;dispatch=value.fetch;return {port:39101,stop:async()=>{}} as never})
 try {createDemoSignerRpcHttpServer({binding:{hostname:'fd00::1',port:39101},requestTimeoutMs,handle:handler,admissionHandle:handler,fundingAbortHandle:handler,healthHandle:handler})} finally {serve.mockRestore()}
 return {dispatch,options,calls:()=>calls,received:()=>received,signal:()=>signal}
}
function request(body:BodyInit|null,path='/v1/frost',extra:RequestInit={}) {return new Request('http://[fd00::1]:39101'+path,{method:'POST',headers,body,...extra})}
function payload(bytes:number) {return new TextEncoder().encode(JSON.stringify({pad:'x'.repeat(bytes-10)}))}
for(const path of paths) {
 for(const size of [MAX-1,MAX]) test(`HTTP ${path}: valid actual ${size} bytes accepted once without Content-Length`,async()=>{
  const f=fixture(), raw=payload(size);expect(raw.byteLength).toBe(size)
  const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(raw.subarray(0,31));c.enqueue(raw.subarray(31));c.close()}})
  const r=request(body,path);expect(r.headers.has('content-length')).toBe(false)
  expect((await f.dispatch(r)).status).toBe(200);expect(f.calls()).toBe(1);expect((f.received() as {pad:string}).pad.length).toBe(size-10)
  expect(f.signal()?.aborted).toBe(false);expect(f.options.maxRequestBodySize).toBe(MAX)
 })
 for(const kind of ['chunks','one-chunk'] as const) test(`HTTP ${path}: oversize ${kind} cancels without EOF or handler`,async()=>{
  const f=fixture();let canceled=0
  const body=new ReadableStream<Uint8Array>({start(c){if(kind==='chunks'){c.enqueue(payload(MAX));c.enqueue(new Uint8Array(1))}else c.enqueue(new Uint8Array(MAX+1))},cancel(){canceled++;return new Promise<void>(()=>{})}})
  const response=await f.dispatch(request(body,path));expect(response.status).toBe(422);expect(canceled).toBe(1);expect(f.calls()).toBe(0)
 })
 test(`HTTP ${path}: client abort at EOF cannot dispatch`,async()=>{
  const f=fixture(), abort=new AbortController();let n=0
  const body=new ReadableStream<Uint8Array>({pull(c){if(n++===0)c.enqueue(new TextEncoder().encode('{}'));else{c.close();abort.abort(new Error('client closed'))}}},{highWaterMark:0})
  expect((await f.dispatch(request(body,path,{signal:abort.signal}))).status).toBe(422);expect(f.calls()).toBe(0)
 })
}
for(const [name,body,extra] of [
 ['empty',new Uint8Array(),{}],['malformed','{',{}],['advertised oversize','{}',{headers:{...headers,'content-length':String(MAX+1)}}],
 ['advertised negative','{}',{headers:{...headers,'content-length':'-1'}}],['advertised fraction','{}',{headers:{...headers,'content-length':'1.5'}}],
 ['wrong content type','{}',{headers:{...headers,'content-type':'text/plain'}}],['missing body',null,{}],
] as const) test(`HTTP rejects ${name} before handler`,async()=>{
 const f=fixture();expect((await f.dispatch(request(body,undefined,extra))).status).toBe(422);expect(f.calls()).toBe(0)
})
test('HTTP deadline cancels a pending native body and returns before stream EOF',async()=>{
 const f=fixture(30);let canceled=0, source!:ReadableStreamDefaultController<Uint8Array>
 const lateCancel=deferred<void>()
 const body=new ReadableStream<Uint8Array>({start(c){source=c},cancel(){canceled++;return lateCancel.promise}})
 const result=f.dispatch(request(body))
 const observed=await Promise.race([result.then(r=>({done:true,status:r.status})),new Promise<{done:boolean,status:number}>(resolve=>setTimeout(()=>resolve({done:false,status:0}),500))])
 // Also permits the test to drain the old implementation on a baseline run.
 if(!observed.done){source.close();await result}
 expect(observed.done).toBe(true);expect(observed.status).toBe(422);expect(canceled).toBe(1);expect(f.calls()).toBe(0)
 lateCancel.reject(new Error('late cancel failure'));await tick();expect(f.calls()).toBe(0)
})
test('HTTP pending native body responds to client abort and observes late cancel rejection',async()=>{
 const f=fixture(),abort=new AbortController(),late=deferred<void>();let canceled=0
 const body=new ReadableStream<Uint8Array>({cancel(){canceled++;return late.promise}})
 const result=f.dispatch(request(body,undefined,{signal:abort.signal}));abort.abort(new Error('client aborted'))
 expect((await result).status).toBe(422);expect(canceled).toBe(1);expect(f.calls()).toBe(0)
 late.reject(new Error('late cancel'));await tick();expect(f.calls()).toBe(0)
})
test('HTTP pre-aborted request does no reader/handler work beyond cancellation',async()=>{
 const f=fixture(),abort=new AbortController();let canceled=0;abort.abort()
 const body=new ReadableStream<Uint8Array>({cancel(){canceled++}})
 expect((await f.dispatch(request(body,undefined,{signal:abort.signal}))).status).toBe(422);expect(f.calls()).toBe(0);expect(canceled).toBe(1)
})
test('HTTP monotonic deadline at EOF is enforced even before the timer callback runs',async()=>{
 let now=0,n=0;const clock=spyOn(performance,'now').mockImplementation(()=>now)
 try {
  const f=fixture(100)
  const body=new ReadableStream<Uint8Array>({pull(c){if(n++===0)c.enqueue(new TextEncoder().encode('{}'));else{now=101;c.close()}}},{highWaterMark:0})
  expect((await f.dispatch(request(body))).status).toBe(422);expect(f.calls()).toBe(0)
 } finally {clock.mockRestore()}
})
test('HTTP late reader rejection after cancellation is handled; reader adapter cannot stall rejection',async()=>{
 const f=fixture(),abort=new AbortController(),read=deferred<ReadableStreamReadResult<Uint8Array>>();let canceled=0,released=0
 const r=request('{}',undefined,{signal:abort.signal})
 const reader=spyOn(r.body!,'getReader').mockReturnValue({read:()=>read.promise,cancel:()=>{canceled++;return Promise.reject(new Error('cancel rejected'))},releaseLock(){released++}} as never)
 try {const result=f.dispatch(r);abort.abort();expect((await result).status).toBe(422);read.reject(new Error('late read'));await tick();expect(canceled).toBe(1);expect(released).toBe(1);expect(f.calls()).toBe(0)} finally {reader.mockRestore()}
})
test('HTTP post-dispatch timer retains operation signal and does not fabricate a no-effect reply',async()=>{
 let dispatch!:(r:Request)=>Promise<Response>,s:AbortSignal|undefined;const finish=deferred<never>()
 const serve=spyOn(Bun,'serve').mockImplementation((value:any)=>{dispatch=value.fetch;return {port:39101,stop:async()=>{}} as never})
 try{createDemoSignerRpcHttpServer({binding:{hostname:'fd00::1',port:39101},requestTimeoutMs:20,handle:async(_b,signal)=>{s=signal;return finish.promise}})}finally{serve.mockRestore()}
 let settled=false;const result=dispatch(request('{}')).then(r=>{settled=true;return r})
 await new Promise(r=>setTimeout(r,60));expect(s?.aborted).toBe(true);expect(settled).toBe(false)
 finish.reject(new Error('post-effect uncertainty'));expect((await result).status).toBe(422)
})
