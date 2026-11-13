import { expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
	exactR45HealthCollectorInvocation,
	inspectPinnedExecutable,
	R45_HEALTH_DIAGNOSTIC_PINS,
} from './demo-signer-incident-health-collect-r45-20261109'
import { INCIDENT_SIGNER_SUCCESSORS_20261109 } from './demo-signer-incident-successors-20261106'

test('R45 health wrapper pins exact release, roots, probe and enrollments', () => {
	expect(R45_HEALTH_DIAGNOSTIC_PINS).toEqual({
		collector: '/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-signer-diagnostic-r45-20261109/bin/plebeian-signer-incident-health-collect-r45-20261109',
		probe: '/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-signer-diagnostic-r45-20261109/bin/plebeian-signer-incident-health-probe-r45-20261109',
		probeSize: 98_531_643,
		probeSha256: 'eb97ee411f400ac378ff7b77a879f1b8335c418e9bab624061efc728c24c4e7e',
		enrollmentRoot: '/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/incidents/20261109/r45-successors',
		diagnosticRoot: '/var/lib/plebeian-auctions-friday/coordinator-v3/runtime/incidents/20261109-r45-signer-health',
	})
	expect(INCIDENT_SIGNER_SUCCESSORS_20261109).toEqual({
		1: { enrollmentSha256: '49741fbb5da4e23170afaf2c8b1929b5fdde94f59bf620ebe335e59d96a41f17', restartEpoch: 8, signerIdentity: '7bbd6fefa289786174bfe6aaedd28b82dd53b22e36bc2ab6ad8bd874c7d30b63' },
		2: { enrollmentSha256: 'e59c6fa6e83debec6b28f626ff3041ae16cff8352da7c7bdcaf31a32d555bdee', restartEpoch: 7, signerIdentity: '595a24ce72978be91ae993c96d28bfc12d6ccb94212599ff69f7d1371f9a6a91' },
		3: { enrollmentSha256: '36b264e760f7d903c649da15d6a3aec4befd8c160b5291b7b664af863230e524', restartEpoch: 7, signerIdentity: '298da713895db65b5b860a11307a78ae8a3057daa7d938af60ca13e439a31b42' },
		4: { enrollmentSha256: '4d5581b48f9f2f0a11e9a601e837a4ace7c08ee2a0549736238ef22441efe115', restartEpoch: 7, signerIdentity: 'bfa05c77a3f23666e3b586a8edca5e50aa6717c309132ed2f9bee93ac7fc3956' },
	})
	expect(exactR45HealthCollectorInvocation([], R45_HEALTH_DIAGNOSTIC_PINS.collector)).toBe(true)
	expect(exactR45HealthCollectorInvocation(['extra'], R45_HEALTH_DIAGNOSTIC_PINS.collector)).toBe(false)
	expect(exactR45HealthCollectorInvocation([], '/tmp/collector')).toBe(false)
})

test('R45 health wrapper checks executable bytes and metadata', async () => {
	const root = await mkdtemp(join(tmpdir(), 'plebeian-r45-health-wrapper-'))
	try {
		const executable = join(root, 'probe')
		const raw = new TextEncoder().encode('probe')
		await writeFile(executable, raw)
		await chmod(executable, 0o755)
		await inspectPinnedExecutable(executable, raw.length, bytesToHex(sha256(raw)), process.getuid!())
		await expect(inspectPinnedExecutable(executable, raw.length, '0'.repeat(64), process.getuid!())).rejects.toThrow(
			'DEMO_SIGNER_HEALTH_R45_20261109: executable digest differs',
		)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
