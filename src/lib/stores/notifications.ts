import { Store } from '@tanstack/store'

// Notification types
export type NotificationType = 'order' | 'message' | 'order-update'

// Per-conversation unseen count
export type ConversationNotifications = Record<string, number> // pubkey -> count

// Notification state interface
export interface NotificationState {
	// Unseen counts
	unseenOrders: number // New orders where user is seller
	unseenMessages: number // New messages in conversations
	unseenPurchases: number // Updates to orders where user is buyer
	unseenByConversation: ConversationNotifications

	// Last seen timestamps (unix timestamp in seconds)
	lastSeenTimestamps: {
		orders: number
		purchases: number
		messages: Record<string, number> // pubkey -> timestamp
	}

	// Track if we've initialized from localStorage
	isInitialized: boolean
}

// LocalStorage key
const STORAGE_KEY = 'nostr-market:notifications'

// Load state from localStorage
const loadFromStorage = (): Partial<NotificationState> => {
	try {
		const stored = localStorage.getItem(STORAGE_KEY)
		if (!stored) return {}
		return JSON.parse(stored)
	} catch (error) {
		console.error('Failed to load notifications from localStorage:', error)
		return {}
	}
}

// Save state to localStorage
const saveToStorage = (state: NotificationState) => {
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				lastSeenTimestamps: state.lastSeenTimestamps,
			}),
		)
	} catch (error) {
		console.error('Failed to save notifications to localStorage:', error)
	}
}

// Initial state
const createInitialState = (): NotificationState => {
	const stored = loadFromStorage()
	return {
		unseenOrders: 0,
		unseenMessages: 0,
		unseenPurchases: 0,
		unseenByConversation: {},
		lastSeenTimestamps: {
			orders: stored.lastSeenTimestamps?.orders || 0,
			purchases: stored.lastSeenTimestamps?.purchases || 0,
			messages: stored.lastSeenTimestamps?.messages || {},
		},
		isInitialized: false,
	}
}

// Create the store
export const notificationStore = new Store<NotificationState>(createInitialState())

