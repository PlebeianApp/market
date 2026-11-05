#!/usr/bin/env bun
/** Validate four signed monotonic signer-enrollment successors without secrets. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const DKG_RUN_ID = 'friday-demo-20261030-separated-v1-dkg1'
const PACKAGE = '954382a53b3589dc0b6069df298c803d2cebcfdec9502645f3c0264e668bdde5'
const ROSTER = 'c1aca1467fa1485dadfb7260024adf31f23e2d0912c99569292ee920d6d1eea1'

type Enrollment = {
	schema: string
	binding: Record<string, unknown>
	signerIdentity: string
	digest: string
	signature: string
}

function exactKeys(value: object, keys: string[], label: string): void {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		throw new Error(`${label}: fields differ`)
	}
}

function validate(value: unknown, slot: number, label: string): Enrollment {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: object required`)
	exactKeys(value, ['schema', 'binding', 'signerIdentity', 'digest', 'signature'], label)
	const record = value as Enrollment
	if (record.binding === null || typeof record.binding !== 'object' || Array.isArray(record.binding)) throw new Error(`${label}: binding required`)
	if (record.schema !== 'COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1'
		|| !HEX_32.test(record.signerIdentity) || !HEX_32.test(record.digest) || !HEX_64.test(record.signature)
		|| record.binding.participantId !== slot || record.binding.dkgRunId !== DKG_RUN_ID
		|| record.binding.publicKeyPackageSha256 !== PACKAGE || record.binding.signerRosterDigest !== ROSTER) {
		throw new Error(`${label}: public identity differs`)
	}
	const digest = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		'COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1', record.binding, record.signerIdentity,
	]))))
	if (record.digest !== digest
		|| !schnorr.verify(hexToBytes(record.signature), hexToBytes(digest), hexToBytes(record.signerIdentity))) {
		throw new Error(`${label}: signature invalid`)
	}
	return structuredClone(record)
}

function stable(binding: Record<string, unknown>): string {
	const copy = structuredClone(binding)
	delete copy.restartEpoch
	return JSON.stringify(copy)
}

const { values } = parseArgs({
	options: { 'old-root': { type: 'string' }, 'new-root': { type: 'string' } },
	strict: true,
})
if (values['old-root'] === undefined || values['new-root'] === undefined) {
	throw new Error('usage: --old-root DIR --new-root DIR')
}

const results = []
for (let slot = 1; slot <= 4; slot += 1) {
	const oldBytes = await readFile(join(values['old-root'], `signer-${slot}.json`))
	const newBytes = await readFile(join(values['new-root'], `signer-${slot}.json`))
	const prior = validate(JSON.parse(oldBytes.toString('utf8')) as unknown, slot, `old-${slot}`)
	const successor = validate(JSON.parse(newBytes.toString('utf8')) as unknown, slot, `new-${slot}`)
	const oldEpoch = prior.binding.restartEpoch
	const newEpoch = successor.binding.restartEpoch
	if (!Number.isSafeInteger(oldEpoch) || !Number.isSafeInteger(newEpoch)
		|| (newEpoch as number) <= (oldEpoch as number)
		|| stable(prior.binding) !== stable(successor.binding)
		|| prior.signerIdentity !== successor.signerIdentity) {
		throw new Error(`slot-${slot}: successor is not the exact monotonic public enrollment`)
	}
	results.push({
		participantId: slot,
		oldEpoch,
		newEpoch,
		sha256: bytesToHex(sha256(newBytes)),
		digest: successor.digest,
	})
}
process.stdout.write(`${JSON.stringify({ status: 'PASS', records: results })}\n`)
