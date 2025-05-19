import { Store } from '@tanstack/store'

// Define types for different UI elements
export type DrawerType = 'cart' | 'createProduct'
export type DialogType = 'login' | 'signup' | 'checkout' | 'product-details' | 'scan-qr'
export type ToastType = 'success' | 'error' | 'warning' | 'info'

// Toast notification structure
export interface Toast {
	id: string
	type: ToastType
	message: string
	duration?: number
}

// UI State interface
export interface UIState {
	drawers: Record<DrawerType, boolean>
	dialogs: Record<DialogType, boolean>
	toasts: Toast[]
	activeElement?: string
	dialogCallbacks?: Partial<Record<DialogType, any>>
}

// Initial state
const initialState: UIState = {
	drawers: {
		cart: false,
		createProduct: false,
	},
	dialogs: {
		login: false,
		signup: false,
		checkout: false,
		'product-details': false,
		'scan-qr': false,
	},
	toasts: [],
	dialogCallbacks: {},
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
		uiStore.setState((state) => ({
			...state,
			dialogs: {
				...state.dialogs,
				[dialog]: false,
			},
			activeElement: state.activeElement === `dialog-${dialog}` ? undefined : state.activeElement,
		}))
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
}

// React hook for consuming the store
export const useUI = () => {
	return {
		...uiStore.state,
		...uiActions,
	}
}
