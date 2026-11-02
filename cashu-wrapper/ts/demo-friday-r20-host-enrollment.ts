/** Fixed keyset-v2 host enrollment adapter. It never supports caller-chosen live paths. */
import { readFile } from 'node:fs/promises'
import { runSeparatedHostCommand } from './demo-friday-separated-host-cli'

import {
	demoFridayDkgOwnerApprovedHostPinDigestAtRoot,
	exactDemoFridayDkgOwnerApprovedHostPinAtRoot,
	initializeDemoFridayDkgHostEnrollment,
	recoverDemoFridayDkgHostEnrollment,
	type DemoFridayDkgEnrollmentFilesystemProfile,
	type DemoFridayDkgEnrollmentKeyGenerator,
	type DemoFridayDkgEnrollmentFaultPhase,
	type DemoFridayDkgHostEnrollmentV1,
} from './demo-friday-per-validator-dkg-enrollment-init'
import type { DemoFridayParticipantId } from './demo-friday-per-validator-dkg-plan'
import { demoFridayR20ProfileDigest } from './demo-friday-r20-enrollment-runtime'
import {
	DEMO_FRIDAY_R20_APPLICATION_RUN_ID, DEMO_FRIDAY_R20_DEPLOYMENT_ID,
	DEMO_FRIDAY_R20_DKG_RUN_ID, DEMO_FRIDAY_R20_FRESH_PARENT, DEMO_FRIDAY_R20_INPUT_ROOT,
	DEMO_FRIDAY_R20_KEYSET_ID,
	DEMO_FRIDAY_R20_KEYSET_ROOT, DEMO_FRIDAY_R20_KEYSET_VERSION,
	type DemoFridayR20FreshDkgProfileV2,
} from './demo-friday-r20-fresh-profile'
import { verifyDemoFridayR20PredecessorPermissionSealFromFixedPath } from './demo-friday-r20-r18-permission-seal'

export const DEMO_FRIDAY_R20_HOST_PIN_PATH =
	`${DEMO_FRIDAY_R20_FRESH_PARENT}/owner-approved-host-enrollment-pin-v2.json` as const
export const DEMO_FRIDAY_R20_PROFILE_PATH =
	`${DEMO_FRIDAY_R20_INPUT_ROOT}/fresh-profile.json` as const

