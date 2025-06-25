import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { authStore } from '@/lib/stores/auth'
import { collectionFormActions } from '@/lib/stores/collection'

import { getCollectionId, getCollectionTitle, useCollectionsByPubkey } from '@/queries/collections'
import { useDeleteCollectionMutation } from '@/publish/collections'
import { createFileRoute, useNavigate, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'
import { ChevronDown, Trash } from 'lucide-react'
import { useDashboardTitle } from '@/routes/_dashboard-layout'

// Component to show basic collection information
function CollectionBasicInfo({ collection }: { collection: any }) {
	const description = collection.content || 'No description'
	const productCount = collection.tags.filter((tag: any) => tag[0] === 'a').length
	const headerImage = collection.tags.find((tag: any) => tag[0] === 'image')?.[1]

	return (
		<div className="p-4 bg-gray-50 border-t">
			<div className="space-y-3">
				{headerImage && (
					<div className="w-full h-32 bg-gray-200 rounded-md overflow-hidden">
						<img src={headerImage} alt="Collection header" className="w-full h-full object-cover" />
					</div>
				)}
				<div>
					<p className="text-sm text-gray-600 mb-1">Description:</p>
					<p className="text-sm">{description}</p>
				</div>
				<div>
					<p className="text-sm text-gray-600">
						Products: <span className="font-medium">{productCount}</span>
					</p>
				</div>
			</div>
		</div>
	)
}

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/collections')({
	component: CollectionsComponent,
})

function CollectionsComponent() {
	const { user, isAuthenticated } = useStore(authStore)
	const navigate = useNavigate()
	const matchRoute = useMatchRoute()
	const [expandedCollection, setExpandedCollection] = useState<string | null>(null)
	useDashboardTitle('Collections')

	// Check if we're on a child route (editing or creating a collection)
	const isOnChildRoute =
		matchRoute({
			to: '/dashboard/products/collections/$collectionId',
			fuzzy: true,
		}) ||
		matchRoute({
			to: '/dashboard/products/collections/new',
			fuzzy: true,
		})

	// Fetch user's collections
	const { data: collections = [], isLoading, error } = useCollectionsByPubkey(user?.pubkey || '')

	// Delete mutation
	const deleteMutation = useDeleteCollectionMutation()

	const handleAddCollectionClick = () => {
		collectionFormActions.reset()
		navigate({
			to: '/dashboard/products/collections/new',
		})
	}

	const handleEditCollectionClick = (collection: any) => {
		const collectionId = getCollectionId(collection)
		navigate({
			to: '/dashboard/products/collections/$collectionId',
			params: { collectionId },
		})
	}

	const handleToggleExpanded = (collectionId: string) => {
		setExpandedCollection(expandedCollection === collectionId ? null : collectionId)
	}

	const handleDeleteCollectionClick = async (collection: any) => {
		if (confirm(`Are you sure you want to delete "${getCollectionTitle(collection)}"?`)) {
			const collectionDTag = getCollectionId(collection)
			if (collectionDTag) {
				deleteMutation.mutate(collectionDTag)
			}
		}
	}

	if (!isAuthenticated || !user) {
		return (
			<div className="p-6 text-center">
				<p>Please log in to manage your collections.</p>
			</div>
		)
	}

	// If we're on a child route, render the child route
	if (isOnChildRoute) {
		return <Outlet />
	}

	return (
		<div className="space-y-6">
			<div className="bg-white rounded-md shadow-sm">
				<Button
					onClick={handleAddCollectionClick}
					data-testid="add-collection-button"
					className="w-full bg-neutral-800 hover:bg-neutral-700 text-white flex items-center justify-center gap-2 py-3 text-base font-semibold rounded-t-md rounded-b-none border-b border-neutral-600"
				>
					<span className="i-market w-5 h-5" />
					Create A Collection
				</Button>

				{isLoading && <div className="p-6 text-center text-gray-500">Loading your collections...</div>}
				{error && <div className="p-6 text-center text-red-600">Failed to load collections: {error.message}</div>}

				{!isLoading && !error && (
					<>
						{collections && collections.length > 0 ? (
							<ul className="p-4 flex flex-col gap-2">
								{collections.map((collection) => {
									const collectionId = getCollectionId(collection)
									const isExpanded = expandedCollection === collectionId

									return (
										<li
											key={collection.id}
											className="border border-gray-300 rounded-md overflow-hidden"
											data-testid={`collection-item-${collectionId}`}
										>
											<Collapsible open={isExpanded} onOpenChange={() => handleToggleExpanded(collectionId)}>
												<div className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors duration-150">
													<div className="flex items-center gap-3">
														<span className="i-market w-5 h-5" />
														<span className="text-sm font-medium text-gray-800">{getCollectionTitle(collection)}</span>
													</div>
													<div className="flex items-center gap-2">
														<Button
															variant="ghost"
															size="sm"
															onClick={(e) => {
																e.stopPropagation()
																handleEditCollectionClick(collection)
															}}
															aria-label={`Edit ${getCollectionTitle(collection)}`}
															className="text-gray-500 hover:text-gray-700"
															data-testid={`edit-collection-button-${collectionId}`}
														>
															<span className="i-edit w-5 h-5" />
														</Button>
														<Button
															variant="ghost"
															size="sm"
															onClick={(e) => {
																e.stopPropagation()
																handleDeleteCollectionClick(collection)
															}}
															aria-label={`Delete ${getCollectionTitle(collection)}`}
															className="text-gray-500 hover:text-red-600"
															disabled={deleteMutation.isPending}
															data-testid={`delete-collection-button-${collectionId}`}
														>
															<Trash className="w-4 h-4" />
														</Button>
														<CollapsibleTrigger asChild>
															<Button
																variant="ghost"
																size="sm"
																className="text-gray-500 hover:text-gray-700"
																aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${getCollectionTitle(collection)}`}
															>
																<ChevronDown />
															</Button>
														</CollapsibleTrigger>
													</div>
												</div>
												<CollapsibleContent>
													<CollectionBasicInfo collection={collection} />
												</CollapsibleContent>
											</Collapsible>
										</li>
									)
								})}
							</ul>
						) : (
							<div className="text-center text-gray-500 py-10 px-6">
								<span className="i-market w-5 h-5" />
								<h3 className="mt-2 text-lg font-semibold text-gray-700">No collections yet</h3>
								<p className="mt-1 text-sm">Click the "Add A Collection" button to create your first one.</p>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	)
}
