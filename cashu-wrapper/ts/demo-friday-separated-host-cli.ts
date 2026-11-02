/** Fixed fresh-only adapter over the existing durable enrollment/DKG engines. */
import { constants } from 'node:fs'
import { open, lstat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { verifySeparatedBootstrap } from './demo-friday-separated-deployment'
import { initializeSeparatedEnrollment } from './demo-friday-separated-enrollment'
import { separatedManifest, SEPARATED_DKG_ROOT, type SeparatedBootstrapVerification } from './demo-friday-separated-profile'
import { SEPARATED_DKG_RUN_ID } from './demo-friday-separated-constants'
import { demoFridayDkgManifestDigest } from './demo-friday-per-validator-dkg-bootstrap'
import { executeDemoFridayPerValidatorDkgHostStage, DEMO_FRIDAY_DKG_HOST_STAGES, type DemoFridayDkgHostStage, type DemoFridayDkgHostStageOptions } from './demo-friday-per-validator-dkg-host-cli'
import { SEPARATED_PARTICIPANT_BINARY, SEPARATED_INSPECTOR_BINARY } from './demo-friday-separated-constants'
import { loadSeparatedApplication, loadSeparatedBootstrapInput, loadSeparatedPermitInput } from './demo-friday-separated-service'

export function prepareSeparatedHostStage(input:SeparatedBootstrapVerification,participantId:1|2|3|4,stage:DemoFridayDkgHostStage):DemoFridayDkgHostStageOptions{
 if(![1,2,3,4].includes(participantId)||!(DEMO_FRIDAY_DKG_HOST_STAGES as readonly string[]).includes(stage))throw new Error('SEPARATED_HOST: invalid participant/stage')
 const bootstrap=verifySeparatedBootstrap(input),manifest=separatedManifest(bootstrap)
 return {stage,participantId,runId:SEPARATED_DKG_RUN_ID,externalManifestDigest:demoFridayDkgManifestDigest(manifest),
  profile:{filesystemRoot:SEPARATED_DKG_ROOT,participantBinary:SEPARATED_PARTICIPANT_BINARY,
   inspectorBinary:SEPARATED_INSPECTOR_BINARY,trustedBinaryOwnerUid:0,trustedBinaryParentRoot:'/'}}
}
async function installManifest(input:SeparatedBootstrapVerification):Promise<void>{
 const manifest=separatedManifest(verifySeparatedBootstrap(input))
 const metadata=await lstat(SEPARATED_DKG_ROOT)
 if(!metadata.isDirectory()||metadata.isSymbolicLink()||metadata.uid!==process.geteuid?.()||(metadata.mode&0o777)!==0o700||await realpath(SEPARATED_DKG_ROOT)!==SEPARATED_DKG_ROOT)throw new Error('SEPARATED_HOST: unsafe enrollment root')
 // Digest marker last; interrupted partial writes are preserved and block reuse.
 const files:[string,string][]=[['manifest.json',JSON.stringify(manifest)+'\n'],['owner-approved-manifest-digest.txt',demoFridayDkgManifestDigest(manifest)+'\n']]
 for(const [name,text]of files){const file=await open(join(SEPARATED_DKG_ROOT,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await file.writeFile(text);await file.sync()}finally{await file.close()}}
 const directory=await open(SEPARATED_DKG_ROOT,constants.O_RDONLY);try{await directory.sync()}finally{await directory.close()}
}
export async function runSeparatedHostCommand(argv:string[]):Promise<unknown>{
 const command=argv[0],stageMode=command==='separated-stage'
 const offset=stageMode?1:0
 if((!stageMode&&!['separated-init','separated-recover','separated-manifest'].includes(command??''))
  ||argv.length!==5+offset||argv[1+offset]!=='--participant'||!['1','2','3','4'].includes(argv[2+offset]??'')
  ||!['--expected-permit-digest','--expected-bootstrap-digest'].includes(argv[3+offset]??'')||!/^[0-9a-f]{64}$/.test(argv[4+offset]??''))throw new Error('SEPARATED_HOST: exact command/participant/digest required')
 const participantId=Number(argv[2+offset])as 1|2|3|4,expected=argv[4+offset]!
 const application=await loadSeparatedApplication()
 if(application.role!=='VALIDATOR_SIGNER'||application.participant_id!==participantId)throw new Error('SEPARATED_HOST: application host cannot enroll or hold participant state')
 if(command==='separated-init'||command==='separated-recover'){
  if(argv[3]!=='--expected-permit-digest')throw new Error('SEPARATED_HOST: pre-enrollment permit required')
  return initializeSeparatedEnrollment({permit:await loadSeparatedPermitInput(participantId,expected),participantId,recover:command==='separated-recover'})
 }
 if(argv[3+offset]!=='--expected-bootstrap-digest')throw new Error('SEPARATED_HOST: post-enrollment bootstrap required')
 const input=await loadSeparatedBootstrapInput()
 if(input.expectedDigest!==expected)throw new Error('SEPARATED_HOST: independent bootstrap pins differ')
 const bootstrap=verifySeparatedBootstrap(input)
 if(application.application_fips_ula!==bootstrap.application.fipsUla||application.fips_ulas.some((ula,index)=>ula!==bootstrap.validators[index]!.fipsUla))throw new Error('SEPARATED_HOST: public topology differs')
 if(command==='separated-manifest'){await installManifest(input);return {status:'INSTALLED_PUBLIC_MANIFEST_ONLY'}}
 return executeDemoFridayPerValidatorDkgHostStage(prepareSeparatedHostStage(input,participantId,argv[1]as DemoFridayDkgHostStage))
}
