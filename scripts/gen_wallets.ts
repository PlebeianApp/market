import { v4 as uuidv4 } from 'uuid'
import type { Wallet } from '@/lib/stores/wallet'
import { saveUserNwcWallets } from '@/publish/wallet'
import type { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { nip04 } from 'nostr-tools'
import { getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils'
import fs from 'fs'
import path from 'path'

// Cached decrypted wallet URI (null means not attempted, undefined means failed)
let cachedTestWallet: string | null | undefined = null

/**
 * Interface for the encrypted wallet file format
 */
interface EncryptedWalletFile {
	version: number
	description: string
	encryptedWith: string
	appPubkey: string
	encryptedWallet: string
	createdAt: string
}

/**
 * Parse an NWC URI to extract pubkey and relays
 */
function parseNwcUri(uri: string): { pubkey: string; relays: string[] } | null {
	try {
		// Format: nostr+walletconnect://<pubkey>?relay=...&relay=...&secret=...
		if (!uri.startsWith('nostr+walletconnect://')) {
			return null
		}

		const url = new URL(uri.replace('nostr+walletconnect://', 'https://'))
		const pubkey = url.hostname || url.pathname.replace('//', '')
		const relays = url.searchParams.getAll('relay')

		if (!pubkey || pubkey.length !== 64) {
			return null
		}

		return { pubkey, relays }
	} catch {
		return null
	}
}

/**
 * Try to load and decrypt the test wallet from the encrypted file.
 * Returns the decrypted NWC URI string, or null if decryption fails.
 */
export async function loadTestWallet(appPrivateKey: string): Promise<string | null> {
	// Return cached result if we've already attempted
	if (cachedTestWallet !== null) {
		return cachedTestWallet === undefined ? null : cachedTestWallet
	}

	const encryptedWalletPath = path.join(__dirname, 'encrypted_test_wallet.json')

	// Check if the encrypted wallet file exists
	if (!fs.existsSync(encryptedWalletPath)) {
		console.log('📭 No encrypted_test_wallet.json found - skipping wallet seeding')
		cachedTestWallet = undefined
		return null
	}

	try {
		// Read and parse the encrypted wallet file
		const fileContent = fs.readFileSync(encryptedWalletPath, 'utf-8')
		const encryptedData: EncryptedWalletFile = JSON.parse(fileContent)

		// Validate the file format
		if (encryptedData.version !== 1 || encryptedData.encryptedWith !== 'nip04') {
			console.warn('⚠️ Encrypted wallet file has unexpected format - skipping wallet seeding')
			cachedTestWallet = undefined
			return null
		}

		// Derive our pubkey and check it matches
		const ourPubkey = getPublicKey(hexToBytes(appPrivateKey))
		if (ourPubkey !== encryptedData.appPubkey) {
			console.warn('🔐 APP_PRIVATE_KEY does not match the key used to encrypt the wallet - skipping wallet seeding')
			cachedTestWallet = undefined
			return null
		}

		// Decrypt the wallet
		const decryptedWallet = await nip04.decrypt(appPrivateKey, encryptedData.appPubkey, encryptedData.encryptedWallet)

		// Validate it's a proper NWC URI
		if (!decryptedWallet.startsWith('nostr+walletconnect://')) {
			console.warn('⚠️ Decrypted content is not a valid NWC URI - skipping wallet seeding')
			cachedTestWallet = undefined
			return null
		}

		console.log('🔓 Successfully decrypted test wallet from encrypted_test_wallet.json')
		cachedTestWallet = decryptedWallet
		return decryptedWallet
	} catch (error) {
		console.warn('⚠️ Failed to decrypt test wallet - skipping wallet seeding:', error instanceof Error ? error.message : error)
		cachedTestWallet = undefined
		return null
	}
}

/**
 * Generate wallet names for test wallets
 */
const walletNames = ['Primary Lightning Wallet', 'Backup Wallet', 'Daily Spending', 'Savings Wallet', 'Business Wallet']

/**
 * Create and save NWC wallets for a user using the encrypted test wallet.
 * If the test wallet cannot be decrypted, this function does nothing.
 *
 * @param signer - The NDK signer for the user
 * @param userPubkey - The user's public key
 * @param count - Number of wallet "names" to create (they all use the same NWC URI)
 * @param appPrivateKey - The APP_PRIVATE_KEY for decrypting the test wallet
 */
export const createUserNwcWallets = async (
	signer: NDKPrivateKeySigner,
	userPubkey: string,
	count: number = 2,
	appPrivateKey?: string,
): Promise<boolean> => {
	// If no app private key provided, skip wallet creation
	if (!appPrivateKey) {
		console.log(`⏭️ No APP_PRIVATE_KEY provided - skipping NWC wallet creation for ${userPubkey.substring(0, 8)}...`)
		return false
	}

	// Try to load the test wallet
	const testWalletUri = await loadTestWallet(appPrivateKey)
	if (!testWalletUri) {
		// loadTestWallet already logs why it failed
		return false
	}

	// Parse the NWC URI to get pubkey and relays
	const parsed = parseNwcUri(testWalletUri)
	if (!parsed) {
		console.warn(`⚠️ Failed to parse test wallet URI - skipping wallet creation`)
		return false
	}

	try {
		const wallets: Wallet[] = []
		const timestamp = Date.now()

		// Create wallets with different names but the same NWC URI
		for (let i = 0; i < count; i++) {
			const wallet: Wallet = {
				id: uuidv4(),
				name: walletNames[i % walletNames.length],
				nwcUri: testWalletUri,
				pubkey: parsed.pubkey,
				relays: parsed.relays,
				storedOnNostr: true,
				createdAt: timestamp + i,
				updatedAt: timestamp + i,
			}
			wallets.push(wallet)
		}

		// Save wallets to Nostr using the existing function
		await saveUserNwcWallets({ wallets, userPubkey })

		console.log(`✅ Created ${count} NWC wallets for user ${userPubkey.substring(0, 8)}... (using real test wallet)`)
		wallets.forEach((wallet, index) => {
			console.log(`  ${index + 1}. ${wallet.name} (${wallet.relays.length} relays)`)
		})

		return true
	} catch (error) {
		console.error(`❌ Failed to create NWC wallets for user ${userPubkey.substring(0, 8)}...`, error)
		return false
	}
}
