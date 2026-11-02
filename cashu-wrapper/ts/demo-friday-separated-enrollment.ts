/** One-time rebuilt-host enrollment, before the public PRE_DKG bootstrap.
 * Reuses the existing durable enrollment engine and its crash/lock rules.
 */
import { createPublicKey, verify } from 'node:crypto'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import {
 exactDemoFridayDkgOwnerApprovedHostPinAtRoot, demoFridayDkgOwnerApprovedHostPinDigestAtRoot,
 initializeDemoFridayDkgHostEnrollment, recoverDemoFridayDkgHostEnrollment,
} from './demo-friday-per-validator-dkg-enrollment-init'
import { separatedCanonical, type SeparatedRebuildProof, type SeparatedPredecessorPin } from './demo-friday-separated-deployment'
import { SEPARATED_DEPLOYMENT_ID, SEPARATED_APPLICATION_RUN_ID, SEPARATED_DKG_RUN_ID } from './demo-friday-separated-constants'
import { SEPARATED_DKG_ROOT, SEPARATED_KEYSET_ID, SEPARATED_KEYSET_VERSION } from './demo-friday-separated-profile'

const DOMAIN='PLEBEIAN_FRIDAY_SEPARATED_ENROLLMENT_PERMIT_OWNER_APPROVAL_V1'
export const SEPARATED_ENROLLMENT_PERMIT_SCHEMA='PLEBEIAN_FRIDAY_SEPARATED_ENROLLMENT_PERMIT_V1' as const
type HostPin=ReturnType<typeof exactDemoFridayDkgOwnerApprovedHostPinAtRoot>
export interface SeparatedEnrollmentPermitBody {
 schema:typeof SEPARATED_ENROLLMENT_PERMIT_SCHEMA
 valueProfile:'FAKE_MONEY_ONLY'
 stage:'PRE_ENROLLMENT'
 predecessorManifestDigest:string
 hostPin:HostPin
 rebuild:SeparatedRebuildProof
}
export interface SeparatedEnrollmentPermit extends SeparatedEnrollmentPermitBody {ownerSignature:string}
export function separatedEnrollmentPermitDigest(value:SeparatedEnrollmentPermit):string{return bytesToHex(sha256(utf8ToBytes(separatedCanonical(value))))}
export function separatedEnrollmentPermitMessage(value:SeparatedEnrollmentPermitBody):Uint8Array{return utf8ToBytes(separatedCanonical([DOMAIN,value]))}
function fail(message:string):never{throw new Error(`SEPARATED_ENROLLMENT: ${message}`)}
export function verifySeparatedEnrollmentPermit(options:{value:unknown;expectedDigest:string;ownerApprovalPublicKey:string;predecessor:SeparatedPredecessorPin}):SeparatedEnrollmentPermit{
 const raw=options.value
 const keys=['schema','valueProfile','stage','predecessorManifestDigest','hostPin','rebuild','ownerSignature']
 if(raw===null||typeof raw!=='object'||Array.isArray(raw)||JSON.stringify(Object.keys(raw).sort())!==JSON.stringify(keys.sort()))fail('permit fields differ')
 const value=raw as SeparatedEnrollmentPermit
 if(value.schema!==SEPARATED_ENROLLMENT_PERMIT_SCHEMA||value.valueProfile!=='FAKE_MONEY_ONLY'||value.stage!=='PRE_ENROLLMENT'
  ||value.predecessorManifestDigest!==options.predecessor.manifestDigest||!/^[0-9a-f]{64}$/.test(options.predecessor.manifestDigest))fail('permit stage/provenance differs')
 const pin=exactDemoFridayDkgOwnerApprovedHostPinAtRoot(value.hostPin,SEPARATED_DKG_ROOT)
 const hosts=['linode-108175009','linode-108236985','linode-108237290','linode-108237424']
 const ips=['172.105.64.142','172.105.95.57','172.104.240.217','172.104.253.247']
 if(pin.deploymentId!==SEPARATED_DEPLOYMENT_ID||pin.applicationRunId!==SEPARATED_APPLICATION_RUN_ID||pin.dkgRunId!==SEPARATED_DKG_RUN_ID
  ||pin.committeeKeysetId!==SEPARATED_KEYSET_ID||pin.committeeKeysetVersion!==SEPARATED_KEYSET_VERSION
  ||pin.hostId!==hosts[pin.participantId-1]||pin.underlayIpv4!==ips[pin.participantId-1]
  ||options.predecessor.fipsNpubs.includes(pin.fipsNpub)||options.predecessor.fipsUlas.includes(pin.fipsUla))fail('permit host or fresh FIPS pins differ')
 const rebuild=value.rebuild
 const rebuildKeys=['providerEventDigest','imageDigest','sshHostKeyDigest','abandonmentDecisionDigest','emptyStateObservationDigest']
 if(rebuild===null||typeof rebuild!=='object'||Array.isArray(rebuild)||JSON.stringify(Object.keys(rebuild).sort())!==JSON.stringify(rebuildKeys.sort())
  ||Object.values(rebuild).some(v=>typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v)))fail('rebuild proof incomplete')
 if(!/^[0-9a-f]{64}$/.test(options.expectedDigest)||! /^[0-9a-f]{64}$/.test(options.ownerApprovalPublicKey)
  ||! /^[0-9a-f]{128}$/.test(value.ownerSignature)||separatedEnrollmentPermitDigest(value)!==options.expectedDigest)fail('independent permit pin differs')
 const {ownerSignature,...body}=value
 const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(hexToBytes(options.ownerApprovalPublicKey))]),format:'der',type:'spki'})
 if(!verify(null,separatedEnrollmentPermitMessage(body),publicKey,hexToBytes(ownerSignature)))fail('owner signature invalid')
 return structuredClone({...value,hostPin:pin})
}

export async function initializeSeparatedEnrollment(options:{
 permit:Parameters<typeof verifySeparatedEnrollmentPermit>[0]
 participantId:1|2|3|4
 recover?:boolean
 /** Existing unit-test seams only; production caller supplies neither. */
 filesystem?:Parameters<typeof initializeDemoFridayDkgHostEnrollment>[0]['profile']
 keyGenerator?:Parameters<typeof initializeDemoFridayDkgHostEnrollment>[0]['keyGenerator']
}){
 const permit=verifySeparatedEnrollmentPermit(options.permit)
 if(permit.hostPin.participantId!==options.participantId)fail('requested slot differs from owner permit')
 const profile=options.filesystem??{parentDirectory:'/var/lib/plebeian-auctions-friday/frost-v3',filesystemRoot:SEPARATED_DKG_ROOT,
  logicalRoot:SEPARATED_DKG_ROOT,hostPinPath:'/var/lib/plebeian-auctions-friday/frost-v3/owner-approved-host-enrollment-pin-v3.json'}
 if(profile.logicalRoot!==SEPARATED_DKG_ROOT)fail('logical enrollment root differs')
 const digest=demoFridayDkgOwnerApprovedHostPinDigestAtRoot(permit.hostPin,SEPARATED_DKG_ROOT)
 if(options.recover)return recoverDemoFridayDkgHostEnrollment({participantId:options.participantId,expectedHostPinDigest:digest,profile})
 return initializeDemoFridayDkgHostEnrollment({participantId:options.participantId,expectedHostPinDigest:digest,profile,keyGenerator:options.keyGenerator})
}
