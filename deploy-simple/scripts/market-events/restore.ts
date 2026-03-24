import { join, relative, resolve } from 'node:path'
import {
	dedupeEvents,
	listNdjsonFiles,
	loadManifest,
	parseRestoreArgs,
	parseScopes,
	parseStageOrExit,
	publishEvents,
	readEventsFromNdjson,
	resolveBackupContext,
	type MarketScopeName,
} from './_shared'
import { usageAndExit } from '../app-settings/_shared'

const usage = `Republish backed up market relay events from NDJSON files.

Usage:
  bun run deploy-simple/scripts/market-events/restore.ts --stage staging --in-dir deploy-simple/backups/market-staging-20260320T000000Z

Options:
  --stage <development|staging|production>   Stage for target relay defaults
  --relay-url <url>                          Override target relay URL
  --in-dir <path>                            Backup directory containing manifest.json and scope .ndjson files
  --scopes <csv>                             Comma-separated scopes or "all" (default: all)
  --dry-run                                  Print what would be published without sending anything
  --ignore-duplicates                        Treat duplicate publish rejections as skipped (default: true)
  -h, --help                                 Show this help`

const { values } = parseRestoreArgs(Bun.argv.slice(2))

if (values.help) {
	usageAndExit(usage)
}

if (!values['in-dir']) {
	usageAndExit('--in-dir is required', 1)
}

const stage = parseStageOrExit(values.stage)
const requestedScopes = parseScopes(values.scopes)
const ignoreDuplicates = values['ignore-duplicates'] ?? true
const inputDir = resolve(values['in-dir'])

const context = await resolveBackupContext({
	stage,
	relayUrl: values['relay-url'],
	// Restore only needs target relay defaults. Reusing the helper keeps stage URL mapping in one place.
	// App pubkey may be unavailable if API is down, so resolve with a placeholder and ignore it afterwards.
	appPubkey: '0'.repeat(64),
})

const manifest = await loadManifest(inputDir)
const scopeFiles = await resolveScopeFiles(inputDir, requestedScopes, manifest)

const eventsByFile = await Promise.all(
	scopeFiles.map(async (filePath) => ({
		filePath,
		events: await readEventsFromNdjson(filePath),
	})),
)

const allEvents = dedupeEvents(eventsByFile.flatMap(({ events }) => events))

console.log('Restoring market relay events')
console.log(`Stage: ${stage}`)
console.log(`Target relay: ${context.targets.relayUrl}`)
console.log(`Input: ${inputDir}`)
console.log(`Scopes: ${requestedScopes.join(', ')}`)

for (const { filePath, events } of eventsByFile) {
	console.log(`  ${relative(process.cwd(), filePath)}: ${events.length} events`)
}

console.log(`Total unique events to restore: ${allEvents.length}`)

if (values['dry-run']) {
	process.exit(0)
}

const result = await publishEvents(context.targets.relayUrl, allEvents, ignoreDuplicates)

console.log(`Published: ${result.published}`)
console.log(`Skipped duplicates: ${result.skippedDuplicates}`)

if (result.failed.length > 0) {
	for (const failure of result.failed) {
		console.error(`Failed ${failure.eventId}: ${failure.reason}`)
	}
	process.exit(1)
}

async function resolveScopeFiles(
	baseDir: string,
	scopes: MarketScopeName[],
	manifest: Awaited<ReturnType<typeof loadManifest>>,
): Promise<string[]> {
	if (manifest) {
		const files = manifest.scopes.filter((scope) => scopes.includes(scope.name)).map((scope) => join(baseDir, scope.file))

		if (files.length > 0) {
			return files
		}
	}

	const allNdjson = await listNdjsonFiles(baseDir)
	const filtered = allNdjson.filter((filePath) => {
		const name = filePath.split('/').pop() || ''
		if (name === 'all.ndjson') return false
		return scopes.some((scope) => name === `${scope}.ndjson`)
	})

	if (filtered.length > 0) {
		return filtered
	}

	const fallbackAll = join(baseDir, 'all.ndjson')
	if (await Bun.file(fallbackAll).exists()) {
		return [fallbackAll]
	}

	throw new Error(`No matching NDJSON files found in ${baseDir}`)
}
