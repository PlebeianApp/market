/** A2 reproduction converted to desired repair assertions in its first two cases; signer-side non-mutating canary test unchanged. */
import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { DemoSignerCoordinatorAnchorSqlite } from './demo-signer-coordinator-anchor-sqlite'
import { createDemoSignerRpcTransport, type DemoSignerDurableBindingV1 } from './demo-signer-rpc'
import { createFridaySignerHealthHandler, probeFridaySignerHealth } from './demo-friday-signer-health'
import { demoDispositionEnrollmentPermit, openDemoDispositionSignerAnchor } from './demo-disposition-signer-anchor'
const key = (n:number) => { const k=new Uint8Array(32); k[31]=n; return k }
const coordinator=key(1), signer=key(2), signerIdentity=bytesToHex(schnorr.getPublicKey(signer))
const pins={deploymentId:'disposable',chainId:'chain',genesisSha256:'a'.repeat(64),validatorsHash:'b'.repeat(64),
 committeeKeysetId:'keyset',committeeKeysetVersion:'2',dkgRunId:'dkg',publicKeyPackageSha256:'c'.repeat(64),
 signerRosterDigest:'d'.repeat(64),mintUrl:'https://mint.example'}
const enrolled:DemoSignerDurableBindingV1={schema:'COCO_DEMO_SIGNER_DURABLE_BINDING_V1',participantId:1,
 keysetId:pins.committeeKeysetId,keysetVersion:pins.committeeKeysetVersion,dkgRunId:pins.dkgRunId,
 publicKeyPackageSha256:pins.publicKeyPackageSha256,signerRosterDigest:pins.signerRosterDigest,restartEpoch:1,
 journalGeneration:'e'.repeat(64),stateDirectory:'/disposable/public-metadata',stateDirectoryIdentity:'f'.repeat(64),
 processIdentity:signerIdentity,verifyingShare:'02'+'1'.repeat(64)}
