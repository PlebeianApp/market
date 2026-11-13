/** Fresh create-once four-signer health diagnostic after the R45 recoveries. */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { lstat, readFile } from 'node:fs/promises'

import {
	collectIncidentHealthBatch,
	runBoundedIncidentHealthProbeProcess,
} from './demo-signer-incident-health-batch-collect-20261106'
import type { IncidentSignerHealthRecordV1 } from './demo-signer-incident-health-transcript-verify-20261106'

const RELEASE = '/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-signer-diagnostic-r45-20261109'
export const R45_HEALTH_DIAGNOSTIC_PINS = Object.freeze({
	collector: `${RELEASE}/bin/plebeian-signer-incident-health-collect-r45-20261109`,
	probe: `${RELEASE}/bin/plebeian-signer-incident-health-probe-r45-20261109`,
	probeSize: 98_531_643,
	probeSha256: 'eb97ee411f400ac378ff7b77a879f1b8335c418e9bab624061efc728c24c4e7e',
	enrollmentRoot: '/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/incidents/20261109/r45-successors',
	diagnosticRoot: '/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/incidents/20261109-r45-signer-health',
})
const COLLECTOR = R45_HEALTH_DIAGNOSTIC_PINS.collector
const PROBE = R45_HEALTH_DIAGNOSTIC_PINS.probe
const PROBE_SIZE = R45_HEALTH_DIAGNOSTIC_PINS.probeSize
const PROBE_SHA256 = R45_HEALTH_DIAGNOSTIC_PINS.probeSha256
const ENROLLMENT_ROOT = R45_HEALTH_DIAGNOSTIC_PINS.enrollmentRoot
const DIAGNOSTIC_ROOT = R45_HEALTH_DIAGNOSTIC_PINS.diagnosticRoot

function fail(message: string): never { throw new Error(`DEMO_SIGNER_HEALTH_R45_20261109: ${message}`) }

export async function inspectPinnedExecutable(
	path: string, expectedSize: number, expectedSha256: string, expectedUid: number,
): Promise<void> {
	const before = await lstat(path)
	if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== expectedUid
		|| (before.mode & 0o777) !== 0o755 || before.size !== expectedSize) fail('executable metadata differs')
	const bytes = await readFile(path)
	const after = await lstat(path)
	if (after.dev !== before.dev || after.ino !== before.ino || after.mode !== before.mode || after.size !== before.size
		|| after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.nlink !== before.nlink) {
		fail('executable changed while read')
	}
	if (bytesToHex(sha256(bytes)) !== expectedSha256) fail('executable digest differs')
}

async function probe(slot: 1 | 2 | 3 | 4): Promise<IncidentSignerHealthRecordV1> {
	return runBoundedIncidentHealthProbeProcess({ slot,
		command: [PROBE, '--slot', String(slot), '--enrollment', `${ENROLLMENT_ROOT}/signer-${slot}.json`] })
}

export function exactR45HealthCollectorInvocation(argv: string[], execPath: string): boolean {
	return argv.length === 0 && execPath === COLLECTOR
}

async function main(argv: string[]): Promise<void> {
	if (!exactR45HealthCollectorInvocation(argv, process.execPath)) fail('fixed invocation differs')
	await inspectPinnedExecutable(PROBE, PROBE_SIZE, PROBE_SHA256, 0)
	const verified = await collectIncidentHealthBatch({
		enrollmentRoot: ENROLLMENT_ROOT,
		attemptMarker: `${DIAGNOSTIC_ROOT}/attempted`,
		output: `${DIAGNOSTIC_ROOT}/success.json`,
		failureOutput: `${DIAGNOSTIC_ROOT}/failure.json`,
		probe,
	})
	process.stdout.write(`${JSON.stringify({
		schema: 'PLEBEIAN_SIGNER_DIAGNOSTIC_COLLECT_R45_20261109_V1', status: 'PASS', ...verified,
	})}\n`)
}

if (import.meta.main) {
	try { await main(process.argv.slice(2)) }
	catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : 'DEMO_SIGNER_HEALTH_R45_20261109: unknown error'}\n`)
		process.exitCode = 1
	}
}
