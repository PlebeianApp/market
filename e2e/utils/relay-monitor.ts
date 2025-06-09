import { type Page } from '@playwright/test'

export interface RelayEvent {
	timestamp: number
	type: 'received' | 'sent'
	data: any
}

export class RelayMonitor {
	private events: RelayEvent[] = []
	private page: Page
	private isMonitoring = false

	constructor(page: Page) {
		this.page = page
	}

	async startMonitoring() {
		if (this.isMonitoring) return

		this.isMonitoring = true
		this.events = []

		// Monitor WebSocket connections
		this.page.on('websocket', (ws) => {
			ws.on('framereceived', (payload) => {
				try {
					// The payload from Playwright is an object like { payload: '...' }
					const frameDataString = (payload as any).payload
					if (ws.url().includes('_bun/hmr') || !frameDataString) {
						return
					}
					const data = JSON.parse(frameDataString)
					this.events.push({
						timestamp: Date.now(),
						type: 'received',
						data: { payload: data, type: 'websocket', url: ws.url() },
					})
				} catch (e) {
					// Skip non-JSON frames
				}
			})

			ws.on('framesent', (payload) => {
				try {
					// The payload from Playwright is an object like { payload: '...' }
					const frameDataString = (payload as any).payload
					if (ws.url().includes('_bun/hmr') || !frameDataString) {
						return
					}
					const data = JSON.parse(frameDataString)
					this.events.push({
						timestamp: Date.now(),
						type: 'sent',
						data: { payload: data, type: 'websocket', url: ws.url() },
					})
				} catch (e) {
					// Skip non-JSON frames
				}
			})

			ws.on('close', () => {
				console.log('🔚 WebSocket connection closed:', ws.url())
			})
		})

		// Also monitor console logs for additional debugging
		this.page.on('console', (msg) => {
			const text = msg.text()
			if (text.includes('nostr') || text.includes('relay') || text.includes('EVENT')) {
				this.events.push({
					timestamp: Date.now(),
					type: 'received',
					data: { message: text, type: 'console' },
				})
			}
		})

		// Inject a script to monitor Nostr events from the client side
		await this.page.addInitScript(() => {
			// Monitor WebSocket connections from the page context
			const originalWebSocket = window.WebSocket
			window.WebSocket = class extends originalWebSocket {
				constructor(url: string | URL, protocols?: string | string[]) {
					super(url, protocols)

					console.log('🔗 Client-side WebSocket connection to:', url)

					const originalSend = this.send
					this.send = function (data) {
						try {
							const parsed = JSON.parse(data as string)
							console.log('📤 Client sending to relay:', JSON.stringify(parsed))
						} catch (e) {
							console.log('📤 Client sending non-JSON data to relay')
						}
						return originalSend.call(this, data)
					}

					this.addEventListener('message', (event) => {
						try {
							const parsed = JSON.parse(event.data)
							console.log('📥 Client received from relay:', JSON.stringify(parsed))
						} catch (e) {
							console.log('📥 Client received non-JSON data from relay')
						}
					})
				}
			} as any
		})

		console.log('✅ Relay monitoring started')
	}

	stopMonitoring() {
		this.isMonitoring = false
		console.log('📡 Stopped relay monitoring')
	}

	getEvents(): RelayEvent[] {
		return [...this.events]
	}

	getEventsByType(type: 'received' | 'sent'): RelayEvent[] {
		return this.events.filter((event) => event.type === type)
	}

	findProfileEvents(): RelayEvent[] {
		return this.events.filter((event) => {
			const data = event.data
			if (data.type === 'websocket' && data.payload) {
				// Look for Nostr events with kind 0 (profile/metadata)
				if (Array.isArray(data.payload) && data.payload[0] === 'EVENT') {
					const nostrEvent = data.payload[2] || data.payload[1] // Different relay implementations might use different positions
					return nostrEvent && nostrEvent.kind === 0
				}
			} else if (data.type === 'console' && data.message) {
				// Look for console messages about profile events
				return data.message.includes('kind":0') || data.message.includes('profile')
			}
			return false
		})
	}

	findSetupEvents(): RelayEvent[] {
		return this.events.filter((event) => {
			const data = event.data
			if (data.type === 'websocket' && data.payload) {
				// Look for Nostr events with kind 31990 (app settings)
				if (Array.isArray(data.payload) && data.payload[0] === 'EVENT') {
					const nostrEvent = data.payload[2] || data.payload[1]
					return nostrEvent && nostrEvent.kind === 31990
				}
			}
			return false
		})
	}

