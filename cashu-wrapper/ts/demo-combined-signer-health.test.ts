/** Combined local gate7: real signed health codec, SQLite, independent anchors
 * and accepted Rust CLI with fixed synthetic fixture keys. No listener. */
import { test, expect, spyOn } from 'bun:test'
import { createDemoSignerRpcHttpServer } from './demo-signer-rpc-server'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { readFile, access } from 'node:fs/promises'
import { schnorr } from '@noble/curves/secp256k1.js'
import { service } from './demo-signer-v1-local.test'
import { registerDemoSignerFixtureCleanup, H, json, type Domain } from './demo-signer-v1-local-fixture'
import { DemoSignerRpcSqliteJournal } from './demo-signer-rpc-sqlite'
import { DemoSignerCoordinatorAnchorSqlite } from './demo-signer-coordinator-anchor-sqlite'
import { createFridaySignerHealthHandler, probeFridaySignerHealth } from './demo-friday-signer-health'
import type { FridayHealthPins } from './demo-friday-readiness'
const signer = new Uint8Array(32).fill(9), coordinator = new Uint8Array(32).fill(7)
const hex = (v: Uint8Array) => Buffer.from(v).toString('hex')
const tick = () => new Promise(resolve => setTimeout(resolve, 1))
async function fixture(domain: Domain = 'admission') {
 const s = await service(domain)
 const inspection = await json<{ verifying_shares: Array<{participant_id:number;verifying_share_hex:string}> }>(join(s.root,'inspection.json'))
 const identity = { participantId: 1 as const, keysetId:'synthetic-f1',keysetVersion:'1', dkgRunId:'synthetic-f1',
  publicKeyPackageSha256:s.options.publicKeyPackageSha256, signerRosterDigest:s.options.signerRosterDigest,
  stateDirectory:s.state,processIdentity:hex(schnorr.getPublicKey(signer)),verifyingShare:inspection.verifying_shares.find(x=>x.participant_id===1)!.verifying_share_hex }
 let db = new Database(join(s.root,'health-terminal.sqlite3'),{create:true,strict:true}), terminal = new DemoSignerRpcSqliteJournal(db,identity)
 const coordinatorDb = new Database(':memory:'), anchor = new DemoSignerCoordinatorAnchorSqlite(coordinatorDb)
 let processId=H(201), checks=0, entries=0
 const pins:FridayHealthPins={deploymentId:'combined-local',chainId:'synthetic-f1',genesisSha256:H(202),validatorsHash:H(203),committeeKeysetId:identity.keysetId,committeeKeysetVersion:identity.keysetVersion,dkgRunId:identity.dkgRunId,publicKeyPackageSha256:identity.publicKeyPackageSha256,signerRosterDigest:identity.signerRosterDigest,mintUrl:'http://[fd00::1]:3338'}
 const make = () => createFridaySignerHealthHandler({pins,participantId:1,coordinatorIdentity:hex(schnorr.getPublicKey(coordinator)),signerPrivate:signer,processInstanceId:processId,binding:()=>terminal.readBinding(),serialize:(signal,read)=>{entries++;return s.gate().observe(signal,read)},async assertReady(){checks++;s.gate().check('read-only');s.anchor().assertHealthCurrent();await terminal.assertReady();await s.journal().assertReady()}})
 let handler=make()
 const options=async()=>({endpoint:'http://[fd00::1]:39101/v1/frost',participantId:1,signerIdentity:identity.processIdentity,coordinatorSecret:coordinator,pins,enrollment:await terminal.readBinding(),anchor,signal:new AbortController().signal,
  fetch:(async(_input,init)=>Response.json(await handler(JSON.parse(String(init?.body)),init?.signal??undefined))) as typeof fetch})
 const probe=async()=>probeFridaySignerHealth(await options())
 const snapshot=async()=>({rust:await s.safety(), admission:s.db().query("SELECT * FROM demo_fips_admission_rpc_journal ORDER BY request_id").all(),abort:s.db().query("SELECT * FROM demo_fips_funding_abort_rpc_journal ORDER BY request_id").all(),terminal:db.query('SELECT * FROM demo_signer_rpc_journal ORDER BY request_id').all(),metadata:db.query('SELECT * FROM demo_signer_rpc_metadata').all(),coordinator:coordinatorDb.query('SELECT * FROM demo_signer_coordinator_anchor').all(),safetyAnchor:hex(await readFile(s.options.coordinatorAnchorPath)),proof:hex(await readFile(s.options.proofUsePath))})
 registerDemoSignerFixtureCleanup(async()=>{db.close();coordinatorDb.close()})
 return {s,probe,options,snapshot,handle:()=>handler,counts:()=>({checks,entries}),terminal:()=>terminal,async restart(){db.close();await s.restart();db=new Database(join(s.root,'health-terminal.sqlite3'),{create:true,strict:true});terminal=new DemoSignerRpcSqliteJournal(db,identity);processId=H(204);handler=make()},async marker(){try{await access(join(s.root,'service.quarantine'));return true}catch{return false}}}
}
for(const domain of ['admission','funding-abort'] as const){
 test(`Combined G7 ${domain}: anchored refusal and success replay remain health-ready; restart health cannot rebind old transport`,async()=>{
  const f=await fixture(domain);expect(await f.probe()).toBe(1)
  f.s.mode('refuse');await expect(f.s.call('commit')).rejects.toThrow(/422/)
  const before=await f.snapshot(),calls={...f.s.count};expect(await f.probe()).toBe(1);expect(await f.snapshot()).toEqual(before)
  await expect(f.s.call('commit')).rejects.toThrow(/422/);expect(f.s.count).toEqual(calls)
  f.s.mode('valid');await f.s.call('commit','valid');expect(await f.probe()).toBe(1)
  const old=await f.options();await f.restart();const stable=await f.snapshot()
  await expect(probeFridaySignerHealth(old)).rejects.toThrow(/EPOCH/);expect(await f.snapshot()).toEqual(stable)
  expect(await f.probe()).toBe(1);const rust=f.s.count.rust;await f.s.call('commit','valid');expect(f.s.count.rust).toBe(rust)
 })
 test(`Combined G7 ${domain}: unknown pending is signed false repeatedly without safety or coordinator writes`,async()=>{
  const f=await fixture(domain);expect(await f.probe()).toBe(1);f.s.mode('unknown');await expect(f.s.call('commit')).rejects.toThrow()
  const before=await f.snapshot();expect(await f.probe()).toBeNull();expect(await f.probe()).toBeNull();expect(await f.snapshot()).toEqual(before);expect(await f.marker()).toBe(true)
  const count={...f.s.count};await expect(f.s.call('commit','next')).rejects.toThrow();expect(f.s.count).toEqual(count)
 })
 test(`Combined G7 ${domain}: DB-before-anchor partial transition is signed false and never adopted`,async()=>{
  const f=await fixture(domain);expect(await f.probe()).toBe(1);f.s.mode('refuse');f.s.fault('before-anchor');await expect(f.s.call('commit')).rejects.toThrow()
  const before=await f.snapshot();expect(await f.probe()).toBeNull();expect(await f.snapshot()).toEqual(before)
  expect(()=>f.s.anchor().assertHealthCurrent()).toThrow(/QUARANTINED/)
 })
}
test('Combined G7 health authenticates before queue, waits for actual Rust transition and never poisons a transient gap',async()=>{
 const f=await fixture();expect(await f.probe()).toBe(1);let release!:()=>void,entered!:()=>void
 const hold=new Promise<void>(r=>{release=r}),inside=new Promise<void>(r=>{entered=r})
 const mutation=f.s.gate().run(new AbortController().signal,async()=>{const result=await f.s.raw('commit');expect(result.code).toBe(0);entered();await hold;f.s.anchor().recordRustStateAdvance()})
 await inside;const checks=f.counts().checks,beforeEntries=f.counts().entries
 const wrong=await f.options();wrong.coordinatorSecret=new Uint8Array(32).fill(8);await expect(probeFridaySignerHealth(wrong)).rejects.toThrow();expect(f.counts().entries).toBe(beforeEntries)
 const health=f.probe();await tick();expect(f.counts().checks).toBe(checks);expect(await f.marker()).toBe(false)
 release();await mutation;expect(await health).toBe(1);expect(await f.marker()).toBe(false)
})
test('Combined G7 canceled queued health has no late read and cannot let a successor overtake the active writer',async()=>{
 const f=await fixture();let release!:()=>void;const held=new Promise<void>(r=>{release=r}),order:string[]=[]
 const mutation=f.s.gate().run(new AbortController().signal,async()=>{order.push('writer');await held;order.push('done')})
 await tick();const opts=await f.options(),stop=new AbortController();opts.signal=stop.signal
 const pending=probeFridaySignerHealth(opts),rejected=expect(pending).rejects.toThrow();await tick();stop.abort();await rejected
 const next=f.s.gate().run(new AbortController().signal,async()=>{order.push('next')});await tick();expect(order).toEqual(['writer']);expect(f.counts().checks).toBe(0)
 release();await mutation;await next;expect(order).toEqual(['writer','done','next']);expect(await f.probe()).toBe(1)
})
test('Combined G7 terminal pending is signed false with no automatic cleanup or marker write',async()=>{
 const f=await fixture();expect(await f.probe()).toBe(1);await f.terminal().claim(H(210),H(211));const before=await f.snapshot()
 expect(await f.probe()).toBeNull();expect(await f.snapshot()).toEqual(before);expect(await f.marker()).toBe(false)
})
test('Combined G7 partial admission restore stays false without rebase; later mutation remains fenced',async()=>{
 const f=await fixture();f.s.mode('refuse');await expect(f.s.call('policy')).rejects.toThrow(/422/);expect(await f.probe()).toBe(1)
 f.s.db().exec('DELETE FROM demo_fips_admission_rpc_journal');const before=await f.snapshot()
 expect(await f.probe()).toBeNull();expect(await f.snapshot()).toEqual(before);expect(await f.marker()).toBe(false)
 f.s.mode('valid');await expect(f.s.call('commit','new')).rejects.toThrow();expect(f.s.count.rust).toBe(0)
})


