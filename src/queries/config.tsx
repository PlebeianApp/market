import { useQuery } from '@tanstack/react-query'
import { configKeys } from './queryKeyFactory'
import type { AppSettings } from '../lib/schemas/app'

interface Config {
	appRelay: string
	appSettings: AppSettings | null
	appPublicKey: string
	needsSetup: boolean
}

let cachedConfig: Config | null = null

const fetchConfig = async (): Promise<Config> => {
	const response = await fetch('/api/config')
	if (!response.ok) {
		throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`)
	}
	const config: Config = await response.json()
	console.log('Fetched config:', config)
	cachedConfig = config
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
