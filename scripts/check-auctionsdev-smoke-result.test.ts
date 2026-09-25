import { describe, expect, test } from 'bun:test'
import {
	createSmokeEnvelopeCommitment,
	parseAuctionsdevSmokeOutput,
	validateAuctionsdevSmokeResult,
	validateBoundAuctionsdevSmokeEvidence,
} from './check-auctionsdev-smoke-result'

const marketGitSha = 'a'.repeat(40)
const coreGitSha = '9'.repeat(40)
const coreSha256 = 'b'.repeat(64)
const indexedDbSha256 = 'c'.repeat(64)
const validResult = {
	schemaVersion: 2,
	suite: 'coco-auctionsdev-smoke',
	status: 'passed',
	exitCode: 0,
	durationMs: 1234,
	mode: 'coco-v2',
	environmentId: 'local-e2e',
	monetaryMode: 'fake',
	baseUrl: 'http://localhost:34567',
	relayUrl: 'ws://localhost:10547',
	mintUrl: 'http://localhost:3338',
	publicRelayEffects: 0,
	realFundsEnabled: false,
	appServerColdStart: true,
	candidate: {
		marketCommit: marketGitSha,
		coreSha: coreGitSha,
		coreInstalledContentHash: `sha256:${coreSha256}`,
		indexeddbInstalledContentHash: `sha256:${indexedDbSha256}`,
	},
	checks: {
		create: true,
		fund: true,
		bidA: true,
		bidB: true,
		hardReloadRecovery: true,
		winnerRelease: true,
		sellerReceiveFinalized: true,
		settlement: true,
		loserOriginalSendRefund: true,
		conservation: true,
	},
	preflightReportPath: '.validation/fresh-auctionsdev-public-report.json',
} as const

describe('validateAuctionsdevSmokeResult', () => {
	test('accepts the exact canonical passed result', () => {
		expect(validateAuctionsdevSmokeResult(validResult)).toEqual(validResult)
	})

	test('rejects unknown result fields', () => {
		expect(() => validateAuctionsdevSmokeResult({ ...validResult, reason: 'unexpected' })).toThrow('unknown schema fields')
	})

	test('rejects public relay effects', () => {
		expect(() => validateAuctionsdevSmokeResult({ ...validResult, publicRelayEffects: 1 })).toThrow('zero public relay effects')
	})

	test('rejects incomplete lifecycle checks', () => {
		expect(() =>
			validateAuctionsdevSmokeResult({ ...validResult, checks: { ...validResult.checks, loserOriginalSendRefund: false } }),
		).toThrow('loserOriginalSendRefund')
	})

	test('rejects a preflight report outside the prepared checkout', () => {
		expect(() => validateAuctionsdevSmokeResult({ ...validResult, preflightReportPath: '/tmp/stale-report.json' })).toThrow(
			'inside the prepared checkout',
		)
	})
})

describe('parseAuctionsdevSmokeOutput', () => {
	test('extracts exactly one canonical result line from command output', () => {
		const output = `playwright output\nCOCO_AUCTIONSDEV_SMOKE_RESULT=${JSON.stringify(validResult)}\n`
		expect(parseAuctionsdevSmokeOutput(output)).toEqual(validResult)
	})

	test('rejects missing or duplicate result lines', () => {
		expect(() => parseAuctionsdevSmokeOutput('playwright output only')).toThrow('found 0')
		const line = `COCO_AUCTIONSDEV_SMOKE_RESULT=${JSON.stringify(validResult)}\n`
		expect(() => parseAuctionsdevSmokeOutput(line + line)).toThrow('found 2')
	})
})

describe('validateBoundAuctionsdevSmokeEvidence', () => {
	const payload = {
		schemaVersion: 1 as const,
		profile: 'COCO_AUCTIONSDEV_SMOKE_BOUND_V1' as const,
		marketGitSha,
		coreGitSha,
		coreSha256,
		indexedDbSha256,
		checkout: {
			gitSha: marketGitSha,
			cleanBeforeStart: true as const,
			appServerColdStarted: true as const,
			origin: 'http://localhost:34567' as const,
			canonicalCommand: 'bun run test:e2e:coco-auctionsdev-smoke' as const,
		},
		smoke: validResult,
	}
	const evidence = { ...payload, envelopeCommitment: createSmokeEnvelopeCommitment(payload) }

	test('accepts an exact committed checkout and installed-graph binding', () => {
		expect(validateBoundAuctionsdevSmokeEvidence(evidence, { marketGitSha, coreGitSha, coreSha256, indexedDbSha256 })).toEqual(evidence)
	})

	test('rejects stale Market or Core bindings', () => {
		expect(() =>
			validateBoundAuctionsdevSmokeEvidence(evidence, {
				marketGitSha: 'd'.repeat(40),
				coreGitSha,
				coreSha256,
				indexedDbSha256,
			}),
		).toThrow('marketGitSha mismatch')
		expect(() =>
			validateBoundAuctionsdevSmokeEvidence(evidence, {
				marketGitSha,
				coreGitSha,
				coreSha256: 'e'.repeat(64),
				indexedDbSha256,
			}),
		).toThrow('coreSha256 mismatch')
		expect(() =>
			validateBoundAuctionsdevSmokeEvidence(
				{
					...evidence,
					smoke: { ...evidence.smoke, candidate: { ...evidence.smoke.candidate, coreSha: '8'.repeat(40) } },
					envelopeCommitment: createSmokeEnvelopeCommitment({
						...payload,
						smoke: { ...payload.smoke, candidate: { ...payload.smoke.candidate, coreSha: '8'.repeat(40) } },
					}),
				},
				{ marketGitSha, coreGitSha, coreSha256, indexedDbSha256 },
			),
		).toThrow('candidate identity')
	})

	test('rejects a forged cold-start claim or envelope commitment', () => {
		expect(() =>
			validateBoundAuctionsdevSmokeEvidence(
				{ ...evidence, checkout: { ...evidence.checkout, appServerColdStarted: false } },
				{ marketGitSha, coreGitSha, coreSha256, indexedDbSha256 },
			),
		).toThrow('checkout/cold-start')
		expect(() =>
			validateBoundAuctionsdevSmokeEvidence(
				{ ...evidence, envelopeCommitment: `sha256:${'0'.repeat(64)}` },
				{ marketGitSha, coreGitSha, coreSha256, indexedDbSha256 },
			),
		).toThrow('envelope commitment')
	})
})
