export interface DeploymentIdentity {
	marketGitSha: string
	marketGitTree: string
	cocoPackageIdentity: string
	cocoCoreGitSha: string
	cocoCoreArchiveSha256: string
	cocoCoreSha256: string
	cocoIndexedDbArchiveSha256: string
	cocoIndexedDbSha256: string
	cashuTsVersion: '5.0.0-rc.4'
	cashuTsSha256: string
	fakeMintVersion: string
	environment: 'auctionsdev'
	monetaryMode: 'coco-test'
	mintMode: 'fake'
	realFundsEnabled: false
	bunVersion: string
	freshAuctionsdevTest: {
		sha256: string
		envelopeCommitment: string
		evidenceEnvironment: 'test'
		verdict: 'FRESH_AUCTIONSDEV_READY'
		namespaceCommitment: string
		reportCommitment: string
	}
	cocoAuctionsdevSmoke: {
		sha256: string
		envelopeCommitment: string
		schemaVersion: 2
		suite: 'coco-auctionsdev-smoke'
		status: 'passed'
		appServerColdStart: true
		checksPassed: 10
		publicRelayEffects: 0
		realFundsEnabled: false
	}
}

const DEPLOYMENT_ENV_KEYS = [
	'APP_DEPLOYMENT_ENVIRONMENT',
	'APP_MARKET_GIT_SHA',
	'APP_MARKET_GIT_TREE',
	'APP_COCO_PACKAGE_IDENTITY',
	'APP_COCO_CORE_GIT_SHA',
	'APP_COCO_CORE_ARCHIVE_SHA256',
	'APP_COCO_CORE_SHA256',
	'APP_COCO_INDEXEDDB_ARCHIVE_SHA256',
	'APP_COCO_INDEXEDDB_SHA256',
	'APP_CASHU_TS_VERSION',
	'APP_CASHU_TS_SHA256',
	'APP_FAKE_MINT_VERSION',
	'APP_BUN_VERSION',
	'APP_MONETARY_MODE',
	'APP_MINT_MODE',
	'APP_REAL_FUNDS_ENABLED',
	'APP_FRESH_AUCTIONSDEV_TEST_SHA256',
	'APP_FRESH_AUCTIONSDEV_TEST_VERDICT',
	'APP_FRESH_ENVELOPE_COMMITMENT',
	'APP_FRESH_EVIDENCE_ENVIRONMENT',
	'APP_FRESH_NAMESPACE_COMMITMENT',
	'APP_FRESH_REPORT_COMMITMENT',
	'APP_COCO_AUCTIONSDEV_SMOKE_SHA256',
	'APP_COCO_AUCTIONSDEV_SMOKE_STATUS',
	'APP_COCO_AUCTIONSDEV_SMOKE_ENVELOPE_COMMITMENT',
	'APP_COCO_AUCTIONSDEV_SMOKE_SCHEMA_VERSION',
	'APP_COCO_AUCTIONSDEV_SMOKE_COLD_START',
	'APP_COCO_AUCTIONSDEV_SMOKE_CHECKS_PASSED',
] as const

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const COMMITMENT_PATTERN = /^sha256:[0-9a-f]{64}$/

/**
 * Return non-secret, read-only deployment diagnostics when the deployment
 * contract is configured. Local development and existing environments omit
 * the object; a partially configured contract fails closed at server startup.
 */
