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

async function main() {
	console.log('\n--- Seeding relay for e2e tests ---')
	console.log(`  App pubkey: ${TEST_APP_PUBLIC_KEY.slice(0, 16)}...`)

	const relay = await Relay.connect(RELAY_URL)

	async function publish(template: EventTemplate) {
		const event = finalizeEvent(template, skBytes)
		await relay.publish(event)
		return event
	}

	// Publish the custom self-hosted event first. The dev server is configured
	// with INSTANCE_HANDLER_ID, so this event should win over the legacy event.
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
		],
	})
	console.log('  Published custom app settings (Kind 31990)')

	// Keep the historical event present so the fallback chain is exercised by
	// the same local relay and remains compatible with existing deployments.
	await publish({
		kind: 31990,
		created_at: Math.floor(Date.now() / 1000) - 1,
		content: JSON.stringify({
			name: 'Legacy Test Market',
			displayName: 'Legacy Test Market',
			picture: 'https://example.invalid/legacy-logo.svg',
			banner: 'https://example.invalid/legacy-banner.png',
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
	console.log('  Published legacy fallback app settings (Kind 31990)')

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
