/**
 * Script to encrypt the TEST_WALLET NWC string using APP_PRIVATE_KEY
 * and save it to a file that can be checked into version control.
 *
 * Usage: bun run scripts/encrypt_test_wallet.ts
 *
 * This script reads TEST_WALLET from .env and encrypts it with APP_PRIVATE_KEY.
 * The encrypted data is saved to scripts/encrypted_test_wallet.json
 */

import { nip04 } from 'nostr-tools'
import { getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils.js'
import fs from 'fs'
import path from 'path'

const TEST_WALLET = process.env.TEST_WALLET
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY

async function encryptTestWallet() {
	if (!TEST_WALLET) {
		console.error('❌ TEST_WALLET environment variable is not set')
		console.log('Please set TEST_WALLET in your .env file with a valid nostr+walletconnect:// URI')
		process.exit(1)
	}

	if (!APP_PRIVATE_KEY) {
		console.error('❌ APP_PRIVATE_KEY environment variable is not set')
		console.log('Please set APP_PRIVATE_KEY in your .env file')
		process.exit(1)
	}

	// Validate the NWC URI format
	if (!TEST_WALLET.startsWith('nostr+walletconnect://')) {
		console.error('❌ TEST_WALLET does not appear to be a valid NWC URI')
		console.log('Expected format: nostr+walletconnect://<pubkey>?relay=...&secret=...')
		process.exit(1)
	}

	try {
		// Derive the public key from the private key
		const appPubkey = getPublicKey(hexToBytes(APP_PRIVATE_KEY))

		// Encrypt the wallet string using NIP-04 (symmetric encryption with own pubkey)
		// This makes the encrypted data only decryptable by the same private key
		const encryptedWallet = await nip04.encrypt(APP_PRIVATE_KEY, appPubkey, TEST_WALLET)

		// Create the output object
		const output = {
			version: 1,
			description: 'Encrypted NWC test wallet for seeding. Decrypt with APP_PRIVATE_KEY.',
			encryptedWith: 'nip04',
			appPubkey: appPubkey,
			encryptedWallet: encryptedWallet,
			createdAt: new Date().toISOString(),
		}

		// Write to file
		const outputPath = path.join(__dirname, 'encrypted_test_wallet.json')
		fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))

		console.log('✅ Successfully encrypted TEST_WALLET')
		console.log(`📁 Saved to: ${outputPath}`)
		console.log(`🔐 Encrypted with app pubkey: ${appPubkey.substring(0, 16)}...`)
		console.log('')
		console.log('You can now check in scripts/encrypted_test_wallet.json to version control.')
		console.log('The wallet seeding will automatically use this if APP_PRIVATE_KEY can decrypt it.')
	} catch (error) {
		console.error('❌ Failed to encrypt TEST_WALLET:', error)
		process.exit(1)
	}
}

encryptTestWallet()
