import { useQuery } from '@tanstack/react-query'
import { configKeys } from './queryKeyFactory'
import type { PublicAppConfig } from '@/lib/instance-config'
import { configActions } from '@/lib/stores/config'

let cachedConfig: PublicAppConfig | null = null

const fetchConfig = async (): Promise<PublicAppConfig> => {
	const response = await fetch('/api/config')
	if (!response.ok) {
		throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`)
	}
	const config: PublicAppConfig = await response.json()
	console.log('Fetched config:', config)
	cachedConfig = config
	configActions.setConfig(config)
	return config
}

export const getConfig = () => cachedConfig

export const useConfigQuery = () => {
	return useQuery({
		queryKey: configKeys.all,
		queryFn: fetchConfig,
		staleTime: cachedConfig?.needsSetup ? 0 : Infinity,
		retry: 3,
		refetchOnWindowFocus: cachedConfig?.needsSetup ? true : false,
	})
}
