import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { authStore } from '@/lib/stores/auth'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'
import { nip15ProductsQueryOptions, migratedEventsQueryOptions } from '@/queries/migration'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { MigrationForm } from '@/components/migration/MigrationForm'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/migration-tool')({
	component: MigrationToolComponent,
})

function MigrationToolComponent() {
	const { user, isAuthenticated } = useStore(authStore)
	const queryClient = useQueryClient()
	useDashboardTitle('Migration Tool')
	const [selectedEvent, setSelectedEvent] = useState<NDKEvent | null>(null)

	const { data: nip15Products, isLoading: isLoadingNip15 } = useQuery({
		...nip15ProductsQueryOptions(user?.pubkey || ''),
		enabled: !!user?.pubkey && isAuthenticated,
	})

	const { data: migratedEventIds, isLoading: isLoadingMigrated } = useQuery({
		...migratedEventsQueryOptions(user?.pubkey || ''),
		enabled: !!user?.pubkey && isAuthenticated,
	})

	const handleMigrationSuccess = async () => {
		setSelectedEvent(null)
		if (user?.pubkey) {
			await queryClient.invalidateQueries({ queryKey: ['migration'] })
			await queryClient.refetchQueries({ queryKey: ['migration'] })
		}
	}

	if (!isAuthenticated || !user) {
		return (
			<div className="p-6 text-center">
				<p>Please log in to use the migration tool.</p>
			</div>
		)
	}

	// Filter out already migrated events
	const unmigratedProducts =
		nip15Products?.filter((event) => !migratedEventIds?.has(event.id)) || []

	if (selectedEvent) {
		return (
			<MigrationForm
				nip15Event={selectedEvent}
				onBack={() => setSelectedEvent(null)}
				onSuccess={handleMigrationSuccess}
			/>
		)
	}

	return (
		<div className="p-4 lg:p-6">
			<div className="mb-6">
				<h1 className="text-2xl font-bold mb-2">Migration Tool</h1>
				<p className="text-gray-600">
					Search for NIP-15 product listings and migrate them to NIP-99 format.
				</p>
			</div>

			{isLoadingNip15 || isLoadingMigrated ? (
				<div className="p-6 text-center text-gray-500">Loading products...</div>
			) : unmigratedProducts.length === 0 ? (
				<Card>
					<CardHeader>
						<CardTitle>No products to migrate</CardTitle>
						<CardDescription>
							{nip15Products && nip15Products.length > 0
								? 'All your NIP-15 products have been migrated.'
								: 'No NIP-15 products found in your relay list.'}
						</CardDescription>
					</CardHeader>
				</Card>
			) : (
				<div className="space-y-4">
					<div className="text-sm text-gray-600">
						Found {unmigratedProducts.length} product{unmigratedProducts.length !== 1 ? 's' : ''} to migrate
					</div>
					<div className="space-y-2">
						{unmigratedProducts.map((event) => {
							const productData = parseNip15Event(event)
							return (
								<Card
									key={event.id}
									className="cursor-pointer hover:bg-gray-50 transition-colors"
									onClick={() => setSelectedEvent(event)}
								>
									<CardContent className="p-4">
										<div className="flex items-start justify-between">
											<div className="flex-1">
												<h3 className="font-semibold text-lg mb-1">{productData.name}</h3>
												<p className="text-sm text-gray-600 mb-2 line-clamp-2">
													{productData.description || 'No description'}
												</p>
												<div className="flex gap-4 text-sm">
													<span>
														<strong>Price:</strong> {productData.price} {productData.currency}
													</span>
													{productData.quantity !== null && (
														<span>
															<strong>Quantity:</strong> {productData.quantity}
														</span>
													)}
												</div>
											</div>
											<Button variant="outline" size="sm">
												Migrate
											</Button>
										</div>
									</CardContent>
								</Card>
							)
						})}
					</div>
				</div>
			)}
		</div>
	)
}

/**
 * Parses a NIP-15 event (kind 30018) into a readable format
 */
function parseNip15Event(event: NDKEvent) {
	let productData: {
		id: string
		name: string
		description: string
		price: string
		currency: string
		quantity: number | null
		images: string[]
		specs: Array<[string, string]>
		stall_id?: string
	} = {
		id: '',
		name: '',
		description: '',
		price: '0',
		currency: 'USD',
		quantity: null,
		images: [],
		specs: [],
	}

	try {
		const content = JSON.parse(event.content)
		productData = {
			id: content.id || '',
			name: content.name || '',
			description: content.description || '',
			price: content.price?.toString() || '0',
			currency: content.currency || 'USD',
			quantity: content.quantity ?? null,
			images: content.images || [],
			specs: content.specs || [],
			stall_id: content.stall_id,
		}
	} catch (error) {
		console.error('Failed to parse NIP-15 event content:', error)
		// Fallback: try to extract from tags
		const dTag = event.tags.find((tag) => tag[0] === 'd')
		if (dTag) {
			productData.id = dTag[1] || ''
		}
		productData.description = event.content || ''
	}

	return productData
}

