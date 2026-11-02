import { describe, expect, test } from 'bun:test'
import { createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import {
 SEPARATED_APPLICATION_RUN_ID, SEPARATED_BOOTSTRAP_SCHEMA, SEPARATED_DEPLOYMENT_ID,
 SEPARATED_DKG_RUN_ID, SEPARATED_PUBLIC_ORIGIN, separatedBootstrapApprovalMessage,
 separatedBootstrapDigest, separatedCanonical, verifySeparatedBootstrap,
 type SeparatedBootstrapBody, type SeparatedBootstrap, type SeparatedPredecessorPin,
} from './demo-friday-separated-deployment'

// Deterministic local synthetic keys only; no operational key generation/read.
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 91)]), format: 'der', type: 'pkcs8' })
const ownerPublicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex')
const hash = (s: string) => bytesToHex(sha256(utf8ToBytes(s)))
const npub = (s: string) => `npub1${s.repeat(58)}` // Shape-only synthetic transport labels, not live identities.
const predecessor: SeparatedPredecessorPin = {
 manifestDigest: hash('public predecessor'), fipsNpubs: ['q', 'p', 'z', 'r'].map(npub),
 fipsUlas: [1, 2, 3, 4].map(x => `fd00::${x}`),
 authorityIdentities: [1, 2, 3, 4].map(x => hash(`old authority ${x}`)),
}
function body(): SeparatedBootstrapBody {
 const hosts = [['linode-108175009', '172.105.64.142'], ['linode-108236985', '172.105.95.57'],
  ['linode-108237290', '172.104.240.217'], ['linode-108237424', '172.104.253.247']]
 const fills = ['9', 'x', '8', 'g']
 return {
  schema: SEPARATED_BOOTSTRAP_SCHEMA, valueProfile: 'FAKE_MONEY_ONLY', stage: 'PRE_DKG',
  deploymentId: SEPARATED_DEPLOYMENT_ID, applicationRunId: SEPARATED_APPLICATION_RUN_ID,
  dkgRunId: SEPARATED_DKG_RUN_ID, predecessorManifestDigest: predecessor.manifestDigest,
  application: { role: 'APPLICATION', hostId: 'linode-109290386', underlayIpv4: '139.162.161.233',
   fipsNpub: npub('y'), fipsUla: 'fd42::5', coordinatorRpcIdentity: hash('app RPC'),
   publicOrigin: SEPARATED_PUBLIC_ORIGIN, mintOrigin: SEPARATED_PUBLIC_ORIGIN },
  validators: hosts.map(([hostId, ip], index) => ({ participantId: index + 1, role: 'VALIDATOR_SIGNER',
   hostId, underlayIpv4: ip, fipsNpub: npub(fills[index]!), fipsUla: `fd42::${index + 1}`,
   dkgIdentity: hash(`fresh DKG ${index}`), signerIdentity: hash(`fresh signer ${index}`),
   kexPublicKey: hash(`fresh KEX ${index}`), rebuild: { providerEventDigest: hash(`provider ${index}`),
    imageDigest: hash('image'), sshHostKeyDigest: hash(`SSH ${index}`),
    abandonmentDecisionDigest: hash('abandonment'), emptyStateObservationDigest: hash(`empty ${index}`) },
  })) as SeparatedBootstrapBody['validators'],
  participantBinarySha256: hash('participant bytes'), inspectorBinarySha256: hash('inspector bytes'),
 }
}
function signed(value: SeparatedBootstrapBody = body()): SeparatedBootstrap {
 return { ...value, ownerSignature: sign(null, separatedBootstrapApprovalMessage(value), privateKey).toString('hex') }
}
function verify(value: SeparatedBootstrap, changes: Record<string, unknown> = {}) {
 return verifySeparatedBootstrap({ value, expectedDigest: separatedBootstrapDigest(value), ownerApprovalPublicKey: ownerPublicKey, predecessor, ...changes })
}
function rejectMutation(change: (value: any) => void) {
 const value = body();change(value)
 // Re-sign to prove malformed topology is rejected even if signed by owner.
 expect(() => verify(signed(value))).toThrow()
}

