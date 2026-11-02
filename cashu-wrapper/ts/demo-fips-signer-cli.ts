import { createFridaySignerHealthHandler } from './demo-friday-signer-health'
/** Authenticated admission + terminal signer service bound to one FIPS ULA. */
import { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { schnorr } from '@noble/curves/secp256k1.js'

import { openDemoDispositionSignerAnchor, type DemoDispositionSignerAnchor } from './demo-disposition-signer-anchor'
import { createDemoSignerSerialization } from './demo-signer-serialization'
import { type DemoSignerPureContext } from './demo-signer-pure-policy'
import { assertDemoFipsAdmissionPins, createDemoFipsAdmissionParticipant } from './demo-fips-admission-policy'
import { assertDemoFipsFundingAbortPins, createDemoFipsFundingAbortParticipant } from './demo-fips-funding-abort-policy'
import {
	createDemoFipsAdmissionRpcHandler,
	type DemoFipsAdmissionCommitPayloadV1,
	type DemoFipsAdmissionSharePayloadV1,
} from './demo-fips-admission-rpc'
import { DemoFipsAdmissionRpcSqliteJournal } from './demo-fips-admission-rpc-sqlite'
import {
	createDemoFipsFundingAbortRpcHandler,
	type DemoFipsFundingAbortCommitPayloadV1,
	type DemoFipsFundingAbortSharePayloadV1,
} from './demo-fips-funding-abort-rpc'
import { DemoFipsFundingAbortRpcSqliteJournal } from './demo-fips-funding-abort-rpc-sqlite'
import { assertDemoFipsTerminalPins, createDemoFipsTerminalPolicyPorts } from './demo-fips-terminal-policy'
import { preflightDemoFridaySignerPolicyComposition } from './demo-friday-signer-contract'
import { ensureDemoFridaySignerEnrollment } from './demo-friday-signer-enrollment'
import {
	exactDemoFridayApplication, isSeparatedApplication,
	exactDemoFridayApplicationInputPath, exactDemoFridayPublicInputPath,
} from './demo-friday-runtime-config'
import {
	demoFrostAdmissionAuthorization,
	demoFrostAdmissionAuthorizationDigest,
	demoFrostAdmissionTranscriptHash,
	exactDemoAdmissionDurableBinding,
	sameDemoAdmissionPolicyAuthorizationFacts,
	type DemoAdmissionRustParticipant,
	type DemoFrostAdmissionRustCommitment,
	type DemoFrostAdmissionRustShare,
} from './demo-frost-threshold3-admission'
import { sameDemoFundingAbortStableParticipantEvidence,
	type DemoFundingAbortParticipantPolicyRequestV1 } from './demo-funding-abort-participant-policy'
import {
	demoFrostFundingAbortAuthorization,
	demoFrostFundingAbortAuthorizationDigest,
	demoFrostFundingAbortParticipantPolicyDigest,
	demoFrostFundingAbortTranscriptDigest,
	type DemoFrostFundingAbortCommitmentV1,
	type DemoFrostFundingAbortShareV1,
} from './demo-frost-threshold3-funding-abort'
import { createDemoFrostThreshold3RustParticipantWorker, type DemoFrostThreshold3ParticipantWorker } from './demo-frost-threshold3-rust-participant-worker'
import { createDemoSignerRpcHandler } from './demo-signer-rpc'
import { createDemoSignerRpcHttpServer } from './demo-signer-rpc-server'
import { DemoSignerRpcSqliteJournal } from './demo-signer-rpc-sqlite'
import {
	assertDemoFridayPublicPackageBytes,
	bindDemoFridaySignerDkgV2,
} from './demo-friday-signer-dkg-v2'
import {
	assertDemoFridayR20PublicPackageBytes,
	bindDemoFridaySignerDkgR20,
} from './demo-friday-signer-dkg-r20'
import type { DemoFridayR20FreshDkgProfileV2 } from './demo-friday-r20-fresh-profile'
import { verifyDemoFridayR20PredecessorPermissionSealFromFixedPath } from './demo-friday-r20-r18-permission-seal'
import {
	afterDemoFridayParticipantBinaryPin,
	assertDemoFridayParticipantBinaryCurrent,
	closeDemoFridayParticipantBinaryPin,
	demoFridayParticipantBinaryExecutionPath,
} from './demo-friday-participant-binary-pin'

import { loadSeparatedServiceBinding } from './demo-friday-separated-service'
import { SEPARATED_PARTICIPANT_BINARY } from './demo-friday-separated-constants'
import { SEPARATED_INPUT_ROOT } from './demo-friday-separated-profile'

const PARTICIPANTS = [1, 2, 3, 4] as const
type ParticipantId = typeof PARTICIPANTS[number]
const HEX_32 = /^[0-9a-f]{64}$/
const COMPRESSED = /^(?:02|03)[0-9a-f]{64}$/

function executable(value: string): string {
	if (!value.startsWith('/') || resolve(value) !== value || value === '/' || value.endsWith('/') || value.includes('//')) {
		throw new Error('DEMO_FIPS_SIGNER_PATH: participant binary is not a canonical absolute path')
	}
	return value
}
async function json<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T }
async function privateJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' }); await chmod(path, 0o600)
}
async function bounded(command: string[], signal: AbortSignal): Promise<void> {
	const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
	const abort = (): void => { child.kill() }
	if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
	try {
		const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
		if (signal.aborted) throw new Error('DEMO_FIPS_SIGNER_COMMAND: aborted')
		if (code !== 0) throw new Error(`DEMO_FIPS_SIGNER_COMMAND: exit ${code}: ${stderr.trim() || 'no diagnostic'}`)
	} finally { signal.removeEventListener('abort', abort) }
}
async function scratch<T>(parent: string, run: (directory: string) => Promise<T>): Promise<T> {
	const directory = await mkdtemp(join(parent, 'signer-rpc-')); await chmod(directory, 0o700)
	try { return await run(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

interface SignerArguments {
	application: string
	dkg: string
	expectedManifestDigest: string
	networkFacts: string
	slot: ParticipantId
	participantBinary: string
	r20?: {
		profile: string
		predecessorManifest: string
		boundManifest: string
		expectedManifestBindingDigest: string
		expectedRuntimeBindingDigest: string
	}
}

function argumentsExact(): SignerArguments {
	const argv = process.argv.slice(2)
	if (![13, 23].includes(argv.length) || argv[0] !== 'serve' || argv[1] !== '--application' || argv[3] !== '--dkg-result'
		|| argv[5] !== '--expected-manifest-digest' || argv[7] !== '--network-facts'
		|| argv[9] !== '--slot' || argv[11] !== '--participant-binary'
		|| (argv.length === 23 && (argv[13] !== '--r20-profile' || argv[15] !== '--r20-predecessor-manifest'
			|| argv[17] !== '--r20-bound-manifest' || argv[19] !== '--expected-r20-manifest-binding-digest'
			|| argv[21] !== '--expected-r20-runtime-binding-digest'))) {
		throw new Error('usage: plebeian-friday-signer serve --application PATH --dkg-result PATH --expected-manifest-digest SHA256 --network-facts PATH --slot 1..4 --participant-binary PATH [--r20-profile PATH --r20-predecessor-manifest PATH --r20-bound-manifest PATH --expected-r20-manifest-binding-digest SHA256 --expected-r20-runtime-binding-digest SHA256]')
	}
	const slot = Number(argv[10]) as ParticipantId
	if (!PARTICIPANTS.includes(slot)) throw new Error('DEMO_FIPS_SIGNER_SLOT: expected 1..4')
	const result: SignerArguments = {
		application: exactDemoFridayApplicationInputPath(argv[2]!),
		dkg: exactDemoFridayPublicInputPath(argv[4]!, 'dkg result'),
		expectedManifestDigest: argv[6]!,
		networkFacts: exactDemoFridayPublicInputPath(argv[8]!, 'network facts'), slot, participantBinary: executable(argv[12]!),
	}
	if (argv.length === 23) result.r20 = {
		profile: exactDemoFridayPublicInputPath(argv[14]!, 'R20 profile'),
		predecessorManifest: exactDemoFridayPublicInputPath(argv[16]!, 'R20 predecessor manifest'),
		boundManifest: exactDemoFridayPublicInputPath(argv[18]!, 'R20 bound manifest'),
		expectedManifestBindingDigest: argv[20]!, expectedRuntimeBindingDigest: argv[22]!,
	}
	return result
}

const args = argumentsExact()
const application = exactDemoFridayApplication(await json<unknown>(args.application))
if ((application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3') !== (args.r20 !== undefined)) {
	throw new Error('DEMO_FIPS_SIGNER_CONFIG: R20 application and fresh-run inputs must be supplied together')
}
const networkFacts = await json<unknown>(args.networkFacts)
if (isSeparatedApplication(application) && (application.role !== 'VALIDATOR_SIGNER' || application.participant_id !== args.slot
 || args.participantBinary !== SEPARATED_PARTICIPANT_BINARY || args.dkg !== `${SEPARATED_INPUT_ROOT}/runtime-binding.json` || args.networkFacts !== join(application.network_root,'network-facts.json'))) {
 throw new Error('SEPARATED_SIGNER: exact validator role and public input paths required')
}
const separatedPublic = isSeparatedApplication(application) ? await loadSeparatedServiceBinding({application}) : undefined
const binding = separatedPublic ? { ...separatedPublic, target: separatedPublic.result.participants[args.slot-1]!,
 configPath: join(application.dkg_root,'participant.config.json'), stateDirectory: join(application.dkg_root,'state') }
 : application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3'
	? bindDemoFridaySignerDkgR20({
		application, profile: await json<DemoFridayR20FreshDkgProfileV2>(args.r20!.profile),
		predecessorManifest: await json<unknown>(args.r20!.predecessorManifest),
		boundManifest: await json<unknown>(args.r20!.boundManifest),
		expectedManifestBindingDigest: args.r20!.expectedManifestBindingDigest,
		expectedRuntimeBindingDigest: args.r20!.expectedRuntimeBindingDigest,
		runtimeBinding: await json<unknown>(args.dkg), networkFacts, slot: args.slot,
	})
	: bindDemoFridaySignerDkgV2({ application, expectedManifestDigest: args.expectedManifestDigest,
		dkgResult: await json<unknown>(args.dkg), networkFacts, slot: args.slot })
const dkg = 'runtime' in binding ? binding.runtime.result : binding.result
if ('runtime' in binding) {
	await verifyDemoFridayR20PredecessorPermissionSealFromFixedPath({
		expectedAbortDigest: binding.runtime.predecessorAbortDigest,
		expectedManifestDigest: binding.runtime.predecessorManifestDigest,
		expectedParticipantId: args.slot,
	})
}
if ((args.r20 !== undefined || isSeparatedApplication(application)) && args.expectedManifestDigest !== dkg.manifestDigest) {
	throw new Error('DEMO_FIPS_SIGNER_CONFIG: R20 external manifest digest differs from the authenticated result')
}
const facts = binding.facts
const target = binding.target
// Resolve and validate eager admission AND lazy abort/terminal before bootstrap.
const { contract: signerContract, admissionPins, abortPins, terminalPins } = preflightDemoFridaySignerPolicyComposition({
	application, slot: args.slot, facts, dkg,
	validate: { admission: assertDemoFipsAdmissionPins, fundingAbort: assertDemoFipsFundingAbortPins,
		terminal: assertDemoFipsTerminalPins },
})
const { identityPath } = signerContract.paths
const live = application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2'
	|| application.schema === 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3' || isSeparatedApplication(application)
if (live && process.geteuid!() === 0) {
	throw new Error('DEMO_FIPS_SIGNER_PRIVILEGE: live signer must not run as root')
}
const participantBootstrap = await afterDemoFridayParticipantBinaryPin({
	path: args.participantBinary,
	expectedSha256: target.participantBinarySha256,
	trustedOwnerUid: live ? 0 : process.geteuid!(),
	requireOwnerDifferentFromRuntimeUid: live,
}, async () => {
	const publicPackage = await readFile(binding.publicKeyPackagePath)
	if ('runtime' in binding) assertDemoFridayR20PublicPackageBytes(binding, publicPackage)
	else assertDemoFridayPublicPackageBytes(binding, publicPackage)
	return (await readFile(identityPath, 'utf8')).trim()
})
const participantBinaryPin = participantBootstrap.pin
const secretHex = participantBootstrap.value
if (!HEX_32.test(secretHex) || bytesToHex(schnorr.getPublicKey(hexToBytes(secretHex))) !== target.signerIdentity) {
	throw new Error('DEMO_FIPS_SIGNER_IDENTITY: private RPC identity differs from public DKG result')
}
const signerPrivate = hexToBytes(secretHex)
async function boundedParticipant(command: string[], signal: AbortSignal): Promise<void> {
	if (command[0] !== participantBinaryPin.path) throw new Error('DEMO_FIPS_SIGNER_COMMAND: participant path changed')
	await assertDemoFridayParticipantBinaryCurrent(participantBinaryPin)
	await bounded([demoFridayParticipantBinaryExecutionPath(participantBinaryPin), ...command.slice(1)], signal)
}
const stateDirectory = binding.stateDirectory
const { scratchParent, proofUsePath, anchorPath, admissionSafetyPath, enrollmentPermit } = signerContract.paths
let anchor!: DemoDispositionSignerAnchor
let assertJournalReadiness = () => {}
const mutationGate = createDemoSignerSerialization({
	leasePath: signerContract.paths.leasePath,
	quarantinePath: signerContract.paths.quarantinePath,
	assertCurrent() { anchor.captureNoEffectWitness() },
	assertReady() { assertJournalReadiness() },
})
anchor = openDemoDispositionSignerAnchor({
	participantId: args.slot, dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
	signerRosterDigest: dkg.signerRosterDigest, stateDirectory,
	signerMetadataPath: join(stateDirectory, 'disposition-metadata.sqlite3'), proofUsePath,
	coordinatorAnchorPath: anchorPath, initialEnrollmentPermitPath: enrollmentPermit, admissionSafetyPath,
})
const signerJournalDatabase = new Database(signerContract.paths.signerJournalPath, { create: true, strict: true })
const signerJournal = new DemoSignerRpcSqliteJournal(signerJournalDatabase, {
	participantId: args.slot, keysetId: dkg.committeeKeysetId, keysetVersion: dkg.committeeKeysetVersion,
	dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
	signerRosterDigest: dkg.signerRosterDigest, stateDirectory,
	processIdentity: target.signerIdentity, verifyingShare: target.verifyingShare,
})
await signerJournal.assertReady()
const publicBinding = await signerJournal.readBinding()
await ensureDemoFridaySignerEnrollment({
	path: signerContract.paths.publicEnrollmentPath, binding: publicBinding,
	signerIdentity: target.signerIdentity, signerPrivate,
})
const admissionJournalDatabase = new Database(admissionSafetyPath, { create: true, strict: true })
const admissionJournal = new DemoFipsAdmissionRpcSqliteJournal(admissionJournalDatabase, anchor)
assertJournalReadiness = () => admissionJournal.assertReadyNow()
assertJournalReadiness()
const fundingAbortJournal = new DemoFipsFundingAbortRpcSqliteJournal(admissionJournalDatabase, {
	assertFundingAbortJournalCurrent: anchor.assertAdmissionJournalCurrent,
	recordFundingAbortJournalAdvance: anchor.recordAdmissionJournalAdvance,
	assertNoEffectWitness: anchor.assertNoEffectWitness,
	captureNoEffectWitness: anchor.captureNoEffectWitness, recordRpcJournalAdvance: anchor.recordRpcJournalAdvance,
})
const admissionParticipant = createDemoFipsAdmissionParticipant({
	contract: signerContract, pins: admissionPins, proofUse: anchor,
})
const rustTarget: DemoAdmissionRustParticipant = {
	participantId: args.slot, configPath: binding.configPath, stateDirectory,
	verifyingShare: target.verifyingShare, policyService: admissionParticipant,
}

function fundingAbortParticipant(activeKeysetId: string) {
	return createDemoFipsFundingAbortParticipant({
		contract: signerContract, pins: { ...abortPins, activeKeysetId }, proofUse: anchor,
	})
}


function exactFundingAbortDurableBinding(binding: DemoFrostFundingAbortCommitmentV1['durable_binding']): void {
	if (binding.version !== 'COCO_DEMO_FROST_FUNDING_ABORT_3OF4_V1' || binding.participant_id !== args.slot
		|| binding.dkg_run_id !== dkg.dkgRunId || binding.public_key_package_sha256 !== dkg.publicKeyPackageSha256
		|| binding.signer_roster_digest !== dkg.signerRosterDigest || !HEX_32.test(binding.state_directory_identity)
		|| !HEX_32.test(binding.journal_generation) || !Number.isSafeInteger(binding.restart_epoch)
		|| binding.restart_epoch < 1) throw new Error('DEMO_FIPS_SIGNER_ABORT_BINDING: durable signer identity differs')
}

type AdmissionPrepared = { evidence: Awaited<ReturnType<typeof admissionParticipant.preflightExact>> }
type AbortPrepared = { participant: ReturnType<typeof fundingAbortParticipant>; evidence: Awaited<ReturnType<ReturnType<typeof fundingAbortParticipant>['preflightExact']>> }
const localAttempt = { gate: mutationGate, captureWitness: anchor.captureNoEffectWitness, assertWitness: anchor.assertNoEffectWitness }
async function prepareAdmission(method: string, payload: { request: Parameters<typeof admissionParticipant.preflightExact>[0]; participantEvidence?: DemoFipsAdmissionCommitPayloadV1['participantEvidence'] }, context: DemoSignerPureContext): Promise<AdmissionPrepared> {
	const request = structuredClone(payload.request); request.nowSeconds = Math.floor(Date.now() / 1000)
	const evidence = await admissionParticipant.preflightExact(request, context)
	if (method !== 'policy') {
		const supplied = payload.participantEvidence?.find((entry) => entry.participantId === args.slot)
		if (supplied === undefined || !sameDemoAdmissionPolicyAuthorizationFacts(supplied, evidence)) context.refuse('QUORUM_BINDING')
	}
	return { evidence }
}
async function prepareAbort(method: string, payload: { request: DemoFundingAbortParticipantPolicyRequestV1; participantEvidence?: DemoFipsFundingAbortCommitPayloadV1['participantEvidence'] }, context: DemoSignerPureContext): Promise<AbortPrepared> {
	const request = structuredClone(payload.request); request.nowSeconds = Math.floor(Date.now() / 1000)
	const participant = fundingAbortParticipant(request.actorTerms.activeKeysetId)
	const evidence = await participant.preflightExact(request, context)
	if (method !== 'policy') {
		const supplied = payload.participantEvidence?.find((entry) => entry.participantId === args.slot)
		if (supplied === undefined || !sameDemoFundingAbortStableParticipantEvidence(supplied, evidence)) context.refuse('QUORUM_BINDING')
	}
	return { participant, evidence }
}

const admissionHandler = createDemoFipsAdmissionRpcHandler({
	binding: {
		participantId: args.slot, network: facts.chain_id, chainId: facts.chain_id,
		committeeKeysetId: dkg.committeeKeysetId, committeeKeysetVersion: dkg.committeeKeysetVersion,
		dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
		signerRosterDigest: dkg.signerRosterDigest, coordinatorIdentity: dkg.coordinatorIdentity,
		signerIdentity: target.signerIdentity,
	},
	processInstanceId: randomBytes(32).toString('hex'), signerIdentityPrivateKey: signerPrivate, journal: admissionJournal,
	localAttempt, preflight: prepareAdmission,
	async policy(_payload, signal, prepared) {
		return admissionParticipant.claimExact((prepared as AdmissionPrepared).evidence, signal)
	},
	async commit(payload, signal, prepared) {
		await admissionParticipant.claimExact((prepared as AdmissionPrepared).evidence, signal)
		const authorization = demoFrostAdmissionAuthorization(payload.request.receipt, payload.participantEvidence, payload.sessionId)
		const authDigest = demoFrostAdmissionAuthorizationDigest(authorization)
		await anchor.assertRustStateCurrent()
		const result = await scratch(scratchParent, async (directory) => {
			const authPath = join(directory, 'authorization.json'); const outputPath = join(directory, 'commitment.json')
			await privateJson(authPath, authorization)
			await boundedParticipant([args.participantBinary, 'admission-commit', binding.configPath, stateDirectory, authPath, outputPath], signal)
			return json<DemoFrostAdmissionRustCommitment>(outputPath)
		})
		await anchor.recordRustStateAdvance()
		if (result.operation_id !== authorization.operation_id || result.session_id !== authorization.session_id
			|| result.authorization_digest !== authDigest || result.participant_id !== args.slot
			|| !COMPRESSED.test(result.hiding_hex) || !COMPRESSED.test(result.binding_hex)) {
			throw new Error('DEMO_FIPS_SIGNER_ADMISSION_COMMIT: Rust response differs from exact authorization')
		}
		exactDemoAdmissionDurableBinding(result.durable_binding, rustTarget, payload.request.receipt)
		return result
	},
	async share(payload: DemoFipsAdmissionSharePayloadV1, signal, prepared) {
		await admissionParticipant.claimExact((prepared as AdmissionPrepared).evidence, signal)
		const authorization = demoFrostAdmissionAuthorization(payload.request.receipt, payload.participantEvidence, payload.sessionId)
		const authDigest = demoFrostAdmissionAuthorizationDigest(authorization)
		const transcript = demoFrostAdmissionTranscriptHash(authDigest, payload.commitments)
		await anchor.assertRustStateCurrent()
		const result = await scratch(scratchParent, async (directory) => {
			const authPath = join(directory, 'authorization.json'); const bundlePath = join(directory, 'commitments.json')
			const outputPath = join(directory, 'share.json')
			await privateJson(authPath, authorization)
			await privateJson(bundlePath, { version: authorization.version, entries: payload.commitments })
			await boundedParticipant([args.participantBinary, 'admission-share', binding.configPath, stateDirectory, authPath, bundlePath, outputPath], signal)
			return json<DemoFrostAdmissionRustShare>(outputPath)
		})
		await anchor.recordRustStateAdvance()
		if (result.operation_id !== authorization.operation_id || result.session_id !== authorization.session_id
			|| result.authorization_digest !== authDigest || result.commitments_digest !== transcript
			|| result.participant_id !== args.slot || !HEX_32.test(result.share_hex)) {
			throw new Error('DEMO_FIPS_SIGNER_ADMISSION_SHARE: Rust response differs from exact transcript')
		}
		exactDemoAdmissionDurableBinding(result.durable_binding, rustTarget, payload.request.receipt)
		return result
	},
})

const fundingAbortHandler = createDemoFipsFundingAbortRpcHandler({
	binding: {
		participantId: args.slot, network: facts.chain_id, chainId: facts.chain_id,
		committeeKeysetId: dkg.committeeKeysetId, committeeKeysetVersion: dkg.committeeKeysetVersion,
		dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
		signerRosterDigest: dkg.signerRosterDigest, coordinatorIdentity: dkg.coordinatorIdentity,
		signerIdentity: target.signerIdentity,
	},
	processInstanceId: randomBytes(32).toString('hex'), signerIdentityPrivateKey: signerPrivate,
	journal: fundingAbortJournal, localAttempt, preflight: prepareAbort,
	async revalidate(method, payload, cached, _signal, context) {
		if (!context) throw new Error('SIGNER_LOCAL_REPLAY_PURE_CONTEXT_REQUIRED')
		const prepared = await prepareAbort(method, payload as DemoFipsFundingAbortCommitPayloadV1, context)
		if (method === 'policy' && !sameDemoFundingAbortStableParticipantEvidence(cached as typeof prepared.evidence, prepared.evidence)) context.refuse('QUORUM_BINDING')
	},
	async policy(_payload, signal, prepared) {
		const staged = prepared as AbortPrepared
		return staged.participant.claimExact(staged.evidence, signal)
	},
	async commit(payload, signal, prepared) {
		const staged = prepared as AbortPrepared
		await staged.participant.claimExact(staged.evidence, signal)
		const committeeUnsigned = { ...structuredClone(payload.request.actorTerms),
			participantPolicyDigest: demoFrostFundingAbortParticipantPolicyDigest(payload.participantEvidence),
			actorAbortEvent: structuredClone(payload.request.actorAbortEvent) }
		const authorization = demoFrostFundingAbortAuthorization({ committeeUnsigned,
			participantEvidence: payload.participantEvidence, sessionId: payload.sessionId })
		const authorizationDigest = demoFrostFundingAbortAuthorizationDigest(authorization)
		await anchor.assertRustStateCurrent()
		const result = await scratch(scratchParent, async (directory) => {
			const authPath = join(directory, 'funding-abort-authorization.json')
			const outputPath = join(directory, 'funding-abort-commitment.json')
			await privateJson(authPath, authorization)
			await boundedParticipant([args.participantBinary, 'funding-abort-commit', binding.configPath,
				stateDirectory, authPath, outputPath], signal)
			return json<DemoFrostFundingAbortCommitmentV1>(outputPath)
		})
		await anchor.recordRustStateAdvance()
		if (result.operation_id !== authorization.operation_id || result.session_id !== authorization.session_id
			|| result.authorization_digest !== authorizationDigest || result.participant_id !== args.slot
			|| !COMPRESSED.test(result.hiding_hex) || !COMPRESSED.test(result.binding_hex)) {
			throw new Error('DEMO_FIPS_SIGNER_ABORT_COMMIT: Rust response differs from exact authorization')
		}
		exactFundingAbortDurableBinding(result.durable_binding)
		return result
	},
	async share(payload: DemoFipsFundingAbortSharePayloadV1, signal, prepared) {
		const staged = prepared as AbortPrepared
		await staged.participant.claimExact(staged.evidence, signal)
		const committeeUnsigned = { ...structuredClone(payload.request.actorTerms),
			participantPolicyDigest: demoFrostFundingAbortParticipantPolicyDigest(payload.participantEvidence),
			actorAbortEvent: structuredClone(payload.request.actorAbortEvent) }
		const authorization = demoFrostFundingAbortAuthorization({ committeeUnsigned,
			participantEvidence: payload.participantEvidence, sessionId: payload.sessionId })
		const authorizationDigest = demoFrostFundingAbortAuthorizationDigest(authorization)
		const transcript = demoFrostFundingAbortTranscriptDigest(authorizationDigest, payload.commitments)
		await anchor.assertRustStateCurrent()
		const result = await scratch(scratchParent, async (directory) => {
			const authPath = join(directory, 'funding-abort-authorization.json')
			const commitmentsPath = join(directory, 'funding-abort-commitments.json')
			const outputPath = join(directory, 'funding-abort-share.json')
			await privateJson(authPath, authorization)
			await privateJson(commitmentsPath, { version: authorization.version, entries: payload.commitments })
			await boundedParticipant([args.participantBinary, 'funding-abort-share', binding.configPath,
				stateDirectory, authPath, commitmentsPath, outputPath], signal)
			return json<DemoFrostFundingAbortShareV1>(outputPath)
		})
		await anchor.recordRustStateAdvance()
		if (result.operation_id !== authorization.operation_id || result.session_id !== authorization.session_id
			|| result.authorization_digest !== authorizationDigest || result.commitments_digest !== transcript
			|| result.participant_id !== args.slot || !HEX_32.test(result.share_hex)) {
			throw new Error('DEMO_FIPS_SIGNER_ABORT_SHARE: Rust response differs from exact transcript')
		}
		exactFundingAbortDurableBinding(result.durable_binding)
		return result
	},
})

const terminalSessions = new Map<string, DemoFrostThreshold3ParticipantWorker>()
const terminalWorker: DemoFrostThreshold3ParticipantWorker = {
	async roundOne(request, signal) {
		if (terminalSessions.has(request.binding.sessionId)) throw new Error('DEMO_FIPS_SIGNER_SESSION: duplicate terminal round one')
		const worker = createDemoFrostThreshold3RustParticipantWorker({
			participantId: args.slot, dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
			configPath: binding.configPath, stateDirectory, binaryPath: args.participantBinary, scratchParent,
			policyPorts: createDemoFipsTerminalPolicyPorts({
				contract: signerContract, pins: terminalPins,
				anchor, policy: request.policy,
			}),
			stateGuard: { assertCurrent: anchor.assertRustStateCurrent, recordAdvance: anchor.recordRustStateAdvance },
			runCommand: boundedParticipant,
		})
		const response = await worker.roundOne(request, signal)
		terminalSessions.set(request.binding.sessionId, worker)
		return response
	},
	async roundTwo(request, signal) {
		const worker = terminalSessions.get(request.binding.sessionId)
		if (worker === undefined) throw new Error('DEMO_FIPS_SIGNER_SESSION: terminal round two has no accepted round one')
		terminalSessions.delete(request.binding.sessionId)
		return worker.roundTwo(request, signal)
	},
}
const terminalProcessInstanceId = randomBytes(32).toString('hex')
const terminalHandler = createDemoSignerRpcHandler({
	processInstanceId: terminalProcessInstanceId, coordinatorIdentity: dkg.coordinatorIdentity,
	signerIdentityPrivateKey: signerPrivate, worker: terminalWorker, journal: signerJournal,
	serialize: (signal, operation) => mutationGate.run(signal, async () => {
		try { return await operation() } catch (error) { mutationGate.poison(); throw error }
	}),
})
const healthHandler = createFridaySignerHealthHandler({
	pins: { deploymentId: signerContract.deploymentId ?? signerContract.runId, chainId: facts.chain_id,
		genesisSha256: facts.genesis_sha256, validatorsHash: facts.validators_hash,
		committeeKeysetId: dkg.committeeKeysetId, committeeKeysetVersion: dkg.committeeKeysetVersion,
		dkgRunId: dkg.dkgRunId, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
		signerRosterDigest: dkg.signerRosterDigest, mintUrl: signerContract.mintUrl },
	participantId: args.slot, coordinatorIdentity: dkg.coordinatorIdentity, signerPrivate,
	processInstanceId: terminalProcessInstanceId, binding: () => signerJournal.readBinding(),
	serialize: (signal, read) => mutationGate.observe(signal, read),
	async assertReady() {
		mutationGate.check('read-only')
		await assertDemoFridayParticipantBinaryCurrent(participantBinaryPin)
		anchor.assertHealthCurrent()
		await signerJournal.assertReady(); await admissionJournal.assertReady(); await fundingAbortJournal.assertReady()
	},
})
const server = createDemoSignerRpcHttpServer({
	healthHandle: healthHandler,
	binding: { hostname: application.fips_ulas[args.slot - 1], port: application.signer_rpc_port },
	handle: terminalHandler,
	admissionHandle: admissionHandler,
	fundingAbortHandle: fundingAbortHandler,
})

const stopped = new Promise<void>((resolvePromise) => {
	for (const name of ['SIGINT', 'SIGTERM'] as const) process.once(name, () => resolvePromise())
})
try { await stopped }
finally {
	await server.stop(); await mutationGate.close(); admissionJournalDatabase.close(false); anchor.close(); signerJournalDatabase.close(false)
	await closeDemoFridayParticipantBinaryPin(participantBinaryPin)
}
