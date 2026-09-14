import { Store } from '@tanstack/store'

export interface AuctionWonPayload {
	auctionRootEventId: string
	bidEventId: string
	bidAmount: number
}

interface AuctionWonState {
	queue: AuctionWonPayload[]
}

export const auctionWonStore = new Store<AuctionWonState>({ queue: [] })

export const auctionWonActions = {
	enqueue: (payload: AuctionWonPayload) => {
		auctionWonStore.setState((state) =>
			state.queue.some((p) => p.auctionRootEventId === payload.auctionRootEventId) ? state : { queue: [...state.queue, payload] },
		)
	},

	dismissActive: () => {
		auctionWonStore.setState((state) => ({ queue: state.queue.slice(1) }))
	},
}
