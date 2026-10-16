import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'
import { Label } from '@ui/primitives/label'
import { EditorTextField } from '@ui/components/EditorFields'
import { collectionFormStore, collectionFormActions } from '@/lib/stores/collection'
import { useForm } from '@tanstack/react-form'
import { useStore } from '@tanstack/react-store'

export function InfoTab() {
	const { name, summary, description, headerImageUrl } = useStore(collectionFormStore)

	const form = useForm({
		defaultValues: {
			name: name,
			summary: summary,
			description: description,
		},
		onSubmit: async ({ value }) => {
			collectionFormActions.updateValues({
				name: value.name,
				summary: value.summary,
				description: value.description,
			})
		},
	})

	const handleSaveImage = ({ url }: { url: string }) => {
		collectionFormActions.updateValues({ headerImageUrl: url })
	}

	const handleDeleteImage = () => {
		collectionFormActions.updateValues({ headerImageUrl: '' })
	}

	return (
		<div className="space-y-4">
			<div className="space-y-4">
				<div className="space-y-2">
					<Label>Header Image</Label>
					<p className="text-sm text-gray-600">We recommend using images of 1500x500 and under 2mb.</p>

					<ImageUploader
						src={headerImageUrl || null}
						index={0}
						imagesLength={1}
						onSave={handleSaveImage}
						onDelete={handleDeleteImage}
						initialUrl=""
						data-testid="collection-header-image-uploader"
					/>
				</div>
			</div>

			<form.Field
				name="name"
				validators={{
					onChange: (field) => (!field.value ? 'Collection name is required' : undefined),
				}}
			>
				{(field) => (
					<EditorTextField
						id={field.name}
						label="Collection Name"
						required
						value={field.state.value}
						onBlur={field.handleBlur}
						onChange={(value) => {
							field.handleChange(value)
							collectionFormActions.updateValues({ name: value })
						}}
						placeholder="e.g. Clothes Collection"
						errors={field.state.meta.errors}
						touched={field.state.meta.isTouched}
						data-testid="collection-name-input"
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
							collectionFormActions.updateValues({ summary: value })
						}}
						placeholder="A short summary of your collection"
						hint="A brief one-line summary displayed in collection listings"
						data-testid="collection-summary-input"
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
							collectionFormActions.updateValues({ description: value })
						}}
						placeholder="Bitaxe Miners"
						errors={field.state.meta.errors}
						touched={field.state.meta.isTouched}
						data-testid="collection-description-input"
					/>
				)}
			</form.Field>
		</div>
	)
}
