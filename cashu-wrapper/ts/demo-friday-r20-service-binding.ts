import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bytesToHex } from '@noble/hashes/utils.js'

import {
	verifyDemoFridayR20RuntimeBinding,
	type DemoFridayR20RuntimeDkgBindingV1,
} from './demo-friday-r20-enrollment-runtime'
import {
	DEMO_FRIDAY_R20_BOUND_MANIFEST_PATH, DEMO_FRIDAY_R20_DKG_RUN_ID,
	DEMO_FRIDAY_R20_INPUT_ROOT, DEMO_FRIDAY_R20_MANIFEST_DIGEST_PATH,
	DEMO_FRIDAY_R20_MANIFEST_PATH, DEMO_FRIDAY_R20_PREDECESSOR_MANIFEST_PATH,
	type DemoFridayR20FreshDkgProfileV2,
} from './demo-friday-r20-fresh-profile'
import type { DemoFridayLiveApplicationV3 } from './demo-friday-runtime-config'
import { verifyDemoFridayR20PredecessorPermissionSealFromFixedPath } from './demo-friday-r20-r18-permission-seal'
import {
	exactDemoFridaySignerNetworkFactsV1,
	type DemoFridaySignerNetworkFactsV1,
} from './demo-friday-signer-dkg-v2'

const HEX_32 = /^[0-9a-f]{64}$/

export interface DemoFridayR20ServicePins {
	manifestBindingDigest: string
	runtimeBindingDigest: string
}

export interface DemoFridayR20ServiceBinding {
	runtime: DemoFridayR20RuntimeDkgBindingV1
	facts: DemoFridaySignerNetworkFactsV1
	publicKeyPackagePath: string
}

export async function requireDemoFridayR20ServicePredecessorSeal(options: {
	application: DemoFridayLiveApplicationV3
	runtime: Pick<DemoFridayR20RuntimeDkgBindingV1, 'predecessorAbortDigest' | 'predecessorManifestDigest'>
	verify?: typeof verifyDemoFridayR20PredecessorPermissionSealFromFixedPath
}): Promise<void> {
	await (options.verify ?? verifyDemoFridayR20PredecessorPermissionSealFromFixedPath)({
		expectedAbortDigest: options.runtime.predecessorAbortDigest,
		expectedManifestDigest: options.runtime.predecessorManifestDigest,
		expectedParticipantId: options.application.application_host_slot,
	})
}

export function demoFridayR20ServicePaths(application: DemoFridayLiveApplicationV3) {
	const root = application.dkg_root
	return Object.freeze({
		profile: join(DEMO_FRIDAY_R20_INPUT_ROOT, 'fresh-profile.json'),
		predecessorManifest: DEMO_FRIDAY_R20_PREDECESSOR_MANIFEST_PATH,
		manifest: DEMO_FRIDAY_R20_MANIFEST_PATH,
		manifestDigest: DEMO_FRIDAY_R20_MANIFEST_DIGEST_PATH,
		boundManifest: DEMO_FRIDAY_R20_BOUND_MANIFEST_PATH,
		runtimeBinding: join(root, 'runtime-binding.json'),
		publicKeyPackage: join(root, 'exchange', DEMO_FRIDAY_R20_DKG_RUN_ID, 'participant-1.public.json'),
	})
}

export function demoFridayR20ServicePins(env: NodeJS.ProcessEnv = process.env): DemoFridayR20ServicePins {
	const manifestBindingDigest = env.FRIDAY_R20_MANIFEST_BINDING_DIGEST ?? ''
	const runtimeBindingDigest = env.FRIDAY_R20_RUNTIME_BINDING_DIGEST ?? ''
	if (!HEX_32.test(manifestBindingDigest) || !HEX_32.test(runtimeBindingDigest)) {
		throw new Error('DEMO_FRIDAY_R20_SERVICE: independent manifest/runtime digest pins are required')
	}
	return { manifestBindingDigest, runtimeBindingDigest }
}

function json(raw: Uint8Array): unknown {
	return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as unknown
}

