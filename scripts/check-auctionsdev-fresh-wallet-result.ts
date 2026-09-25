import { createHash } from 'node:crypto'

export interface FreshAuctionsdevPreflightResult {
	schemaVersion: 1
	profile: 'FRESH_AUCTIONSDEV_TEST'
	verdict: 'FRESH_AUCTIONSDEV_READY'
	marketCommit: string
	environment: 'test'
	namespaceCommitment: string
	reportCommitment: string
}

export interface BoundFreshAuctionsdevPreflightEvidence {
	schemaVersion: 1
	profile: 'FRESH_AUCTIONSDEV_TEST_BOUND_V1'
	marketGitSha: string
	coreGitSha: string
	coreSha256: string
	indexedDbSha256: string
	checkout: {
		gitSha: string
		cleanBeforeStart: true
		producerCommand: 'bun run test:e2e:coco-auctionsdev-smoke'
		canonicalVerifierCommand: 'bun run preflight:auctionsdev:fresh-wallet <public-report.json>'
	}
	rawPublicReportSha256: string
	result: FreshAuctionsdevPreflightResult
	envelopeCommitment: string
}

const EXACT_FIELDS = [
	'schemaVersion',
	'profile',
	'verdict',
	'marketCommit',
	'environment',
	'namespaceCommitment',
	'reportCommitment',
] as const
const COMMITMENT_PATTERN = /^sha256:[0-9a-f]{64}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/

const readArg = (name: string): string | undefined => {
	const index = process.argv.indexOf(name)
	return index >= 0 ? process.argv[index + 1] : undefined
}

const requiredArg = (name: string): string => {
	const value = readArg(name)
	if (!value) throw new Error(`Missing required argument: ${name}`)
	return value
}

const assertExactFields = (value: Record<string, unknown>): void => {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...EXACT_FIELDS].sort())) {
		throw new Error('Canonical fresh-wallet result does not match schema version 1')
	}
}

const assertExactObjectFields = (value: Record<string, unknown>, fields: readonly string[], label: string): void => {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new Error(`${label} contains missing or unknown schema fields`)
	}
}

const canonicalJson = (value: unknown): string =>
	JSON.stringify(value, (_key, child) => {
		if (!child || typeof child !== 'object' || Array.isArray(child)) return child
		return Object.fromEntries(Object.entries(child as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
	})

export const createFreshEnvelopeCommitment = (payload: Omit<BoundFreshAuctionsdevPreflightEvidence, 'envelopeCommitment'>): string =>
	`sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`

export const validateFreshWalletPreflightResult = (value: unknown, marketGitSha: string): FreshAuctionsdevPreflightResult => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Canonical fresh-wallet result must be an object')
	}
	const result = value as Record<string, unknown>
	assertExactFields(result)
	if (result.schemaVersion !== 1 || result.profile !== 'FRESH_AUCTIONSDEV_TEST' || result.verdict !== 'FRESH_AUCTIONSDEV_READY') {
		throw new Error('Canonical fresh-wallet result must report FRESH_AUCTIONSDEV_READY under schema 1')
	}
	if (result.marketCommit !== marketGitSha) throw new Error('Canonical fresh-wallet result Market SHA mismatch')
	if (result.environment !== 'test') throw new Error('Canonical fresh-wallet result environment must be the isolated test environment')
	for (const field of ['namespaceCommitment', 'reportCommitment'] as const) {
		if (typeof result[field] !== 'string' || !COMMITMENT_PATTERN.test(result[field])) {
			throw new Error(`Canonical fresh-wallet result has an invalid ${field}`)
		}
	}
	return result as unknown as FreshAuctionsdevPreflightResult
}

export const parseFreshWalletPreflightOutput = (output: string, marketGitSha: string): FreshAuctionsdevPreflightResult => {
	const candidates: unknown[] = []
	for (const line of output.split(/\r?\n/)) {
		if (!line.trim().startsWith('{')) continue
		try {
			candidates.push(JSON.parse(line) as unknown)
		} catch {
			throw new Error('Canonical fresh-wallet command emitted malformed JSON')
		}
	}
	if (candidates.length !== 1) {
		throw new Error(`Expected exactly one canonical fresh-wallet JSON result, found ${candidates.length}`)
	}
	return validateFreshWalletPreflightResult(candidates[0], marketGitSha)
}