	printEventSummary() {
		console.log('\n📊 Relay Event Summary:')
		console.log(`Total events: ${this.events.length}`)
		console.log(`Received: ${this.getEventsByType('received').length}`)
		console.log(`Sent: ${this.getEventsByType('sent').length}`)

		const profileEvents = this.findProfileEvents()
		const setupEvents = this.findSetupEvents()

		console.log(`Profile events (kind 0): ${profileEvents.length}`)
		console.log(`Setup events (kind 31990): ${setupEvents.length}`)

		// Print all events for debugging
		if (this.events.length > 0) {
			console.log('\n📋 All captured events:')
			this.events.forEach((event, index) => {
				const data = event.data
				if (data.type === 'websocket') {
					console.log(`  ${index + 1}. ${event.type} - WebSocket: ${JSON.stringify(data.payload).substring(0, 100)}...`)
				} else if (data.type === 'console') {
					console.log(`  ${index + 1}. ${event.type} - Console: ${data.message.substring(0, 100)}...`)
				}
			})
		}

		if (profileEvents.length > 0) {
			console.log('\n👤 Profile Events:')
			profileEvents.forEach((event, index) => {
				const data = event.data
				if (data.type === 'websocket' && data.payload) {
					const nostrEvent = data.payload[2] || data.payload[1]
					try {
						const content = JSON.parse(nostrEvent.content)
						console.log(
							`  ${index + 1}. ${event.type} - Name: ${content.name || 'N/A'}, Display: ${content.display_name || content.displayName || 'N/A'}`,
						)
					} catch (e) {
						console.log(`  ${index + 1}. ${event.type} - Content: ${nostrEvent.content.substring(0, 50)}...`)
					}
				}
			})
		}

		if (setupEvents.length > 0) {
			console.log('\n⚙️  Setup Events:')
			setupEvents.forEach((event, index) => {
				const data = event.data
				if (data.type === 'websocket' && data.payload) {
					const nostrEvent = data.payload[2] || data.payload[1]
					console.log(`  ${index + 1}. ${event.type} - Event ID: ${nostrEvent.id}`)
				}
			})
		}
	}

	async waitForProfileEvent(timeout = 10000): Promise<RelayEvent | null> {
		const startTime = Date.now()

		while (Date.now() - startTime < timeout) {
			const profileEvents = this.findProfileEvents()
			if (profileEvents.length > 0) {
				return profileEvents[profileEvents.length - 1] // Return latest
			}
			await new Promise((resolve) => setTimeout(resolve, 500))
		}

		return null
	}

	async verifyProfileData(expectedData: any): Promise<boolean> {
		console.log('🔍 Starting profile data verification...')

		const profileEvent = await this.waitForProfileEvent()

		if (!profileEvent) {
			console.log('❌ No profile event found')
			this.printEventSummary() // Print summary to help debug
			return false
		}

		try {
			const data = profileEvent.data
			let content: any

			if (data.type === 'websocket' && data.payload) {
				const nostrEvent = data.payload[2] || data.payload[1]
				content = JSON.parse(nostrEvent.content)
			} else if (data.type === 'console') {
				// Try to extract content from console message
				const match = data.message.match(/content['":][\s]*['"](.*?)['"]/)
				if (match) {
					content = JSON.parse(match[1])
				}
			}

			if (!content) {
				console.log('❌ Could not extract profile content from event')
				return false
			}

			console.log('🔍 Verifying profile data...')
			console.log('Expected:', expectedData)
			console.log('Actual:', content)

			// Check key fields
			const fieldsToCheck = ['name', 'display_name', 'displayName', 'about', 'nip05', 'lud16', 'website']
			let allMatch = true

			for (const field of fieldsToCheck) {
				const expected = expectedData[field] || expectedData[field.replace('_', '')]
				const actual = content[field] || content[field.replace('_', '')]

				if (expected && expected !== actual) {
					console.log(`❌ Field ${field}: expected "${expected}", got "${actual}"`)
					allMatch = false
				}
			}

			if (allMatch) {
				console.log('✅ Profile data verification passed')
			}

			return allMatch
		} catch (e) {
			console.log('❌ Failed to parse profile event:', e)
			return false
		}
	}
}

// Utility function to create a monitor for a test
export async function createRelayMonitor(page: Page): Promise<RelayMonitor> {
	const monitor = new RelayMonitor(page)
	await monitor.startMonitoring()
	return monitor
}
