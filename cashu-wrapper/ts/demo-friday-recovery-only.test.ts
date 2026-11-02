import { describe, expect, test } from 'bun:test'

import { createDemoFridayRecoveryOnlyGuard } from './demo-friday-recovery-only'

const actor = '1'.repeat(64)
const eventId = '2'.repeat(64)
const operationId = 'operation-1'

function guard(options: {
	fundingPhase?: 'claimed' | 'prepared' | 'signed' | 'broadcasting' | 'broadcast' | 'admitted' | 'quarantined'
	terminal?: boolean; seller?: boolean; capsule?: unknown
} = {}) {
	return createDemoFridayRecoveryOnlyGuard({
		readFundingRecoveryPhaseExact: (value) => value === eventId ? options.fundingPhase ?? null : null,
		hasTerminalNoticeExact: (value, operation) => options.terminal === true && value === actor && operation === operationId,
		hasSellerPlanExact: (operation) => options.seller === true && operation === operationId,
		async readAbortCapsuleExact() {
			if (options.capsule === undefined) throw new Error('capsule is absent')
			return options.capsule as never
		},
	})
}

describe('Friday recovery-only durable guard', () => {
	test('permits only exact pre-existing funding, terminal and seller identities', async () => {
		const held = guard({ fundingPhase: 'broadcasting', terminal: true, seller: true })
		await held.assertRecordedExact('funding_confirm', { fundingAuthorizationEventId: eventId })
		await held.assertRecordedExact('funding_status', { fundingAuthorizationEventId: eventId })
		await held.assertRecordedExact('terminal_ack', { actor, fundingOperationId: operationId })
		await held.assertRecordedExact('seller_register', { plan: { fundingOperationId: operationId } })
		for (const [action, value] of [
			['funding_confirm', { fundingAuthorizationEventId: '3'.repeat(64) }],
			['terminal_ack', { actor, fundingOperationId: 'new-operation' }],
			['seller_register', { plan: { fundingOperationId: 'new-operation' } }],
		] as const) await expect(held.assertRecordedExact(action, value)).rejects.toThrow('not recorded before recovery mode')
	})

	test('read-only status sees a prepared row but confirm resumes only an already-broadcast transaction', async () => {
		const prepared = guard({ fundingPhase: 'prepared' })
		await prepared.assertRecordedExact('funding_status', { fundingAuthorizationEventId: eventId })
		await expect(prepared.assertRecordedExact('funding_confirm', {
			fundingAuthorizationEventId: eventId,
		})).rejects.toThrow('not already broadcast')
		for (const phase of ['broadcasting', 'broadcast', 'admitted'] as const) {
			await guard({ fundingPhase: phase }).assertRecordedExact('funding_confirm', {
				fundingAuthorizationEventId: eventId,
			})
		}
	})

	test('requires the byte-identical pre-existing abort capsule for every abort mutation', async () => {
		// Capsule validation is deliberately exercised elsewhere with complete
		// fixtures. Here a strict source failure proves absence never authorizes a
		// recovery mutation.
		await expect(guard().assertRecordedExact('abort_prepare', { fundingOperationId: operationId })).rejects.toThrow('capsule is absent')
	})

	test('does not infer permission from malformed or absent identities', async () => {
		const held = guard({ fundingPhase: 'broadcasting', terminal: true, seller: true })
		await expect(held.assertRecordedExact('funding_confirm', {})).rejects.toThrow('not recorded')
		await expect(held.assertRecordedExact('terminal_ack', { actor: 'bad', fundingOperationId: operationId })).rejects.toThrow('actor identity')
		await expect(held.assertRecordedExact('seller_register', {})).rejects.toThrow('operation identity')
	})
})
