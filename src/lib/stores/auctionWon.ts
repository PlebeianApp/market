import { Store } from '@tanstack/store'

export interface AuctionWonPayload {
	auctionRootEventId: string
	bidEventId: string
	bidAmount: number
	userPubkey: string
}

interface AuctionWonState {
	queue: AuctionWonPayload[]
}

const dismissedStorageKey = (pubkey: string) => `plebeian-market:auction-won-dismissed:${pubkey}`

const loadDismissedIds = (pubkey: string): Set<string> => {
	if (typeof window === 'undefined') return new Set()
	try {
		const raw = localStorage.getItem(dismissedStorageKey(pubkey))
		return raw ? new Set(JSON.parse(raw)) : new Set()
	} catch {
		return new Set()
	}
}

const saveDismissedIds = (pubkey: string, ids: Set<string>) => {
	if (typeof window === 'undefined') return
	try {
		localStorage.setItem(dismissedStorageKey(pubkey), JSON.stringify(Array.from(ids)))
	} catch {
		// Ignore quota/serialization errors - the modal may reappear after a reload.
	}
}

export const auctionWonStore = new Store<AuctionWonState>({ queue: [] })

export const auctionWonActions = {
	hasBeenDismissed: (pubkey: string, auctionRootEventId: string): boolean => loadDismissedIds(pubkey).has(auctionRootEventId),

	enqueue: (payload: AuctionWonPayload) => {
		auctionWonStore.setState((state) =>
			state.queue.some((p) => p.auctionRootEventId === payload.auctionRootEventId) ? state : { queue: [...state.queue, payload] },
		)
	},

	dismissActive: () => {
		auctionWonStore.setState((state) => {
			const active = state.queue[0]
			if (active) {
				const dismissedIds = loadDismissedIds(active.userPubkey)
				dismissedIds.add(active.auctionRootEventId)
				saveDismissedIds(active.userPubkey, dismissedIds)
			}
			return { queue: state.queue.slice(1) }
		})
	},
}
