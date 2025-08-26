import { Store } from '@tanstack/react-store'

export interface DashboardWidget {
	id: string
	title: string
	description: string
	component: string
	enabled: boolean
}

export interface DashboardLayout {
	top: string[]
	bottom: string[]
	right: string[]
	hidden: string[]
}

const defaultWidgets: DashboardWidget[] = [
	{
		id: 'sales-overview',
		title: 'Sales Overview',
		description: 'Quick view of your sales metrics',
		component: 'SalesOverview',
		enabled: true,
	},
	{
		id: 'top-products',
		title: 'Top Products',
		description: 'Your best selling products',
		component: 'TopProducts',
		enabled: true,
	},
	{
		id: 'sales-chart',
		title: 'Sales Chart',
		description: 'Visual representation of sales data over time',
		component: 'SalesChart',
		enabled: true,
	},
	{
		id: 'latest-messages',
		title: 'Latest Messages',
		description: 'Recent customer messages',
		component: 'LatestMessages',
		enabled: true,
	},
	{
		id: 'nostr-posts',
		title: 'Latest Nostr Posts',
		description: 'Recent posts from the network',
		component: 'NostrPosts',
		enabled: true,
	},
]

const defaultLayout: DashboardLayout = {
	top: ['sales-overview', 'top-products'],
	bottom: ['sales-chart', 'latest-messages'],
	right: ['nostr-posts'],
	hidden: [],
}

export interface DashboardState {
	widgets: DashboardWidget[]
	layout: DashboardLayout
	isOpen: boolean
}

const STORAGE_KEY = 'dashboard:state:v2'

function loadPersistedState(): DashboardState | null {
	if (typeof window === 'undefined') return null
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return null
		const parsed = JSON.parse(raw)
		if (!parsed || typeof parsed !== 'object') return null
		// Minimal shape validation
		if (!parsed.widgets || !parsed.layout) return null
		return parsed as DashboardState
	} catch {
		return null
	}
}

const initialState: DashboardState = loadPersistedState() ?? {
	widgets: defaultWidgets,
	layout: defaultLayout,
	isOpen: false,
}

export const dashboardStore = new Store<DashboardState>(initialState)

// Persist on changes (browser only)
if (typeof window !== 'undefined') {
	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	dashboardStore.subscribe(() => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboardStore.state))
		} catch {
			// ignore write errors
		}
	})
}

function isInAnySection(layout: DashboardLayout, id: string): boolean {
	return (
		layout.top.includes(id) ||
		layout.bottom.includes(id) ||
		layout.right.includes(id) ||
		layout.hidden.includes(id)
	)
}

function removeFromAllSections(layout: DashboardLayout, id: string): DashboardLayout {
	return {
		top: layout.top.filter((x) => x !== id),
		bottom: layout.bottom.filter((x) => x !== id),
		right: layout.right.filter((x) => x !== id),
		hidden: layout.hidden.filter((x) => x !== id),
	}
}

export const dashboardActions = {
	openSettings: () => {
		dashboardStore.setState((state) => ({
			...state,
			isOpen: true,
		}))
	},

	closeSettings: () => {
		dashboardStore.setState((state) => ({
			...state,
			isOpen: false,
		}))
	},

	addWidget: (widgetId: string, section: keyof DashboardLayout) => {
		dashboardStore.setState((state) => {
			const updated: DashboardLayout = removeFromAllSections(state.layout, widgetId)
			// Prevent duplicates; then add to target section
			updated[section] = [...updated[section], widgetId]
			return { ...state, layout: updated }
		})
	},

	moveWidget: (sourceSection: string, destSection: string, sourceIndex: number, destIndex: number) => {
		dashboardStore.setState((state) => {
			const updatedLayout: DashboardLayout = { ...state.layout }
			const isValidSection = (s: string): s is keyof DashboardLayout => ['top','bottom','right','hidden'].includes(s)
			if (!isValidSection(sourceSection) || !isValidSection(destSection)) return state
			const sourceArr = [...updatedLayout[sourceSection]]
			if (sourceIndex < 0 || sourceIndex >= sourceArr.length) return state
			const [movedWidget] = sourceArr.splice(sourceIndex, 1)
			updatedLayout[sourceSection] = sourceArr
			if (!movedWidget) return { ...state, layout: updatedLayout }

			let destArr = [...updatedLayout[destSection]]
			// Clamp destIndex into range
			const clampedIndex = Math.max(0, Math.min(destIndex, destArr.length))

			const capacity = (destSection === 'top' || destSection === 'bottom') ? 2 : Infinity
			if (destArr.length >= capacity && capacity !== Infinity) {
				// Replace at index; push replaced to hidden
				const replaceIndex = Math.max(0, Math.min(clampedIndex, capacity - 1))
				const replaced = destArr[replaceIndex]
				destArr[replaceIndex] = movedWidget
				updatedLayout[destSection] = destArr
				if (replaced) {
					updatedLayout.hidden = [...updatedLayout.hidden, replaced]
				}
			} else {
				// Insert at target position
				destArr.splice(clampedIndex, 0, movedWidget)
				updatedLayout[destSection] = destArr
			}

			return { ...state, layout: updatedLayout }
		})
	},

	removeWidget: (section: keyof DashboardLayout, index: number) => {
		dashboardStore.setState((state) => {
			const updatedLayout: DashboardLayout = { ...state.layout }
			const arr = [...updatedLayout[section]]
			if (index < 0 || index >= arr.length) return state
			const [removedWidget] = arr.splice(index, 1)
			updatedLayout[section] = arr
			if (removedWidget) updatedLayout.hidden = [...updatedLayout.hidden, removedWidget]
			return { ...state, layout: updatedLayout }
		})
	},

	resetToDefaults: () => {
		dashboardStore.setState({ widgets: defaultWidgets, layout: defaultLayout, isOpen: false })
	},

	replaceLayout: (layout: DashboardLayout) => {
		dashboardStore.setState((state) => ({ ...state, layout }))
	},

	getWidgetById: (widgetId: string) => {
		const state = dashboardStore.state
		return state.widgets.find((w) => w.id === widgetId)
	},

	getLayoutWidgets: (section: keyof DashboardLayout) => {
		const state = dashboardStore.state
		return state.layout[section].map((id) => state.widgets.find((w) => w.id === id)).filter(Boolean) as DashboardWidget[]
	},

	getAvailableWidgets: (): DashboardWidget[] => {
		const state = dashboardStore.state
		return state.widgets.filter((w) => !isInAnySection(state.layout, w.id))
	},
}
