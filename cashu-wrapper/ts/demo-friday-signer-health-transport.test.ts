/** Synthetic exchanges only: real transport codec and real coordinator SQLite anchor. */
import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { createDemoFridayTerminalParticipants } from './demo-fips-r4-terminal-cli'
import { DemoSignerCoordinatorAnchorSqlite } from './demo-signer-coordinator-anchor-sqlite'
import { createDemoSignerRpcHandler, createDemoSignerRpcTransport,
 type DemoSignerDurableBindingV1, type DemoSignerRpcResponseV1, type DemoSignerCoordinatorAnchorPort } from './demo-signer-rpc'
import { createFridaySignerHealthHandler, probeFridaySignerHealth } from './demo-friday-signer-health'
import type { DemoFrostProcessRoundOneRequest } from './demo-frost-process-boundary'
import type { FridayHealthPins } from './demo-friday-readiness'
const key = (n: number) => { const bytes = new Uint8Array(32); bytes[31] = n; return bytes }
const coordinator = key(1), signer = key(2), signerIdentity = bytesToHex(schnorr.getPublicKey(signer))
const processId = '1'.repeat(64)
const pins: FridayHealthPins = { deploymentId: 'test', chainId: 'chain', genesisSha256: 'a'.repeat(64), validatorsHash: 'b'.repeat(64),
 committeeKeysetId: 'keyset', committeeKeysetVersion: '2', dkgRunId: 'dkg', publicKeyPackageSha256: 'c'.repeat(64),
 signerRosterDigest: 'd'.repeat(64), mintUrl: 'https://mint.example' }
const binding: DemoSignerDurableBindingV1 = { schema: 'COCO_DEMO_SIGNER_DURABLE_BINDING_V1', participantId: 1,
 keysetId: pins.committeeKeysetId, keysetVersion: pins.committeeKeysetVersion, dkgRunId: pins.dkgRunId,
 publicKeyPackageSha256: pins.publicKeyPackageSha256, signerRosterDigest: pins.signerRosterDigest, restartEpoch: 1,
 journalGeneration: 'e'.repeat(64), stateDirectory: '/synthetic/public-state-metadata', stateDirectoryIdentity: 'f'.repeat(64),
 processIdentity: signerIdentity, verifyingShare: '02' + '1'.repeat(64) }
