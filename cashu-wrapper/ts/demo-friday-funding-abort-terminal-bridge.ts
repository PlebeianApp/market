/** Durable bridge from committed FundingAbortV1 to the terminal queue/import exchange. */
import type { DemoFridayFundingAbortCapsuleStore } from './demo-friday-funding-abort-capsule'
import { demoMaintainerScopeFor } from './demo-maintainer-offline'
import type {
	DemoFridayFundingAbortTerminalPort,
	DemoFridayFundingAbortTerminalResultV1,
} from './demo-friday-funding-abort-service'
import { DemoFridayCocoTerminalExchangeSqlite } from './demo-friday-coco-terminal-exchange'
import {
	demoFridayTerminalDescriptorDigest,
	DemoFridayTerminalDescriptorSqlite,
} from './demo-friday-fixed-terminal-resolver'
import {
	DemoFridayTrustedTerminalSqlite,
	type DemoFridayTrustedTerminalReferenceV1,
} from './demo-friday-authority-runtime'

export function createDemoFridayFundingAbortTerminalBridge(options: {
	capsules: DemoFridayFundingAbortCapsuleStore
	descriptors: DemoFridayTerminalDescriptorSqlite
	source: DemoFridayTrustedTerminalSqlite
	exchange: DemoFridayCocoTerminalExchangeSqlite
}): DemoFridayFundingAbortTerminalPort {
	return Object.freeze({
		async returnOrRecoverExact(
			input: Parameters<DemoFridayFundingAbortTerminalPort['returnOrRecoverExact']>[0],
		): Promise<DemoFridayFundingAbortTerminalResultV1> {
			const capsule = await options.capsules.readByOperationExact(input.certificate.operationId)
			const template = capsule.refund
			if (input.commit.operationId !== input.certificate.operationId
				|| input.commit.consensusEventId !== input.commit.abortCertificateDigest
				|| input.evidence.operationId !== input.certificate.operationId
				|| template.operationId !== input.certificate.operationId
				|| template.templateDigest !== input.certificate.returnPackageDigest
				|| template.cashuSigAllDigest !== input.certificate.returnCashuSigAllDigest
				|| capsule.capsuleDigest !== input.certificate.fundingAuthorizationEventId) {
				throw new Error('DEMO_FRIDAY_FUNDING_ABORT_TERMINAL: exact stored package or committed abort differs')
			}
			const descriptor = {
				schema: 'PLEBEIAN_FRIDAY_TERMINAL_DESCRIPTOR_V1' as const,
				reference: `funding-abort-${input.commit.consensusEventId.slice(0, 32)}`,
				branch: 'funding_abort_return' as const, auctionId: input.certificate.auctionId,
				fundingOperationId: input.certificate.operationId, scope: demoMaintainerScopeFor(template),
				bundleDigest: capsule.capsuleDigest, eventHeight: input.commit.height,
				eventId: input.commit.consensusEventId,
			}
			const reference: DemoFridayTrustedTerminalReferenceV1 = options.descriptors.persistAuthenticatedExact(descriptor)
			if (reference.identityDigest !== demoFridayTerminalDescriptorDigest(descriptor)) {
				throw new Error('DEMO_FRIDAY_FUNDING_ABORT_TERMINAL: descriptor digest changed')
			}
			options.source.enqueueAuthenticatedExact(reference)
			const recipientAckDigest = options.exchange.readAckDigestExact(input.certificate.operationId)
			if (recipientAckDigest === null) {
				throw new Error('DEMO_FRIDAY_FUNDING_ABORT_TERMINAL_PENDING: terminal FROST/mint/import is pending')
			}
			return {
				schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_TERMINAL_RESULT_V1',
				operationId: input.certificate.operationId, terminalOperationId: input.terminalOperationId,
				abortCertificateDigest: input.commit.abortCertificateDigest,
				status: 'recipient_imported', recipientAckDigest,
			}
		},
	})
}
