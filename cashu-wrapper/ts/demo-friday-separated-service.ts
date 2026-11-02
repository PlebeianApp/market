/** Fixed public service inputs for the separated deployment. No private DKG files. */
import { open, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { exactDemoFridayDkgManifest, demoFridayDkgManifestDigest } from './demo-friday-per-validator-dkg-bootstrap'
import { exactDemoFridaySignerNetworkFactsV1, type DemoFridayPublicDkgBindingV2 } from './demo-friday-signer-dkg-v2'
import { verifySeparatedRuntime, SEPARATED_DKG_ROOT, SEPARATED_INPUT_ROOT, type SeparatedBootstrapVerification } from './demo-friday-separated-profile'
import { exactDemoFridayApplication, isSeparatedApplication, type DemoFridaySeparatedApplication } from './demo-friday-runtime-config'

const CONFIG = '/etc/plebeian-auctions-friday'
const HEX32 = /^[0-9a-f]{64}$/
const hash = (b: Uint8Array) => bytesToHex(sha256(b))
async function publicBytes(path: string, limit = 1024 * 1024): Promise<Uint8Array> {
 const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
 try {
  const first = await handle.stat()
  if (!first.isFile() || first.nlink !== 1 || first.size < 1 || first.size > limit) throw new Error('SEPARATED_SERVICE: unsafe public file')
  const out = Buffer.alloc(first.size)
  let count = 0
  while (count < out.length) {
   const result = await handle.read(out, count, out.length - count, count)
   if (result.bytesRead === 0) throw new Error('SEPARATED_SERVICE: truncated public file')
   count += result.bytesRead
  }
  const after = await handle.stat()
  if (first.ino !== after.ino || first.dev !== after.dev || first.size !== after.size || first.mtimeMs !== after.mtimeMs
   || first.ctimeMs !== after.ctimeMs || after.nlink !== 1) throw new Error('SEPARATED_SERVICE: public input changed')
  return out
 } finally { await handle.close() }
}
function parse(bytes: Uint8Array): unknown { return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)) }
function pin(env: NodeJS.ProcessEnv, name: string): string {
 const value = env[name]
 if (typeof value !== 'string' || !HEX32.test(value)) throw new Error(`SEPARATED_SERVICE: independent ${name} pin required`)
 return value
}

async function predecessorPins() {
 const predecessor = exactDemoFridayDkgManifest(parse(await publicBytes(`${CONFIG}/predecessor-manifest.json`)))
 return { manifestDigest: demoFridayDkgManifestDigest(predecessor),
  fipsNpubs: predecessor.participants.map(p => p.fipsNpub), fipsUlas: predecessor.participants.map(p => p.fipsUla),
  authorityIdentities: [predecessor.coordinatorIdentity, ...predecessor.participants.flatMap(p => [p.dkgIdentity,p.signerIdentity,p.kexPublicKey])] }
}
export async function loadSeparatedBootstrapInput(env: NodeJS.ProcessEnv = process.env): Promise<SeparatedBootstrapVerification> {
 return { value: parse(await publicBytes(`${CONFIG}/separated-bootstrap.json`)), expectedDigest: pin(env,'FRIDAY_SEPARATED_BOOTSTRAP_DIGEST'),
  ownerApprovalPublicKey: pin(env,'FRIDAY_OWNER_APPROVAL_PUBLIC_KEY'), predecessor: await predecessorPins() }
}
export async function loadSeparatedPermitInput(participantId:1|2|3|4,expectedDigest:string,env:NodeJS.ProcessEnv=process.env) {
 if (!HEX32.test(expectedDigest)) throw new Error('SEPARATED_SERVICE: independent permit digest required')
 return {value:parse(await publicBytes(`${CONFIG}/separated-enrollment-permit-${participantId}.json`)), expectedDigest,
  ownerApprovalPublicKey:pin(env,'FRIDAY_OWNER_APPROVAL_PUBLIC_KEY'),predecessor:await predecessorPins()}
}
export async function loadSeparatedApplication():Promise<DemoFridaySeparatedApplication>{
 const application=exactDemoFridayApplication(parse(await publicBytes(`${CONFIG}/application.json`)))
 if(!isSeparatedApplication(application))throw new Error('SEPARATED_SERVICE: separated role configuration required')
 return application
}

