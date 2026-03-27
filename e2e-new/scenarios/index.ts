import { finalizeEvent, type EventTemplate } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils'
import WebSocket from 'ws'
import { devUser1, devUser2, WALLETED_USER_LUD16 } from '../../src/lib/fixtures'
import { RELAY_URL, TEST_APP_PRIVATE_KEY, TEST_APP_PUBLIC_KEY } from '../test-config'
import { seedBase, seedMerchant, seedMarketplace } from 'e2e-new/helpers/seed'

useWebSocketImplementation(WebSocket)

export type ScenarioName = 'none' | 'base' | 'merchant' | 'marketplace'

// Track which scenarios have been seeded in this worker
const seededScenarios = new Set<ScenarioName>()

/**
 * Ensures a scenario has been seeded. Scenarios are cumulative and idempotent
 * within a worker process.
 */
export async function ensureScenario(scenario: ScenarioName): Promise<void> {
	if (scenario === 'none' || seededScenarios.has(scenario)) return

	const relay = await Relay.connect(RELAY_URL)

	try {
		switch (scenario) {
			case 'base':
				await seedBase(relay)
				break
			case 'merchant':
				await ensureScenario('base')
				await seedMerchant(relay)
				break
			case 'marketplace':
				await ensureScenario('merchant')
				await seedMarketplace(relay)
				break
		}

		seededScenarios.add(scenario)
	} finally {
		relay.close()
	}
}

// --- Helper to sign and publish ---

async function publish(relay: Relay, skHex: string, template: EventTemplate) {
	const skBytes = hexToBytes(skHex)
	const event = finalizeEvent(template, skBytes)
	await relay.publish(event)
	return event
}

export async function resetRemoteCartForUser(skHex: string): Promise<void> {
	const relay = await Relay.connect(RELAY_URL)

	try {
		await publish(relay, skHex, {
			kind: 30078,
			created_at: Math.floor(Date.now() / 1000),
			content: JSON.stringify({
				version: 1,
				updatedAt: Math.floor(Date.now() / 1000),
				items: [],
			}),
			tags: [['d', 'plebeian-market-cart']],
		})
	} finally {
		relay.close()
	}
}
