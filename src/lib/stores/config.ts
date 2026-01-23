import { Store } from '@tanstack/store'
import type { Stage } from '@/lib/constants'

interface ConfigState {
	config: {
		appRelay?: string
		stage?: Stage
		appSettings?: any
		appPublicKey?: string
		needsSetup?: boolean
		[key: string]: any
	}
	isLoaded: boolean
}

const initialState: ConfigState = {
	config: {},
	isLoaded: false,
}

export const configStore = new Store<ConfigState>(initialState)

export const configActions = {
	setConfig: (config: any) => {
		configStore.setState((state) => ({
			...state,
			config,
			isLoaded: true,
		}))
		return config
	},

	getAppRelay: () => {
		return configStore.state.config.appRelay
	},

	getStage: (): Stage => {
		return configStore.state.config.stage || 'production'
	},

	getAppPublicKey: () => {
		return configStore.state.config.appPublicKey
	},

	getAppSettings: () => {
		return configStore.state.config.appSettings
	},

	needsSetup: () => {
		return configStore.state.config.needsSetup
	},

	isConfigLoaded: () => {
		return configStore.state.isLoaded
	},
}

// React hook for consuming the store
export const useConfig = () => {
	return {
		...configStore.state,
		...configActions,
	}
}
