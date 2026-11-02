/** Public-only, deterministic composer for the verified R18 abort bundle. */
import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
	demoFridayDkgManifestDigest, exactDemoFridayDkgManifest,
	type DemoFridayDkgPublicManifestV1,
} from './demo-friday-per-validator-dkg-bootstrap'
import {
	demoFridayR18AbortDigest, exactDemoFridayR18AbortRecord,
	type DemoFridayR18AbortAcknowledgementV1, type DemoFridayR18AbortRecordV1,
} from './demo-friday-r20-fresh-profile'
import { verifyDemoFridayR18AbortSealBundle } from './demo-friday-r20-abort-seal'
import {
	DEMO_FRIDAY_R18_ABORT_BUNDLE_SCHEMA, DEMO_FRIDAY_R18_PRODUCTION_BUNDLE,
	type DemoFridayR18VerifiedAbortBundleV1,
} from './demo-friday-r20-r18-permission-seal'

const HEX_32 = /^[0-9a-f]{64}$/
const IDS = [1, 2, 3, 4] as const
const MAX_INPUT = 512 * 1024
const MAX_OUTPUT = 1024 * 1024
const R18_DEPLOYMENT = 'friday-demo-20261023-r14'
const R18_APPLICATION_RUN = 'friday-demo-20261023-r14-run1'
const R18_DKG_RUN = 'friday-demo-20261023-r14-dkg1'
const R18_KEYSET = 'friday-demo-frost-keyset-v1'
const R18_KEYSET_VERSION = '1'

export const DEMO_FRIDAY_R18_COMPOSER_MANIFEST = '/var/lib/plebeian-auctions-friday-operator/dkg-r20/predecessor-manifest.json' as const
export const DEMO_FRIDAY_R18_COMPOSER_RECORD = '/var/lib/plebeian-auctions-friday-operator/dkg-r20/predecessor-abort/abort-record.json' as const
export const DEMO_FRIDAY_R18_COMPOSER_ACKS = IDS.map((id) =>
	`/var/lib/plebeian-auctions-friday-operator/dkg-r20/predecessor-abort/participant-${id}.acknowledgement.json`) as readonly string[]

export interface DemoFridayVerifiedAbortComposerProfile {
	manifestPath: string
	abortRecordPath: string
	acknowledgementPaths: readonly [string, string, string, string]
	outputPath: string
	ownerUid: number
	ownerGid: number
}

export interface DemoFridayComposedVerifiedAbortBundle extends DemoFridayR18VerifiedAbortBundleV1 {
	predecessorManifest: DemoFridayDkgPublicManifestV1
	abortRecord: DemoFridayR18AbortRecordV1
	acknowledgements: DemoFridayR18AbortAcknowledgementV1[]
}

