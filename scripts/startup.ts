import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { config } from 'dotenv'
import { devUser1, devUser2, devUser3, devUser4, devUser5 } from '@/lib/fixtures'
import { AppSettingsSchema } from '@/lib/schemas/app'
import { SHIPPING_KIND } from '@/lib/schemas/shippingOption'

config()

const RELAY_URL = process.env.APP_RELAY_URL
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY

if (!RELAY_URL || !APP_PRIVATE_KEY) {
	console.error('Missing required environment variables: APP_RELAY_URL, APP_PRIVATE_KEY')
	process.exit(1)
}

const relay = RELAY_URL as string
const privateKey = APP_PRIVATE_KEY as string

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

async function createUserRolesEvent(signer: NDKPrivateKeySigner) {
	// EXTECTED ITEMS: d tag `roles/admins`, `roles/editors`, `roles/plebs`
	// const userRoles = UserRolesSchema.parse({
	// 	roles: {
	// 		admins: [devUser1.pk, devUser2.pk],
	// 		editors: [],
	// 		plebs: [devUser3.pk, devUser4.pk, devUser5.pk],
	// 	},
	// })

	const userRolesAdminsEvent = new NDKEvent(ndk)
	userRolesAdminsEvent.kind = 30000
	// userRolesAdminsEvent.content = JSON.stringify(userRoles)
	userRolesAdminsEvent.tags.push(['d', 'roles/admins'])
	userRolesAdminsEvent.tags.push(['p', devUser1.pk])
	userRolesAdminsEvent.tags.push(['p', devUser2.pk])
	await userRolesAdminsEvent.sign(signer)
	await userRolesAdminsEvent.publish()
	console.log('Published user admin roles event')

	const userRolesEditorsEvent = new NDKEvent(ndk)
	userRolesEditorsEvent.kind = 30000
	userRolesEditorsEvent.tags.push(['d', 'roles/editors'])
	userRolesEditorsEvent.tags.push(['p', devUser3.pk])
	await userRolesEditorsEvent.sign(signer)
	await userRolesEditorsEvent.publish()
	console.log('Published user editor roles event')

	const userRolesPlebsEvent = new NDKEvent(ndk)
	userRolesPlebsEvent.kind = 30000
	userRolesPlebsEvent.tags.push(['d', 'roles/plebs'])
	userRolesPlebsEvent.tags.push(['p', devUser4.pk])
	await userRolesPlebsEvent.sign(signer)
	await userRolesPlebsEvent.publish()
	console.log('Published user plebs roles event')
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

	console.log('Creating user roles event...')
	await createUserRolesEvent(signer)

	console.log('Initialization complete!')
	process.exit(0)
}

initializeEvents().catch((error) => {
	console.error('Initialization failed:', error)
	process.exit(1)
})