export function requireDemoFridayR20InstalledManifestInputs(options: {
	manifestBytes: Uint8Array
	manifestDigestBytes: Uint8Array
	runtime: { manifestDigest: string; result: { manifest: unknown } }
}): void {
	let manifestDigestPin: string
	try { manifestDigestPin = new TextDecoder('ascii', { fatal: true }).decode(options.manifestDigestBytes) }
	catch { throw new Error('DEMO_FRIDAY_R20_SERVICE: installed manifest digest pin is malformed') }
	if (manifestDigestPin !== `${options.runtime.manifestDigest}\n`
		|| JSON.stringify(json(options.manifestBytes)) !== JSON.stringify(options.runtime.result.manifest)) {
		throw new Error('DEMO_FRIDAY_R20_SERVICE: installed manifest inputs differ from the bound runtime')
	}
}

export async function loadDemoFridayR20ServiceBinding(options: {
	application: DemoFridayLiveApplicationV3
	pins: DemoFridayR20ServicePins
	networkFactsPath?: string
	/** Tests only. Production always uses the fixed root-owned predecessor seal. */
	verifyPredecessorSeal?: typeof verifyDemoFridayR20PredecessorPermissionSealFromFixedPath
}): Promise<DemoFridayR20ServiceBinding> {
	const publicPaths = demoFridayR20ServicePaths(options.application)
	const paths = {
		...publicPaths,
		networkFacts: options.networkFactsPath ?? join(options.application.network_root, 'network-facts.json'),
	}
	const [profileBytes, predecessorBytes, manifestBytes, manifestDigestBytes,
		boundBytes, runtimeBytes, factsBytes] = await Promise.all([
		readFile(paths.profile), readFile(paths.predecessorManifest), readFile(paths.manifest),
		readFile(paths.manifestDigest), readFile(paths.boundManifest),
		readFile(paths.runtimeBinding), readFile(paths.networkFacts),
	])
	const runtime = verifyDemoFridayR20RuntimeBinding({
		profile: json(profileBytes) as DemoFridayR20FreshDkgProfileV2,
		predecessorManifest: json(predecessorBytes), boundManifest: json(boundBytes),
		expectedManifestBindingDigest: options.pins.manifestBindingDigest,
		expectedRuntimeBindingDigest: options.pins.runtimeBindingDigest,
		value: json(runtimeBytes),
	})
	requireDemoFridayR20InstalledManifestInputs({ manifestBytes, manifestDigestBytes, runtime })
	await requireDemoFridayR20ServicePredecessorSeal({ application: options.application, runtime,
		verify: options.verifyPredecessorSeal })
	if (runtime.deploymentId !== options.application.deployment_id
		|| runtime.applicationRunId !== options.application.run_id
		|| runtime.dkgRoot !== options.application.dkg_root
		|| runtime.coordinatorRoot !== options.application.coordinator_root) {
		throw new Error('DEMO_FRIDAY_R20_SERVICE: runtime binding differs from live application')
	}
	const facts = exactDemoFridaySignerNetworkFactsV1(json(factsBytes))
	if (facts.committee_public_key !== runtime.result.committeePublicKey) {
		throw new Error('DEMO_FRIDAY_R20_SERVICE: network committee differs from fresh DKG')
	}
	for (let index = 0; index < 4; index += 1) {
		const participant = runtime.result.participants[index]!
		const ula = options.application.fips_ulas[index]
		if (participant.participantId !== index + 1 || participant.fipsUla !== ula
			|| participant.signerEndpoint !== `http://[${ula}]:${options.application.signer_rpc_port}/v1/frost`) {
			throw new Error('DEMO_FRIDAY_R20_SERVICE: authenticated signer roster differs from application')
		}
	}
	const publicKeyPackagePath = publicPaths.publicKeyPackage
	if (runtime.result.publicKeyPackagePath !== publicKeyPackagePath) {
		throw new Error('DEMO_FRIDAY_R20_SERVICE: authenticated public package path differs')
	}
	const packageBytes = await readFile(publicKeyPackagePath)
	if (packageBytes.length === 0 || packageBytes.length > 65_536
		|| bytesToHex(packageBytes) !== runtime.result.publicKeyPackageHex) {
		throw new Error('DEMO_FRIDAY_R20_SERVICE: installed public package bytes differ')
	}
	return { runtime, facts, publicKeyPackagePath }
}
