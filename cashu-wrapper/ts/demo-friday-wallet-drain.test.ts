/** Production opener/common lease with contract Web Locks; no real browser or storage. */
import { expect, test } from 'bun:test'
import { initializeCoco, MemoryRepositories, CocoInitializationError } from '@cashu/coco-core'
import { openDemoFridayBrowserCocoWallet } from './demo-friday-browser-coco-wallet'
import { createDemoFridayBrowserPaymentState } from './demo-friday-browser-payment-state'
import { disposeFridayWallet, useFridayWallet, FridayWalletCleanupUnconfirmed } from './demo-friday-wallet-drain'
import { openWalletDomain } from './open-wallet'
import { createMemorySeedStore } from './seed-store'
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))
function gate(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}}
let serial=0
function contract(){
 const tails=new Map<string,Promise<void>>(),active=new Map<string,number>(),names:string[]=[]
 const locks={request<T>(name:string,options:{mode:'exclusive';signal?:AbortSignal},run:()=>Promise<T>):Promise<T>{
  names.push(name);const previous=tails.get(name)??Promise.resolve(),done=gate();tails.set(name,done.promise)
  return new Promise<T>((resolve,reject)=>{
   let entered=false
   const abort=()=>{if(!entered)reject(options.signal?.reason)}
   options.signal?.addEventListener('abort',abort,{once:true})
   void previous.then(async()=>{
    try{options.signal?.throwIfAborted();entered=true;options.signal?.removeEventListener('abort',abort);active.set(name,(active.get(name)??0)+1);resolve(await run())}
    catch(error){reject(error)}finally{if(entered)active.set(name,(active.get(name)??0)-1);options.signal?.removeEventListener('abort',abort);done.resolve()}
   })
  })
 }}
 const identity={actor:'ab'.repeat(32),environmentId:`p2-drain-${++serial}`}
 const state=()=>createDemoFridayBrowserPaymentState({indexedDB:{} as IDBFactory,locks})
 return {locks,state,identity,names,active}
}
const neverFetch=(async()=>{throw new Error('network forbidden')}) as unknown as typeof fetch
function options(c:ReturnType<typeof contract>){return {...c.identity,mintUrl:'https://mint.example',browserOrigin:'https://mint.example',seedStore:createMemorySeedStore(new Uint8Array(64).fill(1)),fetchImpl:neverFetch}}
async function errorOf(p:Promise<unknown>){try{await p;throw new Error('expected failure')}catch(error){return error}}
async function assertCrossContextHeld(c:ReturnType<typeof contract>){
 const abort=new AbortController();let entered=false
 // Bypass the module's context fence to model a separate tab: the actual lock
 // callback must still be pending, not merely a local poisoned-identity flag.
 const attempt=c.locks.request(c.names[0]!,{mode:'exclusive',signal:abort.signal},async()=>{entered=true})
 const canceled=attempt.catch(()=>{});await tick();expect(entered).toBe(false);expect(c.active.get(c.names[0]!)).toBe(1)
 abort.abort();await canceled;await tick();expect(entered).toBe(false)
}

test('wallet initial observation + rejected cleanup reports both errors and holds actual cross-context lease',async()=>{
 const c=contract(),operation=new Error('initial observation failed'),cleanup=new Error('cleanup failed');let active=0,disposals=0
 const error=await errorOf(c.state().runWalletExclusive(c.identity,async()=>openDemoFridayBrowserCocoWallet({...options(c),async openDomain(){active++;return {runtime:{} as never,paymentKey:{} as never,rail:{async trustMint(){throw operation}} as never,async dispose(){disposals++;throw cleanup}}}})))
 expect(error).toBeInstanceOf(FridayWalletCleanupUnconfirmed);expect((error as FridayWalletCleanupUnconfirmed).operationError).toBe(operation);expect((error as FridayWalletCleanupUnconfirmed).cleanupError).toBe(cleanup)
 expect(disposals).toBe(1);expect(active).toBe(1)
 let opens=0
 await expect(c.state().runWalletExclusive(c.identity,async()=>{opens++})).rejects.toBeInstanceOf(FridayWalletCleanupUnconfirmed)
 await assertCrossContextHeld(c);expect(opens).toBe(0)
 // Explicitly drain only this injected fixture resource; no production lease reset.
 active--;expect(active).toBe(0);await assertCrossContextHeld(c)
})

