/** Public-only, owner-authenticated bootstrap for the separated fake-sat demo.
 * This is pre-DKG evidence, never a completed DKG, genesis or runtime receipt.
 * No key generation, filesystem, process, network or provider operation.
 */
import { createPublicKey, verify } from 'node:crypto'
import { isIP } from 'node:net'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { SEPARATED_DEPLOYMENT_ID, SEPARATED_APPLICATION_RUN_ID, SEPARATED_DKG_RUN_ID, SEPARATED_PUBLIC_ORIGIN } from './demo-friday-separated-constants'
export { SEPARATED_DEPLOYMENT_ID, SEPARATED_APPLICATION_RUN_ID, SEPARATED_DKG_RUN_ID, SEPARATED_PUBLIC_ORIGIN } from './demo-friday-separated-constants'
export const SEPARATED_BOOTSTRAP_SCHEMA = 'PLEBEIAN_FRIDAY_SEPARATED_BOOTSTRAP_V1' as const
const DOMAIN = 'PLEBEIAN_FRIDAY_SEPARATED_BOOTSTRAP_OWNER_APPROVAL_V1'
const HEX32 = /^[0-9a-f]{64}$/
const HEX64 = /^[0-9a-f]{128}$/
const NPUB = /^npub1[023456789acdefghjklmnpqrstuvwxyz]{58}$/
const VALIDATORS = [
 ['linode-108175009', '172.105.64.142'], ['linode-108236985', '172.105.95.57'],
 ['linode-108237290', '172.104.240.217'], ['linode-108237424', '172.104.253.247'],
] as const

export interface SeparatedRebuildProof {
 providerEventDigest: string
 imageDigest: string
 sshHostKeyDigest: string
 abandonmentDecisionDigest: string
 emptyStateObservationDigest: string
}
export interface SeparatedValidatorPin {
 participantId: 1 | 2 | 3 | 4
 role: 'VALIDATOR_SIGNER'
 hostId: string
 underlayIpv4: string
 fipsNpub: string
 fipsUla: string
 dkgIdentity: string
 signerIdentity: string
 kexPublicKey: string
 rebuild: SeparatedRebuildProof
}
export interface SeparatedApplicationPin {
 role: 'APPLICATION'
 hostId: 'linode-109290386'
 underlayIpv4: '139.162.161.233'
 fipsNpub: string
 fipsUla: string
 coordinatorRpcIdentity: string
 publicOrigin: typeof SEPARATED_PUBLIC_ORIGIN
 mintOrigin: typeof SEPARATED_PUBLIC_ORIGIN
}
export interface SeparatedBootstrapBody {
 schema: typeof SEPARATED_BOOTSTRAP_SCHEMA
 valueProfile: 'FAKE_MONEY_ONLY'
 stage: 'PRE_DKG'
 deploymentId: typeof SEPARATED_DEPLOYMENT_ID
 applicationRunId: typeof SEPARATED_APPLICATION_RUN_ID
 dkgRunId: typeof SEPARATED_DKG_RUN_ID
 predecessorManifestDigest: string
 application: SeparatedApplicationPin
 validators: [SeparatedValidatorPin, SeparatedValidatorPin, SeparatedValidatorPin, SeparatedValidatorPin]
 participantBinarySha256: string
 inspectorBinarySha256: string
}
export interface SeparatedBootstrap extends SeparatedBootstrapBody { ownerSignature: string }
export interface SeparatedPredecessorPin {
 manifestDigest: string
 fipsNpubs: readonly string[]
 fipsUlas: readonly string[]
 authorityIdentities: readonly string[]
}

function fail(reason: string): never { throw new Error(`SEPARATED_DEPLOYMENT: ${reason}`) }
function object(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
 if (value === null || typeof value !== 'object' || Array.isArray(value)
  || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) fail(`${label} fields differ`)
 return value as Record<string, unknown>
}
function hex(value: unknown, label: string): string {
 if (typeof value !== 'string' || !HEX32.test(value)) fail(`${label} is not a canonical digest/key`)
 return value
}
function ula(value: unknown): string {
 if (typeof value !== 'string' || value !== value.toLowerCase() || isIP(value) !== 6
  || !/^(?:fc|fd)/.test(value) || value.includes('%') || value.includes('[')) fail('FIPS ULA is invalid')
 if (new URL(`http://[${value}]/`).hostname !== `[${value}]`) fail('FIPS ULA is not canonical')
 return value
}
export function separatedCanonical(value: unknown): string {
 if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
 if (typeof value === 'number') {
  if (!Number.isSafeInteger(value)) fail('canonical number is not a safe integer')
  return JSON.stringify(value)
 }
 if (Array.isArray(value)) return `[${value.map(separatedCanonical).join(',')}]`
 if (typeof value !== 'object') fail('unsupported canonical value')
 return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${separatedCanonical((value as Record<string, unknown>)[key])}`).join(',')}}`
}
export function separatedBootstrapApprovalMessage(body: SeparatedBootstrapBody): Uint8Array {
 return utf8ToBytes(separatedCanonical([DOMAIN, body]))
}
export function separatedBootstrapDigest(value: SeparatedBootstrap): string {
 return bytesToHex(sha256(utf8ToBytes(separatedCanonical(value))))
}

