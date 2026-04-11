import { join, relative } from 'node:path'
import {
	collectScopeEvents,
	createMarketScopes,
	dedupeEvents,
	ensureDirectory,
	parseBackupArgs,
	parseOptionalNumber,
	parseScopes,
	parseStageOrExit,
	resolveBackupContext,
	resolveOutputDirectory,
	type MarketBackupManifest,
	type MarketBackupScopeSummary,
	writeManifest,
	writeNdjsonFile,
} from './_shared'
import { usageAndExit } from '../app-settings/_shared'

const usage = `Backup market-related relay events to editable NDJSON files.

Usage:
  bun run deploy-simple/scripts/market-events/backup.ts --stage staging

Options:
  --stage <development|staging|production>   Stage to inspect
  --api-url <url>                            Override /api/config URL
  --relay-url <url>                          Override relay URL
  --app-pubkey <hex>                         Override app pubkey discovery
  --out-dir <path>                           Output directory (default: deploy-simple/backups/market-<stage>-<timestamp>)
  --scopes <csv>                             Comma-separated scopes or "all"
  --max-wait-ms <ms>                         Relay EOSE wait timeout (default: 15000)
  --since <unix>                             Optional lower created_at bound
  --until <unix>                             Optional upper created_at bound
  -h, --help                                 Show this help

Scopes:
  app-authored, catalog, lists, app-data, orders`

const { values } = parseBackupArgs(Bun.argv.slice(2))

if (values.help) {
	usageAndExit(usage)
}

const stage = parseStageOrExit(values.stage)
const maxWait = parseOptionalNumber(values['max-wait-ms'], '--max-wait-ms') ?? 15_000
const since = parseOptionalNumber(values.since, '--since')
const until = parseOptionalNumber(values.until, '--until')
const scopes = parseScopes(values.scopes)

if (typeof since === 'number' && typeof until === 'number' && since > until) {
	usageAndExit('--since cannot be greater than --until', 1)
}

const context = await resolveBackupContext({
	stage,
	apiUrl: values['api-url'],
	relayUrl: values['relay-url'],
	appPubkey: values['app-pubkey'],
})

const scopeDefinitions = createMarketScopes(context.appPubkey, scopes, since, until)
const outputDir = await ensureDirectory(resolveOutputDirectory(values['out-dir'], stage))

console.log('Backing up market relay events')
console.log(`Stage: ${stage}`)
console.log(`API URL: ${context.targets.apiUrl}`)
console.log(`Relay URL: ${context.targets.relayUrl}`)
console.log(`App pubkey: ${context.appPubkey}`)
console.log(`Scopes: ${scopes.join(', ')}`)
console.log(`Output: ${outputDir}`)

const collected = await collectScopeEvents(context.targets.relayUrl, scopeDefinitions, maxWait)
const scopeSummaries: MarketBackupScopeSummary[] = []
const allEvents = dedupeEvents(collected.flatMap(({ events }) => events))

for (const { scope, events } of collected) {
	const fileName = `${scope.name}.ndjson`
	const filePath = join(outputDir, fileName)
	await writeNdjsonFile(filePath, events)

	scopeSummaries.push({
		name: scope.name,
		description: scope.description,
		file: fileName,
		count: events.length,
		filter: scope.filter,
	})

	console.log(`  ${scope.name}: ${events.length} events -> ${relative(process.cwd(), filePath)}`)
}

await writeNdjsonFile(join(outputDir, 'all.ndjson'), allEvents)

const manifest: MarketBackupManifest = {
	version: 1,
	createdAt: new Date().toISOString(),
	stage,
	apiUrl: context.targets.apiUrl,
	relayUrl: context.targets.relayUrl,
	appPubkey: context.appPubkey,
	totalEvents: allEvents.length,
	allFile: 'all.ndjson',
	scopes: scopeSummaries,
}

await writeManifest(join(outputDir, 'manifest.json'), manifest)

console.log(`Total unique events: ${allEvents.length}`)
console.log(`Manifest: ${relative(process.cwd(), join(outputDir, 'manifest.json'))}`)
