import { Store } from '@tanstack/store'

export interface AuctionWonPayload {
	bidderPubkey: string
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
			state.queue.some((win) => win.bidderPubkey === payload.bidderPubkey && win.auctionRootEventId === payload.auctionRootEventId)
				? state
				: { queue: [...state.queue, payload] },
		)
	},

	dismissActive: () => {
		auctionWonStore.setState((state) => ({ queue: state.queue.slice(1) }))
	},

	removeForAuction: (auctionRootEventId: string) => {
		auctionWonStore.setState((state) => ({
			queue: state.queue.filter((win) => win.auctionRootEventId !== auctionRootEventId),
		}))
	},

	clear: () => {
		auctionWonStore.setState(() => ({ queue: [] }))
	},

	retainForBidder: (bidderPubkey: string) => {
		auctionWonStore.setState((state) => ({ queue: state.queue.filter((win) => win.bidderPubkey === bidderPubkey) }))
	},
}
