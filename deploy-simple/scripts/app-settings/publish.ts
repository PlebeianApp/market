import { AppSettingsSchema } from '../../../src/lib/schemas/app'
import { commonOptions, parsePrivateKey, parsePubkeyList, parseStage, readJsonFile, resolveStageTargets, usageAndExit } from './_shared'
import { parseArgs } from 'node:util'
import { getPublicKey } from 'nostr-tools/pure'
import { finalizeEvent, SimplePool, type Event } from 'nostr-tools'

const HANDLER_KIND = 31990
const PRODUCT_KIND = 30402
const COLLECTION_KIND = 30405
const PLEBEIAN_MARKET_URL = 'https://plebeian.market'

function helpText() {
	return `Publish app settings events directly to a stage relay.

Usage:
  bun run deploy-simple/scripts/app-settings/publish.ts \\
    --stage staging \\
    --secret-key <hex-or-nsec> \\
    --settings-file deploy-simple/scripts/app-settings/examples/settings.example.json \\
    --admins-file deploy-simple/scripts/app-settings/examples/admins.example.json \\
    --editors-file deploy-simple/scripts/app-settings/examples/editors.example.json

Options:
  --stage <development|staging|production>  Required stage selector
  --secret-key <hex-or-nsec>                 App private key; falls back to APP_PRIVATE_KEY
  --relay-url <url>                          Override relay URL for the stage
  --settings-file <path>                     JSON file for the kind 31990 app settings event
  --admins-file <path>                       JSON file for the kind 30000 admin list
  --editors-file <path>                      JSON file for the kind 30000 editor list
  --handler-id <value>                       Defaults to plebeian-market-handler
  --dry-run                                  Build events and print them without publishing
  -h, --help                                 Show this help
`
}

function createHandlerEventData(pubkey: string, relayUrl: string, appSettings: Record<string, unknown>, handlerId: string) {
	return {
		kind: HANDLER_KIND,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['d', handlerId],
			['k', PRODUCT_KIND.toString()],
			['k', COLLECTION_KIND.toString()],
			['web', `${PLEBEIAN_MARKET_URL}/product/<bech32>`, 'naddr'],
			['web', `${PLEBEIAN_MARKET_URL}/a/<bech32>`, 'naddr'],
			['web', `${PLEBEIAN_MARKET_URL}/collection/<bech32>`, 'naddr'],
			['r', relayUrl],
		],
		content: JSON.stringify(appSettings),
		pubkey,
	}
}

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		...commonOptions,
		'secret-key': {
			type: 'string',
		},
		'settings-file': {
			type: 'string',
		},
		'admins-file': {
			type: 'string',
		},
		'editors-file': {
			type: 'string',
		},
		'handler-id': {
			type: 'string',
		},
		'dry-run': {
			type: 'boolean',
		},
	},
	strict: true,
	allowPositionals: false,
})

if (values.help) {
	usageAndExit(helpText())
}

const stage = parseStage(values.stage)
const { relayUrl } = resolveStageTargets(stage, values['relay-url'])
const secretKey = parsePrivateKey(String(values['secret-key'] || process.env.APP_PRIVATE_KEY || ''))
const handlerId = String(values['handler-id'] || 'plebeian-market-handler')
const dryRun = values['dry-run'] === true

const secretKeyBytes = Buffer.from(secretKey, 'hex')
const appPubkey = getPublicKey(secretKeyBytes)
const eventsToPublish: Array<{ name: string; event: Event }> = []

const settingsFile = values['settings-file']
if (settingsFile) {
	const settings = AppSettingsSchema.parse(await readJsonFile(settingsFile))
	const unsignedEvent = createHandlerEventData(appPubkey, relayUrl, settings, handlerId)
	eventsToPublish.push({
		name: 'appSettings',
		event: finalizeEvent(unsignedEvent, secretKeyBytes),
	})
}

const adminsFile = values['admins-file']
if (adminsFile) {
	const admins = parsePubkeyList(await readJsonFile(adminsFile), 'admins')
	if (admins.length === 0) {
		throw new Error('Admin list cannot be empty')
	}
	eventsToPublish.push({
		name: 'admins',
		event: finalizeEvent(
			{
				kind: 30000,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['d', 'admins'], ...admins.map((pubkey) => ['p', pubkey] as string[])],
				content: '',
				pubkey: appPubkey,
			},
			secretKeyBytes,
		),
	})
}

const editorsFile = values['editors-file']
if (editorsFile) {
	const editors = parsePubkeyList(await readJsonFile(editorsFile), 'editors')
	eventsToPublish.push({
		name: 'editors',
		event: finalizeEvent(
			{
				kind: 30000,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['d', 'editors'], ...editors.map((pubkey) => ['p', pubkey] as string[])],
				content: '',
				pubkey: appPubkey,
			},
			secretKeyBytes,
		),
	})
}

if (eventsToPublish.length === 0) {
	throw new Error('Nothing to publish. Pass at least one of --settings-file, --admins-file, or --editors-file.')
}

console.log(
	JSON.stringify(
		{
			stage,
			relayUrl,
			appPubkey,
			dryRun,
			events: eventsToPublish.map(({ name, event }) => ({
				name,
				id: event.id,
				kind: event.kind,
				created_at: event.created_at,
				tags: event.tags,
				content: event.content ? JSON.parse(event.content) : '',
			})),
		},
		null,
		2,
	),
)

if (dryRun) {
	process.exit(0)
}

const pool = new SimplePool()
try {
	for (const { name, event } of eventsToPublish) {
		await Promise.all(pool.publish([relayUrl], event))
		console.log(`Published ${name}: ${event.id}`)
	}
} finally {
	pool.close([relayUrl])
}
