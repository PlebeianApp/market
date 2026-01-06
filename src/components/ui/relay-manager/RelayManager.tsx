import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ndkStore, ndkActions } from '@/lib/stores/ndk'
import type { NDKRelay } from '@nostr-dev-kit/ndk'
import { useStore } from '@tanstack/react-store'
import { Globe, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { RelayCard } from './RelayCard'

export function RelayManager() {
	const ndkState = useStore(ndkStore)
	const { ndk } = ndkState
	const [newRelayUrl, setNewRelayUrl] = useState('')
	const [relays, setRelays] = useState<{ explicit: NDKRelay[]; outbox: NDKRelay[] }>({ explicit: [], outbox: [] })
	const [isLoading, setIsLoading] = useState(false)

	// Update relays when NDK changes
	useEffect(() => {
		if (ndk) {
			const currentRelays = ndkActions.getRelays()
			setRelays(currentRelays)
		}
	}, [ndk, ndkActions.getRelays])

	// Listen for relay changes
	useEffect(() => {
		if (!ndk || !ndk.pool) return

		const updateRelays = () => {
			const currentRelays = ndkActions.getRelays()
			setRelays(currentRelays)
		}

		// Listen for relay events - wrap in try/catch to handle potential errors
		try {
			ndk.pool.on('relay:connect', updateRelays)
			ndk.pool.on('relay:disconnect', updateRelays)
		} catch (error) {
			console.error('Failed to attach relay event listeners:', error)
		}

		return () => {
			try {
				ndk.pool.off('relay:connect', updateRelays)
				ndk.pool.off('relay:disconnect', updateRelays)
			} catch (error) {
				console.error('Failed to remove relay event listeners:', error)
			}
		}
	}, [ndk, ndkActions.getRelays])

	const handleAddRelay = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!newRelayUrl.trim()) return

		setIsLoading(true)
		try {
			const success = ndkActions.addSingleRelay(newRelayUrl.trim())
			if (success) {
				setNewRelayUrl('')
				toast.success('Relay added successfully')
				// Update relay list
				setTimeout(() => {
					const currentRelays = ndkActions.getRelays()
					setRelays(currentRelays)
				}, 500)
			} else {
				toast.error('Failed to add relay')
			}
		} catch (error) {
			console.error('Error adding relay:', error)
			toast.error('Failed to add relay')
		} finally {
			setIsLoading(false)
		}
	}

	const handleRemoveRelay = async (relayUrl: string) => {
		try {
			const success = ndkActions.removeRelay(relayUrl)
			if (success) {
				toast.success('Relay removed successfully')
				// Update relay list
				const currentRelays = ndkActions.getRelays()
				setRelays(currentRelays)
			} else {
				toast.error('Failed to remove relay')
			}
		} catch (error) {
			console.error('Error removing relay:', error)
			toast.error('Failed to remove relay')
		}
	}

	const handleConnectToDefaults = async () => {
		try {
			const success = ndkActions.connectToDefaultRelays()
			if (success) {
				toast.success('Connected to default relays')
				// Update relay list
				setTimeout(() => {
					const currentRelays = ndkActions.getRelays()
					setRelays(currentRelays)
				}, 500)
			} else {
				toast.error('Failed to connect to default relays')
			}
		} catch (error) {
			console.error('Error connecting to default relays:', error)
			toast.error('Failed to connect to default relays')
		}
	}

	const totalRelays = relays.explicit.length + relays.outbox.length

	if (!ndk) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Globe className="w-5 h-5" />
						Network
					</CardTitle>
					<CardDescription>NDK not initialized</CardDescription>
				</CardHeader>
			</Card>
		)
	}

	return (
		<div className="space-y-6">

			{/* Add Relay Form */}
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Add Relay</CardTitle>
					<CardDescription>Add a new relay to your network</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleAddRelay} className="flex flex-col sm:flex-row gap-2">
						<div className="flex-1">
							<Label htmlFor="relay-url" className="sr-only">
								Relay URL
							</Label>
							<Input
								id="relay-url"
								type="url"
								placeholder="relay.example.com or wss://relay.example.com"
								value={newRelayUrl}
								onChange={(e) => setNewRelayUrl(e.target.value)}
								disabled={isLoading}
							/>
						</div>
						<Button type="submit" disabled={!newRelayUrl.trim() || isLoading} className="w-full sm:w-auto">
							<Plus className="w-4 h-4 mr-2" />
							{isLoading ? 'Adding...' : 'Add'}
						</Button>
					</form>

					{totalRelays === 0 && (
						<div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
							<p className="text-sm text-yellow-800 mb-2">
								You're not connected to any relays. Connect to default relays to get started.
							</p>
							<Button 
								variant="outline" 
								size="sm" 
								onClick={handleConnectToDefaults}
								className="text-yellow-800 border-yellow-300 hover:bg-yellow-100 w-full sm:w-auto"
							>
								<RefreshCw className="w-4 h-4 mr-2" />
								Use Default Relays
							</Button>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Explicit Relays */}
			{relays.explicit.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">
							Explicit Relays ({relays.explicit.length})
						</CardTitle>
						<CardDescription>
							Relays you've explicitly configured for publishing and reading events
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ScrollArea className={relays.explicit.length > 5 ? 'h-80' : undefined}>
							<div className="space-y-2">
								{relays.explicit.map((relay) => (
									<RelayCard
										key={relay.url}
										relay={relay}
										onRemove={handleRemoveRelay}
										type="explicit"
									/>
								))}
							</div>
						</ScrollArea>
					</CardContent>
				</Card>
			)}

			{/* Outbox Relays */}
			{relays.outbox.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">
							Outbox Relays ({relays.outbox.length})
						</CardTitle>
						<CardDescription>
							Relays discovered through the outbox model for efficient data distribution
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ScrollArea className={relays.outbox.length > 5 ? 'h-80' : undefined}>
							<div className="space-y-2">
								{relays.outbox.map((relay) => (
									<RelayCard
										key={`outbox-${relay.url}`}
										relay={relay}
										onRemove={() => {}} // Can't remove outbox relays
										type="outbox"
									/>
								))}
							</div>
						</ScrollArea>
					</CardContent>
				</Card>
			)}
		</div>
	)
} 