/** Actual public codecs/crypto + mocked HTTP only; no listener or DKG runtime. */
import { describe, expect, test } from 'bun:test'
import { createPrivateKey, sign } from 'node:crypto'
import {
 separatedBootstrapDigest, verifySeparatedBootstrap,
 type SeparatedBootstrap, type SeparatedPredecessorPin,
} from './demo-friday-separated-deployment'
import { exactDemoFridayDkgManifest, demoFridayDkgManifestDigest } from './demo-friday-per-validator-dkg-bootstrap'
import { DEMO_FRIDAY_DKG_HOST_PIN_SCHEMA } from './demo-friday-per-validator-dkg-enrollment-init'
import {
 verifySeparatedRuntime, composeSeparatedRuntime, separatedManifest, SEPARATED_DKG_ROOT, SEPARATED_KEYSET_ID, SEPARATED_KEYSET_VERSION,
 type SeparatedRuntimeBinding,
} from './demo-friday-separated-profile'
import {
 SEPARATED_ENROLLMENT_PERMIT_SCHEMA, separatedEnrollmentPermitDigest, separatedEnrollmentPermitMessage,
 verifySeparatedEnrollmentPermit, type SeparatedEnrollmentPermitBody,
} from './demo-friday-separated-enrollment'
import { SEPARATED_DEPLOYMENT_ID, SEPARATED_APPLICATION_RUN_ID, SEPARATED_DKG_RUN_ID, SEPARATED_PUBLIC_ORIGIN } from './demo-friday-separated-constants'
import { exactDemoFridayApplication, demoFridayMintUrl, demoFridayMintIdentityUrl, demoFridayNodeRoot, type DemoFridaySeparatedApplication } from './demo-friday-runtime-config'
import { prepareSeparatedHostStage } from './demo-friday-separated-host-cli'
import { createPinnedObserverCometReader } from './demo-comet-displacement-verifier'
import { executeSeparatedRelay } from './demo-friday-separated-relay-cli'
import { DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA } from './demo-friday-per-validator-dkg-relay'
import { resolveDemoFridaySignerContract, preflightDemoFridaySignerPolicyComposition } from './demo-friday-signer-contract'
import { assertDemoFipsAdmissionPins } from './demo-fips-admission-policy'
import { assertDemoFipsFundingAbortPins } from './demo-fips-funding-abort-policy'
import { assertDemoFipsTerminalPins } from './demo-fips-terminal-policy'
import { exactDemoFridayCoordinatorIdentity } from './demo-friday-dkg-deployment-tools'

