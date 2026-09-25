import { describe, expect, test } from 'bun:test'
import {
	createFreshEnvelopeCommitment,
	parseFreshWalletPreflightOutput,
	validateBoundFreshWalletPreflightEvidence,
	validateFreshWalletPreflightResult,
} from './check-auctionsdev-fresh-wallet-result'

const marketGitSha = 'a'.repeat(40)
const coreGitSha = '9'.repeat(40)
const coreSha256 = 'd'.repeat(64)
const indexedDbSha256 = 'e'.repeat(64)
const validResult = {
	schemaVersion: 1,
	profile: 'FRESH_AUCTIONSDEV_TEST',
	verdict: 'FRESH_AUCTIONSDEV_READY',
	marketCommit: marketGitSha,
	environment: 'test',
	namespaceCommitment: `sha256:${'b'.repeat(64)}`,
	reportCommitment: `sha256:${'c'.repeat(64)}`,
} as const

describe('validateFreshWalletPreflightResult', () => {
	test('accepts the exact canonical output envelope', () => {
		expect(validateFreshWalletPreflightResult(validResult, marketGitSha)).toEqual(validResult)
	})

	test('rejects unknown fields', () => {
		expect(() => validateFreshWalletPreflightResult({ ...validResult, extra: true }, marketGitSha)).toThrow(
			'does not match schema version 1',
		)
	})

	test('rejects a result bound to another Market commit', () => {
		expect(() => validateFreshWalletPreflightResult(validResult, 'd'.repeat(40))).toThrow('Market SHA mismatch')
	})

	test('rejects a blocked or unknown verdict', () => {
		expect(() => validateFreshWalletPreflightResult({ ...validResult, verdict: 'FRESH_AUCTIONSDEV_BLOCKED' }, marketGitSha)).toThrow(
			'FRESH_AUCTIONSDEV_READY',
		)
	})

	test('extracts exactly one result from canonical command output', () => {
		expect(parseFreshWalletPreflightOutput(`$ bun run verifier\n${JSON.stringify(validResult)}\n`, marketGitSha)).toEqual(validResult)
		expect(() => parseFreshWalletPreflightOutput('', marketGitSha)).toThrow('found 0')
		expect(() => parseFreshWalletPreflightOutput(`${JSON.stringify(validResult)}\n${JSON.stringify(validResult)}\n`, marketGitSha)).toThrow(
			'found 2',
		)
	})
})

describe('validateBoundFreshWalletPreflightEvidence', () => {
	const payload = {
		schemaVersion: 1 as const,
		profile: 'FRESH_AUCTIONSDEV_TEST_BOUND_V1' as const,
		marketGitSha,
		coreGitSha,
		coreSha256,
		indexedDbSha256,
		checkout: {
			gitSha: marketGitSha,
			cleanBeforeStart: true as const,
			producerCommand: 'bun run test:e2e:coco-auctionsdev-smoke' as const,
			canonicalVerifierCommand: 'bun run preflight:auctionsdev:fresh-wallet <public-report.json>' as const,
		},
		rawPublicReportSha256: 'f'.repeat(64),
		result: validResult,
	}
	const evidence = { ...payload, envelopeCommitment: createFreshEnvelopeCommitment(payload) }

	test('accepts evidence bound to the exact checkout, artifacts, producer and verifier', () => {
		expect(validateBoundFreshWalletPreflightEvidence(evidence, { marketGitSha, coreGitSha, coreSha256, indexedDbSha256 })).toEqual(evidence)
	})

	test('rejects stale Market and installed artifact bindings', () => {
		expect(() =>
			validateBoundFreshWalletPreflightEvidence(evidence, {
				marketGitSha: '0'.repeat(40),
				coreGitSha,
				coreSha256,
				indexedDbSha256,
			}),
		).toThrow('marketGitSha mismatch')
		expect(() =>
			validateBoundFreshWalletPreflightEvidence(evidence, {
				marketGitSha,
				coreGitSha,
				coreSha256: '1'.repeat(64),
				indexedDbSha256,
			}),
		).toThrow('coreSha256 mismatch')
	})

	test('rejects a verifier-only wrapper claim and an uncommitted envelope', () => {
		expect(() =>
			validateBoundFreshWalletPreflightEvidence(
				{ ...evidence, checkout: { ...evidence.checkout, producerCommand: 'bun run preflight:auctionsdev:fresh-wallet' } },
				{ marketGitSha, coreGitSha, coreSha256, indexedDbSha256 },
			),
		).toThrow('checkout/command')
		expect(() =>
			validateBoundFreshWalletPreflightEvidence(
				{ ...evidence, envelopeCommitment: `sha256:${'0'.repeat(64)}` },
				{ marketGitSha, coreGitSha, coreSha256, indexedDbSha256 },
			),
		).toThrow('envelope commitment')
	})
})
