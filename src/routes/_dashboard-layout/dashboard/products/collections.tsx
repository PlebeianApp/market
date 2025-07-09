import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { authStore } from '@/lib/stores/auth'
import { collectionFormActions } from '@/lib/stores/collection'

import { getCollectionId, getCollectionTitle, useCollectionsByPubkey } from '@/queries/collections'
import { useDeleteCollectionMutation } from '@/publish/collections'
import {
	createFileRoute,
	useNavigate,
	Outlet,
	useMatchRoute,
} from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'
import { ChevronDown, PlusIcon, StoreIcon, Trash } from 'lucide-react'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { DashboardListItem } from '@/components/layout/DashboardListItem'

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

function CollectionListItem({
	collection,
	isExpanded,
	onToggleExpanded,
	onEdit,
	onDelete,
	isDeleting,
}: {
	collection: any
	isExpanded: boolean
	onToggleExpanded: () => void
	onEdit: () => void
	onDelete: () => void
	isDeleting: boolean
}) {
	const triggerContent = (
		<div>
			<p className="font-semibold">{getCollectionTitle(collection)}</p>
		</div>
	)

	const actions = (
		<>
			<Button
				variant="ghost"
				size="sm"
				onClick={(e) => {
					e.stopPropagation()
					onEdit()
				}}
				aria-label={`Edit ${getCollectionTitle(collection)}`}
			>
				<span className="i-edit w-5 h-5" />
			</Button>
			<Button
				variant="ghost"
				size="sm"
				onClick={(e) => {
					e.stopPropagation()
					onDelete()
				}}
				aria-label={`Delete ${getCollectionTitle(collection)}`}
				disabled={isDeleting}
			>
				{isDeleting ? <div className="animate-spin h-4 w-4 border-2 border-destructive border-t-transparent rounded-full" /> : <Trash className="w-4 h-4 text-destructive" />}
			</Button>
		</>
	)

	return (
		<DashboardListItem
			isOpen={isExpanded}
			onOpenChange={onToggleExpanded}
			triggerContent={triggerContent}
			actions={actions}
			isDeleting={isDeleting}
			icon={<StoreIcon className="h-6 w-6 text-muted-foreground" />}
		>
			<CollectionBasicInfo collection={collection} />
		</DashboardListItem>
	)
}

export const Route = createFileRoute(
	'/_dashboard-layout/dashboard/products/collections',
)({
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
		<div>
			<div className="hidden md:flex sticky top-0 z-10 bg-white border-b py-4 px-4 md:px-8 items-center justify-between">
				<h1 className="text-2xl font-bold">Collections</h1>
				<Button
					onClick={handleAddCollectionClick}
					data-testid="add-collection-button"
					className="bg-neutral-800 hover:bg-neutral-700 text-white flex items-center gap-2 px-4 py-2 text-sm font-semibold"
				>
					<span className="i-market w-5 h-5" />
					Create A Collection
				</Button>
			</div>
			<div className="space-y-6 p-4 md:p-8">
				<div className="md:hidden">
					<Button
						onClick={handleAddCollectionClick}
						data-testid="add-collection-button-mobile"
						className="w-full bg-neutral-800 hover:bg-neutral-700 text-white flex items-center justify-center gap-2 py-3 text-base font-semibold rounded-t-md rounded-b-none border-b border-neutral-600"
					>
						<span className="i-market w-5 h-5" />
						Create A Collection
					</Button>
				</div>

				<div>
					{isLoading && <div className="p-6 text-center text-gray-500 mt-4">Loading your collections...</div>}
					{error && <div className="p-6 text-center text-red-600 mt-4">Failed to load collections: {error.message}</div>}

					{!isLoading && !error && (
						<>
							{collections && collections.length > 0 ? (
								<ul className="flex flex-col gap-4 mt-4">
									{collections.map((collection) => {
										const collectionId = getCollectionId(collection)
										return (
											<li key={collection.id} data-testid={`collection-item-${collectionId}`}>
												<CollectionListItem
													collection={collection}
													isExpanded={expandedCollection === collectionId}
													onToggleExpanded={() => handleToggleExpanded(collectionId)}
													onEdit={() => handleEditCollectionClick(collection)}
													onDelete={() => handleDeleteCollectionClick(collection)}
													isDeleting={deleteMutation.isPending && deleteMutation.variables === collectionId}
												/>
											</li>
										)
									})}
								</ul>
							) : (
								<div className="text-center text-gray-500 py-10">
									<span className="i-market w-5 h-5" />
									<h3 className="mt-2 text-lg font-semibold text-gray-700">No collections yet</h3>
									<p className="mt-1 text-sm">Click the "Create A Collection" button to create your first one.</p>
								</div>
							)}
						</>
					)}
				</div>
			</div>
		</div>
	)
}
