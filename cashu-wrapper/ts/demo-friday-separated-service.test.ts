/** Actual public crypto/service binding, synthetic byte reader; no private I/O. */
import {test,expect} from 'bun:test'
import {createHash} from 'node:crypto'
import {loadSeparatedServiceBinding,type SeparatedPublicInputReader} from './demo-friday-separated-service'
import {exactDemoFridayApplication,type DemoFridaySeparatedApplication} from './demo-friday-runtime-config'
import {SEPARATED_DKG_ROOT,SEPARATED_INPUT_ROOT} from './demo-friday-separated-profile'
const vector=await Bun.file(new URL('../../internal/poc/testdata/friday-separated-go-golden.json',import.meta.url)).json()
const bytes=(v:unknown)=>Buffer.from(JSON.stringify(v)+'\n')
const hash=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex')
function fixture(){
 const app=exactDemoFridayApplication({schema:'PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1',role:'APPLICATION',participant_id:0,deployment_id:vector.runtime.deploymentId,run_id:vector.runtime.result.runId,
 application_host_id:'linode-109290386',application_ipv4:'139.162.161.233',application_fips_ula:'fd42::5',fips_ulas:['fd42::1','fd42::2','fd42::3','fd42::4'],comet_p2p_port:27656,comet_rpc_port:27657,signer_rpc_port:39101,mint_port:3438,site_port:8180,cashu_mint_url:'https://139.162.161.233',network_root:'/var/lib/plebeian-auctions-friday/network-separated',dkg_root:SEPARATED_DKG_ROOT,coordinator_root:'/var/lib/plebeian-auctions-friday/coordinator-v3/runtime',coordinator_rpc_identity_path:'/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/coordinator-rpc-identity.key'}) as DemoFridaySeparatedApplication
 const facts={schema:'PlebeianAuctionsPOCNetworkFactsV1',chain_id:'fresh-synthetic',genesis_sha256:'a'.repeat(64),validators_hash:'b'.repeat(64),committee_public_key:vector.runtime.result.committeePublicKey,validator_roster_version:'genesis-v1'}
 const env:NodeJS.ProcessEnv={FRIDAY_SEPARATED_BOOTSTRAP_DIGEST:vector.bootstrapDigest,FRIDAY_SEPARATED_RUNTIME_DIGEST:vector.runtime.bindingDigest,FRIDAY_OWNER_APPROVAL_PUBLIC_KEY:vector.ownerPublic,FRIDAY_OBSERVER_NODE_ID:'c'.repeat(40)}
 const health={mintConformanceReceiptSha256:'d'.repeat(64),mint:{activeSatKeysetId:'synthetic-sat'}}
 const anchor={deployment_id:app.deployment_id,chain_id:facts.chain_id,application_fips_ula:'fd42::5',application_fips_npub:vector.bootstrap.application.fipsNpub,separated_mint_origin:app.cashu_mint_url,separated_bootstrap_digest:vector.bootstrapDigest,separated_runtime_binding_digest:vector.runtime.bindingDigest,separated_runtime_binding_sha256:hash(bytes(vector.runtime)),expected_manifest_digest:vector.runtime.manifestDigest,owner_approval_public_key:vector.ownerPublic,separated_mint_conformance_sha256:health.mintConformanceReceiptSha256,active_keyset_id:'synthetic-sat'}
 const receipt={schema:'PLEBEIAN_FRIDAY_NONVOTING_OBSERVER_V1',role:'NONVOTING_APPLICATION_OBSERVER',deployment_id:app.deployment_id,chain_id:facts.chain_id,validators_hash:facts.validators_hash,owner_approval_public_key:vector.ownerPublic,rpc_listen:'tcp://127.0.0.1:27657',node_id:env.FRIDAY_OBSERVER_NODE_ID}
 const files=new Map<string,Uint8Array>([
 ['/etc/plebeian-auctions-friday/separated-bootstrap.json',bytes(vector.bootstrap)],[`${SEPARATED_INPUT_ROOT}/runtime-binding.json`,bytes(vector.runtime)],
 ['/etc/plebeian-auctions-friday/predecessor-manifest.json',bytes(vector.predecessor)],[`${app.network_root}/network-facts.json`,bytes(facts)],
 [`${app.network_root}/deployment-anchor.json`,bytes(anchor)],['/etc/plebeian-auctions-friday/health-r20-pins.json',bytes(health)],[`${app.network_root}/observer.json`,bytes(receipt)],
 [vector.runtime.result.publicKeyPackagePath,Buffer.from(vector.runtime.result.publicKeyPackageHex,'hex')]])
 const pin=()=>{env.FRIDAY_DEPLOYMENT_ANCHOR_SHA256=hash(files.get(`${app.network_root}/deployment-anchor.json`)!);env.FRIDAY_NETWORK_FACTS_SHA256=hash(bytes(facts));env.POC_FRIDAY_HEALTH_PINS_SHA256=hash(files.get('/etc/plebeian-auctions-friday/health-r20-pins.json')!);env.FRIDAY_OBSERVER_RECEIPT_SHA256=hash(files.get(`${app.network_root}/observer.json`)!)};pin()
 const checked:string[]=[];let privatePresent=false
 const reader:SeparatedPublicInputReader={async read(path,limit=1024*1024){const v=files.get(path);if(!v || v.length>limit)throw new Error('unreviewed public read');return v},async assertAbsent(path){checked.push(path);if(privatePresent)throw new Error('forbidden private state')}}
 return {app,facts,env,files,health,anchor,receipt,reader,pin,checked,privatePresent:()=>{privatePresent=true}}
}
test('app service consumes only exact public inputs, observer, final owner/mint pins and no participant files',async()=>{
 const f=fixture(),v=await loadSeparatedServiceBinding({application:f.app,env:f.env},f.reader)
 expect(v.result.participants).toHaveLength(4);expect(f.checked).toHaveLength(6);expect(f.checked).toContain(`${SEPARATED_DKG_ROOT}/kex-private-key.hex`)
 expect(v.publicKeyPackagePath).toBe(vector.runtime.result.publicKeyPackagePath)
})
for(const mode of ['runtime-bytes','active-keyset','mint-receipt','observer-role','private-state','package-bytes'] as const)test('service rejects '+mode+' before returning signer/payment authority',async()=>{
 const f=fixture()
 if(mode==='runtime-bytes'){f.anchor.separated_runtime_binding_sha256='e'.repeat(64);f.files.set(`${f.app.network_root}/deployment-anchor.json`,bytes(f.anchor));f.pin()}
 if(mode==='active-keyset'||mode==='mint-receipt'){if(mode==='active-keyset')f.health.mint.activeSatKeysetId='wrong';else f.health.mintConformanceReceiptSha256='e'.repeat(64);f.files.set('/etc/plebeian-auctions-friday/health-r20-pins.json',bytes(f.health));f.pin()}
 if(mode==='observer-role'){f.receipt.role='VALIDATOR_SIGNER';f.files.set(`${f.app.network_root}/observer.json`,bytes(f.receipt));f.pin()}
 if(mode==='private-state')f.privatePresent()
 if(mode==='package-bytes')f.files.set(vector.runtime.result.publicKeyPackagePath,Buffer.from('different'))
 await expect(loadSeparatedServiceBinding({application:f.app,env:f.env},f.reader)).rejects.toThrow()
})
