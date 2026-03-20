import {
	commonOptions,
	fetchAppConfig,
	latestEvent,
	parseCommonArgs,
	parseStage,
	queryRelay,
	resolveStageTargets,
	summarizeRoleEvent,
	usageAndExit,
} from './_shared'

function helpText() {
	return `Inspect current app settings events on a relay.

Usage:
  bun run deploy-simple/scripts/app-settings/inspect.ts --stage staging
  bun run deploy-simple/scripts/app-settings/inspect.ts --stage production

Options:
  --stage <development|staging|production>  Required stage selector
  --api-url <url>                           Override /api/config endpoint for the stage
  --relay-url <url>                         Override relay URL for the stage
  --app-pubkey <hex>                        Skip /api/config lookup and query this app pubkey
  -h, --help                                Show this help
`
}

const { values } = parseCommonArgs(Bun.argv.slice(2))

if (values.help) {
	usageAndExit(helpText())
}

const stage = parseStage(values.stage)
const { apiUrl, relayUrl } = resolveStageTargets(stage, values['api-url'], values['relay-url'])
const config = values['app-pubkey'] ? null : await fetchAppConfig(apiUrl)
const appPubkey = values['app-pubkey'] || config?.appPublicKey

if (!appPubkey) {
	throw new Error(`No app pubkey available for stage ${stage}. Pass --app-pubkey to override.`)
}

const [handlerEvents, adminEvents, editorEvents] = await Promise.all([
	queryRelay(relayUrl, {
		kinds: [31990],
		authors: [appPubkey],
		'#d': ['plebeian-market-handler'],
	}),
	queryRelay(relayUrl, {
		kinds: [30000],
		authors: [appPubkey],
		'#d': ['admins'],
	}),
	queryRelay(relayUrl, {
		kinds: [30000],
		authors: [appPubkey],
		'#d': ['editors'],
	}),
])

const latestHandler = latestEvent(handlerEvents)
const latestAdmins = latestEvent(adminEvents)
const latestEditors = latestEvent(editorEvents)
const parsedHandlerContent = latestHandler
	? (() => {
			try {
				return JSON.parse(latestHandler.content)
			} catch {
				return latestHandler.content
			}
		})()
	: null

console.log(
	JSON.stringify(
		{
			stage,
			apiUrl,
			relayUrl,
			appPubkey,
			apiConfig: config
				? {
						appRelay: config.appRelay,
						stage: config.stage,
						needsSetup: config.needsSetup,
					}
				: null,
			appSettings: latestHandler
				? {
						id: latestHandler.id,
						created_at: latestHandler.created_at,
						pubkey: latestHandler.pubkey,
						tags: latestHandler.tags,
						content: parsedHandlerContent,
					}
				: null,
			admins: summarizeRoleEvent(latestAdmins, 'admins'),
			editors: summarizeRoleEvent(latestEditors, 'editors'),
		},
		null,
		2,
	),
)
