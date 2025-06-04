import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { collectionFormStore, collectionFormActions } from '@/lib/stores/collection'
import { useForm } from '@tanstack/react-form'
import { useStore } from '@tanstack/react-store'

export function InfoTab() {
	const { name, description, headerImageUrl } = useStore(collectionFormStore)

	const form = useForm({
		defaultValues: {
			name: name,
			description: description,
		},
		onSubmit: async ({ value }) => {
			collectionFormActions.updateValues({
				name: value.name,
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
					<div className="grid w-full gap-1.5">
						<Label htmlFor={field.name}>
							<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Collection Name</span>
						</Label>
						<Input
							id={field.name}
							name={field.name}
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => {
								field.handleChange(e.target.value)
								collectionFormActions.updateValues({ name: e.target.value })
							}}
							className="border-2"
							placeholder="e.g. Clothes Collection"
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
								collectionFormActions.updateValues({ description: e.target.value })
							}}
							className="border-2 min-h-24 p-2 rounded-md"
							placeholder="Bitaxe Miners"
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