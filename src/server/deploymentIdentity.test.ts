import { describe, expect, test } from 'bun:test'
import { resolveDeploymentIdentity } from './deploymentIdentity'

const sha256 = 'b'.repeat(64)
const validEnvironment = {
	APP_DEPLOYMENT_ENVIRONMENT: 'auctionsdev',
	APP_MARKET_GIT_SHA: 'a'.repeat(40),
	APP_MARKET_GIT_TREE: 'd'.repeat(40),
	APP_COCO_PACKAGE_IDENTITY:
		'@cashu/coco-core@2.0.0#sha256:' +
		sha256 +
		';@cashu/coco-indexeddb@2.0.0#sha256:' +
		sha256 +
		';@cashu/cashu-ts@5.0.0-rc.4#sha256:' +
		sha256,
	APP_COCO_CORE_GIT_SHA: 'c'.repeat(40),
	APP_COCO_CORE_ARCHIVE_SHA256: sha256,
	APP_COCO_CORE_SHA256: sha256,
	APP_COCO_INDEXEDDB_ARCHIVE_SHA256: sha256,
	APP_COCO_INDEXEDDB_SHA256: sha256,
	APP_CASHU_TS_VERSION: '5.0.0-rc.4',
	APP_CASHU_TS_SHA256: sha256,
	APP_FAKE_MINT_VERSION: '0.17.0-rc.0',
	APP_BUN_VERSION: '1.4.2',
	APP_MONETARY_MODE: 'coco-test',
	APP_MINT_MODE: 'fake',
	APP_REAL_FUNDS_ENABLED: 'false',
	APP_FRESH_AUCTIONSDEV_TEST_SHA256: sha256,
	APP_FRESH_AUCTIONSDEV_TEST_VERDICT: 'FRESH_AUCTIONSDEV_READY',
	APP_FRESH_ENVELOPE_COMMITMENT: `sha256:${sha256}`,
	APP_FRESH_EVIDENCE_ENVIRONMENT: 'test',
	APP_FRESH_NAMESPACE_COMMITMENT: `sha256:${sha256}`,
	APP_FRESH_REPORT_COMMITMENT: `sha256:${sha256}`,
	APP_COCO_AUCTIONSDEV_SMOKE_SHA256: sha256,
	APP_COCO_AUCTIONSDEV_SMOKE_STATUS: 'passed',
	APP_COCO_AUCTIONSDEV_SMOKE_ENVELOPE_COMMITMENT: `sha256:${sha256}`,
	APP_COCO_AUCTIONSDEV_SMOKE_SCHEMA_VERSION: '2',
	APP_COCO_AUCTIONSDEV_SMOKE_COLD_START: 'true',
	APP_COCO_AUCTIONSDEV_SMOKE_CHECKS_PASSED: '10',
}

describe('resolveDeploymentIdentity', () => {
	test('is absent outside a configured deployment', () => {
		expect(resolveDeploymentIdentity({})).toBeUndefined()
	})

	test('exposes only the non-secret deployment contract', () => {
		expect(resolveDeploymentIdentity(validEnvironment)).toEqual({
			marketGitSha: 'a'.repeat(40),
			marketGitTree: 'd'.repeat(40),
			cocoPackageIdentity: validEnvironment.APP_COCO_PACKAGE_IDENTITY,
			cocoCoreGitSha: 'c'.repeat(40),
			cocoCoreArchiveSha256: sha256,
			cocoCoreSha256: sha256,
			cocoIndexedDbArchiveSha256: sha256,
			cocoIndexedDbSha256: sha256,
			cashuTsVersion: '5.0.0-rc.4',
			cashuTsSha256: sha256,
			fakeMintVersion: '0.17.0-rc.0',
			environment: 'auctionsdev',
			monetaryMode: 'coco-test',
			mintMode: 'fake',
			realFundsEnabled: false,
			bunVersion: '1.4.2',
			freshAuctionsdevTest: {
				sha256,
				envelopeCommitment: `sha256:${sha256}`,
				evidenceEnvironment: 'test',
				verdict: 'FRESH_AUCTIONSDEV_READY',
				namespaceCommitment: `sha256:${sha256}`,
				reportCommitment: `sha256:${sha256}`,
			},
			cocoAuctionsdevSmoke: {
				sha256,
				envelopeCommitment: `sha256:${sha256}`,
				schemaVersion: 2,
				suite: 'coco-auctionsdev-smoke',
				status: 'passed',
				appServerColdStart: true,
				checksPassed: 10,
				publicRelayEffects: 0,
				realFundsEnabled: false,
			},
		})
	})

	test('fails closed when real funds are enabled', () => {
		expect(() => resolveDeploymentIdentity({ ...validEnvironment, APP_REAL_FUNDS_ENABLED: 'true' })).toThrow('Real funds must be disabled')
	})

	test('fails closed on the wrong Cashu runtime', () => {
		expect(() => resolveDeploymentIdentity({ ...validEnvironment, APP_CASHU_TS_VERSION: '3.7.1' })).toThrow('Unsupported Cashu runtime')
	})

	test('fails closed on stale fresh-wallet evidence', () => {
		expect(() => resolveDeploymentIdentity({ ...validEnvironment, APP_FRESH_AUCTIONSDEV_TEST_VERDICT: 'UNKNOWN' })).toThrow(
			'fresh-wallet preflight is not ready',
		)
	})

	test('fails closed when smoke evidence is not a schema-v2 ten-check cold start', () => {
		expect(() => resolveDeploymentIdentity({ ...validEnvironment, APP_COCO_AUCTIONSDEV_SMOKE_COLD_START: 'false' })).toThrow(
			'smoke contract is incomplete',
		)
	})

	test('fails closed on incomplete identity', () => {
		expect(() => resolveDeploymentIdentity({ APP_DEPLOYMENT_ENVIRONMENT: 'auctionsdev' })).toThrow('APP_MARKET_GIT_SHA is required')
	})
})
