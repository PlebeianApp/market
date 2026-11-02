/** Fresh-only DKG profile. Owner-approved rebuild provenance replaces old seals.
 * Reuses existing enrollment, transcript, inspection and final attestations.
 * Public inputs only; no private key, provider operation or DKG execution.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import {
 DEMO_FRIDAY_DKG_MANIFEST_SCHEMA, demoFridayDkgManifestDigest, demoFridayDkgRosterDigest,
 exactDemoFridayDkgManifest, verifyDemoFridayDkgEnrollments,
 type DemoFridayDkgPublicManifestV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import {
 verifyDemoFridayAuthenticatedDkgResultV2AtRoot, type DemoFridayAuthenticatedDkgResultV2,
} from './demo-friday-per-validator-dkg-bootstrap-v2'
import {
 SEPARATED_APPLICATION_RUN_ID, SEPARATED_DEPLOYMENT_ID, SEPARATED_DKG_RUN_ID,
 separatedBootstrapDigest, separatedCanonical, verifySeparatedBootstrap,
 type SeparatedBootstrap,
} from './demo-friday-separated-deployment'

export const SEPARATED_DKG_ROOT = '/var/lib/plebeian-auctions-friday/frost-v3/keyset-v3' as const
export const SEPARATED_INPUT_ROOT = '/var/lib/plebeian-auctions-friday/separated-inputs' as const
export { SEPARATED_COORDINATOR_ROOT } from './demo-friday-separated-constants'
export const SEPARATED_KEYSET_ID = 'friday-demo-frost-keyset-separated-v1' as const
export const SEPARATED_KEYSET_VERSION = '3' as const
export const SEPARATED_RUNTIME_SCHEMA = 'PLEBEIAN_FRIDAY_SEPARATED_RUNTIME_V1' as const
export type SeparatedBootstrapVerification = Parameters<typeof verifySeparatedBootstrap>[0]

function fail(message: string): never { throw new Error(`SEPARATED_PROFILE: ${message}`) }
function digest(value: unknown) { return bytesToHex(sha256(utf8ToBytes(separatedCanonical(value)))) }
export function separatedManifest(bootstrap: SeparatedBootstrap): DemoFridayDkgPublicManifestV1 {
 const participant = (index: 0 | 1 | 2 | 3) => {
 const pin = bootstrap.validators[index]
 return {
  participantId: pin.participantId, hostId: pin.hostId, underlayIpv4: pin.underlayIpv4,
  fipsNpub: pin.fipsNpub, fipsUla: pin.fipsUla, dkgIdentity: pin.dkgIdentity,
  signerIdentity: pin.signerIdentity, kexPublicKey: pin.kexPublicKey,
  signerEndpoint: `http://[${pin.fipsUla}]:39101/v1/frost`,
  participantBinarySha256: bootstrap.participantBinarySha256,
  inspectorBinarySha256: bootstrap.inspectorBinarySha256,
  configPath: `${SEPARATED_DKG_ROOT}/participant.config.json`, stateDirectory: `${SEPARATED_DKG_ROOT}/state`,
 } }
 const participants: DemoFridayDkgPublicManifestV1['participants'] = [participant(0), participant(1), participant(2), participant(3)]
 return exactDemoFridayDkgManifest({
  schema: DEMO_FRIDAY_DKG_MANIFEST_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY',
  deploymentId: SEPARATED_DEPLOYMENT_ID, applicationRunId: SEPARATED_APPLICATION_RUN_ID,
  dkgRunId: SEPARATED_DKG_RUN_ID, committeeKeysetId: SEPARATED_KEYSET_ID,
  committeeKeysetVersion: SEPARATED_KEYSET_VERSION, roster: [1, 2, 3, 4],
  rosterDigest: demoFridayDkgRosterDigest(participants), coordinatorParticipantId: 1,
  // Logical DKG relay is not a voting or FROST participant. Its RPC identity
  // belongs to the app host; participants retain their own private shares.
  coordinatorIdentity: bootstrap.application.coordinatorRpcIdentity, participants,
 })
}
export interface SeparatedRuntimeBinding {
 schema: typeof SEPARATED_RUNTIME_SCHEMA
 valueProfile: 'FAKE_MONEY_ONLY'
 deploymentId: typeof SEPARATED_DEPLOYMENT_ID
 bootstrapDigest: string
 manifestDigest: string
 result: DemoFridayAuthenticatedDkgResultV2
 bindingDigest: string
}
export function separatedRuntimeDigest(value: Omit<SeparatedRuntimeBinding, 'bindingDigest'>): string {
 return digest(['PLEBEIAN_FRIDAY_SEPARATED_RUNTIME_BINDING_V1', value])
}
/** Public completed-result producer; validation is identical to service startup. */
export function composeSeparatedRuntime(bootstrap: SeparatedBootstrapVerification, result: unknown): SeparatedRuntimeBinding {
 const verified = verifySeparatedBootstrap(bootstrap)
 const manifest = separatedManifest(verified)
 const body: Omit<SeparatedRuntimeBinding,'bindingDigest'> = { schema:SEPARATED_RUNTIME_SCHEMA,
  valueProfile:'FAKE_MONEY_ONLY', deploymentId:SEPARATED_DEPLOYMENT_ID,
  bootstrapDigest:separatedBootstrapDigest(verified), manifestDigest:demoFridayDkgManifestDigest(manifest),
  result:result as DemoFridayAuthenticatedDkgResultV2 }
 const bindingDigest=separatedRuntimeDigest(body)
 return verifySeparatedRuntime({bootstrap,value:{...body,bindingDigest},expectedRuntimeDigest:bindingDigest}).runtime
}
/** Validate completed DKG independently before a final deployment anchor uses it. */
export function verifySeparatedRuntime(options: {
 bootstrap: SeparatedBootstrapVerification
 value: unknown
 expectedRuntimeDigest: string
}): { bootstrap: SeparatedBootstrap; manifest: DemoFridayDkgPublicManifestV1; runtime: SeparatedRuntimeBinding } {
 const bootstrap = verifySeparatedBootstrap(options.bootstrap)
 const manifest = separatedManifest(bootstrap), manifestDigest = demoFridayDkgManifestDigest(manifest)
 const raw = options.value
 const fields = ['schema', 'valueProfile', 'deploymentId', 'bootstrapDigest', 'manifestDigest', 'result', 'bindingDigest']
 if (raw === null || typeof raw !== 'object' || Array.isArray(raw)
  || JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(fields.sort())) fail('runtime fields differ')
 const value = raw as SeparatedRuntimeBinding
 if (value.schema !== SEPARATED_RUNTIME_SCHEMA || value.valueProfile !== 'FAKE_MONEY_ONLY'
  || value.deploymentId !== SEPARATED_DEPLOYMENT_ID || value.bootstrapDigest !== separatedBootstrapDigest(bootstrap)
  || value.manifestDigest !== manifestDigest || !/^[0-9a-f]{64}$/.test(options.expectedRuntimeDigest)) fail('runtime deployment/profile differs')
 const result = verifyDemoFridayAuthenticatedDkgResultV2AtRoot({
  expectedManifestDigest: manifestDigest, result: value.result, expectedDkgRoot: SEPARATED_DKG_ROOT,
  verifyManifestAndEnrollments: input => {
   const actual = exactDemoFridayDkgManifest(input.manifest)
   if (separatedCanonical(actual) !== separatedCanonical(manifest) || input.expectedManifestDigest !== manifestDigest) fail('DKG manifest differs from owner bootstrap')
   if (!Array.isArray(input.enrollments)) fail('DKG enrollments missing')
   verifyDemoFridayDkgEnrollments(actual, input.enrollments)
   return actual
  },
 })
 const { bindingDigest, ...body } = { ...value, result }
 if (bindingDigest !== options.expectedRuntimeDigest || separatedRuntimeDigest(body) !== bindingDigest) fail('runtime digest differs from independent pin')
 return { bootstrap, manifest, runtime: structuredClone({ ...value, result }) }
}