test('typed unconfirmed Coco initialization before manager return retains lease; typed confirmed failure releases',async()=>{
 for(const cleanupState of ['unconfirmed','confirmed'] as const){
  const c=contract();let managerReturned=false
  const original=new CocoInitializationError('initializer failed',cleanupState,new Error('fixture'))
  const error=await errorOf(c.state().runWalletExclusive(c.identity,async()=>openDemoFridayBrowserCocoWallet({...options(c),async openDomain(){throw original}})))
  expect(managerReturned).toBe(false)
  if(cleanupState==='unconfirmed'){expect(error).toBeInstanceOf(FridayWalletCleanupUnconfirmed);expect((error as FridayWalletCleanupUnconfirmed).operationError).toBe(original);await assertCrossContextHeld(c)}
  else {let next=0;await c.state().runWalletExclusive(c.identity,async()=>{next++});expect(next).toBe(1)}
 }
})

test('default domain classifies actual Coco failed initialization cleanup without a returned manager',async()=>{
 const c=contract(),repo=new MemoryRepositories(),failure=new Error('repository init failed')
 repo.init=async()=>{throw failure}
 repo.releaseAuthority=async()=>{throw new Error('repository cleanup unavailable')}
 const error=await errorOf(c.state().runWalletExclusive(c.identity,async()=>openWalletDomain({account:{accountId:c.identity.actor,environmentId:c.identity.environmentId},seedStore:createMemorySeedStore(new Uint8Array(64).fill(1)),repositories:repo,requestFetch:neverFetch})))
 expect(error).toBeInstanceOf(FridayWalletCleanupUnconfirmed);await assertCrossContextHeld(c)
})

test('known validation/pre-acquisition failures and queued cancellation do not poison ownership',async()=>{
 const c=contract();let opened=0
 await expect(c.state().runWalletExclusive(c.identity,()=>openDemoFridayBrowserCocoWallet({...options(c),actor:'invalid',async openDomain(){opened++;throw new Error('must not enter')}}))).rejects.toThrow(/actor/)
 const held=gate(),entered=gate();const first=c.state().runWalletExclusive(c.identity,async()=>{entered.resolve();await held.promise});await entered.promise
 const abort=new AbortController();const queued=c.state().runWalletExclusive(c.identity,async()=>{opened++},abort.signal);const canceled=queued.catch(()=>{});abort.abort();await canceled
 held.resolve();await first;let next=0;await c.state().runWalletExclusive(c.identity,async()=>{next++})
 expect(opened).toBe(0);expect(next).toBe(1)
})

for(const outcome of ['success','error','cancellation'] as const)test(`ordinary ${outcome} plus rejected disposal holds lease and preserves operation outcome`,async()=>{
 const c=contract(),operation=new Error(outcome),cleanup=new Error('dispose rejected');let disposals=0
 const error=await errorOf(c.state().runWalletExclusive(c.identity,()=>useFridayWallet({async dispose(){disposals++;throw cleanup}},async()=>{if(outcome!=='success')throw operation;return 7})))
 expect(error).toBeInstanceOf(FridayWalletCleanupUnconfirmed);expect((error as FridayWalletCleanupUnconfirmed).operationError).toBe(outcome==='success'?undefined:operation);expect((error as FridayWalletCleanupUnconfirmed).cleanupError).toBe(cleanup);expect(disposals).toBe(1)
 await assertCrossContextHeld(c)
 let other=0;await c.state().runWalletExclusive({...c.identity,actor:'cd'.repeat(32)},async()=>{other++});await c.state().runWalletExclusive({...c.identity,environmentId:c.identity.environmentId+'-other'},async()=>{other++});expect(other).toBe(2)
})

test('hung disposal becomes user-visible unconfirmed; late success/retry cannot release actual ownership',async()=>{
 const c=contract(),drain=gate(),entered=gate();let calls=0
 const resource={async dispose(){calls++;entered.resolve();await drain.promise}}
 const error=await errorOf(c.state().runWalletExclusive(c.identity,()=>disposeFridayWallet(resource,20)))
 await entered.promise;expect(error).toBeInstanceOf(FridayWalletCleanupUnconfirmed);await assertCrossContextHeld(c)
 drain.resolve();await tick();await expect(disposeFridayWallet(resource)).rejects.toBe(error);expect(calls).toBe(1)
 await assertCrossContextHeld(c)
})

test('pending positive cleanup retains ownership then permits multiple contenders exactly once',async()=>{
 const c=contract(),drain=gate(),entered=gate();let disposal=0;const order:number[]=[]
 const first=c.state().runWalletExclusive(c.identity,()=>useFridayWallet({async dispose(){disposal++;entered.resolve();await drain.promise}},async()=>{order.push(0)}))
 await entered.promise
 const b=c.state().runWalletExclusive(c.identity,async()=>{order.push(1)}),d=c.state().runWalletExclusive(c.identity,async()=>{order.push(2)})
 await tick();expect(order).toEqual([0]);drain.resolve();await Promise.all([first,b,d]);expect(order).toEqual([0,1,2]);expect(disposal).toBe(1)
})