export function resolveDeploymentIdentity(env: NodeJS.ProcessEnv = process.env): DeploymentIdentity | undefined {
	if (DEPLOYMENT_ENV_KEYS.every((key) => env[key] === undefined)) return undefined

	const required = (key: (typeof DEPLOYMENT_ENV_KEYS)[number]): string => {
		const value = env[key]
		if (!value) throw new Error(`Incomplete deployment identity: ${key} is required`)
		return value
	}

	const environment = required('APP_DEPLOYMENT_ENVIRONMENT')
	const marketGitSha = required('APP_MARKET_GIT_SHA')
	const marketGitTree = required('APP_MARKET_GIT_TREE')
	const cocoPackageIdentity = required('APP_COCO_PACKAGE_IDENTITY')
	const cocoCoreGitSha = required('APP_COCO_CORE_GIT_SHA')
	const cocoCoreArchiveSha256 = required('APP_COCO_CORE_ARCHIVE_SHA256')
	const cocoCoreSha256 = required('APP_COCO_CORE_SHA256')
	const cocoIndexedDbArchiveSha256 = required('APP_COCO_INDEXEDDB_ARCHIVE_SHA256')
	const cocoIndexedDbSha256 = required('APP_COCO_INDEXEDDB_SHA256')
	const cashuTsVersion = required('APP_CASHU_TS_VERSION')
	const cashuTsSha256 = required('APP_CASHU_TS_SHA256')
	const fakeMintVersion = required('APP_FAKE_MINT_VERSION')
	const bunVersion = required('APP_BUN_VERSION')
	const monetaryMode = required('APP_MONETARY_MODE')
	const mintMode = required('APP_MINT_MODE')
	const realFundsEnabled = required('APP_REAL_FUNDS_ENABLED')
	const freshTestSha256 = required('APP_FRESH_AUCTIONSDEV_TEST_SHA256')
	const freshTestVerdict = required('APP_FRESH_AUCTIONSDEV_TEST_VERDICT')
	const freshEnvelopeCommitment = required('APP_FRESH_ENVELOPE_COMMITMENT')
	const freshEvidenceEnvironment = required('APP_FRESH_EVIDENCE_ENVIRONMENT')
	const freshNamespaceCommitment = required('APP_FRESH_NAMESPACE_COMMITMENT')
	const freshReportCommitment = required('APP_FRESH_REPORT_COMMITMENT')
	const smokeSha256 = required('APP_COCO_AUCTIONSDEV_SMOKE_SHA256')
	const smokeStatus = required('APP_COCO_AUCTIONSDEV_SMOKE_STATUS')
	const smokeEnvelopeCommitment = required('APP_COCO_AUCTIONSDEV_SMOKE_ENVELOPE_COMMITMENT')
	const smokeSchemaVersion = required('APP_COCO_AUCTIONSDEV_SMOKE_SCHEMA_VERSION')
	const smokeColdStart = required('APP_COCO_AUCTIONSDEV_SMOKE_COLD_START')
	const smokeChecksPassed = required('APP_COCO_AUCTIONSDEV_SMOKE_CHECKS_PASSED')

	if (environment !== 'auctionsdev') throw new Error(`Unsupported deployment environment: ${environment}`)
	if (!/^[0-9a-f]{40}$/.test(marketGitSha)) throw new Error('APP_MARKET_GIT_SHA must be a full lowercase Git SHA')
	if (!/^[0-9a-f]{40}$/.test(marketGitTree)) throw new Error('APP_MARKET_GIT_TREE must be a full lowercase Git tree')
	if (!cocoPackageIdentity.includes('@cashu/coco-core@') || !cocoPackageIdentity.includes('@cashu/coco-indexeddb@')) {
		throw new Error('APP_COCO_PACKAGE_IDENTITY is not a complete current Coco runtime identity')
	}
	if (!/^[0-9a-f]{40}$/.test(cocoCoreGitSha)) throw new Error('APP_COCO_CORE_GIT_SHA must be a full lowercase Git SHA')
	for (const [name, digest] of [
		['APP_COCO_CORE_ARCHIVE_SHA256', cocoCoreArchiveSha256],
		['APP_COCO_CORE_SHA256', cocoCoreSha256],
		['APP_COCO_INDEXEDDB_ARCHIVE_SHA256', cocoIndexedDbArchiveSha256],
		['APP_COCO_INDEXEDDB_SHA256', cocoIndexedDbSha256],
		['APP_CASHU_TS_SHA256', cashuTsSha256],
		['APP_FRESH_AUCTIONSDEV_TEST_SHA256', freshTestSha256],
		['APP_COCO_AUCTIONSDEV_SMOKE_SHA256', smokeSha256],
	] as const) {
		if (!SHA256_PATTERN.test(digest)) throw new Error(`${name} must be a lowercase SHA-256 digest`)
	}
	if (cashuTsVersion !== '5.0.0-rc.4') throw new Error(`Unsupported Cashu runtime: ${cashuTsVersion}`)
	if (monetaryMode !== 'coco-test') throw new Error(`Unsupported AuctionsDev monetary mode: ${monetaryMode}`)
	if (mintMode !== 'fake') throw new Error(`Unsupported AuctionsDev mint mode: ${mintMode}`)
	if (realFundsEnabled !== 'false') throw new Error('Real funds must be disabled for the AuctionsDev Coco deployment')
	if (freshTestVerdict !== 'FRESH_AUCTIONSDEV_READY') throw new Error('Canonical fresh-wallet preflight is not ready')
	if (freshEvidenceEnvironment !== 'test') throw new Error('Fresh-wallet evidence must come from the isolated test environment')
	if (
		!COMMITMENT_PATTERN.test(freshEnvelopeCommitment) ||
		!COMMITMENT_PATTERN.test(freshNamespaceCommitment) ||
		!COMMITMENT_PATTERN.test(freshReportCommitment) ||
		!COMMITMENT_PATTERN.test(smokeEnvelopeCommitment)
	) {
		throw new Error('Canonical fresh-wallet commitments are invalid')
	}
	if (smokeStatus !== 'passed') throw new Error('Canonical Coco AuctionsDev smoke did not pass')
	if (smokeSchemaVersion !== '2' || smokeColdStart !== 'true' || smokeChecksPassed !== '10') {
		throw new Error('Canonical Coco AuctionsDev smoke contract is incomplete')
	}

	return {
		marketGitSha,
		marketGitTree,
		cocoPackageIdentity,
		cocoCoreGitSha,
		cocoCoreArchiveSha256,
		cocoCoreSha256,
		cocoIndexedDbArchiveSha256,
		cocoIndexedDbSha256,
		cashuTsVersion: '5.0.0-rc.4',
		cashuTsSha256,
		fakeMintVersion,
		environment,
		monetaryMode,
		mintMode,
		realFundsEnabled: false,
		bunVersion,
		freshAuctionsdevTest: {
			sha256: freshTestSha256,
			envelopeCommitment: freshEnvelopeCommitment,
			evidenceEnvironment: 'test',
			verdict: 'FRESH_AUCTIONSDEV_READY',
			namespaceCommitment: freshNamespaceCommitment,
			reportCommitment: freshReportCommitment,
		},
		cocoAuctionsdevSmoke: {
			sha256: smokeSha256,
			envelopeCommitment: smokeEnvelopeCommitment,
			schemaVersion: 2,
			suite: 'coco-auctionsdev-smoke',
			status: 'passed',
			appServerColdStart: true,
			checksPassed: 10,
			publicRelayEffects: 0,
			realFundsEnabled: false,
		},
	}
}