// Notification Actions
export const notificationActions = {
	/**
	 * Initialize the notification system
	 * This should be called once when the app starts
	 */
	initialize: () => {
		notificationStore.setState((state) => ({
			...state,
			isInitialized: true,
		}))
	},

	/**
	 * Update unseen order count
	 */
	setUnseenOrders: (count: number) => {
		notificationStore.setState((state) => ({
			...state,
			unseenOrders: Math.max(0, count),
		}))
	},

	/**
	 * Update unseen message count
	 */
	setUnseenMessages: (count: number) => {
		notificationStore.setState((state) => ({
			...state,
			unseenMessages: Math.max(0, count),
		}))
	},

	/**
	 * Update unseen purchase count
	 */
	setUnseenPurchases: (count: number) => {
		notificationStore.setState((state) => ({
			...state,
			unseenPurchases: Math.max(0, count),
		}))
	},

	/**
	 * Update unseen count for a specific conversation
	 */
	setUnseenForConversation: (pubkey: string, count: number) => {
		notificationStore.setState((state) => ({
			...state,
			unseenByConversation: {
				...state.unseenByConversation,
				[pubkey]: Math.max(0, count),
			},
		}))
	},

	/**
	 * Increment unseen order count
	 */
	incrementUnseenOrders: () => {
		notificationStore.setState((state) => ({
			...state,
			unseenOrders: state.unseenOrders + 1,
		}))
	},

	/**
	 * Increment unseen message count for a specific conversation
	 */
	incrementUnseenForConversation: (pubkey: string) => {
		notificationStore.setState((state) => ({
			...state,
			unseenMessages: state.unseenMessages + 1,
			unseenByConversation: {
				...state.unseenByConversation,
				[pubkey]: (state.unseenByConversation[pubkey] || 0) + 1,
			},
		}))
	},

	/**
	 * Increment unseen purchase count
	 */
	incrementUnseenPurchases: () => {
		notificationStore.setState((state) => ({
			...state,
			unseenPurchases: state.unseenPurchases + 1,
		}))
	},

	/**
	 * Mark all orders as seen
	 * Updates the last seen timestamp and resets unseen count
	 */
	markOrdersSeen: () => {
		const now = Math.floor(Date.now() / 1000)
		notificationStore.setState((state) => {
			const newState = {
				...state,
				unseenOrders: 0,
				lastSeenTimestamps: {
					...state.lastSeenTimestamps,
					orders: now,
				},
			}
			saveToStorage(newState)
			return newState
		})
	},

	/**
	 * Mark messages from a specific conversation as seen
	 * If no pubkey provided, marks all messages as seen
	 */
	markMessagesSeen: (pubkey?: string) => {
		const now = Math.floor(Date.now() / 1000)
		notificationStore.setState((state) => {
			if (pubkey) {
				// Mark specific conversation as seen
				const unseenForConvo = state.unseenByConversation[pubkey] || 0
				const newState = {
					...state,
					unseenMessages: Math.max(0, state.unseenMessages - unseenForConvo),
					unseenByConversation: {
						...state.unseenByConversation,
						[pubkey]: 0,
					},
					lastSeenTimestamps: {
						...state.lastSeenTimestamps,
						messages: {
							...state.lastSeenTimestamps.messages,
							[pubkey]: now,
						},
					},
				}
				saveToStorage(newState)
				return newState
			} else {
				// Mark all messages as seen
				const newState = {
					...state,
					unseenMessages: 0,
					unseenByConversation: {},
					lastSeenTimestamps: {
						...state.lastSeenTimestamps,
						messages: Object.keys(state.unseenByConversation).reduce(
							(acc, key) => {
								acc[key] = now
								return acc
							},
							{ ...state.lastSeenTimestamps.messages } as Record<string, number>,
						),
					},
				}
				saveToStorage(newState)
				return newState
			}
		})
	},

	/**
	 * Mark a specific conversation as seen
	 */
	markConversationSeen: (pubkey: string) => {
		notificationActions.markMessagesSeen(pubkey)
	},

	/**
	 * Mark all purchases as seen
	 * Updates the last seen timestamp and resets unseen count
	 */
	markPurchasesSeen: () => {
		const now = Math.floor(Date.now() / 1000)
		notificationStore.setState((state) => {
			const newState = {
				...state,
				unseenPurchases: 0,
				lastSeenTimestamps: {
					...state.lastSeenTimestamps,
					purchases: now,
				},
			}
			saveToStorage(newState)
			return newState
		})
	},

	/**
	 * Get last seen timestamp for orders
	 */
	getLastSeenOrders: (): number => {
		return notificationStore.state.lastSeenTimestamps.orders
	},

	/**
	 * Get last seen timestamp for a specific conversation
	 */
	getLastSeenForConversation: (pubkey: string): number => {
		return notificationStore.state.lastSeenTimestamps.messages[pubkey] || 0
	},

	/**
	 * Get last seen timestamp for purchases
	 */
	getLastSeenPurchases: (): number => {
		return notificationStore.state.lastSeenTimestamps.purchases
	},

	/**
	 * Reset all notifications
	 */
	reset: () => {
		const newState = createInitialState()
		notificationStore.setState(newState)
		localStorage.removeItem(STORAGE_KEY)
	},

	/**
	 * Recalculate unseen counts based on provided events
	 * This is used by the monitor to sync with actual data
	 */
	recalculateFromEvents: (data: {
		orderCount: number
		messageCount: number
		purchaseCount: number
		conversationCounts: ConversationNotifications
	}) => {
		notificationStore.setState((state) => ({
			...state,
			unseenOrders: data.orderCount,
			unseenMessages: data.messageCount,
			unseenPurchases: data.purchaseCount,
			unseenByConversation: data.conversationCounts,
		}))
	},
}

// React hook for consuming the store
export const useNotifications = () => {
	return {
		...notificationStore.state,
		...notificationActions,
	}
}