const vector = await Bun.file(new URL('../../internal/poc/testdata/friday-separated-go-golden.json',import.meta.url)).json() as {
 predecessor:unknown;bootstrap:SeparatedBootstrap;bootstrapDigest:string;ownerPublic:string;runtime:SeparatedRuntimeBinding
}
const previous=exactDemoFridayDkgManifest(vector.predecessor)
const predecessor:SeparatedPredecessorPin={manifestDigest:demoFridayDkgManifestDigest(previous),fipsNpubs:previous.participants.map(x=>x.fipsNpub),fipsUlas:previous.participants.map(x=>x.fipsUla),authorityIdentities:[previous.coordinatorIdentity,...previous.participants.flatMap(x=>[x.dkgIdentity,x.signerIdentity,x.kexPublicKey])]}
const input=()=>({value:structuredClone(vector.bootstrap),expectedDigest:vector.bootstrapDigest,ownerApprovalPublicKey:vector.ownerPublic,predecessor})
const owner=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.alloc(32,0x44)]),format:'der',type:'pkcs8'})
function application():DemoFridaySeparatedApplication{return {
 schema:'PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1',role:'APPLICATION',participant_id:0,
 deployment_id:SEPARATED_DEPLOYMENT_ID,run_id:SEPARATED_APPLICATION_RUN_ID,application_host_id:'linode-109290386',application_ipv4:'139.162.161.233',
 application_fips_ula:'fd42::5',fips_ulas:['fd42::1','fd42::2','fd42::3','fd42::4'],comet_p2p_port:27656,comet_rpc_port:27657,signer_rpc_port:39101,
 mint_port:3438,cashu_mint_url:SEPARATED_PUBLIC_ORIGIN,site_port:8180,network_root:'/var/lib/plebeian-auctions-friday/network-separated',
 dkg_root:SEPARATED_DKG_ROOT,coordinator_root:'/var/lib/plebeian-auctions-friday/coordinator-v3/runtime',coordinator_rpc_identity_path:'/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/coordinator-rpc-identity.key',
}}
function permit(){
 const p=vector.bootstrap.validators[0]
 const body:SeparatedEnrollmentPermitBody={schema:SEPARATED_ENROLLMENT_PERMIT_SCHEMA,valueProfile:'FAKE_MONEY_ONLY',stage:'PRE_ENROLLMENT',predecessorManifestDigest:predecessor.manifestDigest,
 hostPin:{schema:DEMO_FRIDAY_DKG_HOST_PIN_SCHEMA,valueProfile:'FAKE_MONEY_ONLY',deploymentId:SEPARATED_DEPLOYMENT_ID,applicationRunId:SEPARATED_APPLICATION_RUN_ID,dkgRunId:SEPARATED_DKG_RUN_ID,
 committeeKeysetId:SEPARATED_KEYSET_ID,committeeKeysetVersion:SEPARATED_KEYSET_VERSION,participantId:1,hostId:p.hostId,underlayIpv4:p.underlayIpv4,fipsNpub:p.fipsNpub,fipsUla:p.fipsUla,signerEndpoint:`http://[${p.fipsUla}]:39101/v1/frost`,
 participantBinarySha256:vector.bootstrap.participantBinarySha256,inspectorBinarySha256:vector.bootstrap.inspectorBinarySha256,configPath:`${SEPARATED_DKG_ROOT}/participant.config.json`,stateDirectory:`${SEPARATED_DKG_ROOT}/state`},rebuild:p.rebuild}
 return {...body,ownerSignature:sign(null,separatedEnrollmentPermitMessage(body),owner).toString('hex')}
}
describe('separated profile, roles and observer seam',()=>{
 test('observer RPC never follows a redirect out of the fixed loopback transport',async()=>{
  let mode:RequestRedirect|undefined
  const reader=createPinnedObserverCometReader({chainId:'fresh-synthetic',nodeId:'c'.repeat(40),fetchImpl:(async(_input,init)=>{
   mode=init?.redirect;return new Response(null,{status:302,headers:{location:'https://example.invalid'}})
  }) as typeof fetch})
  await expect(reader.readChainId()).rejects.toThrow(/redirect/);expect(mode).toBe('manual')
 })
 test('public runtime producer and allowlisted relay retain owner-pinned fresh profile',()=>{
  expect(composeSeparatedRuntime(input(),vector.runtime.result)).toEqual(vector.runtime)
  const request={schema:DEMO_FRIDAY_DKG_RELAY_REQUEST_SCHEMA,action:'enrollment_bundle',manifest:vector.runtime.result.manifest,
   expectedManifestDigest:vector.runtime.manifestDigest,entries:vector.runtime.result.enrollments}
  expect((executeSeparatedRelay(input(),request) as {entries:unknown[]}).entries).toHaveLength(4)
  expect(()=>executeSeparatedRelay(input(),{...request,expectedManifestDigest:'a'.repeat(64)})).toThrow()
 })
 test('fresh app requester record cannot masquerade as the old V2 host',()=>{
  const record={schema:'PLEBEIAN_FRIDAY_COORDINATOR_RPC_IDENTITY_V1',valueProfile:'FAKE_MONEY_ONLY',deploymentId:SEPARATED_DEPLOYMENT_ID,
   applicationRunId:SEPARATED_APPLICATION_RUN_ID,dkgRunId:SEPARATED_DKG_RUN_ID,committeeKeysetId:SEPARATED_KEYSET_ID,committeeKeysetVersion:'3',
   hostId:'linode-109290386',coordinatorParticipantId:1,coordinatorIdentity:vector.runtime.result.coordinatorIdentity}
  expect(exactDemoFridayCoordinatorIdentity(record).hostId).toBe('linode-109290386')
  expect(()=>exactDemoFridayCoordinatorIdentity({...record,hostId:'linode-108236985'})).toThrow()
  expect(()=>exactDemoFridayCoordinatorIdentity({...record,committeeKeysetVersion:'2'})).toThrow()
 })
 test('all concrete signer policies accept fresh own-chain/mint bindings; app cannot compose a signer',()=>{
  const facts={chain_id:'synthetic-fresh',genesis_sha256:'a'.repeat(64),validators_hash:'b'.repeat(64),validator_roster_version:'genesis-v1'}
  for(const slot of [1,2,3,4] as const){
   const app={...application(),role:'VALIDATOR_SIGNER' as const,participant_id:slot}
   const composed=preflightDemoFridaySignerPolicyComposition({application:app,slot,facts,dkg:vector.runtime.result,
    validate:{admission:assertDemoFipsAdmissionPins,fundingAbort:assertDemoFipsFundingAbortPins,terminal:assertDemoFipsTerminalPins}})
   expect(composed.contract.cometRpc).toBe('http://127.0.0.1:27657')
   expect(composed.contract.mintTransportUrl).toBe('http://[fd42::5]:3438')
   expect(composed.contract.paths.identityPath).toBe(`${SEPARATED_DKG_ROOT}/signer-rpc-identity.key`)
   expect(composed.contract.nodeRoot.endsWith(`/separated/node-${slot}`)).toBe(true)
  }
  expect(()=>resolveDemoFridaySignerContract(application(),1)).toThrow()
  expect(()=>resolveDemoFridaySignerContract({...application(),role:'VALIDATOR_SIGNER',participant_id:1,comet_rpc_port:26657},1)).toThrow()
 })
 test('Go-signed public bootstrap has identical TS canonical digest and signature',()=>{
  expect(separatedBootstrapDigest(vector.bootstrap)).toBe(vector.bootstrapDigest)
  expect(verifySeparatedBootstrap(input())).toEqual(vector.bootstrap)
 })
 test('Go completed DKG result verifies through unchanged cryptographic verifier and new owner profile',()=>{
  const result=verifySeparatedRuntime({bootstrap:input(),value:vector.runtime,expectedRuntimeDigest:vector.runtime.bindingDigest})
  expect(result.runtime.result.participants).toHaveLength(4)
  expect(result.runtime.result.coordinatorIdentity).toBe(vector.bootstrap.application.coordinatorRpcIdentity)
  expect(result.runtime.result.publicKeyPackagePath.startsWith(`${SEPARATED_DKG_ROOT}/exchange/`)).toBe(true)
 })
 test('wrong runtime, package, owner manifest and final attestation fail closed',()=>{
  const wrong=structuredClone(vector.runtime);wrong.result.finalAttestations[0]!.signature='0'.repeat(128)
  expect(()=>verifySeparatedRuntime({bootstrap:input(),value:wrong,expectedRuntimeDigest:vector.runtime.bindingDigest})).toThrow()
  const changed=structuredClone(vector.runtime);changed.bootstrapDigest='1'.repeat(64)
  expect(()=>verifySeparatedRuntime({bootstrap:input(),value:changed,expectedRuntimeDigest:vector.runtime.bindingDigest})).toThrow()
  expect(()=>verifySeparatedRuntime({bootstrap:input(),value:vector.runtime,expectedRuntimeDigest:'1'.repeat(64)})).toThrow()
 })
 test('new root has four signers, app requester is absent from the participant roster',()=>{
  const manifest=separatedManifest(verifySeparatedBootstrap(input()))
  expect(manifest.participants.map(p=>p.participantId)).toEqual([1,2,3,4])
  expect(manifest.participants.some(p=>p.hostId===vector.bootstrap.application.hostId)).toBe(false)
  expect(manifest.coordinatorIdentity).toBe(vector.bootstrap.application.coordinatorRpcIdentity)
 })
 test('pre-enrollment permit authenticates rebuild/host pins before keys exist',()=>{
  const value=permit();expect(verifySeparatedEnrollmentPermit({value,expectedDigest:separatedEnrollmentPermitDigest(value),ownerApprovalPublicKey:vector.ownerPublic,predecessor}).hostPin.participantId).toBe(1)
  const bad=structuredClone(value);bad.hostPin.hostId='linode-109290386'
  expect(()=>verifySeparatedEnrollmentPermit({value:bad,expectedDigest:separatedEnrollmentPermitDigest(bad),ownerApprovalPublicKey:vector.ownerPublic,predecessor})).toThrow()
  expect(()=>verifySeparatedEnrollmentPermit({value,expectedDigest:'0'.repeat(64),ownerApprovalPublicKey:vector.ownerPublic,predecessor})).toThrow()
 })
 test('post-enrollment bootstrap cannot be substituted for pre-enrollment permit',()=>{
  expect(()=>verifySeparatedEnrollmentPermit({value:vector.bootstrap,expectedDigest:vector.bootstrapDigest,ownerApprovalPublicKey:vector.ownerPublic,predecessor})).toThrow()
  expect(()=>verifySeparatedBootstrap({...input(),value:permit()})).toThrow()
 })
 test('app role is not validator0 or5 and cannot acquire participant state paths',()=>{
  const app=exactDemoFridayApplication(application());expect(app.schema).toBe('PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1')
  expect(()=>demoFridayNodeRoot(app,1)).toThrow()
  for(const value of [1,5])expect(()=>exactDemoFridayApplication({...application(),participant_id:value})).toThrow()
  expect(()=>exactDemoFridayApplication({...application(),application_host_slot:2})).toThrow()
  expect(()=>exactDemoFridayApplication({...application(),role:'VALIDATOR_SIGNER',participant_id:0})).toThrow()
 })
 test('mint transport belongs to application FIPS identity, never validator slot2',()=>{
  const app=exactDemoFridayApplication(application())
  expect(demoFridayMintUrl(app)).toBe('http://[fd42::5]:3438')
  expect(demoFridayMintIdentityUrl(app)).toBe(SEPARATED_PUBLIC_ORIGIN)
  expect(()=>exactDemoFridayApplication({...application(),application_fips_ula:'fd42::2'})).toThrow()
  expect(()=>exactDemoFridayApplication({...application(),cashu_mint_url:'https://172.105.95.57'})).toThrow()
 })
 test('fresh host stage reuses pinned engine/root without an old private-root seal',()=>{
  const stage=prepareSeparatedHostStage(input(),1,'enroll')
  expect(stage.runId).toBe(SEPARATED_DKG_RUN_ID);expect(stage.profile?.filesystemRoot).toBe(SEPARATED_DKG_ROOT)
  expect(stage.externalManifestDigest).toBe(vector.runtime.manifestDigest)
 })
 test('observer guard accepts only pinned non-voting caught-up node at exact loopback',async()=>{
  const expected='a'.repeat(40)
  let observed:any={node_info:{network:'fake-separated',id:expected},sync_info:{catching_up:false,latest_block_height:'11'},validator_info:{voting_power:'0'}}
  const calls:string[]=[]
  const fetchImpl=(async(url:URL|string)=>{calls.push(String(url));return new Response(JSON.stringify({result:observed}),{headers:{'content-type':'application/json'}})})as typeof fetch
  const reader=createPinnedObserverCometReader({chainId:'fake-separated',nodeId:expected,fetchImpl})
  expect(await reader.readChainId()).toBe('fake-separated')
  expect(calls).toEqual(['http://127.0.0.1:27657/status'])
  for(const value of [{...observed,sync_info:{...observed.sync_info,catching_up:true}},{...observed,node_info:{...observed.node_info,network:'other'}},{...observed,validator_info:{voting_power:'1'}},{...observed,node_info:{...observed.node_info,id:'b'.repeat(40)}}]){
   observed=value;await expect(reader.readChainId()).rejects.toThrow()
  }
 })
})
