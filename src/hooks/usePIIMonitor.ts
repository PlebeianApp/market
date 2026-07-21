import { useEffect, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'
import { scanForPIIExposure } from '@/lib/utils/piiScanner'
import type { PIIScanResult } from '@/lib/utils/piiScanner'

/**
 * Monitor for PII exposure in user's events
 * This hook should be used once at the app level
 */
export const usePIIMonitor = () => {
	const { user } = useStore(authStore)
	const [hasPII, setHasPII] = useState(false)
	const [scanResult, setScanResult] = useState<PIIScanResult | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	useEffect(() => {
		// Only run if user is authenticated
		if (!user?.pubkey) {
			return
		}

		const scanForPII = async () => {
			setIsLoading(true)
			setError(null)

			try {
				const result = await scanForPIIExposure(user.pubkey)

				setScanResult(result)
				setHasPII(result.hasPII)
			} catch (err) {
				console.error('[PII Monitor] Error during PII scan:', err)
				setError(err as Error)
			} finally {
				setIsLoading(false)
			}
		}

		// Run the scan
		scanForPII()
	}, [user?.pubkey])

	return {
		hasPII,
		scanResult,
		isLoading,
		error,
	}
}
