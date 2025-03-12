import { useQuery } from '@tanstack/react-query'
import { configKeys } from './queryKeyFactory'

interface Config {
	appRelay: string
}

const fetchConfig = async (): Promise<Config> => {
	const response = await fetch('/api/config')
	if (!response.ok) {
		throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`)
	}
	return response.json()
}

export const useConfigQuery = () => {
	return useQuery({
		queryKey: configKeys.all,
		queryFn: fetchConfig,
		staleTime: Infinity,
		retry: 3,
	})
}
