/** Wallet cleanup is an ownership outcome, never permission to repeat a payment.
 * No trustworthy eventual-drain API exists for rejected Coco disposal. An
 * unconfirmed outcome therefore retains the real Web Lock for context lifetime. */
import { CocoInitializationError } from '@cashu/coco-core'

export class FridayWalletCleanupUnconfirmed extends Error {
 readonly cleanupError: unknown
 readonly operationError: unknown
 constructor(operationError: unknown, cleanupError: unknown) {
  super('DEMO_FRIDAY_WALLET_DRAIN_UNCONFIRMED: wallet unavailable in this context; cleanup was not confirmed', { cause: operationError ?? cleanupError })
  this.name='FridayWalletCleanupUnconfirmed';this.operationError=operationError;this.cleanupError=cleanupError instanceof FridayWalletCleanupUnconfirmed?cleanupError.cleanupError:cleanupError
 }
}
/** Internal positive result from the domain's cleanup boundary, not error-text inference. */
export class FridayWalletOpeningFailed extends Error {
 readonly operationError: unknown
 constructor(operationError: unknown) {
  super(operationError instanceof Error ? operationError.message : 'wallet opening failed', {cause:operationError})
  this.name='FridayWalletOpeningFailed';this.operationError=operationError
 }
}
export function walletOpeningFailure(error: unknown): unknown {
 if(error instanceof FridayWalletCleanupUnconfirmed || error instanceof FridayWalletOpeningFailed) return error
 if(error instanceof CocoInitializationError && error.cleanupState==='confirmed') return new FridayWalletOpeningFailed(error)
 // A generic initializer failure cannot attest that a hidden partial manager drained.
 return new FridayWalletCleanupUnconfirmed(error,error)
}

const disposals=new WeakMap<object,Promise<void>>()
/** A reporting deadline fences forever; it never releases a lease or retries disposal.
 * The optional shorter budget is for focused tests; production uses 5s. */
export function disposeFridayWallet(wallet:{dispose():Promise<void>}, budgetMs=5000):Promise<void> {
 const prior=disposals.get(wallet);if(prior!==undefined)return prior
 if(!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>5000)throw new Error('invalid wallet cleanup reporting budget')
 const result=new Promise<void>((resolve,reject)=>{
  let unconfirmed=false
  const timer=setTimeout(()=>{unconfirmed=true;reject(new FridayWalletCleanupUnconfirmed(undefined,new Error('wallet cleanup reporting deadline')))},budgetMs)
  // Attach both handlers even when the deadline wins. Late success is not a
  // separate drain attestation; the memoized rejected outcome cannot recover.
  void Promise.resolve().then(()=>wallet.dispose()).then(()=>{
   clearTimeout(timer);if(!unconfirmed){disposals.delete(wallet);resolve()}
  },error=>{
   unconfirmed=true;clearTimeout(timer);reject(error instanceof FridayWalletCleanupUnconfirmed?error:new FridayWalletCleanupUnconfirmed(undefined,error))
  })
 })
 disposals.set(wallet,result);return result
}

export async function useFridayWallet<T>(wallet:{dispose():Promise<void>},run:()=>Promise<T>,beforeDispose?:()=>Promise<unknown>):Promise<T> {
 let failed=false, operationError:unknown, value!:T
 try {value=await run()}catch(error){failed=true;operationError=error}
 try {await beforeDispose?.();await disposeFridayWallet(wallet)}catch(cleanupError){
  throw new FridayWalletCleanupUnconfirmed(failed?operationError:undefined,cleanupError instanceof FridayWalletCleanupUnconfirmed?cleanupError.cleanupError:cleanupError)
 }
 if(failed)throw operationError
 return value
}

interface Locks {
 request<T>(name:string,options:{mode:'exclusive';signal?:AbortSignal},run:()=>Promise<T>):Promise<T>
}
// One retained entry per unsafe identity, shared by payment-state instances in
// this module/context. Cross-context exclusion is provided by the held Web Lock.
const fenced=new Set<string>()
export function runFridayWalletLease<T>(locks:Locks,name:string,run:()=>Promise<T>,signal?:AbortSignal):Promise<T> {
 signal?.throwIfAborted()
 if(fenced.has(name))return Promise.reject(new FridayWalletCleanupUnconfirmed(undefined,new Error('wallet ownership retained')))
 return new Promise<T>((resolve,reject)=>{
  const owning=locks.request(name,{mode:'exclusive',...(signal?{signal}:{})},async()=>{
   signal?.throwIfAborted()
   if(fenced.has(name))throw new FridayWalletCleanupUnconfirmed(undefined,new Error('wallet ownership retained'))
   try {const value=await run();resolve(value)}catch(error){
    if(error instanceof FridayWalletCleanupUnconfirmed){
     fenced.add(name);reject(error)
     // Intentionally no timer, abort listener or reset hook. Context termination
     // ends ownership; it does not prove an already-sent mint request had no effect.
     await new Promise<never>(()=>{})
    }
    reject(error)
   }
  })
  void owning.catch(reject)
 })
}
