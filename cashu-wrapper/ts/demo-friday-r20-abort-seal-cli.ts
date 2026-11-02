/** Fixed-path executable wrapper for the create-once R18 abort/seal flow. */
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'

import {
	composeDemoFridayR18AbortRecord,
	createDemoFridayR18AbortAcknowledgement,
	DEMO_FRIDAY_R18_HOST_ABORT_ROOT,
	DEMO_FRIDAY_R18_ROOT,
	DEMO_FRIDAY_R20_ABORT_OPERATOR_ROOT,
	writeDemoFridayAbortBundleCreateOnce,
} from './demo-friday-r20-abort-seal'

const MANIFEST = `${DEMO_FRIDAY_R18_ROOT}/manifest.json`
// The DKG identity signing key and pairwise transport secrets are persisted by
// the enrolled host in transport.json. participant.config.json is the public
// participant launcher configuration and must never be treated as a secret
// signing-key source.
const TRANSPORT = `${DEMO_FRIDAY_R18_ROOT}/transport.json`
const EVIDENCE = `${DEMO_FRIDAY_R20_ABORT_OPERATOR_ROOT}/predecessor-evidence.json`
const HOST_RECORD = `${DEMO_FRIDAY_R18_ROOT}/predecessor-abort-record.json`
const HEX_32 = /^[0-9a-f]{64}$/
const MAX_JSON = 128 * 1024

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_R20_ABORT_CLI: ${message}`) }

async function readJson(path: string, secret: boolean): Promise<unknown> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
	try {
		const before = await handle.stat()
		const uid = process.geteuid?.()
		if (uid === undefined || !before.isFile() || before.nlink !== 1 || before.size < 2 || before.size > MAX_JSON
			|| (secret ? (before.uid !== uid || (before.mode & 0o777) !== 0o600) : (before.mode & 0o022) !== 0)
			|| await realpath(path) !== path) fail('input metadata differs from the fixed protected profile')
		const bytes = await handle.readFile()
		const after = await handle.stat()
		if (bytes.length !== before.size || before.dev !== after.dev || before.ino !== after.ino
			|| before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
			fail('input changed while being read')
		}
		try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
		catch { fail('input is not canonical UTF-8 JSON') }
	} finally { await handle.close() }
}

function digestArg(value: string | undefined, label: string): string {
	if (value === undefined || !HEX_32.test(value)) fail(`${label} must be canonical SHA-256 hex`)
	return value
}

function args(): { mode: 'compose'; manifest: string; abort: string }
	| { mode: 'acknowledge'; participant: 1 | 2 | 3 | 4; abort: string } {
	const argv = process.argv.slice(2)
	if (argv.length === 5 && argv[0] === 'compose' && argv[1] === '--expected-manifest-digest'
		&& argv[3] === '--expected-abort-digest') {
		return { mode: 'compose', manifest: digestArg(argv[2], 'manifest digest'),
			abort: digestArg(argv[4], 'abort digest') }
	}
	if (argv.length === 5 && argv[0] === 'acknowledge' && argv[1] === '--participant'
		&& argv[3] === '--expected-abort-digest') {
		const participant = Number(argv[2]) as 1 | 2 | 3 | 4
		if (![1, 2, 3, 4].includes(participant)) fail('participant must be 1..4')
		return { mode: 'acknowledge', participant, abort: digestArg(argv[4], 'abort digest') }
	}
	fail('usage: compose --expected-manifest-digest HEX --expected-abort-digest HEX | acknowledge --participant 1..4 --expected-abort-digest HEX')
}

export async function main(): Promise<void> {
	const value = args()
	if (value.mode === 'compose') {
		const bundle = composeDemoFridayR18AbortRecord({
			predecessorManifest: await readJson(MANIFEST, false), evidence: await readJson(EVIDENCE, false),
			expectedManifestDigest: value.manifest, expectedAbortDigest: value.abort,
		})
		await writeDemoFridayAbortBundleCreateOnce({
			parent: DEMO_FRIDAY_R20_ABORT_OPERATOR_ROOT, name: 'predecessor-abort',
			files: { 'abort-record.json': bundle.record, 'abort-digest.json': { abortDigest: bundle.abortDigest } },
		})
		return
	}
	const result = createDemoFridayR18AbortAcknowledgement({
		predecessorManifest: await readJson(MANIFEST, false), abortRecord: await readJson(HOST_RECORD, false),
		expectedAbortDigest: value.abort, participantId: value.participant,
		localTransportSecrets: await readJson(TRANSPORT, true),
	})
	await writeDemoFridayAbortBundleCreateOnce({
		parent: DEMO_FRIDAY_R18_HOST_ABORT_ROOT, name: `abort-r20-participant-${value.participant}`,
		files: { 'acknowledgement.json': result.acknowledgement, 'seal.json': result.seal },
	})
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : 'DEMO_FRIDAY_R20_ABORT_CLI: unknown failure'}\n`)
		process.exitCode = 1
	})
}
