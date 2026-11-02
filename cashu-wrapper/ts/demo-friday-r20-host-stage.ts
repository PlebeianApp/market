#!/usr/bin/env bun
/** Fixed-profile adapter from the reviewed R20 abort binding to the host driver. */
import { readFile } from 'node:fs/promises'
import { runSeparatedHostCommand } from './demo-friday-separated-host-cli'

import {
	DEMO_FRIDAY_DKG_HOST_STAGES,
	executeDemoFridayPerValidatorDkgHostStage,
	type DemoFridayDkgHostStage,
	type DemoFridayDkgHostStageOptions,
	type DemoFridayDkgHostStageResult,
} from './demo-friday-per-validator-dkg-host-cli'
import type { DemoFridayParticipantId } from './demo-friday-per-validator-dkg-plan'
import {
	demoFridayR20ProfileDigest,
	exactDemoFridayR20BoundManifest,
} from './demo-friday-r20-enrollment-runtime'
import {
	DEMO_FRIDAY_R20_BOUND_MANIFEST_PATH, DEMO_FRIDAY_R20_DKG_RUN_ID,
	DEMO_FRIDAY_R20_INPUT_ROOT, DEMO_FRIDAY_R20_KEYSET_ROOT,
	DEMO_FRIDAY_R20_MANIFEST_DIGEST_PATH, DEMO_FRIDAY_R20_MANIFEST_PATH,
	DEMO_FRIDAY_R20_PREDECESSOR_MANIFEST_PATH,
	type DemoFridayR20FreshDkgProfileV2,
} from './demo-friday-r20-fresh-profile'
import { verifyDemoFridayR20PredecessorPermissionSealFromFixedPath } from './demo-friday-r20-r18-permission-seal'
import {
	DEMO_FRIDAY_R20_INSPECTOR_BINARY, DEMO_FRIDAY_R20_PARTICIPANT_BINARY,
} from './demo-friday-r20-path-contract'

export const DEMO_FRIDAY_R20_PROFILE_PATH =
	`${DEMO_FRIDAY_R20_INPUT_ROOT}/fresh-profile.json` as const
export { DEMO_FRIDAY_R20_BOUND_MANIFEST_PATH, DEMO_FRIDAY_R20_MANIFEST_DIGEST_PATH,
	DEMO_FRIDAY_R20_MANIFEST_PATH, DEMO_FRIDAY_R20_PREDECESSOR_MANIFEST_PATH }

type ExecuteHostStage = (options: DemoFridayDkgHostStageOptions) => Promise<DemoFridayDkgHostStageResult>

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_R20_HOST_STAGE: ${message}`) }

export function prepareDemoFridayR20HostStage(options: {
	stage: DemoFridayDkgHostStage
	participantId: DemoFridayParticipantId
	profile: DemoFridayR20FreshDkgProfileV2
	predecessorManifest: unknown
	boundManifest: unknown
	expectedProfileDigest: string
	expectedManifestBindingDigest: string
	/** Tests only. Production always uses the fixed keyset-v2 root. */
	filesystemRoot?: string
}): DemoFridayDkgHostStageOptions {
	if (!(DEMO_FRIDAY_DKG_HOST_STAGES as readonly string[]).includes(options.stage)
		|| ![1, 2, 3, 4].includes(options.participantId)) fail('stage or participant is invalid')
	if (demoFridayR20ProfileDigest(options.profile) !== options.expectedProfileDigest) {
		fail('fresh-run profile differs from its independent digest')
	}
	const bound = exactDemoFridayR20BoundManifest({
		profile: options.profile, predecessorManifest: options.predecessorManifest,
		value: options.boundManifest, expectedBindingDigest: options.expectedManifestBindingDigest,
	})
	return {
		stage: options.stage, participantId: options.participantId, runId: DEMO_FRIDAY_R20_DKG_RUN_ID,
		externalManifestDigest: bound.manifestDigest,
		profile: {
			filesystemRoot: options.filesystemRoot ?? DEMO_FRIDAY_R20_KEYSET_ROOT,
			participantBinary: DEMO_FRIDAY_R20_PARTICIPANT_BINARY,
			inspectorBinary: DEMO_FRIDAY_R20_INSPECTOR_BINARY,
			trustedBinaryOwnerUid: 0, trustedBinaryParentRoot: '/',
		},
	}
}

export async function executeDemoFridayR20HostStage(options: Parameters<typeof prepareDemoFridayR20HostStage>[0],
	execute: ExecuteHostStage = executeDemoFridayPerValidatorDkgHostStage,
	verifyPredecessorSeal: typeof verifyDemoFridayR20PredecessorPermissionSealFromFixedPath =
		verifyDemoFridayR20PredecessorPermissionSealFromFixedPath): Promise<DemoFridayDkgHostStageResult> {
	await verifyPredecessorSeal({ expectedAbortDigest: options.profile.predecessorAbortDigest,
		expectedManifestDigest: options.profile.predecessorManifestDigest,
		expectedParticipantId: options.participantId })
	return execute(prepareDemoFridayR20HostStage(options))
}

function exactArgs(argv = process.argv.slice(2)): {
	stage: DemoFridayDkgHostStage
	participantId: DemoFridayParticipantId
	expectedProfileDigest: string
	expectedManifestBindingDigest: string
} {
	if (argv.length !== 7 || argv[1] !== '--participant' || argv[3] !== '--expected-profile-digest'
		|| argv[5] !== '--expected-manifest-binding-digest'
		|| !(DEMO_FRIDAY_DKG_HOST_STAGES as readonly string[]).includes(argv[0] ?? '')
		|| ![1, 2, 3, 4].includes(Number(argv[2]))
		|| !/^[0-9a-f]{64}$/.test(argv[4] ?? '') || !/^[0-9a-f]{64}$/.test(argv[6] ?? '')) {
		fail('usage: plebeian-friday-r20-host STAGE --participant 1..4 --expected-profile-digest HEX --expected-manifest-binding-digest HEX')
	}
	return { stage: argv[0] as DemoFridayDkgHostStage, participantId: Number(argv[2]) as DemoFridayParticipantId,
		expectedProfileDigest: argv[4]!, expectedManifestBindingDigest: argv[6]! }
}

if (import.meta.main) {
	try {
		if (process.argv[2]?.startsWith('separated-')) {
			process.stdout.write(`${JSON.stringify(await runSeparatedHostCommand(process.argv.slice(2)))}\n`)
		} else {
		const args = exactArgs()
		const [profile, predecessorManifest, boundManifest] = await Promise.all([
			readFile(DEMO_FRIDAY_R20_PROFILE_PATH, 'utf8').then((value) => JSON.parse(value) as DemoFridayR20FreshDkgProfileV2),
			readFile(DEMO_FRIDAY_R20_PREDECESSOR_MANIFEST_PATH, 'utf8').then((value) => JSON.parse(value) as unknown),
			readFile(DEMO_FRIDAY_R20_BOUND_MANIFEST_PATH, 'utf8').then((value) => JSON.parse(value) as unknown),
		])
		const result = await executeDemoFridayR20HostStage({ ...args, profile, predecessorManifest, boundManifest })
		process.stdout.write(`${JSON.stringify(result)}\n`)
		}
	} catch {
		process.stderr.write('Friday R20 host stage rejected\n'); process.exitCode = 1
	}
}
