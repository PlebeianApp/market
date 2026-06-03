import React from 'react'
import { FieldLabel } from '@puckeditor/core'
import { Checkbox } from '@/components/ui/checkbox'

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
	const inputId = id || `field-${name}`

	return (
		<div className="flex items-start gap-3">
			<Checkbox id={inputId} checked={value} onCheckedChange={onChange} />
			<div className="flex-1">
				<FieldLabel label={field.label ?? ''} />
				{field.description && <p className="text-sm text-muted-foreground mt-1">{field.description}</p>}
			</div>
		</div>
	)
}
