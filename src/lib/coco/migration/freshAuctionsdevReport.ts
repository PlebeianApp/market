import { createCommitment } from './commitment'
import { evaluateFreshAuctionsdevEvidence, FRESH_AUCTIONSDEV_PROFILE } from './freshAuctionsdev'
import { buildCanonicalWalletNamespace, normalizeAccount, normalizeEnvironment } from './identity'
import type { FreshAuctionsdevPreflightEvidence } from './model'

export interface FreshAuctionsdevPublicReport {
	schemaVersion: 1
	profile: 'FRESH_AUCTIONSDEV_TEST'
	verdict: 'FRESH_AUCTIONSDEV_READY' | 'FRESH_AUCTIONSDEV_BLOCKED'
	blockers: readonly string[]
	marketCommit: string
	environment: 'auctionsdev' | 'test'
	namespaceCommitment: string
	evidenceCommitment: string
	inventoryCommitment: string
	frozenSnapshotId: string
	fakeMintIdentityCommitment: string
	selectionCommitment: string
	reportCommitment: string
	counts: Readonly<{
		fakeMints: number
		legacySpendable: number
		legacyReservations: number
		legacyPending: number
		legacyAuthorities: number
		auctionRecovery: number
		truncatedStorage: number
		truncatedDatabases: number
		activeLegacyWriters: number
		cocoBalance: string
		cocoHistory: number
		cocoInFlight: number
		cocoOrphans: number
		hostCommands: number
		authoritativeDatabases: number
		preexistingAuthoritativeDatabases: number
		preexistingVaultRecords: number
		plaintextSecrets: number
	}>
	assertions: Readonly<{
		fullCanonicalNamespace: boolean
		fakeMintIdentityVerified: boolean
		protectedSeedRoundTrip: boolean
		seedKeyNonExtractable: boolean
		zeroStartingCocoBalance: boolean
		legacyWritersDisabled: boolean
	}>
}

export async function createFreshAuctionsdevPublicReport(
	evidence: Readonly<FreshAuctionsdevPreflightEvidence>,
	selection: Readonly<{ legacyWritersDisabled: boolean; selectionCommitment: string }>,
): Promise<Readonly<FreshAuctionsdevPublicReport>> {
	const assessment = await evaluateFreshAuctionsdevEvidence(evidence)
	const payload = {
		schemaVersion: 1 as const,
		profile: FRESH_AUCTIONSDEV_PROFILE,
		verdict:
			assessment.allowed && selection.legacyWritersDisabled ? ('FRESH_AUCTIONSDEV_READY' as const) : ('FRESH_AUCTIONSDEV_BLOCKED' as const),
		blockers: Object.freeze([...assessment.blockers, ...(selection.legacyWritersDisabled ? [] : ['LEGACY_WRITERS_NOT_DISABLED'])]),
		marketCommit: evidence.marketCommit,
		environment: evidence.environment as 'auctionsdev' | 'test',
		namespaceCommitment: await createCommitment('market-coco-v2-fresh-namespace-v1', {
			namespace: evidence.namespace,
			account: evidence.account,
			environment: evidence.environment,
		}),
		evidenceCommitment: evidence.evidenceCommitment,
		inventoryCommitment: evidence.inventoryCommitment,
		frozenSnapshotId: evidence.frozenSnapshotId,
		fakeMintIdentityCommitment: evidence.fakeMintIdentityCommitment,
		selectionCommitment: selection.selectionCommitment,
		counts: Object.freeze({
			fakeMints: evidence.fakeMintCount,
			legacySpendable: evidence.legacySpendableCount,
			legacyReservations: evidence.legacyReservationCount,
			legacyPending: evidence.legacyPendingCount,
			legacyAuthorities: evidence.legacyAuthorityCount,
			auctionRecovery: evidence.auctionRecoveryCount,
			truncatedStorage: evidence.truncatedStorageCount,
			truncatedDatabases: evidence.truncatedDatabaseCount,
			activeLegacyWriters: evidence.activeLegacyWriterCount,
			cocoBalance: evidence.cocoBalanceAmount.toString(),
			cocoHistory: evidence.cocoHistoryCount,
			cocoInFlight: evidence.cocoInFlightCount,
			cocoOrphans: evidence.cocoOrphanCount,
			hostCommands: evidence.hostCommandCount,
			authoritativeDatabases: evidence.authoritativeDatabaseCount,
			preexistingAuthoritativeDatabases: evidence.preexistingAuthoritativeDatabaseCount,
			preexistingVaultRecords: evidence.preexistingVaultRecordCount,
			plaintextSecrets: evidence.plaintextSecretRecordCount,
		}),
		assertions: Object.freeze({
			fullCanonicalNamespace: true,
			fakeMintIdentityVerified: evidence.fakeMintIdentityVerified,
			protectedSeedRoundTrip: evidence.vaultRoundTripVerified,
			seedKeyNonExtractable: !evidence.vaultKeyExtractable,
			zeroStartingCocoBalance: evidence.cocoBalanceAmount === BigInt(0),
			legacyWritersDisabled: selection.legacyWritersDisabled,
		}),
	}
	return Object.freeze({
		...payload,
		reportCommitment: await createCommitment('market-coco-v2-fresh-auctionsdev-public-report-v1', payload),
	})
}

const requireString = (value: unknown, field: string): string => {
	if (typeof value !== 'string' || !value) throw new Error(`${field} is required`)
	return value
}

