import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { authStore } from '@/lib/stores/auth'
import { productFormActions, productFormStore } from '@/lib/stores/product'
import { useCollectionsByPubkey, getCollectionTitle, getCollectionId } from '@/queries/collections'
import { useForm } from '@tanstack/react-form'
import { useStore } from '@tanstack/react-store'

export function NameTab() {
	const { productType, name, description, selectedCollection } = useStore(productFormStore)
	const { user } = useStore(authStore)

	// Fetch user's collections
	const { data: collections = [] } = useCollectionsByPubkey(user?.pubkey || '')

	const form = useForm({
		defaultValues: {
			name: name,
			description: description,
			collection: selectedCollection || '',
			productType: productType,
		},
		onSubmit: async ({ value }) => {
			productFormActions.updateValues({
				name: value.name,
				description: value.description,
				productType: value.productType as 'single' | 'variable',
			})
		},
	})

	return (
		<div className="space-y-4">
			<div className="grid w-full gap-1.5">
				<Label htmlFor="collection">Collection (Optional)</Label>
				<Select
					value={selectedCollection || 'none'}
					onValueChange={(value) => productFormActions.updateValues({ selectedCollection: value === 'none' ? null : value })}
				>
					<SelectTrigger className="border-2" data-testid="product-collection-select">
						<SelectValue placeholder="Select a collection" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="none" data-testid="collection-option-none">
							Not In A Collection
						</SelectItem>
						{collections.map((collection) => {
							const collectionId = getCollectionId(collection)
							const collectionTitle = getCollectionTitle(collection)
							return (
								<SelectItem
									key={collectionId}
									value={collectionId}
									data-testid={`collection-option-${collectionTitle?.toLowerCase().replace(/\s+/g, '-') || 'unknown'}`}
								>
									{collectionTitle}
								</SelectItem>
							)
						})}
					</SelectContent>
				</Select>
			</div>

			<div className="grid w-full gap-1.5">
				<Label>
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Product Type</span>
				</Label>
				<Select
					value={productType}
					onValueChange={(value) => productFormActions.updateValues({ productType: value as 'single' | 'variable' })}
				>
					{/* TODO: add variants */}
					<SelectTrigger className="border-2" disabled>
						<SelectValue placeholder="Single Product" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="single">Single Product</SelectItem>
						<SelectItem value="variable">Product with variants</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<form.Field
				name="name"
				validators={{
					onChange: (field) => (!field.value ? 'Product name is required' : undefined),
				}}
			>
				{(field) => (
					<div className="grid w-full gap-1.5">
						<Label htmlFor={field.name}>
							<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Title</span>
						</Label>
						<Input
							id={field.name}
							name={field.name}
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => {
								field.handleChange(e.target.value)
								productFormActions.updateValues({ name: e.target.value })
							}}
							className="border-2"
							placeholder="e.g Art Print"
							data-testid="product-name-input"
							required
						/>
						{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
							<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
						)}
					</div>
				)}
			</form.Field>

			<form.Field
				name="description"
				validators={{
					onChange: (field) => (!field.value ? 'Description is required' : undefined),
				}}
			>
				{(field) => (
					<div className="grid w-full gap-1.5">
						<Label htmlFor={field.name}>
							<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Description</span>
						</Label>
						<textarea
							id={field.name}
							name={field.name}
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => {
								field.handleChange(e.target.value)
								productFormActions.updateValues({ description: e.target.value })
							}}
							className="border-2 min-h-24 p-2 rounded-md"
							placeholder="More information about your product to help your customers"
							data-testid="product-description-input"
							required
						/>
						{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
							<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
						)}
					</div>
				)}
			</form.Field>
		</div>
	)
}
