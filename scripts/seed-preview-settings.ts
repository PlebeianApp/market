/**
 * Seed a PREVIEW relay with the minimum events the app needs to boot out of
 * `setup` mode: the kind 31990 app settings, the kind 30000 admin list, and the
 * kind 10002 relay list.
 *
 * Unlike `e2e/seed-relay.ts`, the relay URL and signing key come from the
 * environment (`APP_RELAY_URL`, `APP_PRIVATE_KEY`), so the same script runs
 * against a per-PR preview relay (`wss://<subdomain>/relay`) or any standalone
 * relay. It is idempotent: if app settings already exist for the app pubkey it
 * prints `already-seeded` and publishes nothing, so a redeploy does not
 * duplicate state.
 *
 * The app caches app settings and the admin list at startup, so the deploy
 * workflow restarts `market-app` after this script publishes.
 */
import { hexToBytes } from '@noble/hashes/utils.js'
import { finalizeEvent, getPublicKey, type EventTemplate } from 'nostr-tools/pure'
import { Relay, type SubCloser } from 'nostr-tools/relay'

const RELAY_URL = process.env.APP_RELAY_URL
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY

const APP_SETTINGS_KIND = 31990
const ADMIN_LIST_KIND = 30000
const RELAY_LIST_KIND = 10002
// Must match `APP_SETTINGS_D_TAG` in src/lib/appSettings.ts: the app only
// accepts settings that are kind 31990, authored by the app pubkey, and carry
// this exact `d` tag.
const APP_SETTINGS_D_TAG = 'plebeian-market-handler'

if (!RELAY_URL || !APP_PRIVATE_KEY) {
	console.error('Missing required environment variables: APP_RELAY_URL and APP_PRIVATE_KEY')
	process.exit(1)
}

const skBytes = hexToBytes(APP_PRIVATE_KEY)
const APP_PUBKEY = getPublicKey(skBytes)

async function appSettingsExist(relay: Relay): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false
		let sub: SubCloser | undefined
		const finish = (exists: boolean) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			sub?.close()
			resolve(exists)
		}
		const timer = setTimeout(() => finish(false), 5000)
		sub = relay.subscribe([{ kinds: [APP_SETTINGS_KIND], authors: [APP_PUBKEY], '#d': [APP_SETTINGS_D_TAG], limit: 1 }], {
			onevent: () => finish(true),
			oneose: () => finish(false),
		})
	})
}

async function main() {
	console.log(`Seeding preview relay ${RELAY_URL} for app pubkey ${APP_PUBKEY.slice(0, 16)}…`)
	const relay = await Relay.connect(RELAY_URL)

	const publish = async (template: EventTemplate) => {
		const event = finalizeEvent(template, skBytes)
		await relay.publish(event)
		return event
	}

	if (await appSettingsExist(relay)) {
		console.log('already-seeded')
		relay.close()
		return
	}

	// Kind 31990 — App Handler Information (the settings the app boots from).
	await publish({
		kind: APP_SETTINGS_KIND,
		created_at: Math.floor(Date.now() / 1000),
		content: JSON.stringify({
			name: 'Preview Market',
			displayName: 'Preview Market',
			picture: 'https://placehold.co/200x200',
			banner: 'https://placehold.co/800x200',
			ownerPk: APP_PUBKEY,
			allowRegister: true,
			defaultCurrency: 'USD',
		}),
		tags: [
			['d', APP_SETTINGS_D_TAG],
			['k', '30402'],
			['k', '30405'],
			['k', '30406'],
		],
	})
	console.log('  published app settings (kind 31990)')

	// Kind 30000 — Admin list. The app caches this at startup, hence the
	// restart in the deploy workflow after seeding.
	await publish({
		kind: ADMIN_LIST_KIND,
		created_at: Math.floor(Date.now() / 1000),
		content: '',
		tags: [
			['d', 'admins'],
			['p', APP_PUBKEY],
		],
	})
	console.log('  published admin list (kind 30000)')

	// Kind 10002 — Relay list.
	await publish({
		kind: RELAY_LIST_KIND,
		created_at: Math.floor(Date.now() / 1000),
		content: '',
		tags: [['r', RELAY_URL]],
	})
	console.log('  published relay list (kind 10002)')

	relay.close()
	console.log('seeded')
}

main().catch((err) => {
	console.error('Failed to seed preview relay:', err)
	process.exit(1)
})
