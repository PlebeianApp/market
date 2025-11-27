import { Store } from '@tanstack/store'
import { CURRENCIES } from '@/lib/constants'

// Define types for different UI elements
export type DrawerType = 'cart' | 'createProduct' | 'createCollection' | 'conversation'
export type DialogType = 'login' | 'signup' | 'checkout' | 'product-details' | 'scan-qr' | 'v4v-setup'
export type ToastType = 'success' | 'error' | 'warning' | 'info'
export type SupportedCurrency = (typeof CURRENCIES)[number]

// Toast notification structure
export interface Toast {
	id: string
	type: ToastType
	message: string
	duration?: number
}

// Navigation state type
export type NavigationState = {
	productSourcePath: string | null
	originalResultsPath: string | null // Track the first/original results page
}

// UI State interface
export interface UIState {
	drawers: Record<DrawerType, boolean>
	dialogs: Record<DialogType, boolean>
	toasts: Toast[]
	activeElement?: string
	dialogCallbacks?: Partial<Record<DialogType, any>>
	dashboardTitle: string
	mobileMenuOpen: boolean
	navigation: NavigationState
	selectedCurrency: SupportedCurrency
	conversationPubkey: string | null // Track which conversation to open
}

const getSelectedCurrency = (): SupportedCurrency => {
	const saved = typeof window !== 'undefined' ? localStorage.getItem('selectedCurrency') : null
	return saved && CURRENCIES.includes(saved as SupportedCurrency) ? (saved as SupportedCurrency) : 'USD'
}

// Initial state
const initialState: UIState = {
	drawers: {
		cart: false,
		createProduct: false,
		createCollection: false,
		conversation: false,
	},
	conversationPubkey: null,
	dialogs: {
		login: false,
		signup: false,
		checkout: false,
		'product-details': false,
		'scan-qr': false,
		'v4v-setup': false,
	},
	toasts: [],
	dialogCallbacks: {},
	dashboardTitle: 'DASHBOARD',
	mobileMenuOpen: false,
	navigation: {
		productSourcePath: null,
		originalResultsPath: null,
	},
	selectedCurrency: getSelectedCurrency(),
}

// Create the store
export const uiStore = new Store<UIState>(initialState)

