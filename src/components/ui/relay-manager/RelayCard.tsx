import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { NDKRelay } from '@nostr-dev-kit/ndk'
import { NDKRelayStatus } from '@nostr-dev-kit/ndk'
import { Trash2, Wifi, WifiOff, Globe } from 'lucide-react'
import { useState, useEffect } from 'react'

interface RelayCardProps {
	relay: NDKRelay
	onRemove: (relayUrl: string) => void
	type: 'explicit' | 'outbox'
}

export function RelayCard({ relay, onRemove, type }: RelayCardProps) {
	const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected')

	useEffect(() => {
		const updateStatus = () => {
			if (relay.connectivity.status === NDKRelayStatus.CONNECTED) {
				setStatus('connected')
			} else if (relay.connectivity.status === NDKRelayStatus.CONNECTING) {
				setStatus('connecting')
			} else {
				setStatus('disconnected')
			}
		}

		// Initial status
		updateStatus()

		// Listen for status changes
		relay.on('connect', updateStatus)
		relay.on('disconnect', updateStatus)

		return () => {
			relay.off('connect', updateStatus)
			relay.off('disconnect', updateStatus)
		}
	}, [relay])

	const getStatusIcon = () => {
		switch (status) {
			case 'connected':
				return <Wifi className="w-4 h-4 text-green-500" />
			case 'connecting':
				return <Wifi className="w-4 h-4 text-yellow-500 animate-pulse" />
			default:
				return <WifiOff className="w-4 h-4 text-red-500" />
		}
	}

	const getStatusBadge = () => {
		switch (status) {
			case 'connected':
				return (
					<Badge variant="outline" className="text-green-700 border-green-300 bg-green-50">
						Connected
					</Badge>
				)
			case 'connecting':
				return (
					<Badge variant="outline" className="text-yellow-700 border-yellow-300 bg-yellow-50">
						Connecting
					</Badge>
				)
			default:
				return (
					<Badge variant="outline" className="text-red-700 border-red-300 bg-red-50">
						Disconnected
					</Badge>
				)
		}
	}

	const getRelayDomain = (url: string) => {
		try {
			return new URL(url).hostname
		} catch {
			return url
		}
	}

	return (
		<div className="flex items-center justify-between p-3 border rounded-md hover:bg-gray-50 transition-colors">
			<div className="flex items-center gap-3 flex-1">
				{getStatusIcon()}
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 mb-1">
						<Globe className="w-3 h-3 text-gray-400" />
						<span className="font-medium text-sm truncate">{getRelayDomain(relay.url)}</span>
						<Badge variant="secondary" className="text-xs">
							{type}
						</Badge>
					</div>
					<div className="text-xs text-gray-500 truncate">{relay.url}</div>
				</div>
				{getStatusBadge()}
			</div>
			{type === 'explicit' && (
				<Button
					variant="ghost"
					size="sm"
					onClick={() => onRemove(relay.url)}
					className="text-gray-500 hover:text-red-600 ml-2"
					aria-label={`Remove ${relay.url}`}
				>
					<Trash2 className="w-4 h-4" />
				</Button>
			)}
		</div>
	)
}
