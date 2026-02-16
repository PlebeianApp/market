import type { Page } from '@playwright/test'

export interface NostrEvent {
	id: string
	pubkey: string
	created_at: number
	kind: number
	tags: string[][]
	content: string
	sig: string
}

export interface CapturedEvent {
	timestamp: number
	direction: 'sent' | 'received'
	relayUrl: string
	/** The parsed Nostr message array, e.g. ["EVENT", <subId>, <event>] or ["REQ", ...] */
	message: any[]
	/** The extracted Nostr event (if this is an EVENT message), or null */
	nostrEvent: NostrEvent | null
}

/**
 * Monitors WebSocket traffic between the app and Nostr relays.
 * Captures sent and received events for assertions in tests.
 */
export class RelayMonitor {
	private events: CapturedEvent[] = []
	private page: Page
	private started = false

	constructor(page: Page) {
		this.page = page
	}

	async start(): Promise<void> {
		if (this.started) return
		this.started = true
		this.events = []

		this.page.on('websocket', (ws) => {
			const url = ws.url()

			// Skip non-relay connections (HMR, etc.)
			if (url.includes('_bun/hmr') || url.includes('__vite')) return

			ws.on('framereceived', (frame) => {
				this.captureFrame('received', url, frame)
			})

			ws.on('framesent', (frame) => {
				this.captureFrame('sent', url, frame)
			})
		})
	}

	private captureFrame(direction: 'sent' | 'received', relayUrl: string, frame: { payload: string | Buffer }): void {
		try {
			const data = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString()
			if (!data) return

			const message = JSON.parse(data)
			if (!Array.isArray(message)) return

			let nostrEvent: NostrEvent | null = null

			// Extract the Nostr event from EVENT messages
			if (message[0] === 'EVENT') {
				// Sent: ["EVENT", <event>]
				// Received: ["EVENT", <subscriptionId>, <event>]
				const eventObj = message.length === 2 ? message[1] : message[2]
				if (eventObj && typeof eventObj === 'object' && 'kind' in eventObj) {
					nostrEvent = eventObj as NostrEvent
				}
			}

			this.events.push({
				timestamp: Date.now(),
				direction,
				relayUrl,
				message,
				nostrEvent,
			})
		} catch {
			// Skip non-JSON frames
		}
	}

	/** Get all captured events */
	getAllEvents(): CapturedEvent[] {
		return [...this.events]
	}

	/** Find events by Nostr kind number */
	findEventsByKind(kind: number): CapturedEvent[] {
		return this.events.filter((e) => e.nostrEvent?.kind === kind)
	}

	/** Find events that the app sent (published) by kind */
	findSentEventsByKind(kind: number): CapturedEvent[] {
		return this.events.filter((e) => e.direction === 'sent' && e.nostrEvent?.kind === kind)
	}

	/** Find events that the app received by kind */
	findReceivedEventsByKind(kind: number): CapturedEvent[] {
		return this.events.filter((e) => e.direction === 'received' && e.nostrEvent?.kind === kind)
	}

	/** Find events by kind and a tag filter */
	findEventsByKindAndTag(kind: number, tagName: string, tagValue: string): CapturedEvent[] {
		return this.events.filter((e) => {
			if (e.nostrEvent?.kind !== kind) return false
			return e.nostrEvent.tags.some((t) => t[0] === tagName && t[1] === tagValue)
		})
	}

	/**
	 * Wait for a specific event to appear. Polls at intervals until found or timeout.
	 * Use with expect().toPass() for a cleaner API:
	 *
	 * ```ts
	 * await expect(async () => {
	 *   const events = monitor.findSentEventsByKind(30402)
	 *   expect(events.length).toBeGreaterThan(0)
	 * }).toPass({ timeout: 10_000 })
	 * ```
	 */
	async waitForEvent(opts: {
		kind: number
		direction?: 'sent' | 'received'
		filter?: (event: NostrEvent) => boolean
		timeout?: number
	}): Promise<CapturedEvent | null> {
		const { kind, direction, filter, timeout = 10_000 } = opts
		const start = Date.now()

		while (Date.now() - start < timeout) {
			const matches = this.events.filter((e) => {
				if (e.nostrEvent?.kind !== kind) return false
				if (direction && e.direction !== direction) return false
				if (filter && !filter(e.nostrEvent!)) return false
				return true
			})

			if (matches.length > 0) {
				return matches[matches.length - 1]
			}

			await new Promise((r) => setTimeout(r, 250))
		}

		return null
	}

	/** Print a summary of captured events to console (for debugging) */
	printSummary(): void {
		console.log(`\nRelay Monitor Summary:`)
		console.log(`  Total frames: ${this.events.length}`)
		console.log(`  Sent: ${this.events.filter((e) => e.direction === 'sent').length}`)
		console.log(`  Received: ${this.events.filter((e) => e.direction === 'received').length}`)

		const kinds = new Map<number, number>()
		for (const e of this.events) {
			if (e.nostrEvent) {
				kinds.set(e.nostrEvent.kind, (kinds.get(e.nostrEvent.kind) || 0) + 1)
			}
		}
		if (kinds.size > 0) {
			console.log(`  Event kinds:`)
			for (const [kind, count] of kinds) {
				console.log(`    Kind ${kind}: ${count}`)
			}
		}
	}

	/** Clear all captured events */
	clear(): void {
		this.events = []
	}
}
