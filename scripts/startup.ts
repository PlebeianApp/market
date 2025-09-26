import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { config } from 'dotenv'
import { devUser1, devUser2, devUser3, devUser4, devUser5 } from '@/lib/fixtures'
import { AppSettingsSchema } from '@/lib/schemas/app'
import { SHIPPING_KIND } from '@/lib/schemas/shippingOption'

config()

const RELAY_URL = process.env.APP_RELAY_URL
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY

console.log('Environment variables:', { RELAY_URL, APP_PRIVATE_KEY: APP_PRIVATE_KEY ? '[REDACTED]' : undefined })

if (!RELAY_URL || !APP_PRIVATE_KEY) {
	console.error('Missing required environment variables: APP_RELAY_URL, APP_PRIVATE_KEY')
	process.exit(1)
}

const relay = RELAY_URL as string
const privateKey = APP_PRIVATE_KEY as string

console.log('Using relay URL:', relay)

// Initialize NDK with the relay URL
const ndk = ndkActions.initialize([relay])

async function createAppSettingsEvent(signer: NDKPrivateKeySigner) {
	const appSettings = AppSettingsSchema.parse({
		name: 'Plebeian Market',
		displayName: 'Plebeian Market',
		picture: 'https://plebeian.market/logo.svg',
		banner: 'https://plebeian.market/banner.png',
		ownerPk: devUser1.pk,
		allowRegister: true,
		defaultCurrency: 'USD',
		blossom_server: 'https://blossom.plebeian.market',
		nip96_server: 'https://nip96.plebeian.market',
	})

	// Create kind 31990 event
	const appHandlerEvent = new NDKEvent(ndk)
	appHandlerEvent.kind = 31990
	appHandlerEvent.content = JSON.stringify(appSettings)
	appHandlerEvent.tags = [
		['d', 'app/settings'],
		['k', '30402'], // Product events
		['k', '30405'], // Collection events
		['k', String(SHIPPING_KIND)], // Shipping events
		['k', '30407'], // Review events
		['web', 'https://plebeian.market/a/', 'nevent'],
		['web', 'https://plebeian.market/p/', 'nprofile'],
		['r', relay],
	]

	await appHandlerEvent.sign(signer)
	await appHandlerEvent.publish()
	console.log('Published app handler event')

	// Create kind 30078 event for extended settings
	// const extendedSettings = ExtendedSettingsSchema.parse({
	// 	extended_field: 'Extended settings',
	// 	field_to_encrypt: 'Sensitive data',
	// })

	// const extendedSettingsEvent = new NDKEvent(ndk)
	// extendedSettingsEvent.kind = 30078
	// extendedSettingsEvent.content = JSON.stringify(extendedSettings)
	// extendedSettingsEvent.tags = [['d', appId]]

	// await extendedSettingsEvent.sign(signer)
	// await extendedSettingsEvent.publish()
	// console.log('Published extended settings event')

	// EXPECTD ITEMS: "r" (relays) tags
	if (!RELAY_URL) return
	const relayListEvent = new NDKEvent(ndk)
	relayListEvent.kind = 10002
	relayListEvent.tags.push(['r', RELAY_URL])

	await relayListEvent.sign(signer)
	await relayListEvent.publish()
	console.log('Published relay list event')
}

async function createBanListEvent(signer: NDKPrivateKeySigner) {
	// EXPECTED ITEMS: "p" (pubkeys), "t" (hashtags), "word" (lowercase string), "e" (threads)
	// const banList = BanListSchema.parse({
	// 	pubkeys: [devUser5.pk],
	// 	words: [],
	// 	hashtags: [],
	// })

	const banListEvent = new NDKEvent(ndk)
	banListEvent.kind = 10000
	// banListEvent.content = JSON.stringify(banList)
	banListEvent.tags.push(['d', 'banned'])
	banListEvent.tags.push(['p', devUser5.pk])
	banListEvent.tags.push(['t', 'test'])
	banListEvent.tags.push(['word', 'test'])

	await banListEvent.sign(signer)
	await banListEvent.publish()
	console.log('Published ban list event')
}

async function createRoleListsEvent(signer: NDKPrivateKeySigner) {
	// Create admin list event (kind 30000) with d tag 'admins'
	// This follows the new admin structure where:
	// - devUser1 is the owner (first admin in the list)
	// - devUser2 is an admin
	// - No plebs role needed

	const adminListEvent = new NDKEvent(ndk)
	adminListEvent.kind = 30000
	adminListEvent.tags.push(['d', 'admins'])
	adminListEvent.tags.push(['p', devUser1.pk]) // Owner (first admin)
	adminListEvent.tags.push(['p', devUser2.pk]) // Admin

	await adminListEvent.sign(signer)
	await adminListEvent.publish()
	console.log('Published admin list event with devUser1 as owner and devUser2 as admin')

	// Create editors list event (kind 30000) with d tag 'editors'
	const editorsListEvent = new NDKEvent(ndk)
	editorsListEvent.kind = 30000
	editorsListEvent.tags.push(['d', 'editors'])
	editorsListEvent.tags.push(['p', devUser3.pk]) // Editor

	await editorsListEvent.sign(signer)
	await editorsListEvent.publish()
	console.log('Published editors list event with devUser3 as editor')
}

async function initializeEvents() {
	console.log('Connecting to Nostr...')
	ndkActions.initialize([relay])
	await ndkActions.connect()
	console.log('Connected to Nostr')

	const signer = new NDKPrivateKeySigner(privateKey)
	await signer.blockUntilReady()

	console.log('Creating app settings events...')
	await createAppSettingsEvent(signer)

	console.log('Creating ban list event...')
	await createBanListEvent(signer)

	console.log('Creating admin and editor lists...')
	await createRoleListsEvent(signer)

	console.log('Initialization complete!')
	process.exit(0)
}

initializeEvents().catch((error) => {
	console.error('Initialization failed:', error)
	process.exit(1)
})
