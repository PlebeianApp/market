#!/usr/bin/env bun
/** Fixed-path root action for sealing one stopped R18 host. */
import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import {
	applyDemoFridayR18PermissionSeal,
	DEMO_FRIDAY_R18_PRODUCTION_SEAL_PROFILE,
} from './demo-friday-r20-r18-permission-seal'
import { DEMO_FRIDAY_R20_PERMISSION_SEAL_BINARY } from './demo-friday-r20-path-contract'

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_R18_PERMISSION_SEAL_CLI: ${message}`) }

const CONTRACT_PATH = '/var/lib/plebeian-auctions-friday-operator/dkg-r20/service-seal-contract.json'
const EXECUTABLE_PATH = DEMO_FRIDAY_R20_PERMISSION_SEAL_BINARY
const HEX_32 = /^[0-9a-f]{64}$/
const CONTRACT_KEYS = ['schema', 'artifactSha256', 'executablePath', 'r18Root', 'r18Parent', 'priorOwnerUid',
	'priorOwnerGid', 'sealedOwnerUid', 'sealedOwnerGid', 'sealedRootMode', 'sealedParentMode',
	'privateContentsPreserved'] as const

async function readStable(path: string, max: number): Promise<{ bytes: Uint8Array; dev: number; ino: number }> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
	try {
		const before = await handle.stat()
		if (!before.isFile() || before.nlink !== 1 || before.size < 2 || before.size > max) fail('contract/executable metadata differs')
		const bytes = new Uint8Array(await handle.readFile())
		const after = await handle.stat()
		if (bytes.length !== before.size || before.dev !== after.dev || before.ino !== after.ino
			|| before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
			fail('contract/executable changed while read')
		}
		return { bytes, dev: before.dev, ino: before.ino }
	} finally { await handle.close() }
}

export async function assertDemoFridayR18ServiceSealContract(): Promise<string> {
	if (await realpath(EXECUTABLE_PATH) !== EXECUTABLE_PATH) fail('permission executable path differs')
	const executable = await readStable(EXECUTABLE_PATH, 128 * 1024 * 1024)
	const contractFile = await readStable(CONTRACT_PATH, 16 * 1024)
	const [executableMetadata, contractMetadata, runningExecutable] = await Promise.all([
		stat(EXECUTABLE_PATH), stat(CONTRACT_PATH), stat('/proc/self/exe'),
	])
	if (executableMetadata.uid !== 0 || executableMetadata.gid !== 0
		|| (executableMetadata.mode & 0o777) !== 0o755
		|| contractMetadata.uid !== 0 || contractMetadata.gid !== 0
		|| (contractMetadata.mode & 0o777) !== 0o600
		|| runningExecutable.dev !== executable.dev || runningExecutable.ino !== executable.ino) {
		fail('service-seal contract or running executable identity differs')
	}
	let value: unknown
	try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contractFile.bytes)) }
	catch { fail('service-seal contract is not UTF-8 JSON') }
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...CONTRACT_KEYS].sort())) {
		fail('service-seal contract fields differ')
	}
	const contract = value as Record<string, unknown>
	const executableHash = bytesToHex(sha256(executable.bytes))
	if (contract.schema !== 'PLEBEIAN_FRIDAY_R20_R18_SERVICE_SEAL_CONTRACT_V2'
		|| contract.artifactSha256 !== executableHash || !HEX_32.test(String(contract.artifactSha256))
		|| contract.executablePath !== EXECUTABLE_PATH
		|| contract.r18Root !== '/var/lib/plebeian-auctions-friday/frost/keyset-v1'
		|| contract.r18Parent !== '/var/lib/plebeian-auctions-friday/frost'
		|| contract.priorOwnerUid !== 997 || contract.priorOwnerGid !== 986
		|| contract.sealedOwnerUid !== 0 || contract.sealedOwnerGid !== 0
		|| contract.sealedRootMode !== '0700' || contract.sealedParentMode !== '0711'
		|| contract.privateContentsPreserved !== true) fail('service-seal contract differs from the fixed R20 action')
	const executableAfter = await readStable(EXECUTABLE_PATH, 128 * 1024 * 1024)
	if (executableAfter.dev !== executable.dev || executableAfter.ino !== executable.ino) {
		fail('permission executable pathname changed after verification')
	}
	return bytesToHex(sha256(contractFile.bytes))
}

const args = process.argv.slice(2)
if (args.length !== 5 || args[0] !== 'seal' || args[1] !== '--participant'
	|| args[3] !== '--expected-abort-digest') {
	fail('usage: seal --participant <1|2|3|4> --expected-abort-digest <sha256>')
}
const participant = Number(args[2])
if (![1, 2, 3, 4].includes(participant)) fail('participant is outside the fixed roster')
const serviceSealDigest = await assertDemoFridayR18ServiceSealContract()
const seal = await applyDemoFridayR18PermissionSeal({
	profile: DEMO_FRIDAY_R18_PRODUCTION_SEAL_PROFILE,
	participantId: participant as 1 | 2 | 3 | 4,
	expectedAbortDigest: args[4]!,
	expectedServiceSealDigest: serviceSealDigest,
})
process.stdout.write(`${JSON.stringify({
	schema: seal.schema,
	participantId: seal.participantId,
	abortDigest: seal.abortDigest,
	predecessorManifestDigest: seal.predecessorManifestDigest,
	acknowledgementsDigest: seal.acknowledgementsDigest,
	status: seal.status,
})}\n`)
