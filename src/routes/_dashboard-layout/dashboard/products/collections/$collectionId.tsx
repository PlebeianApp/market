import { CollectionFormContent } from '@/components/sheet-contents/collections/CollectionFormContent'
import { authStore } from '@/lib/stores/auth'
import { collectionFormActions } from '@/lib/stores/collection'
import { getCollectionId, getCollectionTitle, useCollectionsByPubkey } from '@/queries/collections'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useEffect } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/collections/$collectionId')({
	component: EditCollectionComponent,
})

function EditCollectionComponent() {
	const { collectionId } = Route.useParams()
	const { user } = useStore(authStore)

	useDashboardTitle('Edit Collection')

	// Fetch user's collections to find the one being edited
	const { data: collections = [] } = useCollectionsByPubkey(user?.pubkey || '')

	// Find the collection being edited
	const collection = collections.find((c) => getCollectionId(c) === collectionId)

	useEffect(() => {
		if (collection) {
			// Load collection for editing (includes shipping options)
			collectionFormActions.loadCollectionForEdit(collection)
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
			<CollectionFormContent showFooter={true} />
		</div>
	)
}
