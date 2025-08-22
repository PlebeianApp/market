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

const initialState: DashboardState = {
	widgets: defaultWidgets,
	layout: defaultLayout,
	isOpen: false,
}

export const dashboardStore = new Store<DashboardState>(initialState)

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
			const updatedLayout = { ...state.layout }
			updatedLayout[section] = [...updatedLayout[section], widgetId]
			return {
				...state,
				layout: updatedLayout,
			}
		})
	},

	moveWidget: (sourceSection: string, destSection: string, sourceIndex: number, destIndex: number) => {
		dashboardStore.setState((state) => {
			const updatedLayout = { ...state.layout }
			
			// Remove from source
			const sourceWidgets = [...updatedLayout[sourceSection as keyof DashboardLayout]]
			const [movedWidget] = sourceWidgets.splice(sourceIndex, 1)
			updatedLayout[sourceSection as keyof DashboardLayout] = sourceWidgets
			
			// Add to destination
			const destWidgets = [...updatedLayout[destSection as keyof DashboardLayout]]
			destWidgets.splice(destIndex, 0, movedWidget)
			updatedLayout[destSection as keyof DashboardLayout] = destWidgets
			
			return {
				...state,
				layout: updatedLayout,
			}
		})
	},

	removeWidget: (section: keyof DashboardLayout, index: number) => {
		dashboardStore.setState((state) => {
			const updatedLayout = { ...state.layout }
			const [removedWidget] = updatedLayout[section].splice(index, 1)
			updatedLayout.hidden = [...updatedLayout.hidden, removedWidget]
			
			return {
				...state,
				layout: updatedLayout,
			}
		})
	},

	resetToDefaults: () => {
		dashboardStore.setState(initialState)
	},

	getWidgetById: (widgetId: string) => {
		const state = dashboardStore.state
		return state.widgets.find(w => w.id === widgetId)
	},

	getLayoutWidgets: (section: keyof DashboardLayout) => {
		const state = dashboardStore.state
		return state.layout[section].map(id => state.widgets.find(w => w.id === id)).filter(Boolean) as DashboardWidget[]
	},
}
