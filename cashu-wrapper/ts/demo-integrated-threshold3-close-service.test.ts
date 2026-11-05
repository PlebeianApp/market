import { describe, expect, test } from 'bun:test'

import { demoIntegratedClosePolicyMismatchFields } from './demo-integrated-threshold3-close-service'

function fixture() {
	const certificate = {
		cause: 'winner', network: 'network', chainId: 'chain', auctionId: 'auction',
		fundingOperationId: 'operation', bidderActorId: 'a'.repeat(64), poolAmount: 100,
		activeKeysetId: 'keyset', proofStateRefs: ['proof-b', 'proof-a'],
		timing: { locktime: 500 }, closeState: { stateHeight: 10, stateAppHash: 'b'.repeat(64) },
		commits: [{}, {}, { height: 10, appHash: 'b'.repeat(64) }],
	} as never
	const template = {
		recipientPublicKey: 'recipient', templateDigest: 'c'.repeat(64), cashuSigAllDigest: 'd'.repeat(64),
	} as never
	const policy = {
		role: 'winner_settlement', network: 'network', chainId: 'chain', auctionId: 'auction',
		operationId: 'operation', bidId: 'operation', bidEventId: 'operation', bidderActorId: 'a'.repeat(64),
		outcomeHeight: 10, appStateHash: 'b'.repeat(64), amount: 100, locktime: 500,
		activeKeysetId: 'keyset', inputFeePpk: 0, recipientPublicKey: 'recipient',
		packageDigest: 'c'.repeat(64), cashuSigAllDigest: 'd'.repeat(64),
		deposits: [{ proofStateRef: 'proof-a' }, { proofStateRef: 'proof-b' }],
		certifiedClosure: { evidenceDigest: 'evidence' },
	} as never
	return { certificate, template, policy }
}

describe('integrated threshold close policy diagnostics', () => {
	test('accepts the exact policy regardless of proof reference order', () => {
		const value = fixture()
		expect(demoIntegratedClosePolicyMismatchFields(value.certificate, value.template, value.policy, 'evidence')).toEqual([])
		value.certificate.closeState = { stateHeight: 99, stateAppHash: 'f'.repeat(64) }
		expect(demoIntegratedClosePolicyMismatchFields(value.certificate, value.template, value.policy, 'evidence')).toEqual([])
	})

	test('reports only fixed mismatch categories and never field values', () => {
		const value = fixture()
		value.policy.activeKeysetId = 'private-keyset-value'
		value.policy.deposits = [{ proofStateRef: 'private-proof-value' }]
		const result = demoIntegratedClosePolicyMismatchFields(value.certificate, value.template, value.policy, 'evidence')
		expect(result).toEqual(['active_keyset', 'proof_refs'])
		expect(JSON.stringify(result)).not.toContain('private-keyset-value')
		expect(JSON.stringify(result)).not.toContain('private-proof-value')
	})
})
