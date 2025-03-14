import { appService } from '@/lib/services/appService'
import { useQuery } from '@tanstack/react-query'
import { appSettingsKeys } from './queryKeyFactory'

export function useAppSettings() {
	return useQuery({
		queryKey: appSettingsKeys.all,
		queryFn: () => {
			const config = appService.getConfig()
			if (!config) {
				throw new Error('App service not initialized')
			}
			return config
		},
	})
}
