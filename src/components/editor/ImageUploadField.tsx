import { FieldLabel } from '@puckeditor/core'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Upload } from 'lucide-react'
// Assume you have a Blossom service utility
// import { uploadToBlossom } from '@/lib/services/blossom'

interface ImageUploadFieldProps {
	field: any
	value: string
	onChange: (val: string) => void
	name: string
}

export const ImageUploadField: React.FC<ImageUploadFieldProps> = ({ field, value, onChange, name }) => {
	const [isUploading, setIsUploading] = useState(false)
	const [tempFile, setTempFile] = useState<File | null>(null)

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files[0]) {
			setTempFile(e.target.files[0])
		}
	}

	const handleUpload = async () => {
		if (!tempFile) return
		setIsUploading(true)
		try {
			// Placeholder for actual Blossom upload logic
			// const url = await uploadToBlossom(tempFile)
			// onChange(url)
			// Simulate for now
			setTimeout(() => {
				onChange(URL.createObjectURL(tempFile)) // Temporary local preview
				setTempFile(null)
				setIsUploading(false)
			}, 1000)
		} catch (err) {
			console.error(err)
			setIsUploading(false)
		}
	}

	return (
		<FieldLabel label={field.label}>
			<div className="space-y-2">
				<div className="flex gap-2">
					<Input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Or paste image URL" className="flex-1" />
					<label className="cursor-pointer bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded border">
						<Upload className="w-4 h-4" />
						<input type="file" className="hidden" onChange={handleFileChange} accept="image/*" />
					</label>
				</div>

				{tempFile && (
					<div className="flex items-center justify-between p-2 bg-gray-50 rounded border">
						<span className="text-sm truncate">{tempFile.name}</span>
						<Button size="sm" onClick={handleUpload} disabled={isUploading} variant="default">
							{isUploading ? 'Uploading...' : 'Upload to Blossom'}
						</Button>
					</div>
				)}

				{value && !tempFile && <img src={value} alt="Preview" className="w-32 h-32 object-cover rounded border mt-2" />}
			</div>
		</FieldLabel>
	)
}
