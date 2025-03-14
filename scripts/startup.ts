import { NostrService } from '@/lib/nostr'
import { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { config } from 'dotenv'
import { devUser1, devUser2, devUser3, devUser4, devUser5 } from '@/lib/fixtures'
import { randomUUID } from 'crypto'
import { AppSettingsSchema, ExtendedSettingsSchema, BanListSchema, UserRolesSchema } from '@/lib/schemas/app'

config()

const RELAY_URL = process.env.APP_RELAY_URL
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY

if (!RELAY_URL || !APP_PRIVATE_KEY) {
	console.error('Missing required environment variables: APP_RELAY_URL, APP_PRIVATE_KEY')
	process.exit(1)
}

const relay = RELAY_URL as string
const privateKey = APP_PRIVATE_KEY as string

const nostrService = NostrService.getInstance([relay])

async function createAppSettingsEvent(signer: NDKPrivateKeySigner) {
	const appId = randomUUID()
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
	const appHandlerEvent = new NDKEvent(nostrService.ndkInstance)
	appHandlerEvent.kind = 31990
	appHandlerEvent.content = JSON.stringify(appSettings)
	appHandlerEvent.tags = [
		['d', appId],
		['k', '30402'], // Product events
		['k', '30405'], // Collection events
		['k', '30406'], // Shipping events
		['k', '30407'], // Review events
		['web', 'https://plebeian.market/a/', 'nevent'],
		['web', 'https://plebeian.market/p/', 'nprofile'],
		['r', relay],
	]

	await appHandlerEvent.sign(signer)
	await appHandlerEvent.publish()
	console.log('Published app handler event')

	// Create kind 30078 event for extended settings
	const extendedSettings = ExtendedSettingsSchema.parse({
		extended_field: 'Extended settings',
		field_to_encrypt: 'Sensitive data',
	})

	const extendedSettingsEvent = new NDKEvent(nostrService.ndkInstance)
	extendedSettingsEvent.kind = 30078
	extendedSettingsEvent.content = JSON.stringify(extendedSettings)
	extendedSettingsEvent.tags = [['d', appId]]

	await extendedSettingsEvent.sign(signer)
	await extendedSettingsEvent.publish()
	console.log('Published extended settings event')

	// Create kind 10002 event for relay list
	const relayListEvent = new NDKEvent(nostrService.ndkInstance)
	relayListEvent.kind = 10002
	relayListEvent.content = JSON.stringify({
		relays: [relay],
	})
	relayListEvent.tags = []

	await relayListEvent.sign(signer)
	await relayListEvent.publish()
	console.log('Published relay list event')
}

async function createBanListEvent(signer: NDKPrivateKeySigner) {
	const banList = BanListSchema.parse({
		pubkeys: [devUser5.pk],
		words: [],
		hashtags: [],
	})

	const banListEvent = new NDKEvent(nostrService.ndkInstance)
	banListEvent.kind = 10000
	banListEvent.content = JSON.stringify(banList)
	banListEvent.tags = [['d', 'banned']]

	await banListEvent.sign(signer)
	await banListEvent.publish()
	console.log('Published ban list event')
}

async function createUserRolesEvent(signer: NDKPrivateKeySigner) {
	const userRoles = UserRolesSchema.parse({
		roles: {
			admins: [devUser1.pk, devUser2.pk],
			editors: [],
			plebs: [devUser3.pk, devUser4.pk, devUser5.pk],
		},
	})

	const userRolesEvent = new NDKEvent(nostrService.ndkInstance)
	userRolesEvent.kind = 30000
	userRolesEvent.content = JSON.stringify(userRoles)
	userRolesEvent.tags = [['d', 'roles']]

	await userRolesEvent.sign(signer)
	await userRolesEvent.publish()
	console.log('Published user roles event')
}

async function initializeEvents() {
	console.log('Connecting to Nostr...')
	await nostrService.connect()
	console.log('Connected to Nostr')

	const signer = new NDKPrivateKeySigner(privateKey)
	await signer.blockUntilReady()

	console.log('Creating app settings events...')
	await createAppSettingsEvent(signer)

	console.log('Creating ban list event...')
	await createBanListEvent(signer)

	console.log('Creating user roles event...')
	await createUserRolesEvent(signer)

	console.log('Initialization complete!')
	process.exit(0)
}

initializeEvents().catch((error) => {
	console.error('Initialization failed:', error)
	process.exit(1)
})
