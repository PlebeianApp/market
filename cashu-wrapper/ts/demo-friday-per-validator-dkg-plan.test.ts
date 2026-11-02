import { describe, expect, test } from 'bun:test'

import {
	DEMO_FRIDAY_PER_VALIDATOR_BINARY,
	DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT,
	demoFridayPerValidatorDkgPlan,
} from './demo-friday-per-validator-dkg-plan'

const input = {
	runId: 'friday-demo-r12',
	committeeKeysetId: 'friday-demo-committee',
	committeeKeysetVersion: '1',
} as const

describe('inert per-validator DKG deployment plan', () => {
	test('maps every existing Rust round to one participant-local state directory', () => {
		for (const participantId of [1, 2, 3, 4] as const) {
			const plan = demoFridayPerValidatorDkgPlan({ ...input, participantId })
			const localState = `${DEMO_FRIDAY_PER_VALIDATOR_DKG_ROOT}/state`
			expect(plan.custody).toBe('PER_VALIDATOR_ONLY')
			expect(plan.blockedPrerequisites).toContain('PREPROVISIONED_LOCAL_TRANSPORT_CREDENTIALS')
			expect(Object.isFrozen(plan)).toBe(true)
			for (const command of Object.values(plan.commands)) {
				expect(command[0]).toBe(DEMO_FRIDAY_PER_VALIDATOR_BINARY)
				expect(command).toContain(localState)
				expect(command.join(' ')).not.toMatch(/participant-[1-4]\.state/)
			}
			expect(plan.commands.round1[1]).toBe('dkg-round1')
			expect(plan.commands['round1-agree'][1]).toBe('dkg-round1-agree')
			expect(plan.commands.round2[1]).toBe('dkg-round2')
			expect(plan.commands.finalize[1]).toBe('dkg-finalize')
		}
	})

	test('publishes only public artifacts or recipient-addressed encrypted envelopes', () => {
		const plan = demoFridayPerValidatorDkgPlan({ ...input, participantId: 2 })
		expect(plan.exchange.publishPublic).toEqual([
			`${plan.exchange.directory}/participant-2.round1.json`,
			`${plan.exchange.directory}/participant-2.agreement.json`,
			`${plan.exchange.directory}/participant-2.public.json`,
		])
		expect(plan.exchange.publishRecipientEncrypted).toEqual([
			{ recipientId: 1, path: `${plan.exchange.directory}/participant-2.round2-out/to-1.private.json` },
			{ recipientId: 3, path: `${plan.exchange.directory}/participant-2.round2-out/to-3.private.json` },
			{ recipientId: 4, path: `${plan.exchange.directory}/participant-2.round2-out/to-4.private.json` },
		])
		expect(plan.exchange.receiveRecipientEncrypted).toBe(
			`${plan.exchange.directory}/participant-2.round2.bundle.json`,
		)
	})

	test('contains no credential values and never claims transport bootstrap is implemented', () => {
		const plan = demoFridayPerValidatorDkgPlan({ ...input, participantId: 1 })
		const encoded = JSON.stringify(plan)
		expect(encoded).not.toContain('identity_signing_key_hex')
		expect(encoded).not.toContain('round2_pairwise_keys')
		expect(encoded).not.toContain('key_hex')
		expect(encoded).not.toContain('cleanup')
		expect(plan.blockedPrerequisites).toEqual([
			'PREPROVISIONED_LOCAL_TRANSPORT_CREDENTIALS',
			'AUTHENTICATED_FINAL_PACKAGE_ATTESTATION',
			'PUBLIC_ROSTER_AND_RELAY',
		])
	})

	test('refuses malformed participant and deployment bindings', () => {
		expect(() => demoFridayPerValidatorDkgPlan({ ...input, participantId: 0 as 1 })).toThrow('participantId must be 1..4')
		expect(() => demoFridayPerValidatorDkgPlan({ ...input, participantId: 1, runId: '../other' })).toThrow('runId')
		expect(() => demoFridayPerValidatorDkgPlan({ ...input, participantId: 1, committeeKeysetId: 'has spaces' })).toThrow('committeeKeysetId')
	})
})
