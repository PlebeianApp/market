/** Durable engine with fixed synthetic requester identity; no real host keys. */
import {test,expect} from 'bun:test'
import {mkdtemp,chmod,readFile,rm,readdir,mkdir,lstat,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {initializeDemoFridayCoordinatorIdentity,recoverDemoFridayCoordinatorIdentity} from './demo-friday-dkg-deployment-tools'
import {SEPARATED_DEPLOYMENT_ID,SEPARATED_APPLICATION_RUN_ID,SEPARATED_DKG_RUN_ID} from './demo-friday-separated-constants'
const fixture=async()=>{
 const parent=await mkdtemp(join(tmpdir(),'plebeian-separated-coordinator-'));await chmod(parent,0o700)
 await chmod(parent,0o755)
 const privateParent=join(parent,'coordinator-v3');await mkdir(privateParent,{mode:0o700})
 const root=join(privateParent,'runtime')
 return {parent,privateParent,input:{deploymentId:SEPARATED_DEPLOYMENT_ID,applicationRunId:SEPARATED_APPLICATION_RUN_ID,dkgRunId:SEPARATED_DKG_RUN_ID,committeeKeysetId:'friday-demo-frost-keyset-separated-v1',committeeKeysetVersion:'3',profile:{root,secretPath:join(root,'coordinator-rpc-identity.key'),publicPath:join(root,'coordinator-rpc-identity.public.json')},secretGenerator:()=>new Uint8Array(32).fill(91)}}
}
test('fresh app requester uses proven durable engine, exact retry and no FROST participant state',async()=>{
 const f=await fixture();try{
 const first=await initializeDemoFridayCoordinatorIdentity(f.input),bytes=await readFile(f.input.profile.secretPath)
 expect(first.hostId).toBe('linode-109290386');expect(await initializeDemoFridayCoordinatorIdentity(f.input)).toEqual(first)
 expect(await readFile(f.input.profile.secretPath)).toEqual(bytes)
 expect((await readdir(f.input.profile.root)).sort()).toEqual(['coordinator-rpc-identity.key','coordinator-rpc-identity.public.json'])
 await expect(initializeDemoFridayCoordinatorIdentity({...f.input,dkgRunId:'wrong'})).rejects.toThrow()
 expect(await readFile(f.input.profile.secretPath)).toEqual(bytes)
 }finally{await rm(f.parent,{recursive:true,force:true})}
})
test('fresh requester interrupted durable initialization stays quarantined pending explicit recovery',async()=>{
 const f=await fixture();try{
 await expect(initializeDemoFridayCoordinatorIdentity({...f.input,faultInjection:async p=>{if(p==='after-private')throw new Error('synthetic crash')}})).rejects.toThrow('synthetic crash')
 await expect(initializeDemoFridayCoordinatorIdentity(f.input)).rejects.toThrow(/lock exists/)
 expect((await readdir(f.privateParent)).some(n=>n.endsWith('.identity.lock'))).toBe(true)
 }finally{await rm(f.parent,{recursive:true,force:true})}
})

test('configured mixed hierarchy keeps recovery/staging inside private parent and preserves public root',async()=>{
 const f=await fixture();try{
 const before=(await readdir(f.parent)).sort(),mode=(await lstat(f.parent)).mode
 await expect(initializeDemoFridayCoordinatorIdentity({...f.input,faultInjection:async p=>{if(p==='after-staging-sync')throw new Error('synthetic complete crash')}})).rejects.toThrow('synthetic complete crash')
 expect((await readdir(f.parent)).sort()).toEqual(before);expect((await lstat(f.parent)).mode).toBe(mode)
 const lock=(await readdir(f.privateParent)).find(n=>n.endsWith('.identity.lock'));expect(lock).toBeDefined()
 const ownerPath=join(f.privateParent,lock!,'owner.json')
 // Existing reviewed recovery fixture: a known absent synthetic PID, not a live key/store.
 const owner=JSON.parse(await readFile(ownerPath,'utf8'));owner.pid=2_000_000_000;owner.processStartTicks='1'
 await writeFile(ownerPath,JSON.stringify(owner)+'\n',{mode:0o600})
 const recovered=await recoverDemoFridayCoordinatorIdentity(f.input)
 expect(await initializeDemoFridayCoordinatorIdentity(f.input)).toEqual(recovered)
 expect((await readdir(f.privateParent)).sort()).toEqual(['runtime'])
 expect((await readdir(f.parent)).sort()).toEqual(before);expect((await lstat(f.parent)).mode).toBe(mode)
 expect((await lstat(f.privateParent)).mode&0o777).toBe(0o700)
 }finally{await rm(f.parent,{recursive:true,force:true})}
})
test('requester refuses public parent for init and recovery without changing it',async()=>{
 const f=await fixture();try{
 await chmod(f.privateParent,0o755)
 await expect(initializeDemoFridayCoordinatorIdentity(f.input)).rejects.toThrow(/0700|mode|private/)
 await expect(recoverDemoFridayCoordinatorIdentity(f.input)).rejects.toThrow(/0700|mode|private/)
 expect(await readdir(f.privateParent)).toEqual([])
 }finally{await rm(f.parent,{recursive:true,force:true})}
})
