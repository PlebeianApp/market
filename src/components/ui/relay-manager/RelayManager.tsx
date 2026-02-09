import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { authStore } from '@/lib/stores/auth'
import { ndkStore, ndkActions } from '@/lib/stores/ndk'
import type { RelayPreference } from '@/publish/relay-list'
import { useUserRelayList, usePublishRelayList } from '@/queries/relay-list'
import { useRelayPreferences, usePublishRelayPreferences } from '@/queries/relay-preferences'
import type { NDKRelay } from '@nostr-dev-kit/ndk'
import { useStore } from '@tanstack/react-store'
import { Cloud, CloudUpload, Globe, Loader2, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { RelayCard } from './RelayCard'

export function RelayManager() {
	const ndkState = useStore(ndkStore)
	const { ndk } = ndkState
	const { user } = useStore(authStore)
	const userPubkey = user?.pubkey

	const [newRelayUrl, setNewRelayUrl] = useState('')
	const [relays, setRelays] = useState<{ explicit: NDKRelay[]; outbox: NDKRelay[] }>({ explicit: [], outbox: [] })
	const [isLoading, setIsLoading] = useState(false)

	// Queries for Nostr-stored relay data
	const { data: nostrRelays, isLoading: isLoadingNostrRelays, refetch: refetchNostrRelays } = useUserRelayList(userPubkey)
	const { data: relayPreferences, isLoading: isLoadingPreferences } = useRelayPreferences(userPubkey)

	// Mutations for saving to Nostr
	const publishRelayList = usePublishRelayList()
	const publishRelayPreferences = usePublishRelayPreferences()

	// Track if local relays differ from published
	const hasUnsavedChanges = useMemo(() => {
		if (!nostrRelays || nostrRelays.length === 0) return relays.explicit.length > 0
		const localUrls = new Set(relays.explicit.map((r) => r.url))
		const nostrUrls = new Set(nostrRelays.map((r) => r.url))
		if (localUrls.size !== nostrUrls.size) return true
		for (const url of localUrls) {
			if (!nostrUrls.has(url)) return true
		}
		return false
	}, [relays.explicit, nostrRelays])

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

	const handleLoadFromNostr = async () => {
		if (!userPubkey) {
			toast.error('Please log in to load relays from Nostr')
			return
		}

		try {
			const result = await refetchNostrRelays()
			if (result.data && result.data.length > 0) {
				// Clear existing explicit relays and add the ones from Nostr
				const currentRelays = ndkActions.getRelays()
				for (const relay of currentRelays.explicit) {
					ndkActions.removeRelay(relay.url)
				}

				// Add relays from Nostr
				for (const relay of result.data) {
					ndkActions.addSingleRelay(relay.url)
				}

				// Update local state
				setTimeout(() => {
					const updatedRelays = ndkActions.getRelays()
					setRelays(updatedRelays)
				}, 500)

				toast.success(`Loaded ${result.data.length} relays from Nostr`)
			} else {
				toast.info('No relay list found on Nostr')
			}
		} catch (error) {
			console.error('Error loading relays from Nostr:', error)
			toast.error('Failed to load relays from Nostr')
		}
	}

	const handleSaveToNostr = async () => {
		if (!userPubkey) {
			toast.error('Please log in to save relays to Nostr')
			return
		}

		if (relays.explicit.length === 0) {
			toast.error('No relays to save')
			return
		}

		try {
			// Convert current relays to RelayPreference format
			const relayPrefs: RelayPreference[] = relays.explicit.map((relay) => ({
				url: relay.url,
				read: true,
				write: true,
			}))

			await publishRelayList.mutateAsync(relayPrefs)
			toast.success('Relay list saved to Nostr')
		} catch (error) {
			console.error('Error saving relays to Nostr:', error)
			toast.error('Failed to save relays to Nostr')
		}
	}

	const handleToggleAppDefaults = async (enabled: boolean) => {
		if (!userPubkey) {
			toast.error('Please log in to save preferences')
			return
		}

		try {
			await publishRelayPreferences.mutateAsync({ includeAppDefaults: enabled })
			toast.success(enabled ? 'App default relays enabled' : 'App default relays disabled')
		} catch (error) {
			console.error('Error saving relay preferences:', error)
			toast.error('Failed to save preference')
		}
	}

	const totalRelays = relays.explicit.length + relays.outbox.length
	const isSaving = publishRelayList.isPending || publishRelayPreferences.isPending

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
			{/* Nostr Sync Actions */}
			{userPubkey && (
				<Card>
					<CardHeader>
						<CardTitle className="text-lg flex items-center gap-2">
							<Cloud className="w-5 h-5" />
							Nostr Sync
						</CardTitle>
						<CardDescription>
							Save your relay list to Nostr so it persists across sessions and devices
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex flex-col sm:flex-row gap-2">
							<Button
								variant="outline"
								onClick={handleLoadFromNostr}
								disabled={isLoadingNostrRelays || isSaving}
								className="flex-1"
							>
								{isLoadingNostrRelays ? (
									<Loader2 className="w-4 h-4 mr-2 animate-spin" />
								) : (
									<Cloud className="w-4 h-4 mr-2" />
								)}
								Load from Nostr
							</Button>
							<Button
								onClick={handleSaveToNostr}
								disabled={isSaving || relays.explicit.length === 0}
								className="flex-1"
							>
								{isSaving ? (
									<Loader2 className="w-4 h-4 mr-2 animate-spin" />
								) : (
									<CloudUpload className="w-4 h-4 mr-2" />
								)}
								Save to Nostr
							</Button>
						</div>

						{hasUnsavedChanges && (
							<div className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-2">
								Your local relay list differs from your published Nostr relay list
							</div>
						)}

						{/* Fallback Relay Toggle */}
						<div className="flex items-center justify-between p-3 border rounded-md">
							<div className="space-y-0.5">
								<Label htmlFor="include-defaults" className="text-sm font-medium">
									Include app default relays
								</Label>
								<p className="text-xs text-muted-foreground">
									When enabled, products are also published to common public relays for better discoverability
								</p>
							</div>
							<Switch
								id="include-defaults"
								checked={relayPreferences?.includeAppDefaults ?? true}
								onCheckedChange={handleToggleAppDefaults}
								disabled={isLoadingPreferences || publishRelayPreferences.isPending}
							/>
						</div>
					</CardContent>
				</Card>
			)}

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