export const validateBoundFreshWalletPreflightEvidence = (
	value: unknown,
	expected: { marketGitSha: string; coreGitSha: string; coreSha256: string; indexedDbSha256: string },
): BoundFreshAuctionsdevPreflightEvidence => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Bound fresh-wallet evidence must be an object')
	const evidence = value as Record<string, unknown>
	assertExactObjectFields(
		evidence,
		[
			'schemaVersion',
			'profile',
			'marketGitSha',
			'coreGitSha',
			'coreSha256',
			'indexedDbSha256',
			'checkout',
			'rawPublicReportSha256',
			'result',
			'envelopeCommitment',
		],
		'Bound fresh-wallet evidence',
	)
	if (evidence.schemaVersion !== 1 || evidence.profile !== 'FRESH_AUCTIONSDEV_TEST_BOUND_V1') {
		throw new Error('Bound fresh-wallet evidence must use the supported schema/profile')
	}
	for (const [field, actual] of [
		['marketGitSha', evidence.marketGitSha],
		['coreGitSha', evidence.coreGitSha],
		['coreSha256', evidence.coreSha256],
		['indexedDbSha256', evidence.indexedDbSha256],
	] as const) {
		if (actual !== expected[field]) throw new Error(`Bound fresh-wallet evidence ${field} mismatch`)
	}
	const checkout = evidence.checkout
	if (!checkout || typeof checkout !== 'object' || Array.isArray(checkout))
		throw new Error('Bound fresh-wallet checkout evidence is required')
	const checkoutRecord = checkout as Record<string, unknown>
	assertExactObjectFields(
		checkoutRecord,
		['gitSha', 'cleanBeforeStart', 'producerCommand', 'canonicalVerifierCommand'],
		'Bound fresh-wallet checkout evidence',
	)
	if (
		checkoutRecord.gitSha !== expected.marketGitSha ||
		checkoutRecord.cleanBeforeStart !== true ||
		checkoutRecord.producerCommand !== 'bun run test:e2e:coco-auctionsdev-smoke' ||
		checkoutRecord.canonicalVerifierCommand !== 'bun run preflight:auctionsdev:fresh-wallet <public-report.json>'
	) {
		throw new Error('Bound fresh-wallet checkout/command evidence mismatch')
	}
	if (typeof evidence.rawPublicReportSha256 !== 'string' || !SHA256_PATTERN.test(evidence.rawPublicReportSha256)) {
		throw new Error('Bound fresh-wallet public report digest is invalid')
	}
	validateFreshWalletPreflightResult(evidence.result, expected.marketGitSha)
	const { envelopeCommitment, ...payload } = evidence
	if (typeof envelopeCommitment !== 'string' || envelopeCommitment !== createFreshEnvelopeCommitment(payload as never)) {
		throw new Error('Bound fresh-wallet envelope commitment mismatch')
	}
	return evidence as unknown as BoundFreshAuctionsdevPreflightEvidence
}

if (import.meta.main) {
	const marketGitSha = requiredArg('--market-sha')
	if (!/^[0-9a-f]{40}$/.test(marketGitSha)) throw new Error('market SHA must be 40 lowercase hexadecimal characters')
	const resultPath = readArg('--result')
	const logPath = readArg('--log')
	const writeResultPath = readArg('--write-result')
	if ((resultPath ? 1 : 0) + (logPath ? 1 : 0) !== 1) throw new Error('Exactly one of --result or --log is required')
	void (
		resultPath
			? Bun.file(resultPath)
					.json()
					.then((value) => validateFreshWalletPreflightResult(value as unknown, marketGitSha))
			: Bun.file(logPath as string)
					.text()
					.then((value) => parseFreshWalletPreflightOutput(value, marketGitSha))
	).then(async (result) => {
		const json = `${JSON.stringify(result)}\n`
		if (writeResultPath) await Bun.write(writeResultPath, json)
		console.log(json.trim())
	})
}
