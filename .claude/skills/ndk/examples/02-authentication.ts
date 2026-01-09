/**
 * NDK Authentication Patterns
 *
 * Examples from: src/lib/stores/auth.ts
 */

import NDK from '@nostr-dev-kit/ndk'
import { NDKNip07Signer, NDKPrivateKeySigner, NDKNip46Signer } from '@nostr-dev-kit/ndk'

// ============================================================
// NIP-07 - BROWSER EXTENSION SIGNER
// ============================================================

const loginWithExtension = async (ndk: NDK) => {
	try {
		// Create NIP-07 signer (browser extension like Alby, nos2x)
		const signer = new NDKNip07Signer()

		// Wait for signer to be ready
		await signer.blockUntilReady()

		// Set signer on NDK instance
		ndk.signer = signer

		// Get authenticated user
		const user = await signer.user()

		console.log('✅ Logged in via extension:', user.npub)
		return { user, signer }
	} catch (error) {
		console.error('❌ Extension login failed:', error)
		throw new Error('Failed to login with browser extension. Is it installed?')
	}
}

// ============================================================
// PRIVATE KEY SIGNER
// ============================================================

const loginWithPrivateKey = async (ndk: NDK, privateKeyHex: string) => {
	try {
		// Validate private key format (64 hex characters)
		if (!/^[0-9a-f]{64}$/.test(privateKeyHex)) {
			throw new Error('Invalid private key format')
		}

		// Create private key signer
		const signer = new NDKPrivateKeySigner(privateKeyHex)

		// Wait for signer to be ready
		await signer.blockUntilReady()

		// Set signer on NDK instance
		ndk.signer = signer

		// Get authenticated user
		const user = await signer.user()

		console.log('✅ Logged in with private key:', user.npub)
		return { user, signer }
	} catch (error) {
		console.error('❌ Private key login failed:', error)
		throw error
	}
}

// ============================================================
// NIP-46 - REMOTE SIGNER (BUNKER)
// ============================================================

const loginWithNip46 = async (ndk: NDK, bunkerUrl: string, localPrivateKey?: string) => {
	try {
		// Create or use existing local signer
		const localSigner = localPrivateKey ? new NDKPrivateKeySigner(localPrivateKey) : NDKPrivateKeySigner.generate()

		// Create NIP-46 remote signer
		const remoteSigner = new NDKNip46Signer(ndk, bunkerUrl, localSigner)

		// Wait for signer to be ready (may require user approval)
		await remoteSigner.blockUntilReady()

		// Set signer on NDK instance
		ndk.signer = remoteSigner

		// Get authenticated user
		const user = await remoteSigner.user()

		console.log('✅ Logged in via NIP-46:', user.npub)

		// Store local signer key for reconnection
		return {
			user,
			signer: remoteSigner,
			localSignerKey: localSigner.privateKey,
		}
	} catch (error) {
		console.error('❌ NIP-46 login failed:', error)
		throw error
	}
}

// ============================================================
// AUTO-LOGIN FROM LOCAL STORAGE
// ============================================================

const STORAGE_KEYS = {
	AUTO_LOGIN: 'nostr:auto-login',
	LOCAL_SIGNER: 'nostr:local-signer',
	BUNKER_URL: 'nostr:bunker-url',
	ENCRYPTED_KEY: 'nostr:encrypted-key',
}

const getAuthFromStorage = async (ndk: NDK) => {
	try {
		// Check if auto-login is enabled
		const autoLogin = localStorage.getItem(STORAGE_KEYS.AUTO_LOGIN)
		if (autoLogin !== 'true') {
			return null
		}

		// Try NIP-46 bunker connection
		const privateKey = localStorage.getItem(STORAGE_KEYS.LOCAL_SIGNER)
		const bunkerUrl = localStorage.getItem(STORAGE_KEYS.BUNKER_URL)

		if (privateKey && bunkerUrl) {
			return await loginWithNip46(ndk, bunkerUrl, privateKey)
		}

		// Try encrypted private key
		const encryptedKey = localStorage.getItem(STORAGE_KEYS.ENCRYPTED_KEY)
		if (encryptedKey) {
			// Would need decryption password from user
			return { needsPassword: true, encryptedKey }
		}

		// Fallback to extension
		return await loginWithExtension(ndk)
	} catch (error) {
		console.error('Auto-login failed:', error)
		return null
	}
}

// ============================================================
// SAVE AUTH TO STORAGE
// ============================================================

const saveAuthToStorage = (
	method: 'extension' | 'private-key' | 'nip46',
	data?: {
		privateKey?: string
		bunkerUrl?: string
		encryptedKey?: string
	},
) => {
	// Enable auto-login
	localStorage.setItem(STORAGE_KEYS.AUTO_LOGIN, 'true')

	if (method === 'nip46' && data?.privateKey && data?.bunkerUrl) {
		localStorage.setItem(STORAGE_KEYS.LOCAL_SIGNER, data.privateKey)
		localStorage.setItem(STORAGE_KEYS.BUNKER_URL, data.bunkerUrl)
	} else if (method === 'private-key' && data?.encryptedKey) {
		localStorage.setItem(STORAGE_KEYS.ENCRYPTED_KEY, data.encryptedKey)
	}
	// Extension doesn't need storage
}

// ============================================================
// LOGOUT
// ============================================================

const logout = (ndk: NDK) => {
	// Remove signer from NDK
	ndk.signer = undefined

	// Clear all auth storage
	Object.values(STORAGE_KEYS).forEach((key) => {
		localStorage.removeItem(key)
	})

	console.log('✅ Logged out successfully')
}

// ============================================================
// GET CURRENT USER
// ============================================================

const getCurrentUser = async (ndk: NDK) => {
	if (!ndk.signer) {
		return null
	}

	try {
		const user = await ndk.signer.user()
		return {
			pubkey: user.pubkey,
			npub: user.npub,
			profile: await user.fetchProfile(),
		}
	} catch (error) {
		console.error('Failed to get current user:', error)
		return null
	}
}

// ============================================================
// USAGE EXAMPLE
// ============================================================

async function authExample(ndk: NDK) {
	// Try auto-login first
	let auth = await getAuthFromStorage(ndk)

	if (!auth) {
		// Manual login options
		console.log('Choose login method:')
		console.log('1. Browser Extension (NIP-07)')
		console.log('2. Private Key')
		console.log('3. Remote Signer (NIP-46)')

		// Example: login with extension
		auth = await loginWithExtension(ndk)
		saveAuthToStorage('extension')
	}

	if (auth && 'needsPassword' in auth) {
		// Handle encrypted key case
		console.log('Password required for encrypted key')
		return
	}

	// Get current user info
	const currentUser = await getCurrentUser(ndk)
	console.log('Current user:', currentUser)

	// Logout when done
	// logout(ndk)
}

export { loginWithExtension, loginWithPrivateKey, loginWithNip46, getAuthFromStorage, saveAuthToStorage, logout, getCurrentUser }
