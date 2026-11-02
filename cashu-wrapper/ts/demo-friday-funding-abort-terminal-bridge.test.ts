import { describe, expect, test } from 'bun:test'

import { createDemoFridayFundingAbortTerminalBridge } from './demo-friday-funding-abort-terminal-bridge'
import {
	demoFridayTerminalDescriptorDigest,
	type DemoFridayTerminalDescriptorV1,
	type DemoFridayTerminalDescriptorSqlite,
} from './demo-friday-fixed-terminal-resolver'
import type { DemoFridayFundingAbortCapsuleStore } from './demo-friday-funding-abort-capsule'
import type { DemoFridayCocoTerminalExchangeSqlite } from './demo-friday-coco-terminal-exchange'
import type { DemoFridayTrustedTerminalSqlite } from './demo-friday-authority-runtime'

const H = (character: string) => character.repeat(64)

function harness(ack: string | null) {
	let persisted: DemoFridayTerminalDescriptorV1 | null = null
	let enqueues = 0
	const capsules = { async readByOperationExact() { return {
		capsuleDigest: H('7'), refund: { network: 'friday-network', chainId: 'friday-chain',
			auctionId: 'auction-1', operationId: 'funding-1', templateDigest: H('e'),
			cashuSigAllDigest: H('f') },
	} } } as unknown as DemoFridayFundingAbortCapsuleStore
	const descriptors = {
		persistAuthenticatedExact(value: DemoFridayTerminalDescriptorV1) {
			persisted = structuredClone(value)
			return { schema: 'PLEBEIAN_FRIDAY_TRUSTED_TERMINAL_REFERENCE_V1' as const,
				reference: value.reference, identityDigest: demoFridayTerminalDescriptorDigest(value) }
		},
	} as unknown as DemoFridayTerminalDescriptorSqlite
	const source = { enqueueAuthenticatedExact() { enqueues++ } } as unknown as DemoFridayTrustedTerminalSqlite
	const exchange = { readAckDigestExact() { return ack } } as unknown as DemoFridayCocoTerminalExchangeSqlite
	return { bridge: createDemoFridayFundingAbortTerminalBridge({ capsules, descriptors, source, exchange }),
		get persisted() { return persisted }, get enqueues() { return enqueues } }
}

const request = () => ({
	terminalOperationId: H('1'),
	certificate: { operationId: 'funding-1', auctionId: 'auction-1', returnPackageDigest: H('e'),
		returnCashuSigAllDigest: H('f'), fundingAuthorizationEventId: H('7') },
	commit: { operationId: 'funding-1', consensusEventId: H('2'), abortCertificateDigest: H('2'), height: 40 },
	evidence: { operationId: 'funding-1' },
})

describe('FundingAbort terminal bridge', () => {
	test('persists and queues the exact committed abort before reporting terminal pending', async () => {
		const run = harness(null)
		await expect(run.bridge.returnOrRecoverExact(request() as never)).rejects.toThrow(/TERMINAL_PENDING/)
		expect(run.persisted).toMatchObject({ branch: 'funding_abort_return', fundingOperationId: 'funding-1',
			eventHeight: 40, eventId: H('2') })
		expect(run.enqueues).toBe(1)
	})

	test('returns imported only after the exact browser Coco acknowledgement is durable', async () => {
		const run = harness(H('9'))
		await expect(run.bridge.returnOrRecoverExact(request() as never)).resolves.toEqual({
			schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_TERMINAL_RESULT_V1', operationId: 'funding-1',
			terminalOperationId: H('1'), abortCertificateDigest: H('2'), status: 'recipient_imported',
			recipientAckDigest: H('9'),
		})
		expect(run.enqueues).toBe(1)
	})

	test('rejects a committed abort that points at another prepared package before queueing', async () => {
		const run = harness(H('9'))
		const changed = request(); changed.certificate.returnPackageDigest = H('0')
		await expect(run.bridge.returnOrRecoverExact(changed as never)).rejects.toThrow(/package or committed abort differs/)
		expect(run.enqueues).toBe(0)
	})
})
