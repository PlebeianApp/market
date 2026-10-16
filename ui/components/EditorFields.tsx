import type { ReactNode } from 'react'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'

export interface EditorTextFieldProps {
	id: string
	label: ReactNode
	value: string
	onChange: (value: string) => void
	onBlur?: () => void
	required?: boolean
	multiline?: boolean
	placeholder?: string
	hint?: ReactNode
	/** Validation messages from the host form; shown only once the field is touched. */
	errors?: readonly unknown[]
	touched?: boolean
	'data-testid'?: string
}

/** Labeled text input/textarea for seller editors. Form state and validation rules stay with the host form. */
export function EditorTextField({
	id,
	label,
	value,
	onChange,
	onBlur,
	required,
	multiline,
	placeholder,
	hint,
	errors,
	touched,
	'data-testid': testId,
}: EditorTextFieldProps) {
	const visibleErrors = touched ? (errors ?? []).filter(Boolean) : []
	const shared = {
		id,
		name: id,
		value,
		onBlur,
		placeholder,
		required,
		'data-testid': testId,
	}

	return (
		<div className="grid w-full gap-1.5">
			<Label htmlFor={id}>{required ? <span className="after:ml-0.5 after:text-red-500 after:content-['*']">{label}</span> : label}</Label>
			{multiline ? (
				<textarea {...shared} onChange={(event) => onChange(event.target.value)} className="min-h-24 rounded-md border-2 p-2" />
			) : (
				<Input {...shared} onChange={(event) => onChange(event.target.value)} className="border-2" />
			)}
			{hint && <p className="text-xs text-gray-500">{hint}</p>}
			{visibleErrors.length > 0 && <div className="mt-1 text-sm text-red-500">{visibleErrors.join(', ')}</div>}
		</div>
	)
}
