import { Label } from '@ui/primitives/label'
import { EditorTextField } from '@ui/components/EditorFields'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/primitives/select'
import { authStore } from '@/lib/stores/auth'
import { productFormActions, productFormStore } from '@/lib/stores/product'
import { useCollectionsByPubkey } from '@/queries/collections'
import { useForm } from '@tanstack/react-form'
import { useStore } from '@tanstack/react-store'
import { CollectionSelectField } from '@ui/components/CollectionSelectField'

export function NameTab() {
	const { productType, name, summary, description, selectedCollection } = useStore(productFormStore)
	const { user } = useStore(authStore)

	// Fetch user's collections
	const { data: collections = [] } = useCollectionsByPubkey(user?.pubkey || '')

	const form = useForm({
		defaultValues: {
			name: name,
			summary: summary,
			description: description,
			collection: selectedCollection || '',
			productType: productType,
		},
		onSubmit: async ({ value }) => {
			productFormActions.updateValues({
				name: value.name,
				summary: value.summary,
				description: value.description,
				productType: value.productType as 'single' | 'variable',
			})
		},
	})

	return (
		<div className="space-y-4">
			<div className="grid w-full gap-1.5">
				<Label htmlFor="product-collection-select">Collection (Optional)</Label>
				<CollectionSelectField
					id="product-collection-select"
					data-testid="product-collection-select"
					collections={collections}
					value={selectedCollection || 'none'}
					onValueChange={(value) => productFormActions.updateValues({ selectedCollection: value === 'none' ? null : value })}
				/>
			</div>

			<div className="grid w-full gap-1.5">
				<Label>Product Type</Label>
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
					<EditorTextField
						id={field.name}
						label="Title"
						required
						value={field.state.value}
						onBlur={field.handleBlur}
						onChange={(value) => {
							field.handleChange(value)
							productFormActions.updateValues({ name: value })
						}}
						placeholder="e.g Art Print"
						errors={field.state.meta.errors}
						touched={field.state.meta.isTouched}
						data-testid="product-name-input"
					/>
				)}
			</form.Field>
			<form.Field name="summary">
				{(field) => (
					<EditorTextField
						id={field.name}
						label="Summary (Optional)"
						value={field.state.value}
						onBlur={field.handleBlur}
						onChange={(value) => {
							field.handleChange(value)
							productFormActions.updateValues({ summary: value })
						}}
						placeholder="A short summary of your product"
						hint="A brief one-line summary displayed in product listings"
						data-testid="product-summary-input"
					/>
				)}
			</form.Field>
			<form.Field
				name="description"
				validators={{
					onChange: (field) => (!field.value ? 'Description is required' : undefined),
				}}
			>
				{(field) => (
					<EditorTextField
						id={field.name}
						label="Description"
						required
						multiline
						value={field.state.value}
						onBlur={field.handleBlur}
						onChange={(value) => {
							field.handleChange(value)
							productFormActions.updateValues({ description: value })
						}}
						placeholder="More information about your product to help your customers"
						errors={field.state.meta.errors}
						touched={field.state.meta.isTouched}
						data-testid="product-description-input"
					/>
				)}
			</form.Field>
		</div>
	)
}
