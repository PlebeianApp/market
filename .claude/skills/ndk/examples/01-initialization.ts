/**
 * NDK Initialization Patterns
 *
 * Examples from: src/lib/stores/ndk.ts
 */

import NDK from '@nostr-dev-kit/ndk'

// ============================================================
// BASIC INITIALIZATION
// ============================================================

const basicInit = () => {
	const ndk = new NDK({
		explicitRelayUrls: ['wss://relay.damus.io', 'wss://relay.nostr.band'],
	})

	return ndk
}

// ============================================================
// PRODUCTION PATTERN - WITH MULTIPLE NDK INSTANCES
// ============================================================

const productionInit = (relays: string[], zapRelays: string[]) => {
	// Main NDK instance for general operations
	const ndk = new NDK({
		explicitRelayUrls: relays,
	})

	// Separate NDK for zap operations (performance optimization)
	const zapNdk = new NDK({
		explicitRelayUrls: zapRelays,
	})

	return { ndk, zapNdk }
}

// ============================================================
// CONNECTION WITH TIMEOUT
// ============================================================

const connectWithTimeout = async (ndk: NDK, timeoutMs: number = 10000): Promise<void> => {
	// Create connection promise
	const connectPromise = ndk.connect()

	// Create timeout promise
	const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeoutMs))

	try {
		// Race between connection and timeout
		await Promise.race([connectPromise, timeoutPromise])
		console.log('✅ NDK connected successfully')
	} catch (error) {
		if (error instanceof Error && error.message === 'Connection timeout') {
			console.error('❌ Connection timed out after', timeoutMs, 'ms')
		} else {
			console.error('❌ Connection failed:', error)
		}
		throw error
	}
}

// ============================================================
// FULL INITIALIZATION FLOW
// ============================================================

interface InitConfig {
	relays?: string[]
	zapRelays?: string[]
	timeoutMs?: number
}

const defaultRelays = ['wss://relay.damus.io', 'wss://relay.nostr.band', 'wss://nos.lol']

const defaultZapRelays = ['wss://relay.damus.io', 'wss://nostr.wine']

const initializeNDK = async (config: InitConfig = {}) => {
	const { relays = defaultRelays, zapRelays = defaultZapRelays, timeoutMs = 10000 } = config

	// Initialize instances
	const ndk = new NDK({ explicitRelayUrls: relays })
	const zapNdk = new NDK({ explicitRelayUrls: zapRelays })

	// Connect with timeout protection
	try {
		await connectWithTimeout(ndk, timeoutMs)
		await connectWithTimeout(zapNdk, timeoutMs)

		return { ndk, zapNdk, isConnected: true }
	} catch (error) {
		return { ndk, zapNdk, isConnected: false, error }
	}
}

// ============================================================
// CHECKING CONNECTION STATUS
// ============================================================

const getConnectionStatus = (ndk: NDK) => {
	const connectedRelays = Array.from(ndk.pool?.relays.values() || [])
		.filter((relay) => relay.status === 1)
		.map((relay) => relay.url)

	const isConnected = connectedRelays.length > 0

	return {
		isConnected,
		connectedRelays,
		totalRelays: ndk.pool?.relays.size || 0,
	}
}

// ============================================================
// USAGE EXAMPLE
// ============================================================

async function main() {
	// Initialize
	const { ndk, zapNdk, isConnected } = await initializeNDK({
		relays: defaultRelays,
		zapRelays: defaultZapRelays,
		timeoutMs: 10000,
	})

	if (!isConnected) {
		console.error('Failed to connect to relays')
		return
	}

	// Check status
	const status = getConnectionStatus(ndk)
	console.log('Connection status:', status)

	// Ready to use
	console.log('NDK ready for operations')
}

export { basicInit, productionInit, connectWithTimeout, initializeNDK, getConnectionStatus }