export const DEMO_FRIDAY_VERIFIED_ABORT_PRODUCTION_PROFILE: DemoFridayVerifiedAbortComposerProfile = Object.freeze({
	manifestPath: DEMO_FRIDAY_R18_COMPOSER_MANIFEST,
	abortRecordPath: DEMO_FRIDAY_R18_COMPOSER_RECORD,
	acknowledgementPaths: DEMO_FRIDAY_R18_COMPOSER_ACKS as [string, string, string, string],
	outputPath: DEMO_FRIDAY_R18_PRODUCTION_BUNDLE,
	ownerUid: 0,
	ownerGid: 0,
})

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_VERIFIED_ABORT_COMPOSER: ${message}`) }

function canonical(path: string, label: string): string {
	if (!path.startsWith('/') || resolve(path) !== path || path === '/' || path.endsWith('/') || path.includes('//')) {
		fail(`${label} is not a canonical absolute path`)
	}
	return path
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
	try { await handle.sync() } finally { await handle.close() }
}

export async function readDemoFridayPublicComposerJson(options: {
	path: string
	ownerUid: number
	ownerGid: number
}): Promise<unknown> {
	canonical(options.path, 'public input')
	const handle = await open(options.path, constants.O_RDONLY | constants.O_NOFOLLOW)
	try {
		const before = await handle.stat()
		if (!before.isFile() || before.nlink !== 1 || before.uid !== options.ownerUid || before.gid !== options.ownerGid
			|| (before.mode & 0o777) !== 0o600 || before.size < 2 || before.size > MAX_INPUT
			|| await realpath(options.path) !== options.path) fail('public input metadata differs')
		const bytes = await handle.readFile()
		const after = await handle.stat()
		if (bytes.length !== before.size || before.dev !== after.dev || before.ino !== after.ino
			|| before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
			fail('public input changed while read')
		}
		try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
		catch { fail('public input is not UTF-8 JSON') }
	} finally { await handle.close() }
}

function exactR18Manifest(value: unknown, expectedManifestDigest: string): DemoFridayDkgPublicManifestV1 {
	if (!HEX_32.test(expectedManifestDigest)) fail('expected manifest digest is malformed')
	const manifest = exactDemoFridayDkgManifest(value)
	if (manifest.deploymentId !== R18_DEPLOYMENT || manifest.applicationRunId !== R18_APPLICATION_RUN
		|| manifest.dkgRunId !== R18_DKG_RUN || manifest.committeeKeysetId !== R18_KEYSET
		|| manifest.committeeKeysetVersion !== R18_KEYSET_VERSION
		|| JSON.stringify(manifest.roster) !== JSON.stringify(IDS)
		|| demoFridayDkgManifestDigest(manifest) !== expectedManifestDigest) fail('manifest is not the independently pinned R18 predecessor')
	return manifest
}

export function composeDemoFridayVerifiedAbortBundle(options: {
	predecessorManifest: unknown
	abortRecord: unknown
	acknowledgements: unknown
	expectedManifestDigest: string
	expectedAbortDigest: string
}): DemoFridayComposedVerifiedAbortBundle {
	if (!HEX_32.test(options.expectedAbortDigest)) fail('expected abort digest is malformed')
	const predecessorManifest = exactR18Manifest(options.predecessorManifest, options.expectedManifestDigest)
	const abortRecord: DemoFridayR18AbortRecordV1 = exactDemoFridayR18AbortRecord({
		predecessorManifest, record: options.abortRecord,
	})
	if (demoFridayR18AbortDigest(abortRecord) !== options.expectedAbortDigest) fail('abort record differs from the independent pin')
	verifyDemoFridayR18AbortSealBundle({ predecessorManifest, abortRecord,
		acknowledgements: options.acknowledgements, expectedAbortDigest: options.expectedAbortDigest })
	const raw = options.acknowledgements as Array<Record<string, unknown>>
	const acknowledgements = IDS.map((participantId, index): DemoFridayR18AbortAcknowledgementV1 => ({
		schema: 'PLEBEIAN_FRIDAY_DKG_ABORT_ACKNOWLEDGEMENT_V1',
		abortDigest: options.expectedAbortDigest,
		participantId,
		dkgIdentity: predecessorManifest.participants[index]!.dkgIdentity,
		signature: raw[index]!.signature as string,
	}))
	return structuredClone({ schema: DEMO_FRIDAY_R18_ABORT_BUNDLE_SCHEMA,
		predecessorManifest, abortRecord, acknowledgements })
}

/** Create-exclusive output. A partial output is preserved and blocks replay. */
export async function writeDemoFridayVerifiedAbortBundleCreateOnce(options: {
	profile: DemoFridayVerifiedAbortComposerProfile
	bundle: DemoFridayComposedVerifiedAbortBundle
}): Promise<void> {
	const output = canonical(options.profile.outputPath, 'verified bundle output')
	const parent = dirname(output)
	if (await realpath(parent) !== parent) fail('output parent is not canonical')
	const metadata = await stat(parent)
	if (!metadata.isDirectory() || metadata.uid !== options.profile.ownerUid || metadata.gid !== options.profile.ownerGid
		|| (metadata.mode & 0o777) !== 0o700) fail('output parent metadata differs')
	const bytes = new TextEncoder().encode(`${JSON.stringify(options.bundle)}\n`)
	if (bytes.length < 2 || bytes.length > MAX_OUTPUT) fail('verified bundle output is outside the bounded size')
	const handle = await open(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
	try {
		await handle.writeFile(bytes); await handle.sync(); await handle.chmod(0o600)
		const after = await handle.stat()
		if (!after.isFile() || after.nlink !== 1 || after.uid !== options.profile.ownerUid
			|| after.gid !== options.profile.ownerGid || (after.mode & 0o777) !== 0o600
			|| after.size !== bytes.length) fail('verified bundle output metadata differs')
	} finally { await handle.close() }
	await syncDirectory(parent)
}

export async function composeDemoFridayVerifiedAbortBundleFromProfile(options: {
	profile: DemoFridayVerifiedAbortComposerProfile
	expectedManifestDigest: string
	expectedAbortDigest: string
}): Promise<DemoFridayComposedVerifiedAbortBundle> {
	if (options.profile.acknowledgementPaths.length !== 4
		|| new Set(options.profile.acknowledgementPaths).size !== 4) fail('acknowledgement paths are not the exact four distinct slots')
	const read = (path: string) => readDemoFridayPublicComposerJson({ path,
		ownerUid: options.profile.ownerUid, ownerGid: options.profile.ownerGid })
	const [predecessorManifest, abortRecord, ...acknowledgements] = await Promise.all([
		read(options.profile.manifestPath), read(options.profile.abortRecordPath),
		...options.profile.acknowledgementPaths.map(read),
	])
	const bundle = composeDemoFridayVerifiedAbortBundle({ predecessorManifest, abortRecord, acknowledgements,
		expectedManifestDigest: options.expectedManifestDigest, expectedAbortDigest: options.expectedAbortDigest })
	await writeDemoFridayVerifiedAbortBundleCreateOnce({ profile: options.profile, bundle })
	return bundle
}
