import { afterEach, describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { exactDemoFridayFaultApproval } from './demo-friday-browser-acceptance-adapters'
import { DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID } from './demo-friday-browser-acceptance-adapters'
import { runDemoFridayR20AcceptanceOperatorCli } from './demo-friday-r20-acceptance-operator-cli'

let cleanup: string[] = []
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }) })

function approval(deploymentId: string) {
	return utf8ToBytes(JSON.stringify({ schema: 'PLEBEIAN_FRIDAY_VALIDATOR_FAULT_APPROVAL_V1', deploymentId,
		action: 'STOP_VALIDATOR_4_ONCE', targetSlot: 4, targetHostId: 'linode-108237424',
		targetIpv4: '172.104.253.247', unit: 'plebeian-friday-validator.service', notBefore: 900,
		expiresAt: 1_200, nonce: 'ab'.repeat(32) }))
}

describe('Friday R20 acceptance fault binding', () => {
	test('accepts only an externally pinned R20 approval identity', () => {
		const bytes = approval(DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID)
		expect(exactDemoFridayFaultApproval(bytes, bytesToHex(sha256(bytes)), 1_000,
			DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID).deploymentId).toBe(DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID)
	})
	test('rejects the otherwise valid R14 approval under the R20 operator', () => {
		const bytes = approval('friday-demo-20261023-r14')
		expect(() => exactDemoFridayFaultApproval(bytes, bytesToHex(sha256(bytes)), 1_000,
			DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID)).toThrow(/scope or validity/)
	})
	test('rejects a changed approval operation identity before command dispatch', () => {
		const value = JSON.parse(new TextDecoder().decode(approval(DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID)))
		value.nonce = 'cd'.repeat(32)
		const changed = utf8ToBytes(JSON.stringify(value)), original = approval(DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID)
		expect(() => exactDemoFridayFaultApproval(changed, bytesToHex(sha256(original)), 1_000,
			DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID)).toThrow(/external pin/)
	})
	test('executes the fixed R20 operator only after durable approval reservation', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-r20-fault-')); cleanup.push(root)
		const bytes = approval(DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID), pin = bytesToHex(sha256(bytes))
		const approvalPath = join(root, 'approval.json'); await writeFile(approvalPath, bytes, { mode: 0o600 })
		let reserved = false, calls = 0
		const result = await runDemoFridayR20AcceptanceOperatorCli([
			'validator-4-offline', '--approval', approvalPath, '--approval-sha256', pin,
			'--unit-sha256', '12'.repeat(32),
		], {
			nowSeconds: () => 1_000,
			async reserveFaultConsumption(hash) {
				if (reserved || hash !== pin) throw new Error('wrong or replayed operation identity')
				reserved = true
				return { async finalize() {}, async close() {} }
			},
			command: { async runExact(argv) {
				calls += 1
				if (argv.includes('/usr/bin/sha256sum')) return { exitCode: 0,
					stdout: `${'12'.repeat(32)}  /etc/systemd/system/plebeian-friday-validator.service\n`, stderr: '' }
				if (argv.includes('stop')) return { exitCode: 0, stdout: '', stderr: '' }
				return { exitCode: 3, stdout: 'inactive\n', stderr: '' }
			} },
		})
		expect(result).toEqual({ schema: 'PLEBEIAN_FRIDAY_VALIDATOR_FAULT_RESULT_V1', slot: 4,
			status: 'inactive', approvalSha256: pin })
		expect(reserved).toBeTrue(); expect(calls).toBe(3)
	})
})
