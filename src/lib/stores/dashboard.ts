import { Store } from '@tanstack/react-store'

export interface DashboardWidget {
	id: string
	title: string
	description: string
	component: string
	position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'right' | 'hidden'
	enabled: boolean
}

export interface DashboardLayout {
	topLeft: string | null
	topRight: string | null
	bottomLeft: string | null
	bottomRight: string | null
	right: string | null
	hidden: string[]
}

const defaultWidgets: DashboardWidget[] = [
	{
		id: 'sales-overview',
		title: 'Sales Overview',
		description: 'Quick view of your sales metrics',
		component: 'SalesOverview',
		position: 'top-left',
		enabled: true,
	},
	{
		id: 'top-products',
		title: 'Top Products',
		description: 'Your best selling products',
		component: 'TopProducts',
		position: 'top-right',
		enabled: true,
	},
	{
		id: 'sales-chart',
		title: 'Sales Trend',
		description: 'Visual representation of sales data over time',
		component: 'SalesChart',
		position: 'bottom-left',
		enabled: true,
	},
	{
		id: 'latest-messages',
		title: 'Latest Messages',
		description: 'Recent customer messages',
		component: 'LatestMessages',
		position: 'bottom-right',
		enabled: true,
	},
	{
		id: 'nostr-posts',
		title: 'Latest Nostr Posts',
		description: 'Recent posts from the network',
		component: 'NostrPosts',
		position: 'right',
		enabled: true,
	},
]

const defaultLayout: DashboardLayout = {
	topLeft: 'sales-overview',
	topRight: 'top-products',
	bottomLeft: 'sales-chart',
	bottomRight: 'latest-messages',
	right: 'nostr-posts',
	hidden: [],
}

export interface DashboardState {
	widgets: DashboardWidget[]
	layout: DashboardLayout
	isSettingsOpen: boolean
}

const initialState: DashboardState = {
	widgets: defaultWidgets,
	layout: defaultLayout,
	isSettingsOpen: false,
}

export const dashboardStore = new Store<DashboardState>(initialState)