/** External pins are required. An embedded owner key/digest is never accepted. */
export function verifySeparatedBootstrap(options: {
 value: unknown
 expectedDigest: string
 ownerApprovalPublicKey: string
 predecessor: SeparatedPredecessorPin
}): SeparatedBootstrap {
 const raw = object(options.value, ['schema', 'valueProfile', 'stage', 'deploymentId', 'applicationRunId',
  'dkgRunId', 'predecessorManifestDigest', 'application', 'validators', 'participantBinarySha256',
  'inspectorBinarySha256', 'ownerSignature'], 'bootstrap')
 if (raw.schema !== SEPARATED_BOOTSTRAP_SCHEMA || raw.valueProfile !== 'FAKE_MONEY_ONLY' || raw.stage !== 'PRE_DKG'
  || raw.deploymentId !== SEPARATED_DEPLOYMENT_ID || raw.applicationRunId !== SEPARATED_APPLICATION_RUN_ID
  || raw.dkgRunId !== SEPARATED_DKG_RUN_ID) fail('fresh deployment/stage differs')
 const predecessor = options.predecessor
 hex(predecessor.manifestDigest, 'independent predecessor manifest')
 if (raw.predecessorManifestDigest !== predecessor.manifestDigest || predecessor.fipsNpubs.length !== 4
  || new Set(predecessor.fipsNpubs).size !== 4 || predecessor.fipsNpubs.some(x => !NPUB.test(x))
  || predecessor.fipsUlas.length !== 4 || new Set(predecessor.fipsUlas.map(ula)).size !== 4
  || predecessor.authorityIdentities.length < 4 || predecessor.authorityIdentities.some(x => !HEX32.test(x))) fail('independent predecessor pins differ')
 const app = object(raw.application, ['role', 'hostId', 'underlayIpv4', 'fipsNpub', 'fipsUla',
  'coordinatorRpcIdentity', 'publicOrigin', 'mintOrigin'], 'application')
 if (app.role !== 'APPLICATION' || app.hostId !== 'linode-109290386' || app.underlayIpv4 !== '139.162.161.233'
  || app.publicOrigin !== SEPARATED_PUBLIC_ORIGIN || app.mintOrigin !== SEPARATED_PUBLIC_ORIGIN) fail('application host/origin differs')
 if (!Array.isArray(raw.validators) || raw.validators.length !== 4) fail('exactly four validators required')
 const fips = new Set<string>(), ulas = new Set<string>(), identities = new Set<string>()
 function freshTransport(value: Record<string, unknown>) {
  if (typeof value.fipsNpub !== 'string' || !NPUB.test(value.fipsNpub)
   || predecessor.fipsNpubs.includes(value.fipsNpub) || fips.has(value.fipsNpub)) fail('FIPS identity reused or malformed')
  const address = ula(value.fipsUla)
  if (ulas.has(address) || predecessor.fipsUlas.includes(address)) fail('reused or duplicate FIPS ULA')
  fips.add(value.fipsNpub);ulas.add(address)
 }
 function authority(value: unknown, label: string) {
  const key = hex(value, label)
  if (identities.has(key) || predecessor.authorityIdentities.includes(key)) fail('authority identity reused')
  identities.add(key)
 }
 freshTransport(app);authority(app.coordinatorRpcIdentity, 'coordinator RPC identity')
 for (let index = 0; index < 4; index++) {
  const pin = object(raw.validators[index], ['participantId', 'role', 'hostId', 'underlayIpv4', 'fipsNpub',
   'fipsUla', 'dkgIdentity', 'signerIdentity', 'kexPublicKey', 'rebuild'], 'validator')
  if (pin.participantId !== index + 1 || pin.role !== 'VALIDATOR_SIGNER'
   || pin.hostId !== VALIDATORS[index]![0] || pin.underlayIpv4 !== VALIDATORS[index]![1]) fail('validator role/target/order differs')
  freshTransport(pin);authority(pin.dkgIdentity, 'DKG identity');authority(pin.signerIdentity, 'signer identity')
  authority(pin.kexPublicKey, 'KEX public key')
  const rebuild = object(pin.rebuild, ['providerEventDigest', 'imageDigest', 'sshHostKeyDigest',
   'abandonmentDecisionDigest', 'emptyStateObservationDigest'], 'rebuild proof')
  for (const [label, value] of Object.entries(rebuild)) hex(value, label)
 }
 hex(raw.participantBinarySha256, 'participant binary');hex(raw.inspectorBinarySha256, 'inspector binary')
 const expected = hex(options.expectedDigest, 'independent bootstrap digest')
 const owner = hex(options.ownerApprovalPublicKey, 'independent owner key')
 if (typeof raw.ownerSignature !== 'string' || !HEX64.test(raw.ownerSignature)) fail('owner signature malformed')
 const value = structuredClone(raw) as unknown as SeparatedBootstrap
 if (separatedBootstrapDigest(value) !== expected) fail('bootstrap differs from independent digest')
 const { ownerSignature, ...body } = value
 const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(hexToBytes(owner))]), format: 'der', type: 'spki' })
 if (!verify(null, separatedBootstrapApprovalMessage(body), key, hexToBytes(ownerSignature))) fail('owner signature invalid')
 return value
}