// UI Actions
export const uiActions = {
	// Drawer actions
	openDrawer: (drawer: DrawerType) => {
		uiStore.setState((state) => ({
			...state,
			drawers: {
				...state.drawers,
				[drawer]: true,
			},
			activeElement: `drawer-${drawer}`,
		}))
	},

	closeDrawer: (drawer: DrawerType) => {
		uiStore.setState((state) => ({
			...state,
			drawers: {
				...state.drawers,
				[drawer]: false,
			},
			activeElement: state.activeElement === `drawer-${drawer}` ? undefined : state.activeElement,
		}))
	},

	toggleDrawer: (drawer: DrawerType) => {
		uiStore.setState((state) => ({
			...state,
			drawers: {
				...state.drawers,
				[drawer]: !state.drawers[drawer],
			},
			activeElement: state.drawers[drawer] ? undefined : `drawer-${drawer}`,
		}))
	},

	// Dialog actions
	openDialog: (dialog: DialogType, callback?: any) => {
		uiStore.setState((state) => ({
			...state,
			dialogs: {
				...state.dialogs,
				[dialog]: true,
			},
			dialogCallbacks: {
				...state.dialogCallbacks,
				[dialog]: callback,
			},
			activeElement: `dialog-${dialog}`,
		}))
	},

	closeDialog: (dialog: DialogType) => {
		uiStore.setState((state) => {
			const newCallbacks = { ...state.dialogCallbacks }
			delete newCallbacks[dialog]

			return {
				...state,
				dialogs: {
					...state.dialogs,
					[dialog]: false,
				},
				dialogCallbacks: newCallbacks,
				activeElement: state.activeElement === `dialog-${dialog}` ? undefined : state.activeElement,
			}
		})
	},

	toggleDialog: (dialog: DialogType) => {
		uiStore.setState((state) => ({
			...state,
			dialogs: {
				...state.dialogs,
				[dialog]: !state.dialogs[dialog],
			},
			activeElement: state.dialogs[dialog] ? undefined : `dialog-${dialog}`,
		}))
	},

	// Close all drawers and dialogs
	closeAll: () => {
		uiStore.setState((state) => {
			const drawersClosed = Object.keys(state.drawers).reduce(
				(acc, key) => {
					acc[key as DrawerType] = false
					return acc
				},
				{} as Record<DrawerType, boolean>,
			)

			const dialogsClosed = Object.keys(state.dialogs).reduce(
				(acc, key) => {
					acc[key as DialogType] = false
					return acc
				},
				{} as Record<DialogType, boolean>,
			)

			return {
				...state,
				drawers: drawersClosed,
				dialogs: dialogsClosed,
				activeElement: undefined,
			}
		})
	},

	// Toast actions
	addToast: (toast: Omit<Toast, 'id'>) => {
		const id = Math.random().toString(36).substring(2, 9)

		uiStore.setState((state) => ({
			...state,
			toasts: [...state.toasts, { ...toast, id }],
		}))

		// Auto-remove toast after duration (default: 5000ms)
		const duration = toast.duration || 5000
		setTimeout(() => {
			uiActions.removeToast(id)
		}, duration)

		return id
	},

	removeToast: (id: string) => {
		uiStore.setState((state) => ({
			...state,
			toasts: state.toasts.filter((toast) => toast.id !== id),
		}))
	},

	clearToasts: () => {
		uiStore.setState((state) => ({
			...state,
			toasts: [],
		}))
	},

	// Mobile menu actions
	openMobileMenu: () => {
		uiStore.setState((state) => ({
			...state,
			mobileMenuOpen: true,
			activeElement: 'mobile-menu',
		}))
	},

	closeMobileMenu: () => {
		uiStore.setState((state) => ({
			...state,
			mobileMenuOpen: false,
			activeElement: state.activeElement === 'mobile-menu' ? undefined : state.activeElement,
		}))
	},

	toggleMobileMenu: () => {
		uiStore.setState((state) => ({
			...state,
			mobileMenuOpen: !state.mobileMenuOpen,
			activeElement: state.mobileMenuOpen ? undefined : 'mobile-menu',
		}))
	},

	// Dashboard title action
	setDashboardTitle: (title: string) => {
		uiStore.setState((state) => ({
			...state,
			dashboardTitle: title,
		}))
	},

	// Navigation actions
	setProductSourcePath: (path: string | null) => {
		uiStore.setState((state) => ({
			...state,
			navigation: {
				...state.navigation,
				productSourcePath: path,
				// Only set originalResultsPath if it's not already set and we're setting a new path
				originalResultsPath: state.navigation.originalResultsPath || path,
			},
		}))
	},

	setCollectionSourcePath: (path: string | null) => {
		uiStore.setState((state) => ({
			...state,
			navigation: {
				...state.navigation,
				collectionSourcePath: path,
				// Only set originalResultsPath if it's not already set and we're setting a new path
				originalResultsPath: state.navigation.originalResultsPath || path,
			},
		}))
	},

	clearProductNavigation: () => {
		uiStore.setState((state) => ({
			...state,
			navigation: {
				productSourcePath: null,
				originalResultsPath: null,
			},
		}))
	},

	// Currency actions
	setCurrency: (currency: SupportedCurrency) => {
		if (typeof window !== 'undefined') {
			localStorage.setItem('selectedCurrency', currency)
		}

		uiStore.setState((state) => ({
			...state,
			selectedCurrency: currency,
		}))
	},

	// Conversation actions
	openConversation: (pubkey: string) => {
		uiStore.setState((state) => ({
			...state,
			conversationPubkey: pubkey,
			drawers: {
				...state.drawers,
				conversation: true,
			},
			activeElement: 'drawer-conversation',
		}))
	},

	closeConversation: () => {
		uiStore.setState((state) => ({
			...state,
			conversationPubkey: null,
			drawers: {
				...state.drawers,
				conversation: false,
			},
			activeElement: state.activeElement === 'drawer-conversation' ? undefined : state.activeElement,
		}))
	},
}

// React hook for consuming the store
export const useUI = () => {
	return {
		...uiStore.state,
		...uiActions,
	}
}
