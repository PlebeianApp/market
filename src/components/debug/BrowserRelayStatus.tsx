/**
 * BrowserRelayStatus — debug component showing browser relay cache stats.
 *
 * ⚠️ DEBUG ONLY — not intended for production UI yet.
 * This component is useful during development to verify the browser relay
 * is caching events correctly.
 *
 * Usage (dev only):
 * ```tsx
 * import BrowserRelayStatus from '@/components/debug/BrowserRelayStatus'
 *
 * // Add to a debug panel or dev-only route
 * {import.meta.env.DEV && <BrowserRelayStatus />}
 * ```
 */

import { useEffect, useState } from 'react'
import { getCacheStats, initBrowserRelay } from '@/lib/cache/browser-cache'
import { getStorageEstimate } from '@/lib/cache/persist'

interface RelaySummary {
	total_events: number
	kinds?: Record<string, number>
}

/**
 * Debug component showing browser relay cache status.
 * Polls every 5 seconds for updated stats.
 */
export default function BrowserRelayStatus() {
	const [summary, setSummary] = useState<RelaySummary | null>(null)
	const [storage, setStorage] = useState<{ usage: number; quota: number; percent: number } | null>(
		null,
	)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let active = true

		async function fetchStats() {
			try {
				const relay = await initBrowserRelay()
				const stats = await getCacheStats(relay)
				const storageInfo = await getStorageEstimate()

				if (active) {
					setSummary(stats)
					setStorage(storageInfo)
					setError(null)
				}
			} catch (err) {
				if (active) {
					setError(err instanceof Error ? err.message : String(err))
				}
			}
		}

		// Fetch immediately, then every 5 seconds
		fetchStats()
		const interval = setInterval(fetchStats, 5000)

		return () => {
			active = false
			clearInterval(interval)
		}
	}, [])

	const kindEntries = summary?.kinds
		? Object.entries(summary.kinds)
				.sort(([, a], [, b]) => (b as number) - (a as number))
				.slice(0, 8)
		: []

	return (
		<div
			style={{
				padding: '16px',
				margin: '8px 0',
				border: '1px solid #555',
				borderRadius: '8px',
				background: '#1a1a2e',
				color: '#e0e0e0',
				fontFamily: 'monospace',
				fontSize: '13px',
			}}
		>
			<div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#8be9fd' }}>
				🔥 Browser Relay (DEBUG)
			</div>

			{error && <div style={{ color: '#ff5555' }}>Error: {error}</div>}

			{summary && (
				<>
					<div style={{ display: 'flex', gap: '24px', marginBottom: '8px' }}>
						<span>
							<strong>Total Events:</strong>{' '}
							<span style={{ color: '#50fa7b' }}>{summary.total_events.toLocaleString()}</span>
						</span>
						{storage && (
							<span>
								<strong>Storage:</strong>{' '}
								<span style={{ color: '#ffb86c' }}>
									{(storage.usage / 1024 / 1024).toFixed(1)} MB /{' '}
									{(storage.quota / 1024 / 1024).toFixed(0)} MB ({storage.percent.toFixed(1)}%)
								</span>
							</span>
						)}
					</div>

					{kindEntries.length > 0 && (
						<div style={{ marginTop: '8px' }}>
							<strong>Events by Kind:</strong>
							<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginTop: '4px' }}>
								{kindEntries.map(([kind, count]) => (
									<div key={kind}>
										<span style={{ color: '#f8f8f2' }}>kind {kind}:</span>{' '}
										<span style={{ color: '#6272a4' }}>{(count as number).toLocaleString()}</span>
									</div>
								))}
							</div>
						</div>
					)}
				</>
			)}
		</div>
	)
}
