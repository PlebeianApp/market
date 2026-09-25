import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import path from 'node:path'

const RESULT_PREFIX = 'COCO_AUCTIONSDEV_SMOKE_RESULT='
const CHECK_NAMES = [
	'create',
	'fund',
	'bidA',
	'bidB',
	'hardReloadRecovery',
	'winnerRelease',
	'sellerReceiveFinalized',
	'settlement',
	'loserOriginalSendRefund',
	'conservation',
] as const
const EXACT_FIELDS = [
	'schemaVersion',
	'suite',
	'status',
	'exitCode',
	'durationMs',
	'mode',
	'environmentId',
	'monetaryMode',
	'baseUrl',
	'relayUrl',
	'mintUrl',
	'publicRelayEffects',
	'realFundsEnabled',
	'appServerColdStart',
	'candidate',
	'checks',
	'preflightReportPath',
] as const

export interface CocoAuctionsdevSmokeResult {
	schemaVersion: 2
	suite: 'coco-auctionsdev-smoke'
	status: 'passed'
	exitCode: 0
	durationMs: number
	mode: 'coco-v2'
	environmentId: 'test'
	monetaryMode: 'fake'
	baseUrl: 'http://localhost:34567'
	relayUrl: 'ws://localhost:10547'
	mintUrl: 'http://localhost:3338'
	publicRelayEffects: 0
	realFundsEnabled: false
	appServerColdStart: true
	candidate: {
		marketCommit: string
		coreSha: string
		coreInstalledContentHash: string
		indexeddbInstalledContentHash: string
	}
	checks: Record<(typeof CHECK_NAMES)[number], true>
	preflightReportPath: string
}

export interface BoundCocoAuctionsdevSmokeEvidence {
	schemaVersion: 1
	profile: 'COCO_AUCTIONSDEV_SMOKE_BOUND_V1'
	marketGitSha: string
	coreGitSha: string
	coreSha256: string
	indexedDbSha256: string
	checkout: {
		gitSha: string
		cleanBeforeStart: true
		appServerColdStarted: true
		origin: 'http://localhost:34567'
		canonicalCommand: 'bun run test:e2e:coco-auctionsdev-smoke'
	}
	smoke: CocoAuctionsdevSmokeResult
	envelopeCommitment: string
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

const assertExactFields = (value: Record<string, unknown>, fields: readonly string[], label: string): void => {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new Error(`${label} contains missing or unknown schema fields`)
	}
}

