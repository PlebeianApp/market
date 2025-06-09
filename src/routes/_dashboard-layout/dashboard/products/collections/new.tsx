import { CollectionFormContent } from '@/components/sheet-contents/NewCollectionContent'
import { collectionFormActions } from '@/lib/stores/collection'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/collections/new')({
	component: NewCollectionComponent,
})

function NewCollectionComponent() {
	useDashboardTitle('Create Collection')

	useEffect(() => {
		// Reset form when component mounts
		collectionFormActions.reset()
	}, [])

	return (
		<div className="space-y-6">
			<div className="bg-white rounded-md shadow-sm">
				<CollectionFormContent showFooter={true} />
			</div>
		</div>
	)
} 