const requireObject = (value: unknown, label: string): Record<string, unknown> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is required`)
	return value as Record<string, unknown>
}

const assertExactFields = (value: Record<string, unknown>, fields: readonly string[], label: string): void => {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new Error(`${label} does not match schema version 1`)
	}
}

export interface FreshAuctionsdevReportExpectation {
	marketCommit: string
	account: string
	environment: string
}

export async function verifyFreshAuctionsdevPublicReport(
	value: unknown,
	expected: FreshAuctionsdevReportExpectation,
): Promise<Readonly<{ namespaceCommitment: string; reportCommitment: string }>> {
	const report = requireObject(value, 'preflight report')
	assertExactFields(
		report,
		[
			'schemaVersion',
			'profile',
			'verdict',
			'blockers',
			'marketCommit',
			'environment',
			'namespaceCommitment',
			'evidenceCommitment',
			'inventoryCommitment',
			'frozenSnapshotId',
			'fakeMintIdentityCommitment',
			'selectionCommitment',
			'counts',
			'assertions',
			'reportCommitment',
		],
		'preflight report',
	)
	if (report.schemaVersion !== 1 || report.profile !== FRESH_AUCTIONSDEV_PROFILE)
		throw new Error('Unsupported fresh-wallet preflight schema/profile')
	if (report.verdict !== 'FRESH_AUCTIONSDEV_READY') throw new Error('Fresh-wallet preflight verdict is not ready')
	if (!Array.isArray(report.blockers) || report.blockers.length !== 0) throw new Error('Fresh-wallet preflight contains blockers')
	if (!/^[0-9a-f]{40}$/.test(expected.marketCommit)) throw new Error('Expected Market commit is invalid')
	const account = normalizeAccount(expected.account)
	const environment = normalizeEnvironment(expected.environment)
	if (environment !== 'auctionsdev' && environment !== 'test') throw new Error('Expected environment must be auctionsdev or test')
	if (report.marketCommit !== expected.marketCommit || report.environment !== environment) {
		throw new Error('Preflight is bound to another Market SHA or environment')
	}
	const { reportCommitment, ...payload } = report
	const normalizedReportCommitment = requireString(reportCommitment, 'reportCommitment')
	if (!/^sha256:[0-9a-f]{64}$/.test(normalizedReportCommitment)) throw new Error('Preflight report commitment is invalid')
	if ((await createCommitment('market-coco-v2-fresh-auctionsdev-public-report-v1', payload)) !== normalizedReportCommitment) {
		throw new Error('Preflight report commitment does not match its public fields')
	}
	const namespace = buildCanonicalWalletNamespace({ account, environment })
	const namespaceCommitment = await createCommitment('market-coco-v2-fresh-namespace-v1', { namespace, account, environment })
	if (report.namespaceCommitment !== namespaceCommitment) throw new Error('Preflight is bound to another full account namespace')

	const assertions = requireObject(report.assertions, 'preflight assertions')
	const counts = requireObject(report.counts, 'preflight counts')
	assertExactFields(
		assertions,
		[
			'fullCanonicalNamespace',
			'fakeMintIdentityVerified',
			'protectedSeedRoundTrip',
			'seedKeyNonExtractable',
			'zeroStartingCocoBalance',
			'legacyWritersDisabled',
		],
		'preflight assertions',
	)
	assertExactFields(
		counts,
		[
			'fakeMints',
			'legacySpendable',
			'legacyReservations',
			'legacyPending',
			'legacyAuthorities',
			'auctionRecovery',
			'truncatedStorage',
			'truncatedDatabases',
			'activeLegacyWriters',
			'cocoBalance',
			'cocoHistory',
			'cocoInFlight',
			'cocoOrphans',
			'hostCommands',
			'authoritativeDatabases',
			'preexistingAuthoritativeDatabases',
			'preexistingVaultRecords',
			'plaintextSecrets',
		],
		'preflight counts',
	)
	for (const assertion of [
		'fullCanonicalNamespace',
		'fakeMintIdentityVerified',
		'protectedSeedRoundTrip',
		'seedKeyNonExtractable',
		'zeroStartingCocoBalance',
		'legacyWritersDisabled',
	]) {
		if (assertions[assertion] !== true) throw new Error(`Required assertion failed: ${assertion}`)
	}
	for (const count of [
		'legacySpendable',
		'legacyReservations',
		'legacyPending',
		'legacyAuthorities',
		'auctionRecovery',
		'truncatedStorage',
		'truncatedDatabases',
		'activeLegacyWriters',
		'cocoHistory',
		'cocoInFlight',
		'cocoOrphans',
		'hostCommands',
		'plaintextSecrets',
		'preexistingAuthoritativeDatabases',
		'preexistingVaultRecords',
	]) {
		if (counts[count] !== 0) throw new Error(`Required zero count failed: ${count}`)
	}
	if (counts.cocoBalance !== '0') throw new Error('Required zero starting Coco balance failed')
	if (counts.authoritativeDatabases !== 1) throw new Error('Exactly one authoritative Coco database is required')
	if (typeof counts.fakeMints !== 'number' || counts.fakeMints < 1) throw new Error('At least one verified fake mint is required')
	for (const field of [
		'evidenceCommitment',
		'inventoryCommitment',
		'frozenSnapshotId',
		'fakeMintIdentityCommitment',
		'selectionCommitment',
	]) {
		if (!/^sha256:[0-9a-f]{64}$/.test(requireString(report[field], field))) throw new Error(`${field} is invalid`)
	}
	return Object.freeze({ namespaceCommitment, reportCommitment: normalizedReportCommitment })
}