test('Combined G7 actual HTTP dispatcher preserves signed health, cached422, transient503 and cancellation without a listener',async()=>{
 const f=await fixture();let dispatch!: (request:Request)=>Promise<Response>
 const mock=spyOn(Bun,'serve').mockImplementation((options:any)=>{dispatch=options.fetch;return {port:39101,stop:async()=>{}} as never})
 try{createDemoSignerRpcHttpServer({binding:{hostname:'fd00::1',port:39101},handle:async()=>{throw new Error('unused terminal')},admissionHandle:(body,signal)=>f.s.handler()(body,signal),healthHandle:(body,signal)=>f.handle()(body,signal)})}
 finally{mock.mockRestore()}
 const transport=(async(input:RequestInfo|URL,init?:RequestInit)=>dispatch(new Request(input,init))) as typeof fetch
 const options=await f.options();options.fetch=transport;expect(await probeFridaySignerHealth(options)).toBe(1)
 const entries=f.counts().entries;await expect(probeFridaySignerHealth({...options,coordinatorSecret:new Uint8Array(32).fill(8)})).rejects.toThrow();expect(f.counts().entries).toBe(entries)
 f.s.mode('refuse');await expect(f.s.call('policy')).rejects.toThrow(/422/);const cached=await f.s.responses.at(-1)!.text(),calls={...f.s.count}
 const request=()=>new Request('http://[fd00::1]:39101/v1/admission',{method:'POST',headers:{'content-type':'application/json','x-plebeian-fips-plaintext-probe':'PLEBEIAN-FRIDAY-SIGNER-TRANSPORT-V1'},body:JSON.stringify(f.s.request())})
 const reply=await dispatch(request());expect(reply.status).toBe(422);expect(await reply.text()).toBe(cached);expect(f.s.count).toEqual(calls)
 f.s.mode('outage');await expect(f.s.call('policy','outage')).rejects.toThrow();expect((await dispatch(request())).status).toBe(503)
 f.s.mode('unknown');await expect(f.s.call('commit','unknown')).rejects.toThrow();expect(await probeFridaySignerHealth(options)).toBeNull()
 const stop=new AbortController();stop.abort();await expect(probeFridaySignerHealth({...options,signal:stop.signal})).rejects.toThrow()
})