const canonicalJson = (value: unknown): string =>
	JSON.stringify(value, (_key, child) => {
		if (!child || typeof child !== 'object' || Array.isArray(child)) return child
		return Object.fromEntries(Object.entries(child as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
	})

export const createSmokeEnvelopeCommitment = (payload: Omit<BoundCocoAuctionsdevSmokeEvidence, 'envelopeCommitment'>): string =>
	`sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`

const isStrictDescendant = (root: string, candidate: string): boolean => {
	const relative = path.relative(root, candidate)
	return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export const resolveCheckoutContainedReportPath = async (checkoutRoot: string, reportPath: string): Promise<string> => {
	if (typeof reportPath !== 'string' || reportPath.trim() === '' || reportPath.includes('\0')) {
		throw new Error('Smoke fresh-wallet preflight report path is invalid')
	}
	if (reportPath.split(/[\\/]+/).includes('..')) {
		throw new Error('Smoke fresh-wallet preflight report path contains traversal')
	}

	const realCheckoutRoot = await realpath(checkoutRoot)
	const lexicalReportPath = path.isAbsolute(reportPath) ? path.resolve(reportPath) : path.resolve(realCheckoutRoot, reportPath)
	if (!isStrictDescendant(realCheckoutRoot, lexicalReportPath)) {
		throw new Error('Smoke fresh-wallet preflight report path escapes the prepared checkout')
	}

	const realReportPath = await realpath(lexicalReportPath)
	if (!isStrictDescendant(realCheckoutRoot, realReportPath)) {
		throw new Error('Smoke fresh-wallet preflight report real path escapes the prepared checkout')
	}
	return realReportPath
}

export const validateAuctionsdevSmokeResult = (value: unknown): CocoAuctionsdevSmokeResult => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Smoke result must be an object')
	const result = value as Record<string, unknown>
	assertExactFields(result, EXACT_FIELDS, 'Smoke result')
	if (result.schemaVersion !== 2 || result.suite !== 'coco-auctionsdev-smoke' || result.status !== 'passed' || result.exitCode !== 0) {
		throw new Error('Smoke result must use schema 2 and report a zero-exit passed suite')
	}
	if (!Number.isSafeInteger(result.durationMs) || (result.durationMs as number) < 0) {
		throw new Error('Smoke duration must be a non-negative safe integer')
	}
	if (result.mode !== 'coco-v2' || result.environmentId !== 'test' || result.monetaryMode !== 'fake') {
		throw new Error('Smoke must use the sealed Coco v2 local fake-money mode')
	}
	if (
		result.baseUrl !== 'http://localhost:34567' ||
		result.relayUrl !== 'ws://localhost:10547' ||
		result.mintUrl !== 'http://localhost:3338'
	) {
		throw new Error('Smoke endpoints must match the fixed localhost contract')
	}
	if (result.publicRelayEffects !== 0 || result.realFundsEnabled !== false) {
		throw new Error('Smoke must use no real funds and produce zero public relay effects')
	}
	if (result.appServerColdStart !== true) throw new Error('Smoke result must attest a cold-started app server')
	if (!result.candidate || typeof result.candidate !== 'object' || Array.isArray(result.candidate)) {
		throw new Error('Smoke candidate identity is required')
	}
	const candidate = result.candidate as Record<string, unknown>
	assertExactFields(
		candidate,
		['marketCommit', 'coreSha', 'coreInstalledContentHash', 'indexeddbInstalledContentHash'],
		'Smoke candidate identity',
	)
	if (!/^[0-9a-f]{40}$/.test(String(candidate.marketCommit)) || !/^[0-9a-f]{40}$/.test(String(candidate.coreSha))) {
		throw new Error('Smoke candidate Git identities are invalid')
	}
	for (const field of ['coreInstalledContentHash', 'indexeddbInstalledContentHash'] as const) {
		if (!/^sha256:[0-9a-f]{64}$/.test(String(candidate[field]))) throw new Error(`Smoke candidate ${field} is invalid`)
	}
	if (
		typeof result.preflightReportPath !== 'string' ||
		result.preflightReportPath.trim() === '' ||
		result.preflightReportPath.includes('\0')
	) {
		throw new Error('Smoke result must identify its strict fresh-wallet preflight report')
	}
	if (!result.checks || typeof result.checks !== 'object' || Array.isArray(result.checks)) {
		throw new Error('Smoke checks must be an object')
	}
	const checks = result.checks as Record<string, unknown>
	assertExactFields(checks, CHECK_NAMES, 'Smoke checks')
	for (const check of CHECK_NAMES) {
		if (checks[check] !== true) throw new Error(`Smoke check did not pass: ${check}`)
	}
	return result as unknown as CocoAuctionsdevSmokeResult
}

export const parseAuctionsdevSmokeOutput = (output: string): CocoAuctionsdevSmokeResult => {
	const lines = output.split(/\r?\n/).filter((line) => line.startsWith(RESULT_PREFIX))
	if (lines.length !== 1) throw new Error(`Expected exactly one ${RESULT_PREFIX}<json> line, found ${lines.length}`)
	let parsed: unknown
	try {
		parsed = JSON.parse(lines[0].slice(RESULT_PREFIX.length)) as unknown
	} catch {
		throw new Error('Smoke result line does not contain valid JSON')
	}
	return validateAuctionsdevSmokeResult(parsed)
}

export const validateBoundAuctionsdevSmokeEvidence = (
	value: unknown,
	expected: { marketGitSha: string; coreGitSha: string; coreSha256: string; indexedDbSha256: string },
): BoundCocoAuctionsdevSmokeEvidence => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Bound smoke evidence must be an object')
	const evidence = value as Record<string, unknown>
	assertExactFields(
		evidence,
		['schemaVersion', 'profile', 'marketGitSha', 'coreGitSha', 'coreSha256', 'indexedDbSha256', 'checkout', 'smoke', 'envelopeCommitment'],
		'Bound smoke evidence',
	)
	if (evidence.schemaVersion !== 1 || evidence.profile !== 'COCO_AUCTIONSDEV_SMOKE_BOUND_V1') {
		throw new Error('Bound smoke evidence must use the supported schema/profile')
	}
	for (const [field, actual] of [
		['marketGitSha', evidence.marketGitSha],
		['coreGitSha', evidence.coreGitSha],
		['coreSha256', evidence.coreSha256],
		['indexedDbSha256', evidence.indexedDbSha256],
	] as const) {
		if (actual !== expected[field]) throw new Error(`Bound smoke evidence ${field} mismatch`)
	}
	const checkout = evidence.checkout
	if (!checkout || typeof checkout !== 'object' || Array.isArray(checkout)) throw new Error('Bound smoke checkout evidence is required')
	const checkoutRecord = checkout as Record<string, unknown>
	assertExactFields(
		checkoutRecord,
		['gitSha', 'cleanBeforeStart', 'appServerColdStarted', 'origin', 'canonicalCommand'],
		'Bound smoke checkout evidence',
	)
	if (
		checkoutRecord.gitSha !== expected.marketGitSha ||
		checkoutRecord.cleanBeforeStart !== true ||
		checkoutRecord.appServerColdStarted !== true ||
		checkoutRecord.origin !== 'http://localhost:34567' ||
		checkoutRecord.canonicalCommand !== 'bun run test:e2e:coco-auctionsdev-smoke'
	) {
		throw new Error('Bound smoke checkout/cold-start evidence mismatch')
	}
	const smoke = validateAuctionsdevSmokeResult(evidence.smoke)
	if (
		smoke.candidate.marketCommit !== expected.marketGitSha ||
		smoke.candidate.coreSha !== expected.coreGitSha ||
		smoke.candidate.coreInstalledContentHash !== `sha256:${expected.coreSha256}` ||
		smoke.candidate.indexeddbInstalledContentHash !== `sha256:${expected.indexedDbSha256}`
	) {
		throw new Error('Canonical smoke candidate identity does not match the prepared checkout and installed graph')
	}
	const { envelopeCommitment, ...payload } = evidence
	if (typeof envelopeCommitment !== 'string' || envelopeCommitment !== createSmokeEnvelopeCommitment(payload as never)) {
		throw new Error('Bound smoke envelope commitment mismatch')
	}
	return evidence as unknown as BoundCocoAuctionsdevSmokeEvidence
}

if (import.meta.main) {
	const logPath = requiredArg('--log')
	const writeResultPath = readArg('--write-result')
	void Bun.file(logPath)
		.text()
		.then(parseAuctionsdevSmokeOutput)
		.then(async (result) => {
			const json = `${JSON.stringify(result)}\n`
			if (writeResultPath) await Bun.write(writeResultPath, json)
			console.log(json.trim())
		})
}
