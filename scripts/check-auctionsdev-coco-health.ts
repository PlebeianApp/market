interface DeploymentIdentity {
	marketGitSha?: string
	marketGitTree?: string
	cocoPackageIdentity?: string
	cocoCoreGitSha?: string
	cocoCoreArchiveSha256?: string
	cocoCoreSha256?: string
	cocoIndexedDbArchiveSha256?: string
	cocoIndexedDbSha256?: string
	cashuTsVersion?: string
	cashuTsSha256?: string
	fakeMintVersion?: string
	environment?: string
	monetaryMode?: string
	mintMode?: string
	realFundsEnabled?: boolean
	bunVersion?: string
	freshAuctionsdevTest?: {
		sha256?: string
		envelopeCommitment?: string
		evidenceEnvironment?: string
		verdict?: string
		namespaceCommitment?: string
		reportCommitment?: string
	}
	cocoAuctionsdevSmoke?: {
		sha256?: string
		envelopeCommitment?: string
		schemaVersion?: number
		suite?: string
		status?: string
		appServerColdStart?: boolean
		checksPassed?: number
		publicRelayEffects?: number
		realFundsEnabled?: boolean
	}
}

interface HealthConfig {
	stage?: string
	deployment?: DeploymentIdentity
}

interface MintInfo {
	nuts?: Record<string, unknown>
}

const readArg = (name: string): string | undefined => {
	const index = process.argv.indexOf(name)
	return index >= 0 ? process.argv[index + 1] : undefined
}

const requiredArg = (name: string): string => {
	const value = readArg(name)
	if (!value) throw new Error(`Missing required argument: ${name}`)
	return value
}

const origin = requiredArg('--origin').replace(/\/$/, '')
const mintUrl = (readArg('--mint-url') ?? `${origin}/fake-mint`).replace(/\/$/, '')
const expectedIdentity: DeploymentIdentity = {
	marketGitSha: requiredArg('--market-sha'),
	marketGitTree: requiredArg('--market-tree'),
	cocoPackageIdentity: requiredArg('--coco-identity'),
	cocoCoreGitSha: requiredArg('--core-git-sha'),
	cocoCoreArchiveSha256: requiredArg('--core-archive-sha256'),
	cocoCoreSha256: requiredArg('--core-sha256'),
	cocoIndexedDbArchiveSha256: requiredArg('--indexeddb-archive-sha256'),
	cocoIndexedDbSha256: requiredArg('--indexeddb-sha256'),
	cashuTsVersion: '5.0.0-rc.4',
	cashuTsSha256: requiredArg('--cashu-ts-sha256'),
	fakeMintVersion: requiredArg('--fake-mint-version'),
	environment: 'auctionsdev',
	monetaryMode: 'coco-test',
	mintMode: 'fake',
	realFundsEnabled: false,
	bunVersion: requiredArg('--bun-version'),
	freshAuctionsdevTest: {
		sha256: requiredArg('--fresh-test-sha256'),
		envelopeCommitment: requiredArg('--fresh-envelope-commitment'),
		evidenceEnvironment: 'test',
		verdict: 'FRESH_AUCTIONSDEV_READY',
		namespaceCommitment: requiredArg('--fresh-namespace-commitment'),
		reportCommitment: requiredArg('--fresh-report-commitment'),
	},
	cocoAuctionsdevSmoke: {
		sha256: requiredArg('--smoke-result-sha256'),
		envelopeCommitment: requiredArg('--smoke-envelope-commitment'),
		schemaVersion: 2,
		suite: 'coco-auctionsdev-smoke',
		status: 'passed',
		appServerColdStart: true,
		checksPassed: 10,
		publicRelayEffects: 0,
		realFundsEnabled: false,
	},
}

const fetchJson = async <T>(url: string): Promise<T> => {
	const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
	if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
	return (await response.json()) as T
}

const canonicalJson = (value: unknown): string =>
	JSON.stringify(value, (_key, child) => {
		if (!child || typeof child !== 'object' || Array.isArray(child)) return child
		return Object.fromEntries(Object.entries(child as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
	})

const main = async (): Promise<void> => {
	const config = await fetchJson<HealthConfig>(`${origin}/api/config`)
	if (config.stage !== 'staging') throw new Error(`stage mismatch: expected staging, got ${config.stage ?? 'missing'}`)
	if (canonicalJson(config.deployment) !== canonicalJson(expectedIdentity)) {
		throw new Error(
			`browser-visible deployment identity mismatch: expected ${JSON.stringify(expectedIdentity)}, got ${JSON.stringify(config.deployment)}`,
		)
	}

	const mintInfo = await fetchJson<MintInfo>(`${mintUrl}/v1/info`)
	for (const nut of ['4', '7', '11']) {
		if (!mintInfo.nuts || !(nut in mintInfo.nuts)) throw new Error(`fake mint does not advertise required NUT-${nut}`)
	}

	console.log(
		JSON.stringify({
			status: 'healthy',
			stage: config.stage,
			deployment: config.deployment,
			fakeMintRequiredNuts: [4, 7, 11],
		}),
	)
}

void main()

export {}