export interface DemoFridayR20EnrollmentFilesystemProfile extends DemoFridayDkgEnrollmentFilesystemProfile {}

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_R20_HOST_ENROLLMENT: ${message}`) }

function productionFilesystem(): DemoFridayR20EnrollmentFilesystemProfile {
	return {
		parentDirectory: DEMO_FRIDAY_R20_FRESH_PARENT,
		filesystemRoot: DEMO_FRIDAY_R20_KEYSET_ROOT,
		hostPinPath: DEMO_FRIDAY_R20_HOST_PIN_PATH,
		logicalRoot: DEMO_FRIDAY_R20_KEYSET_ROOT,
	}
}

async function exactR20HostPin(options: {
	profile: DemoFridayR20FreshDkgProfileV2
	expectedProfileDigest: string
	expectedHostPinDigest: string
	participantId: DemoFridayParticipantId
	filesystem: DemoFridayR20EnrollmentFilesystemProfile
}): Promise<void> {
	if (demoFridayR20ProfileDigest(options.profile) !== options.expectedProfileDigest) {
		fail('fresh-run profile differs from the independent owner pin')
	}
	let value: unknown
	try { value = JSON.parse(await readFile(options.filesystem.hostPinPath, 'utf8')) as unknown }
	catch { fail('fixed R20 host pin is unavailable or malformed') }
	const pin = exactDemoFridayDkgOwnerApprovedHostPinAtRoot(value, DEMO_FRIDAY_R20_KEYSET_ROOT)
	if (pin.participantId !== options.participantId
		|| pin.deploymentId !== DEMO_FRIDAY_R20_DEPLOYMENT_ID
		|| pin.applicationRunId !== DEMO_FRIDAY_R20_APPLICATION_RUN_ID
		|| pin.dkgRunId !== DEMO_FRIDAY_R20_DKG_RUN_ID
		|| pin.committeeKeysetId !== DEMO_FRIDAY_R20_KEYSET_ID
		|| pin.committeeKeysetVersion !== DEMO_FRIDAY_R20_KEYSET_VERSION
		|| demoFridayDkgOwnerApprovedHostPinDigestAtRoot(pin, DEMO_FRIDAY_R20_KEYSET_ROOT)
			!== options.expectedHostPinDigest) {
		fail('host pin differs from the fixed fresh run or its independent digest')
	}
}

export async function initializeDemoFridayR20HostEnrollment(options: {
	profile: DemoFridayR20FreshDkgProfileV2
	expectedProfileDigest: string
	participantId: DemoFridayParticipantId
	expectedHostPinDigest: string
	/** Tests only. The executable omits this and uses fixed live paths. */
	filesystem?: DemoFridayR20EnrollmentFilesystemProfile
	/** Tests only. The executable never injects a generator. */
	keyGenerator?: DemoFridayDkgEnrollmentKeyGenerator
	/** Tests only. */
	faultInjection?: (phase: DemoFridayDkgEnrollmentFaultPhase) => Promise<void>
	/** Tests only. Production always verifies the fixed root-owned predecessor seal. */
	verifyPredecessorSeal?: typeof verifyDemoFridayR20PredecessorPermissionSealFromFixedPath
}): Promise<DemoFridayDkgHostEnrollmentV1> {
	const filesystem = options.filesystem ?? productionFilesystem()
	if (filesystem.logicalRoot !== DEMO_FRIDAY_R20_KEYSET_ROOT) {
		fail('production filesystem root differs')
	}
	await (options.verifyPredecessorSeal ?? verifyDemoFridayR20PredecessorPermissionSealFromFixedPath)({
		expectedAbortDigest: options.profile.predecessorAbortDigest,
		expectedManifestDigest: options.profile.predecessorManifestDigest,
		expectedParticipantId: options.participantId,
	})
	await exactR20HostPin({ ...options, filesystem })
	return initializeDemoFridayDkgHostEnrollment({
		participantId: options.participantId, expectedHostPinDigest: options.expectedHostPinDigest,
		profile: filesystem, keyGenerator: options.keyGenerator, faultInjection: options.faultInjection,
	})
}

export async function recoverDemoFridayR20HostEnrollment(options: {
	profile: DemoFridayR20FreshDkgProfileV2
	expectedProfileDigest: string
	participantId: DemoFridayParticipantId
	expectedHostPinDigest: string
	/** Tests only. */
	filesystem?: DemoFridayR20EnrollmentFilesystemProfile
	/** Tests only. Production always verifies the fixed root-owned predecessor seal. */
	verifyPredecessorSeal?: typeof verifyDemoFridayR20PredecessorPermissionSealFromFixedPath
}): Promise<DemoFridayDkgHostEnrollmentV1> {
	const filesystem = options.filesystem ?? productionFilesystem()
	if (filesystem.logicalRoot !== DEMO_FRIDAY_R20_KEYSET_ROOT) fail('production filesystem root differs')
	await (options.verifyPredecessorSeal ?? verifyDemoFridayR20PredecessorPermissionSealFromFixedPath)({
		expectedAbortDigest: options.profile.predecessorAbortDigest,
		expectedManifestDigest: options.profile.predecessorManifestDigest,
		expectedParticipantId: options.participantId,
	})
	await exactR20HostPin({ ...options, filesystem })
	return recoverDemoFridayDkgHostEnrollment({
		participantId: options.participantId, expectedHostPinDigest: options.expectedHostPinDigest,
		profile: filesystem,
	})
}

export function demoFridayR20HostEnrollmentArgs(argv = process.argv.slice(2)): {
	action: 'init' | 'recover'
	participantId: DemoFridayParticipantId
	expectedProfileDigest: string
	expectedHostPinDigest: string
} {
	if (argv.length !== 7 || !['init', 'recover'].includes(argv[0] ?? '')
		|| argv[1] !== '--participant' || ![1, 2, 3, 4].includes(Number(argv[2]))
		|| argv[3] !== '--expected-profile-digest' || !/^[0-9a-f]{64}$/.test(argv[4] ?? '')
		|| argv[5] !== '--expected-host-pin-digest' || !/^[0-9a-f]{64}$/.test(argv[6] ?? '')) {
		fail('usage: plebeian-friday-r20-enrollment init|recover --participant 1..4 --expected-profile-digest HEX --expected-host-pin-digest HEX')
	}
	return {
		action: argv[0] as 'init' | 'recover', participantId: Number(argv[2]) as DemoFridayParticipantId,
		expectedProfileDigest: argv[4]!, expectedHostPinDigest: argv[6]!,
	}
}

if (import.meta.main) {
	try {
		if (process.argv[2]?.startsWith('separated-')) {
			process.stdout.write(`${JSON.stringify(await runSeparatedHostCommand(process.argv.slice(2)))}\n`)
		} else {
		const args = demoFridayR20HostEnrollmentArgs()
		const profile = JSON.parse(await readFile(DEMO_FRIDAY_R20_PROFILE_PATH, 'utf8')) as DemoFridayR20FreshDkgProfileV2
		const enrollment = args.action === 'init'
			? await initializeDemoFridayR20HostEnrollment({ ...args, profile })
			: await recoverDemoFridayR20HostEnrollment({ ...args, profile })
		process.stdout.write(`${JSON.stringify(enrollment)}\n`)
		}
	} catch {
		process.stderr.write('Friday R20 host enrollment rejected\n'); process.exitCode = 1
	}
}
