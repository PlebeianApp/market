import { CollectionFormContent } from '@/components/sheet-contents/NewCollectionContent'
import { Button } from '@/components/ui/button'
import { authStore } from '@/lib/stores/auth'
import { collectionFormActions } from '@/lib/stores/collection'
import { getCollectionId, getCollectionTitle, useCollectionsByPubkey } from '@/queries/collections'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useEffect } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/collections/$collectionId')({
	component: EditCollectionComponent,
})

function EditCollectionComponent() {
	const { collectionId } = Route.useParams()
	const { user } = useStore(authStore)
	const navigate = useNavigate()

	// Fetch user's collections to find the one being edited
	const { data: collections = [] } = useCollectionsByPubkey(user?.pubkey || '')

	// Find the collection being edited
	const collection = collections.find((c) => getCollectionId(c) === collectionId)

	useEffect(() => {
		if (collection) {
			const title = getCollectionTitle(collection)
			const description = collection.content || ''
			const headerImageUrl = collection.tags.find((tag: any) => tag[0] === 'image')?.[1] || ''
			const selectedProducts = collection.tags.filter((tag: any) => tag[0] === 'a').map((tag: any) => tag[1])

			// Set editing mode with collection data
			collectionFormActions.setEditingCollection(collectionId, {
				name: title,
				description,
				headerImageUrl,
				selectedProducts,
			})
		}
	}, [collection, collectionId])

	if (!collection) {
		return (
			<div className="space-y-6">
				<h1 className="text-2xl font-bold">Collection Not Found</h1>
				<p className="text-gray-600">The collection you're looking for doesn't exist or you don't have access to it.</p>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Edit Collection</h1>
			<div className="bg-white rounded-md shadow-sm">
				<CollectionFormContent showFooter={true} />
			</div>
		</div>
	)
}
