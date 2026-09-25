/**
 * Seeds the relay with required app settings before the dev server starts.
 * This runs as a standalone script, not as a Playwright globalSetup,
 * because the dev server caches appSettings at startup and needs the
 * events to already exist on the relay when it initializes.
 */
import { finalizeEvent, type EventTemplate } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import { devUser1 } from '../src/lib/fixtures'
import {
	RELAY_URL,
	SELF_HOSTED_HANDLER_ID,
	SELF_HOSTED_INSTANCE_NAME,
	SELF_HOSTED_SITE_URL,
	TEST_APP_PRIVATE_KEY,
	TEST_APP_PUBLIC_KEY,
} from './test-config'

const skBytes = hexToBytes(TEST_APP_PRIVATE_KEY)

/**
 * Connect to the local relay, retrying while it is still coming up.
 *
 * The relay is a sibling webServer entry, and this script is the first half of
 * the dev-server command; if the relay is not accepting connections yet (cold
 * start on a slow machine, a relay that was just restarted, or a hand-started
 * dev server), a single attempt fails in milliseconds ("connection failed") and
 * the `&&` chain then never starts the dev server — the run dies with an opaque
 * "Timed out waiting 60000ms from config.webServer" instead of the real cause.
 */
async function connectWithRetry(timeoutMs = 30_000): Promise<Relay> {
	const deadline = Date.now() + timeoutMs

	for (let attempt = 1; ; attempt++) {
		try {
			return await Relay.connect(RELAY_URL)
		} catch (error) {
			if (Date.now() >= deadline) {
				throw new Error(`relay ${RELAY_URL} unreachable after ${timeoutMs}ms (attempts: ${attempt}): ${String(error)}`)
			}
			if (attempt === 1) {
				console.log(`  Waiting for relay ${RELAY_URL} to accept connections ...`)
			}
			await new Promise((resolve) => setTimeout(resolve, 500))
		}
	}
}

async function main() {
	console.log('\n--- Seeding relay for e2e tests ---')
	console.log(`  App pubkey: ${TEST_APP_PUBLIC_KEY.slice(0, 16)}...`)

	const relay = await connectWithRetry()

	async function publish(template: EventTemplate) {
		const event = finalizeEvent(template, skBytes)
		await relay.publish(event)
		return event
	}

	// Keep the default settings event available for the shared E2E server. The
	// dedicated self-hosted run selects the custom event below via its handler ID.
	await publish({
		kind: 31990,
		created_at: Math.floor(Date.now() / 1000) - 1,
		content: JSON.stringify({
			name: 'Test Market',
			displayName: 'Test Market',
			picture: 'https://example.invalid/test-market-logo.svg',
			banner: 'https://example.invalid/test-market-banner.png',
			ownerPk: TEST_APP_PUBLIC_KEY,
			allowRegister: true,
			defaultCurrency: 'USD',
		}),
		tags: [
			['d', 'plebeian-market-handler'],
			['k', '30402'],
			['k', '30405'],
			['k', '30406'],
		],
	})
	console.log('  Published default app settings (Kind 31990)')

	// Publish a distinct self-hosted event for the isolated self-hosted test
	// command. The event uses BASE_URL so its links match that command's port.
	await publish({
		kind: 31990,
		created_at: Math.floor(Date.now() / 1000),
		content: JSON.stringify({
			name: SELF_HOSTED_INSTANCE_NAME,
			displayName: SELF_HOSTED_INSTANCE_NAME,
			picture: 'https://example.invalid/self-hosted-logo.svg',
			banner: 'https://example.invalid/self-hosted-banner.png',
			ownerPk: TEST_APP_PUBLIC_KEY,
			allowRegister: true,
			defaultCurrency: 'USD',
			handlerId: SELF_HOSTED_HANDLER_ID,
			siteUrl: SELF_HOSTED_SITE_URL,
			publicRelays: [RELAY_URL],
			trustedMints: ['https://mint.example.invalid'],
			bugRelay: RELAY_URL,
			termsUrl: `${SELF_HOSTED_SITE_URL}/terms`,
			socialLinks: {
				twitter: 'https://social.example.invalid/self-hosted',
				github: 'https://github.com/example/self-hosted-market',
				nostr: 'https://njump.me/npub1selfhosted',
			},
			supportContact: 'support@self-hosted.example.invalid',
		}),
		tags: [
			['d', SELF_HOSTED_HANDLER_ID],
			['k', '30402'],
			['k', '30405'],
			['k', '30406'],
			['web', `${SELF_HOSTED_SITE_URL}/product/<bech32>`, 'naddr'],
			['web', `${SELF_HOSTED_SITE_URL}/a/<bech32>`, 'naddr'],
			['web', `${SELF_HOSTED_SITE_URL}/collection/<bech32>`, 'naddr'],
			['r', RELAY_URL],
		],
	})
	console.log('  Published self-hosted app settings (Kind 31990)')

	// Publish Kind 30000 (Admin List)
	// Include devUser1 so the server recognises them as admin at startup.
	// The server caches the admin list via a one-time fetch — events published
	// later (e.g. by test scenarios) won't update the server's cache.
	await publish({
		kind: 30000,
		created_at: Math.floor(Date.now() / 1000),
		content: '',
		tags: [
			['d', 'admins'],
			['p', TEST_APP_PUBLIC_KEY],
			['p', devUser1.pk],
		],
	})
	console.log('  Published admin list (Kind 30000)')

	// Publish Kind 10002 (Relay List)
	await publish({
		kind: 10002,
		created_at: Math.floor(Date.now() / 1000),
		content: '',
		tags: [['r', RELAY_URL]],
	})
	console.log('  Published relay list (Kind 10002)')

	relay.close()
	console.log('--- Relay seeding complete ---\n')
}

main().catch((err) => {
	console.error('Failed to seed relay:', err)
	process.exit(1)
})