export interface SeparatedPublicInputReader {
 read(path:string,limit?:number):Promise<Uint8Array>
 assertAbsent(path:string):Promise<void>
}
const installedPublicInputs:SeparatedPublicInputReader={read:publicBytes,async assertAbsent(path){
 try{await lstat(path)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
 throw new Error('SEPARATED_SERVICE: app host contains forbidden DKG private state')
}}

export async function loadSeparatedServiceBinding(options: {
 application: DemoFridaySeparatedApplication
 env?: NodeJS.ProcessEnv
}, inputs:SeparatedPublicInputReader=installedPublicInputs): Promise<DemoFridayPublicDkgBindingV2> {
 const application = options.application, env = options.env ?? process.env
 const bootstrapDigest = pin(env, 'FRIDAY_SEPARATED_BOOTSTRAP_DIGEST')
 const runtimeDigest = pin(env, 'FRIDAY_SEPARATED_RUNTIME_DIGEST')
 const owner = pin(env, 'FRIDAY_OWNER_APPROVAL_PUBLIC_KEY')
 const [bootstrapRaw, runtimeRaw, predecessorRaw, factsRaw] = await Promise.all([
  inputs.read(`${CONFIG}/separated-bootstrap.json`), inputs.read(`${SEPARATED_INPUT_ROOT}/runtime-binding.json`),
  inputs.read(`${CONFIG}/predecessor-manifest.json`), inputs.read(join(application.network_root, 'network-facts.json')),
 ])
 const predecessor = exactDemoFridayDkgManifest(parse(predecessorRaw))
 const verified = verifySeparatedRuntime({ bootstrap: {
  value: parse(bootstrapRaw), expectedDigest: bootstrapDigest, ownerApprovalPublicKey: owner,
  predecessor: { manifestDigest: demoFridayDkgManifestDigest(predecessor),
   fipsNpubs: predecessor.participants.map(p => p.fipsNpub), fipsUlas: predecessor.participants.map(p => p.fipsUla),
   authorityIdentities: [predecessor.coordinatorIdentity, ...predecessor.participants.flatMap(p => [p.dkgIdentity, p.signerIdentity, p.kexPublicKey])] },
 }, value: parse(runtimeRaw), expectedRuntimeDigest: runtimeDigest })
 const { bootstrap, runtime } = verified
 if (application.application_fips_ula !== bootstrap.application.fipsUla
  || application.deployment_id !== bootstrap.deploymentId || application.run_id !== bootstrap.applicationRunId
  || application.fips_ulas.some((ula, index) => ula !== bootstrap.validators[index]!.fipsUla)) throw new Error('SEPARATED_SERVICE: configuration differs from owner deployment')
 const facts = exactDemoFridaySignerNetworkFactsV1(parse(factsRaw))
 if (facts.committee_public_key !== runtime.result.committeePublicKey) throw new Error('SEPARATED_SERVICE: committee differs from network')
 // A final genesis receipt/owner anchor must additionally bind these facts;
 // the pre-DKG bootstrap cannot authorize a chain by itself.
 const finalAnchorRaw = await inputs.read(join(application.network_root, 'deployment-anchor.json'))
 if (hash(finalAnchorRaw) !== pin(env, 'FRIDAY_DEPLOYMENT_ANCHOR_SHA256')) throw new Error('SEPARATED_SERVICE: final deployment anchor differs')
 const anchor = parse(finalAnchorRaw) as Record<string, unknown>
 if (anchor.application_fips_ula !== bootstrap.application.fipsUla || anchor.application_fips_npub !== bootstrap.application.fipsNpub
  || anchor.separated_mint_origin !== bootstrap.application.mintOrigin || anchor.deployment_id !== application.deployment_id || anchor.chain_id !== facts.chain_id
  || anchor.separated_bootstrap_digest !== bootstrapDigest || anchor.separated_runtime_binding_digest !== runtimeDigest || anchor.separated_runtime_binding_sha256 !== hash(runtimeRaw)
  || anchor.expected_manifest_digest !== runtime.manifestDigest || anchor.owner_approval_public_key !== owner) throw new Error('SEPARATED_SERVICE: final anchor profile differs')
 const healthRaw=await inputs.read(`${CONFIG}/health-r20-pins.json`,16384)
 const health=parse(healthRaw) as {mintConformanceReceiptSha256?:unknown;mint?:{activeSatKeysetId?:unknown}}
 if(hash(healthRaw)!==pin(env,'POC_FRIDAY_HEALTH_PINS_SHA256') || health.mintConformanceReceiptSha256!==anchor.separated_mint_conformance_sha256 || health.mint?.activeSatKeysetId!==anchor.active_keyset_id) throw new Error('SEPARATED_SERVICE: mint conformance differs from final owner anchor')
 const networkFactsDigest = pin(env, 'FRIDAY_NETWORK_FACTS_SHA256')
 if (hash(factsRaw) !== networkFactsDigest) throw new Error('SEPARATED_SERVICE: independently pinned genesis/roster facts differ')
 if (application.role === 'APPLICATION') {
  for (const privateName of ['participant.config.json','identity-signing-key.hex','kex-private-key.hex','signer-rpc-identity.key','transport-secrets.json','state']) {
   await inputs.assertAbsent(join(SEPARATED_DKG_ROOT, privateName))
  }
  const receiptRaw = await inputs.read(join(application.network_root,'observer.json'),16384)
  if (hash(receiptRaw) !== pin(env,'FRIDAY_OBSERVER_RECEIPT_SHA256')) throw new Error('SEPARATED_SERVICE: observer receipt differs')
  const receipt = parse(receiptRaw) as Record<string, unknown>
  if (receipt.schema !== 'PLEBEIAN_FRIDAY_NONVOTING_OBSERVER_V1' || receipt.role !== 'NONVOTING_APPLICATION_OBSERVER'
   || receipt.deployment_id !== application.deployment_id || receipt.chain_id !== facts.chain_id || receipt.validators_hash !== facts.validators_hash
   || receipt.owner_approval_public_key !== owner || receipt.rpc_listen !== 'tcp://127.0.0.1:27657'
   || !/^[0-9a-f]{40}$/.test(env.FRIDAY_OBSERVER_NODE_ID ?? '') || receipt.node_id !== env.FRIDAY_OBSERVER_NODE_ID) throw new Error('SEPARATED_SERVICE: observer identity differs')
 }
 const publicKeyPackagePath = runtime.result.publicKeyPackagePath
 if (publicKeyPackagePath !== join(SEPARATED_DKG_ROOT,'exchange',runtime.result.dkgRunId,'participant-1.public.json')) throw new Error('SEPARATED_SERVICE: public package path differs')
 const bytes = await inputs.read(publicKeyPackagePath,65536)
 if (bytesToHex(bytes) !== runtime.result.publicKeyPackageHex) throw new Error('SEPARATED_SERVICE: public DKG package bytes differ')
 return { result: runtime.result, facts, publicKeyPackagePath }
}