function roundOne(): DemoFrostProcessRoundOneRequest {
 return { schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_REQUEST_V1', binding: {
  schema: 'COCO_DEMO_FROST_PROCESS_BINDING_V1', participantId: 1, processIdentity: signerIdentity,
  committeeKeysetId: pins.committeeKeysetId, committeeKeysetVersion: pins.committeeKeysetVersion,
  rosterDigest: pins.signerRosterDigest, policyPackageDigest: '1'.repeat(64), sessionId: '2'.repeat(64),
  packageDigest: '3'.repeat(64), digest: '4'.repeat(64) }, policy: {} as never }
}
function fixture() {
 const database = new Database(':memory:'), anchor = new DemoSignerCoordinatorAnchorSqlite(database)
 let pending = false, terminalCalls = 0, workerWait: Promise<void> | undefined, started!: () => void
 const workerStarted = new Promise<void>(resolve => { started = resolve })
 const journal = { async readBinding() { return structuredClone(binding) },
  async assertReady() { if (pending) throw new Error('pending') },
  async claim() { pending = true; return { status: 'created' as const } },
  async complete(_id: string, _digest: string, _response: DemoSignerRpcResponseV1) { pending = false } }
 const handler = createDemoSignerRpcHandler({ processInstanceId: processId, coordinatorIdentity: bytesToHex(schnorr.getPublicKey(coordinator)),
  signerIdentityPrivateKey: signer, journal, worker: {
   async roundOne(request) { started(); await workerWait; return { schema: 'COCO_DEMO_FROST_PROCESS_ROUND_ONE_RESPONSE_V1',
    binding: request.binding, policyEvidence: { schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_EVIDENCE_V1',
     policyPackageDigest: request.binding.policyPackageDigest, closureEvidenceDigest: '5'.repeat(64), signedBidEvidenceDigest: '6'.repeat(64),
     committeeLockedProofsDigest: '7'.repeat(64), authenticatedPackageDigest: request.binding.packageDigest,
     derivedCashuSigAllDigest: request.binding.digest }, commitment: { hiding: '02' + '1'.repeat(64), binding: '02' + '2'.repeat(64) } } },
   async roundTwo() { throw new Error('unused') },
  } })
 const fetchImpl = (async (_url, init) => {
  terminalCalls++; return Response.json(await handler(JSON.parse(String(init?.body)), init?.signal ?? new AbortController().signal))
 }) as typeof fetch
 const transport = createDemoSignerRpcTransport({ endpoint: 'http://[fd00::1]:39101/v1/frost',
  enrollment: { participantId: 1, processIdentity: signerIdentity, stateDirectory: binding.stateDirectory, verifyingShare: binding.verifyingShare },
  signerBinding: binding, signerIdentity, coordinatorIdentityPrivateKey: coordinator, anchor, fetchImpl })
 const snapshot = () => database.query('SELECT * FROM demo_signer_coordinator_anchor').all()
 return { database, anchor, transport, fetchImpl, snapshot, workerStarted, journal,
  holdWorker: (wait: Promise<void>) => { workerWait = wait }, terminalCalls: () => terminalCalls }
}
function healthOptions(anchor: DemoSignerCoordinatorAnchorPort, changes: {
 binding?: DemoSignerDurableBindingV1; processId?: string; ready?: boolean; signal?: AbortSignal
 enrollment?: DemoSignerDurableBindingV1; assertReady?: () => Promise<void>
} = {}) {
 const handler = createFridaySignerHealthHandler({ pins, participantId: 1, coordinatorIdentity: bytesToHex(schnorr.getPublicKey(coordinator)),
  signerPrivate: signer, processInstanceId: changes.processId ?? processId,
  binding: async () => changes.binding ?? binding, now: () => 1_000,
  assertReady: changes.assertReady ?? (async () => { if (changes.ready === false) throw new Error('unready') }) })
 return { endpoint: 'http://[fd00::1]:39101/v1/frost', participantId: 1, signerIdentity, coordinatorSecret: coordinator,
  pins, enrollment: changes.enrollment ?? binding, anchor, signal: changes.signal ?? new AbortController().signal, now: () => 1_000,
  fetch: (async (_url, init) => Response.json(await handler(JSON.parse(String(init?.body))))) as typeof fetch }
}
test('newer ready epoch cannot retire the active epoch-1 terminal transport', async () => {
 const f = fixture()
 try {
  await f.anchor.assertCurrent(binding); await f.anchor.observeProcess(binding, processId)
  const before = f.snapshot()
  await expect(probeFridaySignerHealth(healthOptions(f.anchor, { binding: { ...binding, restartEpoch: 2 }, processId: '2'.repeat(64) }))).rejects.toThrow('BINDING')
  expect(f.snapshot()).toEqual(before)
  expect((await f.transport.roundOne(roundOne(), { signal: new AbortController().signal })).peer.restartCounter).toBe(1)
  expect(f.terminalCalls()).toBe(1)
 } finally { f.database.close(false) }
})
test('signed false never initializes epoch/process or advances an existing active binding', async () => {
 const f = fixture()
 try {
  expect(await probeFridaySignerHealth(healthOptions(f.anchor, { ready: false }))).toBeNull()
  expect(f.snapshot()).toEqual([])
  await f.anchor.assertCurrent(binding); await f.anchor.observeProcess(binding, processId)
  const before = f.snapshot()
  await expect(probeFridaySignerHealth(healthOptions(f.anchor, { binding: { ...binding, restartEpoch: 2 }, ready: false }))).rejects.toThrow('BINDING')
  expect(await probeFridaySignerHealth(healthOptions(f.anchor, { ready: false, processId: '2'.repeat(64) }))).toBeNull()
  expect(f.snapshot()).toEqual(before)
 } finally { f.database.close(false) }
})
test('an old reply arriving after a rejected newer reply still matches active transport; alternate same-epoch process refuses', async () => {
 const f = fixture()
 try {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  const old = healthOptions(f.anchor), fetchOld = old.fetch
  const delayed = probeFridaySignerHealth({ ...old, fetch: (async (url, init) => {
   const response = await fetchOld(url, init); await wait; return response
  }) as typeof fetch })
  await expect(probeFridaySignerHealth(healthOptions(f.anchor, { binding: { ...binding, restartEpoch: 2 } }))).rejects.toThrow('BINDING')
  release(); expect(await delayed).toBe(1)
  const before = f.snapshot()
  await expect(probeFridaySignerHealth(healthOptions(f.anchor, { processId: '2'.repeat(64) }))).rejects.toThrow('reused')
  expect(f.snapshot()).toEqual(before)
  expect((await f.transport.roundOne(roundOne(), { signal: new AbortController().signal })).peer.restartCounter).toBe(1)
 } finally { f.database.close(false) }
})
test('cancellation before observations and between anchor awaits never returns ready or rebinds the process', async () => {
 const f = fixture()
 try {
  const cancelled = new AbortController(); cancelled.abort()
  await expect(probeFridaySignerHealth(healthOptions(f.anchor, { signal: cancelled.signal }))).rejects.toThrow()
  expect(f.snapshot()).toEqual([])
  await f.anchor.assertCurrent(binding); await f.anchor.observeProcess(binding, processId)
  const before = f.snapshot(), mid = new AbortController(); let processCalls = 0
  const anchor = { async assertCurrent(value: DemoSignerDurableBindingV1) { await f.anchor.assertCurrent(value); mid.abort() },
   async observeProcess(value: DemoSignerDurableBindingV1, process: string) { processCalls++; await f.anchor.observeProcess(value, process) } }
  await expect(probeFridaySignerHealth(healthOptions(anchor, { signal: mid.signal }))).rejects.toThrow('CANCELLED')
  expect(processCalls).toBe(0); expect(f.snapshot()).toEqual(before)
 } finally { f.database.close(false) }
})
test('an older delayed reply cannot roll back an already observed higher transport binding', async () => {
 const f = fixture()
 try {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve }), old = healthOptions(f.anchor), fetchOld = old.fetch
  const delayed = probeFridaySignerHealth({ ...old, fetch: (async (url, init) => {
   const response = await fetchOld(url, init); await wait; return response
  }) as typeof fetch })
  // Simulate a higher binding already observed through the existing signing
  // path. Health must not undo it or make the stale active transport ready.
  const newer = { ...binding, restartEpoch: 2 }
  await f.anchor.assertCurrent(newer); await f.anchor.observeProcess(newer, '2'.repeat(64))
  const before = f.snapshot()
  release(); await expect(delayed).rejects.toThrow('REGRESSED')
  expect(f.snapshot()).toEqual(before)
 } finally { f.database.close(false) }
})
test('health during an in-flight terminal operation stays false and cannot strand its completion', async () => {
 const f = fixture(); let finish!: () => void
 f.holdWorker(new Promise<void>(resolve => { finish = resolve }))
 try {
  await f.anchor.assertCurrent(binding); await f.anchor.observeProcess(binding, processId)
  const before = f.snapshot(), terminal = f.transport.roundOne(roundOne(), { signal: new AbortController().signal })
  await f.workerStarted
  expect(await probeFridaySignerHealth(healthOptions(f.anchor, { assertReady: () => f.journal.assertReady() }))).toBeNull()
  await expect(probeFridaySignerHealth(healthOptions(f.anchor, { binding: { ...binding, restartEpoch: 2 } }))).rejects.toThrow('BINDING')
  expect(f.snapshot()).toEqual(before)
  finish(); expect((await terminal).peer.restartCounter).toBe(1)
  expect(await probeFridaySignerHealth(healthOptions(f.anchor, { assertReady: () => f.journal.assertReady() }))).toBe(1)
  expect(f.snapshot()).toEqual(before)
 } finally { finish(); f.database.close(false) }
})
test('participant composition captures one immutable binding for health and transport despite enrollment replacement', async () => {
 const f = fixture(), root = await mkdtemp('/tmp/hlt-r2-capture-')
 try {
  await mkdir(join(root, 'node-1'))
  const path = join(root, 'node-1/signer-enrollment-public.json')
  const writeEnrollment = async (value: DemoSignerDurableBindingV1) => {
   const digest = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(['COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1', value, signerIdentity]))))
   await writeFile(path, JSON.stringify({ schema: 'COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1', binding: value, signerIdentity, digest,
    signature: bytesToHex(schnorr.sign(Buffer.from(digest, 'hex'), signer)) }))
  }
  await writeEnrollment(binding)
  const participants = await createDemoFridayTerminalParticipants({ root, coordinatorSecret: coordinator, fetchImpl: f.fetchImpl,
   dkg: { participants: [{ participantId: 1, stateDirectory: binding.stateDirectory, verifyingShare: binding.verifyingShare,
    signerIdentity, signerEndpoint: 'http://[fd00::1]:39101/v1/frost', configPath: '/synthetic/config' }] } }, f.anchor)
  const participant = participants[0]!
  expect(Object.isFrozen(participant.signerBinding)).toBe(true)
  await writeEnrollment({ ...binding, restartEpoch: 2 })
  expect(participant.signerBinding.restartEpoch).toBe(1)
  await expect(probeFridaySignerHealth(healthOptions(f.anchor, { enrollment: participant.signerBinding, binding: { ...binding, restartEpoch: 2 } }))).rejects.toThrow('BINDING')
  expect((await participant.transport.roundOne(roundOne(), { signal: new AbortController().signal })).peer.restartCounter).toBe(1)
 } finally { f.database.close(false); await rm(root, { recursive: true, force: true }) }
})
