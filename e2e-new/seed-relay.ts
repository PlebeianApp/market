/**
 * Seeds the relay with required app settings before the dev server starts.
 * This runs as a standalone script, not as a Playwright globalSetup,
 * because the dev server caches appSettings at startup and needs the
 * events to already exist on the relay when it initializes.
 */
import { finalizeEvent, type EventTemplate } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils'
import { TEST_APP_PRIVATE_KEY, TEST_APP_PUBLIC_KEY, RELAY_URL } from './test-config'

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

	// Publish Kind 31990 (App Handler Information)
	await publish({
		kind: 31990,
		created_at: Math.floor(Date.now() / 1000),
		content: JSON.stringify({
			name: 'Test Market',
			displayName: 'Test Market',
			picture: 'https://placehold.co/200x200',
			banner: 'https://placehold.co/800x200',
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
	console.log('  Published app settings (Kind 31990)')

	// Publish Kind 30000 (Admin List)
	await publish({
		kind: 30000,
		created_at: Math.floor(Date.now() / 1000),
		content: '',
		tags: [
			['d', 'admin'],
			['p', TEST_APP_PUBLIC_KEY],
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
