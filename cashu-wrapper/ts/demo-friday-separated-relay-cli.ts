#!/usr/bin/env bun
/** Existing public/ciphertext relay with a fixed owner-approved fresh roster.
 * No private material, transport, host command or automatic retry is accepted.
 */
import { executeDemoFridayDkgRelayRequestV1 } from './demo-friday-per-validator-dkg-relay'
import { demoFridayDkgManifestDigest } from './demo-friday-per-validator-dkg-bootstrap'
import { verifySeparatedBootstrap, separatedCanonical } from './demo-friday-separated-deployment'
import { separatedManifest, composeSeparatedRuntime, type SeparatedBootstrapVerification } from './demo-friday-separated-profile'
import { loadSeparatedBootstrapInput, loadSeparatedApplication } from './demo-friday-separated-service'

export function executeSeparatedRelay(bootstrapInput:SeparatedBootstrapVerification,request:unknown):unknown {
 const bootstrap=verifySeparatedBootstrap(bootstrapInput),manifest=separatedManifest(bootstrap)
 const expected=demoFridayDkgManifestDigest(manifest)
 if(!request || typeof request!=='object' || Array.isArray(request))throw new Error('SEPARATED_RELAY: object required')
 const raw=request as Record<string,unknown>
 const source=raw.action==='compose_authenticated_result' ? raw.checkpoint : raw
 if(!source || typeof source!=='object' || Array.isArray(source))throw new Error('SEPARATED_RELAY: pinned payload required')
 const payload=source as Record<string,unknown>
 if(payload.expectedManifestDigest!==expected || separatedCanonical(payload.manifest)!==separatedCanonical(manifest))throw new Error('SEPARATED_RELAY: owner manifest differs')
 const result=executeDemoFridayDkgRelayRequestV1(request)
 return raw.action==='compose_authenticated_result' ? composeSeparatedRuntime(bootstrapInput,result) : result
}
export async function runSeparatedRelay():Promise<void>{
 if(process.argv.length!==2)throw new Error('SEPARATED_RELAY: no arguments accepted')
 const app=await loadSeparatedApplication()
 if(app.role!=='APPLICATION')throw new Error('SEPARATED_RELAY: application host required')
 const input=await loadSeparatedBootstrapInput()
 const chunks:Uint8Array[]=[];let total=0
 const reader=Bun.stdin.stream().getReader()
 for(;;){
  const next=await reader.read();if(next.done)break
  const chunk=next.value
  total+=chunk.byteLength;if(total>4*1024*1024)throw new Error('SEPARATED_RELAY: input bound')
  chunks.push(chunk)
 }
 if(!total)throw new Error('SEPARATED_RELAY: empty request')
 const result=executeSeparatedRelay(input,JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks))))
 const encoded=JSON.stringify(result)+'\n'
 if(Buffer.byteLength(encoded)>4*1024*1024)throw new Error('SEPARATED_RELAY: output bound')
 process.stdout.write(encoded)
}
if(import.meta.main){try{await runSeparatedRelay()}catch{process.stderr.write('Separated public relay rejected\n');process.exitCode=1}}