export const dashboardActions = {
	addWidget: (widget: DashboardWidget) => {
		dashboardStore.setState((state) => ({
			...state,
			widgets: [...state.widgets, widget],
		}))
	},

	removeWidget: (widgetId: string) => {
		dashboardStore.setState((state) => {
			const updatedLayout = { ...state.layout }
			
			// Remove from layout positions
			Object.keys(updatedLayout).forEach((key) => {
				if (key !== 'hidden' && updatedLayout[key as keyof Omit<DashboardLayout, 'hidden'>] === widgetId) {
					updatedLayout[key as keyof Omit<DashboardLayout, 'hidden'>] = null
				}
			})
			
			// Remove from hidden array
			updatedLayout.hidden = updatedLayout.hidden.filter(id => id !== widgetId)

			return {
				...state,
				widgets: state.widgets.filter(w => w.id !== widgetId),
				layout: updatedLayout,
			}
		})
	},

	updateWidget: (widgetId: string, updates: Partial<DashboardWidget>) => {
		dashboardStore.setState((state) => ({
			...state,
			widgets: state.widgets.map(w => 
				w.id === widgetId ? { ...w, ...updates } : w
			),
		}))
	},

	moveWidget: (widgetId: string, newPosition: DashboardWidget['position']) => {
		dashboardStore.setState((state) => {
			const updatedLayout = { ...state.layout }
			
			// Find the current position of the widget being moved
			let currentPosition: DashboardWidget['position'] | null = null
			Object.keys(updatedLayout).forEach((key) => {
				if (key === 'hidden') {
					if (updatedLayout.hidden.includes(widgetId)) {
						currentPosition = 'hidden'
					}
				} else if (updatedLayout[key as keyof Omit<DashboardLayout, 'hidden'>] === widgetId) {
					currentPosition = key as DashboardWidget['position']
				}
			})

			// Remove widget from current position
			Object.keys(updatedLayout).forEach((key) => {
				if (key === 'hidden') {
					updatedLayout.hidden = updatedLayout.hidden.filter(id => id !== widgetId)
				} else if (updatedLayout[key as keyof Omit<DashboardLayout, 'hidden'>] === widgetId) {
					updatedLayout[key as keyof Omit<DashboardLayout, 'hidden'>] = null
				}
			})

			// Place widget in new position
			if (newPosition === 'hidden') {
				updatedLayout.hidden.push(widgetId)
			} else {
				// Check if position is occupied
				const currentWidgetInPosition = updatedLayout[newPosition]
				if (currentWidgetInPosition) {
					// If we're swapping within the same section (both have positions), swap them
					if (currentPosition && currentPosition !== 'hidden' && 
						((currentPosition === 'top-left' || currentPosition === 'top-right') && 
						 (newPosition === 'top-left' || newPosition === 'top-right')) ||
						((currentPosition === 'bottom-left' || currentPosition === 'bottom-right') && 
						 (newPosition === 'bottom-left' || newPosition === 'bottom-right'))) {
						// Swap the widgets
						updatedLayout[currentPosition] = currentWidgetInPosition
					} else {
						// Otherwise, move displaced widget to hidden
						updatedLayout.hidden.push(currentWidgetInPosition)
					}
				}
				updatedLayout[newPosition] = widgetId
			}

			return {
				...state,
				layout: updatedLayout,
				widgets: state.widgets.map(w => 
					w.id === widgetId ? { ...w, position: newPosition } : w
				),
			}
		})
	},

	autoLayout: () => {
		dashboardStore.setState((state) => {
			const enabledWidgets = state.widgets.filter(w => w.enabled)
			const positions: (keyof Omit<DashboardLayout, 'hidden'>)[] = [
				'topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'right'
			]
			
			const newLayout: DashboardLayout = {
				topLeft: null,
				topRight: null,
				bottomLeft: null,
				bottomRight: null,
				right: null,
				hidden: [],
			}

			enabledWidgets.forEach((widget, index) => {
				if (index < positions.length) {
					newLayout[positions[index]] = widget.id
				} else {
					newLayout.hidden.push(widget.id)
				}
			})

			return {
				...state,
				layout: newLayout,
			}
		})
	},

	openSettings: () => {
		dashboardStore.setState((state) => ({
			...state,
			isSettingsOpen: true,
		}))
	},

	closeSettings: () => {
		dashboardStore.setState((state) => ({
			...state,
			isSettingsOpen: false,
		}))
	},

	resetToDefaults: () => {
		dashboardStore.setState(() => ({
			widgets: defaultWidgets,
			layout: defaultLayout,
			isSettingsOpen: false,
		}))
	},
}

// Helper functions
export const getWidgetById = (state: DashboardState, id: string) => {
	return state.widgets.find(w => w.id === id)
}

export const getWidgetsByPosition = (state: DashboardState, position: DashboardWidget['position']) => {
	if (position === 'hidden') {
		return state.layout.hidden.map(id => getWidgetById(state, id)).filter(Boolean) as DashboardWidget[]
	}
	const widgetId = state.layout[position]
	return widgetId ? [getWidgetById(state, widgetId)].filter(Boolean) as DashboardWidget[] : []
}

export const getLayoutWidgets = (state: DashboardState) => {
	return {
		topLeft: state.layout.topLeft ? getWidgetById(state, state.layout.topLeft) : null,
		topRight: state.layout.topRight ? getWidgetById(state, state.layout.topRight) : null,
		bottomLeft: state.layout.bottomLeft ? getWidgetById(state, state.layout.bottomLeft) : null,
		bottomRight: state.layout.bottomRight ? getWidgetById(state, state.layout.bottomRight) : null,
		right: state.layout.right ? getWidgetById(state, state.layout.right) : null,
		hidden: state.layout.hidden.map(id => getWidgetById(state, id)).filter(Boolean) as DashboardWidget[],
	}
}
