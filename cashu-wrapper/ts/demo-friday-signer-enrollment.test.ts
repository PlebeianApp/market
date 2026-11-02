import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { ensureDemoFridaySignerEnrollment } from './demo-friday-signer-enrollment'

const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const identity = bytesToHex(schnorr.getPublicKey(secret))

describe('Friday signer durable enrollment', () => {
	test('creates once and validates restart without overwriting identity', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-signer-enrollment-')); const path = join(root, 'enrollment.json')
		try {
			const binding = { participantId: 1, deploymentId: 'friday-blue-20261023', restartEpoch: 2 }
			await ensureDemoFridaySignerEnrollment({ path, binding, signerIdentity: identity, signerPrivate: secret })
			const first = await readFile(path, 'utf8')
			await ensureDemoFridaySignerEnrollment({ path, binding, signerIdentity: identity, signerPrivate: secret })
			expect(await readFile(path, 'utf8')).toBe(first)
			expect(() => JSON.parse(first)).not.toThrow()
			await expect(ensureDemoFridaySignerEnrollment({ path, binding: { ...binding, restartEpoch: 1 }, signerIdentity: identity, signerPrivate: secret })).rejects.toThrow(/differs/)
		} finally { await rm(root, { recursive: true, force: true }) }
	})

	test('rejects a permissive pre-existing enrollment file', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-signer-enrollment-')); const path = join(root, 'enrollment.json')
		try {
			const binding = { participantId: 1, deploymentId: 'friday-blue-20261023', restartEpoch: 2 }
			await ensureDemoFridaySignerEnrollment({ path, binding, signerIdentity: identity, signerPrivate: secret })
			await chmod(path, 0o644)
			await expect(ensureDemoFridaySignerEnrollment({ path, binding, signerIdentity: identity, signerPrivate: secret })).rejects.toThrow(/owner or mode/)
		} finally { await rm(root, { recursive: true, force: true }) }
	})
})
