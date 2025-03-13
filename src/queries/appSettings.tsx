import { useQuery } from '@tanstack/react-query'
import type { AppSettings } from '@/lib/appSettings'
import { appSettingsKeys } from './queryKeyFactory'

interface ConfigResponse {
	appRelay: string
	appSettings: AppSettings
}

async function fetchConfig(): Promise<ConfigResponse> {
	const response = await fetch('/api/config')
	if (!response.ok) {
		throw new Error('Failed to fetch config')
	}
	return response.json()
}

export function useAppSettings() {
	return useQuery({
		queryKey: appSettingsKeys.all,
		queryFn: async () => {
			const config = await fetchConfig()
			return config.appSettings
		},
	})
}