describe('separated public bootstrap before DKG', () => {
 test('accepts exact five-host public role binding and clones it', () => {
  const value = signed(), result = verify(value)
  expect(result).toEqual(value);expect(result).not.toBe(value)
  expect(result.application.role).toBe('APPLICATION');expect(result.validators).toHaveLength(4)
  expect(new Set(result.validators.map(x => x.hostId)).has(result.application.hostId)).toBe(false)
 })
 test('does not turn bootstrap evidence into a completed DKG/genesis/health receipt', () => {
  rejectMutation(x => x.stage = 'COMPLETED_DKG')
  rejectMutation(x => x.genesisSha256 = hash('self asserted genesis'))
  rejectMutation(x => x.dkgResult = { ready: true })
  rejectMutation(x => x.health = 'ready')
 })
 test('requires both independently pinned digest and actual owner signature', () => {
  const value = signed()
  expect(() => verify(value, { expectedDigest: hash('wrong pin') })).toThrow()
  expect(() => verify(value, { ownerApprovalPublicKey: hash('wrong owner') })).toThrow()
  const altered = structuredClone(value);altered.participantBinarySha256 = hash('different binary')
  expect(() => verify(altered)).toThrow()
  altered.ownerSignature = '0'.repeat(128);expect(() => verify(altered)).toThrow()
 })
 test('rejects embedded owner authority and extra secret-bearing fields', () => {
  rejectMutation(x => x.ownerApprovalPublicKey = ownerPublicKey)
  rejectMutation(x => x.application.participantConfig = '/private/share')
  rejectMutation(x => x.application.validatorPrivateKey = 'not permitted')
  rejectMutation(x => x.validators[0].share = 'not permitted')
 })
 test('rejects a different public origin, port, insecure scheme or mint identity', () => {
  for (const origin of ['https://172.105.95.57', 'http://139.162.161.233', 'https://139.162.161.233:8443', 'https://example.test']) {
   rejectMutation(x => x.application.publicOrigin = origin)
   rejectMutation(x => x.application.mintOrigin = origin)
  }
 })
 test('rejects old deployment, wrong app host, extra voting role and reordered participants', () => {
  rejectMutation(x => x.deploymentId = 'friday-demo-20261023-r20')
  rejectMutation(x => x.application.hostId = 'linode-108236985')
  rejectMutation(x => x.application.role = 'VALIDATOR_SIGNER')
  rejectMutation(x => x.validators.push(structuredClone(x.validators[0])))
  rejectMutation(x => x.validators.reverse())
  rejectMutation(x => x.validators[0].underlayIpv4 = '139.162.161.233')
 })
 test('requires all four exact rebuild records and rejects predecessor-only evidence', () => {
  rejectMutation(x => x.validators.pop())
  rejectMutation(x => delete x.validators[3].rebuild)
  rejectMutation(x => x.validators[3].rebuild.providerEventDigest = '')
  rejectMutation(x => x.validators[3].rebuild.emptyStateObservationDigest = 'not observed')
  rejectMutation(x => x.abortAcknowledgements = [])
  const value = signed();expect(() => verify(value, { predecessor: { ...predecessor, manifestDigest: hash('other predecessor') } })).toThrow()
 })
 test('rejects old or duplicated transport and signing identities across app and committee', () => {
  rejectMutation(x => x.validators[0].fipsNpub = predecessor.fipsNpubs[0])
  rejectMutation(x => x.application.fipsUla = predecessor.fipsUlas[0])
  rejectMutation(x => x.application.fipsNpub = x.validators[0].fipsNpub)
  rejectMutation(x => x.validators[1].fipsUla = x.validators[0].fipsUla)
  rejectMutation(x => x.validators[1].signerIdentity = x.application.coordinatorRpcIdentity)
  rejectMutation(x => x.validators[0].dkgIdentity = predecessor.authorityIdentities[0])
  rejectMutation(x => x.validators[0].kexPublicKey = x.validators[1].kexPublicKey)
 })
 test('rejects aliases, non-ULA addresses and scoped addresses', () => {
  for (const address of ['fd42:0:0:0:0:0:0:1', 'FD42::1', '2001:db8::1', 'fd42::1%eth0', '[fd42::1]']) {
   rejectMutation(x => x.validators[0].fipsUla = address)
  }
 })
 test('owner domain cannot be replaced by a plain JSON signature', () => {
  const value = body(), packet = { ...value, ownerSignature: sign(null, Buffer.from(separatedCanonical(value)), privateKey).toString('hex') }
  expect(() => verify(packet)).toThrow()
 })
 test('canonical message ignores object insertion order but preserves array ordering', () => {
  expect(separatedCanonical({ b: 1, a: 2 })).toBe(separatedCanonical({ a: 2, b: 1 }))
  expect(separatedCanonical([1, 2])).not.toBe(separatedCanonical([2, 1]))
  expect(() => separatedCanonical(Number.MAX_SAFE_INTEGER + 1)).toThrow()
 })
})
