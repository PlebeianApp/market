import { constants } from 'node:fs'
import { chmod, lstat, readFile, rename, writeFile } from 'node:fs/promises'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/

interface DemoFridaySignerEnrollmentV1 {
	schema: 'COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1'
	binding: unknown
	signerIdentity: string
	digest: string
	signature: string
}

function exactKeys(value: object, keys: string[]): void {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		throw new Error('DEMO_FRIDAY_SIGNER_ENROLLMENT: stored enrollment has missing or unexpected fields')
	}
}

function expectedEnrollment(binding: unknown, signerIdentity: string, signerPrivate: Uint8Array): DemoFridaySignerEnrollmentV1 {
	if (!HEX_32.test(signerIdentity) || bytesToHex(schnorr.getPublicKey(signerPrivate)) !== signerIdentity) {
		throw new Error('DEMO_FRIDAY_SIGNER_ENROLLMENT: signer identity differs from private identity')
	}
	const digest = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		'COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1', binding, signerIdentity,
	]))))
	return {
		schema: 'COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1', binding: structuredClone(binding), signerIdentity, digest,
		signature: bytesToHex(schnorr.sign(hexToBytes(digest), signerPrivate)),
	}
}

function validateSigned(value: unknown, signerIdentity: string): DemoFridaySignerEnrollmentV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('DEMO_FRIDAY_SIGNER_ENROLLMENT: stored enrollment is not an object')
	exactKeys(value, ['schema', 'binding', 'signerIdentity', 'digest', 'signature'])
	const stored = value as DemoFridaySignerEnrollmentV1
	const digest = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		'COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1', stored.binding, signerIdentity,
	]))))
	if (stored.schema !== 'COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1' || stored.signerIdentity !== signerIdentity
		|| stored.digest !== digest
		|| !HEX_64.test(stored.signature) || !schnorr.verify(hexToBytes(stored.signature), hexToBytes(stored.digest), hexToBytes(stored.signerIdentity))) {
		throw new Error('DEMO_FRIDAY_SIGNER_ENROLLMENT: stored enrollment differs or has an invalid signature')
	}
	return structuredClone(stored)
}

function restartEpoch(binding: unknown): number {
	if (binding === null || typeof binding !== 'object' || Array.isArray(binding)) {
		throw new Error('DEMO_FRIDAY_SIGNER_ENROLLMENT: durable binding is not an object')
	}
	const epoch = (binding as Record<string, unknown>).restartEpoch
	if (!Number.isSafeInteger(epoch) || (epoch as number) < 1) {
		throw new Error('DEMO_FRIDAY_SIGNER_ENROLLMENT: restart epoch is invalid')
	}
	return epoch as number
}

function stableBinding(binding: unknown): string {
	const value = structuredClone(binding) as Record<string, unknown>
	delete value.restartEpoch
	return JSON.stringify(value)
}

/** Create once or validate byte-for-byte-compatible durable public enrollment. */
export async function ensureDemoFridaySignerEnrollment(options: {
	path: string; binding: unknown; signerIdentity: string; signerPrivate: Uint8Array
}): Promise<DemoFridaySignerEnrollmentV1> {
	const expected = expectedEnrollment(options.binding, options.signerIdentity, options.signerPrivate)
	try {
		await writeFile(options.path, `${JSON.stringify(expected)}\n`, { mode: 0o600, flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL })
		await chmod(options.path, 0o600)
		return expected
	} catch (error) {
		if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
	}
	const metadata = await lstat(options.path)
	const effectiveUid = process.geteuid?.()
	if (effectiveUid === undefined || !metadata.isFile() || metadata.isSymbolicLink()
		|| (metadata.mode & 0o777) !== 0o600 || metadata.uid !== effectiveUid) {
		throw new Error('DEMO_FRIDAY_SIGNER_ENROLLMENT: stored enrollment owner or mode differs')
	}
	const priorBytes = await readFile(options.path, 'utf8')
	const prior = validateSigned(JSON.parse(priorBytes) as unknown, options.signerIdentity)
	if (prior.schema === expected.schema && prior.signerIdentity === expected.signerIdentity
		&& prior.digest === expected.digest && JSON.stringify(prior.binding) === JSON.stringify(expected.binding)) return prior
	const priorEpoch = restartEpoch(prior.binding)
	const expectedEpoch = restartEpoch(expected.binding)
	if (expectedEpoch <= priorEpoch || stableBinding(prior.binding) !== stableBinding(expected.binding)) {
		throw new Error('DEMO_FRIDAY_SIGNER_ENROLLMENT: stored enrollment differs from the monotonic restart')
	}
	// Keep every replaced signed enrollment create-once.  A failed start can
	// consume an epoch before publishing, so a later successful start may skip
	// epochs; the signer journal remains the authority for monotonicity.
	const retained = `${options.path}.epoch-${priorEpoch}`
	try { await writeFile(retained, priorBytes, { mode: 0o600, flag: 'wx' }); await chmod(retained, 0o600) }
	catch (error) {
		if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST'
			|| await readFile(retained, 'utf8') !== priorBytes) throw error
	}
	const successor = `${options.path}.next-${expectedEpoch}`
	await writeFile(successor, `${JSON.stringify(expected)}\n`, { mode: 0o600, flag: 'wx' })
	await chmod(successor, 0o600)
	await rename(successor, options.path)
	return expected
}