function healthProbe(anchor:DemoSignerCoordinatorAnchorSqlite,binding:DemoSignerDurableBindingV1,down=false) {
 const handler=createFridaySignerHealthHandler({pins,participantId:1,coordinatorIdentity:bytesToHex(schnorr.getPublicKey(coordinator)),
  signerPrivate:signer,processInstanceId:'2'.repeat(64),binding:async()=>binding,now:()=>1000,
  assertReady:async()=>{if(down)throw new Error('quarantined')}})
 return probeFridaySignerHealth({endpoint:'http://[fd00::1]:39101/v1/frost',participantId:1,signerIdentity,
  coordinatorSecret:coordinator,pins,enrollment:enrolled,anchor,signal:new AbortController().signal,now:()=>1000,
  fetch:(async(_url,init)=>Response.json(await handler(JSON.parse(String(init?.body))))) as typeof fetch})
}
test('A2 desired repair: newer health epoch is refused without stranding the active terminal transport',async()=>{
 const db=new Database(':memory:');try{
  const anchor=new DemoSignerCoordinatorAnchorSqlite(db);await anchor.assertCurrent(enrolled);await anchor.observeProcess(enrolled,'1'.repeat(64))
  let networkCalls=0
  const transport=createDemoSignerRpcTransport({endpoint:'http://[fd00::1]:39101/v1/frost',signerIdentity,
   signerBinding:enrolled,enrollment:{participantId:1,processIdentity:signerIdentity,stateDirectory:enrolled.stateDirectory,verifyingShare:enrolled.verifyingShare},
   anchor,coordinatorIdentityPrivateKey:coordinator,fetchImpl:(async()=>{networkCalls++;throw new Error('unexpected network')}) as unknown as typeof fetch})
  await expect(healthProbe(anchor,{...enrolled,restartEpoch:2})).rejects.toThrow(/EPOCH_BINDING/)
  expect(db.query<{maximum_restart_epoch:number},[]>('SELECT maximum_restart_epoch FROM demo_signer_coordinator_anchor WHERE participant_id=1').get()!.maximum_restart_epoch).toBe(1)
  await expect(transport.roundOne({} as never,{signal:new AbortController().signal})).rejects.toThrow(/unexpected network/)
  expect(networkCalls).toBe(1)
 }finally{db.close(false)}
})
test('A2 desired repair: signed false cannot advance coordinator epoch/process anchor',async()=>{
 const db=new Database(':memory:');try{
  const anchor=new DemoSignerCoordinatorAnchorSqlite(db);await anchor.assertCurrent(enrolled)
  await expect(healthProbe(anchor,{...enrolled,restartEpoch:2},true)).rejects.toThrow(/EPOCH_BINDING/)
  expect(db.query<{maximum_restart_epoch:number,process_instance_id:string|null},[]>('SELECT maximum_restart_epoch,process_instance_id FROM demo_signer_coordinator_anchor WHERE participant_id=1').get()).toEqual({maximum_restart_epoch:1,process_instance_id:null})
 }finally{db.close(false)}
})
test('A2 HLT: local health preserves signer state, reports transient signing gap false, and never rebases it',async()=>{
 const root=await mkdtemp('/tmp/a2-hlt-state-');const stateDirectory=join(root,'state');await mkdir(stateDirectory)
 const dkg=join(stateDirectory,'dkg-final.state'),journal=join(stateDirectory,'sign-'+'a'.repeat(64)+'.journal')
 await writeFile(dkg,'PRIVATE_TEST_CANARY_DKG',{mode:0o600});await writeFile(journal,'PRIVATE_TEST_CANARY_COMMITTED',{mode:0o600})
 const options={participantId:1 as const,dkgRunId:'dkg',publicKeyPackageSha256:pins.publicKeyPackageSha256,
  signerRosterDigest:pins.signerRosterDigest,stateDirectory,signerMetadataPath:join(stateDirectory,'metadata.sqlite3'),
  proofUsePath:join(root,'proof.sqlite3'),coordinatorAnchorPath:join(root,'anchor.sqlite3'),initialEnrollmentPermitPath:join(root,'permit.json')}
 await writeFile(options.initialEnrollmentPermitPath,JSON.stringify(demoDispositionEnrollmentPermit(options)),{mode:0o600})
 const anchor=openDemoDispositionSignerAnchor(options),db=new Database(options.coordinatorAnchorPath,{readonly:true})
 try{
  const snapshot=()=>JSON.stringify(db.query('SELECT * FROM disposition_signer_safety_anchor').all())
  const before=snapshot()
  const handler=createFridaySignerHealthHandler({pins,participantId:1,coordinatorIdentity:bytesToHex(schnorr.getPublicKey(coordinator)),
   signerPrivate:signer,processInstanceId:'2'.repeat(64),binding:async()=>enrolled,assertReady:async()=>anchor.assertHealthCurrent(),now:()=>1000})
  let captured:unknown
  const probe=()=>probeFridaySignerHealth({endpoint:'http://[fd00::1]:39101/v1/frost',participantId:1,signerIdentity,coordinatorSecret:coordinator,
   pins,enrollment:enrolled,anchor:{async assertCurrent(){},async observeProcess(){}},signal:new AbortController().signal,now:()=>1000,
   fetch:(async(_url,init)=>{captured=await handler(JSON.parse(String(init?.body)));return Response.json(captured)}) as typeof fetch})
  expect(await probe()).toBe(1);expect(snapshot()).toBe(before)
  expect(JSON.stringify(captured)).not.toContain('PRIVATE_TEST_CANARY')
  await writeFile(journal,'PRIVATE_TEST_CANARY_CONSUMED',{mode:0o600})
  expect(await probe()).toBeNull();expect(snapshot()).toBe(before)
  expect(await readFile(journal,'utf8')).toBe('PRIVATE_TEST_CANARY_CONSUMED')
  expect(()=>anchor.assertRustStateCurrent()).toThrow(/QUARANTINED/)
  // Simulate the successful signing path recording its own completed transition.
  anchor.recordRustStateAdvance();const advanced=snapshot()
  expect(await probe()).toBe(1);expect(snapshot()).toBe(advanced)
 }finally{db.close(false);anchor.close();await rm(root,{recursive:true,force:true})}
})

