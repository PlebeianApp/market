export interface LegacyDisablementSignal {
	namespace: string
	revision: number
}

type Listener = (signal: Readonly<LegacyDisablementSignal>) => void

const listeners = new Set<Listener>()
let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
	if (channel || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return channel
	channel = new BroadcastChannel('plebeian-market-coco-v2-authority')
	channel.addEventListener('message', (event: MessageEvent<LegacyDisablementSignal>) => {
		if (!event.data || typeof event.data.namespace !== 'string' || !Number.isSafeInteger(event.data.revision)) return
		for (const listener of listeners) {
			try {
				listener(Object.freeze({ ...event.data }))
			} catch {
				// The durable control record remains authoritative if a local
				// best-effort notification listener fails.
			}
		}
	})
	return channel
}

export function subscribeToLegacyDisablement(listener: Listener): () => void {
	listeners.add(listener)
	getChannel()
	return () => listeners.delete(listener)
}

export function publishLegacyDisablement(signal: LegacyDisablementSignal): void {
	const frozen = Object.freeze({ ...signal })
	for (const listener of listeners) {
		try {
			listener(frozen)
		} catch {
			// Never make a successful durable cutover appear to have failed
			// because a best-effort runtime notification listener threw.
		}
	}
	try {
		getChannel()?.postMessage(frozen)
	} catch {
		// The durable record is authoritative. Broadcast is best-effort only;
		// every explicit writer still re-reads IndexedDB before mutating.
	}
}

export function closeLegacyDisablementChannel(): void {
	channel?.close()
	channel = null
}