test('late actual Coco initialization after cancellation is positively disposed before next contender enters',async()=>{
 const c=contract(),repo=new MemoryRepositories(),entered=gate(),finish=gate(),abort=new AbortController();let next=0
 const init=repo.init.bind(repo);repo.init=async()=>{entered.resolve();await finish.promise;await init()}
 const first=c.state().runWalletExclusive(c.identity,()=>openWalletDomain({account:{accountId:c.identity.actor,environmentId:c.identity.environmentId},seedStore:createMemorySeedStore(new Uint8Array(64).fill(1)),repositories:repo,requestFetch:neverFetch,signal:abort.signal})).catch(()=>{})
 await entered.promise;abort.abort()
 const contender=c.state().runWalletExclusive(c.identity,async()=>{next++})
 await tick();expect(next).toBe(0);finish.resolve();await first;await contender
 expect(repo.getAuthorityState()).toBe('released');expect(next).toBe(1)
})

test('resolved Coco rejected disposal with released repository and pending hook cannot attest drain',async()=>{
 const c=contract(),repo=new MemoryRepositories(),cleanup=gate();let hookEntered=false,finished=false
 const manager=await initializeCoco({repo,seedGetter:async()=>new Uint8Array(64).fill(1),authority:{namespace:c.identity.environmentId,ownerId:'synthetic-owner'},lifecycle:{disposeTimeoutMs:20},watchers:{mintOperationWatcher:{disabled:true},proofStateWatcher:{disabled:true},meltQuoteWatcher:{disabled:true}},processors:{mintOperationProcessor:{disabled:true},meltSettlementProcessor:{disabled:true}},plugins:[{name:'p2-held-disposal',required:[],async onDispose(){hookEntered=true;await cleanup.promise;finished=true}}],requestFetch:neverFetch})
 try{
  const error=await errorOf(c.state().runWalletExclusive(c.identity,()=>useFridayWallet(manager,async()=>7)))
  expect(error).toBeInstanceOf(FridayWalletCleanupUnconfirmed);expect(hookEntered).toBe(true);expect(finished).toBe(false);expect(repo.getAuthorityState()).toBe('released');await assertCrossContextHeld(c)
 }finally{cleanup.resolve();await tick()}
 expect(finished).toBe(true);await assertCrossContextHeld(c)
})

for(const action of ['balance','fundFake'] as const)test(`production browser ${action} cleanup failure retains the common lease`,async()=>{
 const {spyOn}=await import('bun:test')
 const walletModule=await import('./demo-friday-browser-coco-wallet')
 const trustModule=await import('./demo-friday-browser-trust-http')
 const {createPlebeianFridayBrowserController}=await import('./poc-friday-browser-entry')
 const c=contract(),saved=new Map<string,PropertyDescriptor|undefined>(),storage=new Map<string,string>();let opens=0,disposals=0,operations=0
 for(const [key,value] of Object.entries({indexedDB:{},navigator:{locks:c.locks},location:{origin:'https://mint.example'},localStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>{storage.set(k,v)}}})){
  saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value})
 }
 const wallet=spyOn(walletModule,'createDemoFridayBrowserCocoWalletFactory').mockReturnValue({async openExact(){opens++;return {async balance(){operations++;return {total:0}},async fundFake(value:{operationId:string}){operations++;return {operationId:value.operationId,state:'finalized',balance:1}},async dispose(){disposals++;throw new Error('entrypoint cleanup failed')}}}} as never)
 const trust=spyOn(trustModule,'createDemoFridayBrowserTrustedDeploymentHttp').mockReturnValue({async readExact(){return {environmentId:c.identity.environmentId,canonicalMintUrl:'https://mint.example'}}} as never)
 try{
  const controller=createPlebeianFridayBrowserController({async getPublicKey(){return c.identity.actor},async signEvent(){throw new Error('no signing allowed')}})
  await expect(action==='balance'?controller.balance():controller.fundFake(1)).rejects.toBeInstanceOf(FridayWalletCleanupUnconfirmed)
  expect(opens).toBe(1);expect(disposals).toBe(1);expect(operations).toBe(1)
  let next=false;await expect(c.state().runWalletExclusive(c.identity,async()=>{next=true})).rejects.toBeInstanceOf(FridayWalletCleanupUnconfirmed);expect(next).toBe(false)
  const name=c.names.find(n=>n.startsWith('plebeian-friday-private:wallet:'))!;expect(c.active.get(name)).toBe(1)
 }finally{
  wallet.mockRestore();trust.mockRestore()
  for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key)}
 }
})
