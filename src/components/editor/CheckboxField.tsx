import React from 'react'
import { FieldLabel } from '@puckeditor/core'

// Define the props expected by Puck for a custom field
interface CheckboxFieldProps {
	field: {
		label?: string
		description?: string
		[key: string]: any
	}
	value?: boolean
	onChange: (value: boolean) => void
	name: string
	id?: string
}

export const CheckboxField: React.FC<CheckboxFieldProps> = ({ field, value = false, onChange, name, id }) => {
	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		onChange(e.target.checked)
	}

	const inputId = id || `field-${name}`

	return (
		<div className="flex items-start gap-3">
			<div className="relative flex items-center h-5">
				<input
					id={inputId}
					name={name}
					type="checkbox"
					checked={value}
					onChange={handleChange}
					className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer"
				/>
			</div>
			<div className="flex-1">
				<FieldLabel label={field.label} htmlFor={inputId} />
				{field.description && <p className="text-sm text-gray-500 mt-1">{field.description}</p>}
			</div>
		</div>
	)
}
