import { faker } from '@faker-js/faker'
import { v4 as uuidv4 } from 'uuid'
import type { Wallet } from '@/lib/stores/wallet'
import { saveUserNwcWallets } from '@/publish/wallet'
import type { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'

// Generate realistic wallet names
const generateWalletName = (): string => {
	const walletTypes = [
		'Lightning Wallet',
		'Bitcoin Wallet',
		'Satoshi Wallet',
		'Mobile Wallet',
		'Desktop Wallet',
		'Hardware Wallet',
		'Cold Storage',
		'Hot Wallet',
		'Trading Wallet',
		'Savings Wallet',
	]

	const adjectives = ['Primary', 'Secondary', 'Main', 'Backup', 'Personal', 'Business', 'Travel', 'Emergency', 'Daily', 'Secure']

	const brands = ['Alby', 'Phoenix', 'Breez', 'Zeus', 'BlueWallet', 'Muun', 'Wallet of Satoshi', 'Strike', 'Cash App', 'River']

	const nameType = faker.number.int({ min: 1, max: 3 })

	switch (nameType) {
		case 1:
			// Brand + Type (e.g., "Alby Lightning Wallet")
			return `${faker.helpers.arrayElement(brands)} ${faker.helpers.arrayElement(walletTypes)}`
		case 2:
			// Adjective + Type (e.g., "Primary Bitcoin Wallet")
			return `${faker.helpers.arrayElement(adjectives)} ${faker.helpers.arrayElement(walletTypes)}`
		case 3:
			// Just brand name (e.g., "Phoenix")
			return faker.helpers.arrayElement(brands)
		default:
			return faker.helpers.arrayElement(walletTypes)
	}
}

// Generate a fake but realistic NWC URI
const generateNwcUri = (): { uri: string; pubkey: string; relays: string[] } => {
	// Generate a fake pubkey (64 hex characters)
	const pubkey = faker.string.hexadecimal({ length: 64, prefix: '' })

	// Common relay URLs used in the ecosystem
	const commonRelays = [
		'wss://relay.getalby.com/v1',
		'wss://relay.damus.io',
		'wss://nos.lol',
		'wss://relay.snort.social',
		'wss://relay.nostr.band',
		'wss://nostr-pub.wellorder.net',
		'wss://relay.current.fyi',
		'wss://nostr.wine',
		'wss://relay.orangepill.dev',
		'wss://nostr.fmt.wiz.biz',
	]

	// Pick 1-3 random relays
	const numRelays = faker.number.int({ min: 1, max: 3 })
	const selectedRelays = faker.helpers.arrayElements(commonRelays, numRelays)

	// Generate a fake secret (32 hex characters)
	const secret = faker.string.hexadecimal({ length: 64, prefix: '' })

	// Build the NWC URI
	const relayParam = selectedRelays.map((relay) => `relay=${encodeURIComponent(relay)}`).join('&')
	const uri = `nostr+walletconnect://${pubkey}?${relayParam}&secret=${secret}`

	return {
		uri,
		pubkey,
		relays: selectedRelays,
	}
}

// Generate a fake NWC wallet
export const generateFakeNwcWallet = (): Omit<Wallet, 'id' | 'createdAt' | 'updatedAt'> => {
	const { uri, pubkey, relays } = generateNwcUri()

	return {
		name: generateWalletName(),
		nwcUri: uri,
		pubkey,
		relays,
		storedOnNostr: true, // These will be stored on Nostr
	}
}

// Create and save NWC wallets for a user
export const createUserNwcWallets = async (signer: NDKPrivateKeySigner, userPubkey: string, count: number = 2): Promise<boolean> => {
	try {
		const wallets: Wallet[] = []
		const timestamp = Date.now()

		for (let i = 0; i < count; i++) {
			const walletData = generateFakeNwcWallet()
			const wallet: Wallet = {
				id: uuidv4(),
				...walletData,
				createdAt: timestamp + i, // Slight offset to ensure different timestamps
				updatedAt: timestamp + i,
			}
			wallets.push(wallet)
		}

		// Save wallets to Nostr using the existing function
		await saveUserNwcWallets({ wallets, userPubkey })

		console.log(`Created ${count} NWC wallets for user ${userPubkey.substring(0, 8)}...`)
		wallets.forEach((wallet, index) => {
			console.log(`  ${index + 1}. ${wallet.name} (${wallet.relays.length} relays)`)
		})

		return true
	} catch (error) {
		console.error(`Failed to create NWC wallets for user ${userPubkey.substring(0, 8)}...`, error)
		return false
	}
}
