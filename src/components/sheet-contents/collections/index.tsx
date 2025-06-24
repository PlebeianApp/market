import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { collectionFormStore, DEFAULT_COLLECTION_FORM_STATE } from '@/lib/stores/collection'
import { useStore } from '@tanstack/react-store'
import { useEffect, useState } from 'react'
import { CollectionFormContent } from './CollectionFormContent'
import { CollectionWelcomeScreen } from './CollectionWelcomeScreen'

export function NewCollectionContent({
	title,
	description,
	showWelcome = true,
}: {
	title?: string
	description?: string
	showWelcome?: boolean
}) {
	// Get form state from store
	const formState = useStore(collectionFormStore)
	const { isEditing } = formState

	// Check if the form has been modified from its default state
	const isFormModified = () => {
		if (isEditing) return true

		return (
			formState.name !== DEFAULT_COLLECTION_FORM_STATE.name ||
			formState.description !== DEFAULT_COLLECTION_FORM_STATE.description ||
			formState.headerImageUrl !== DEFAULT_COLLECTION_FORM_STATE.headerImageUrl ||
			formState.selectedProducts.length > 0
		)
	}

	const [showForm, setShowForm] = useState(isFormModified())

	// Update showForm based on form modification or editing state
	useEffect(() => {
		if (isEditing || isFormModified()) {
			setShowForm(true)
		}
	}, [isEditing, formState])

	// Default titles
	const defaultTitle = isEditing ? 'Edit Collection' : 'Create Collection'
	const defaultDescription = isEditing ? 'Modify your collection details.' : 'Create a new collection to organize your products'

	if (!showForm && showWelcome) {
		return (
			<SheetContent side="right">
				<SheetHeader className="hidden">
					<SheetTitle>Create Collection</SheetTitle>
					<SheetDescription>Organize your products into collections</SheetDescription>
				</SheetHeader>
				<CollectionWelcomeScreen onGetStarted={() => setShowForm(true)} />
			</SheetContent>
		)
	}

	return (
		<SheetContent
			side="right"
			className="flex flex-col max-h-screen overflow-hidden w-[100vw] sm:min-w-[85vw] md:min-w-[55vw] xl:min-w-[35vw]"
		>
			<SheetHeader>
				<SheetTitle className="text-center">{title || defaultTitle}</SheetTitle>
				<SheetDescription className="hidden">{description || defaultDescription}</SheetDescription>
			</SheetHeader>

			<CollectionFormContent />
		</SheetContent>
	)
}

// Export all components for reuse
export { InfoTab } from './InfoTab'
export { ProductsTab } from './ProductsTab'
export { CollectionWelcomeScreen } from './CollectionWelcomeScreen'
export { CollectionFormContent } from './CollectionFormContent'
