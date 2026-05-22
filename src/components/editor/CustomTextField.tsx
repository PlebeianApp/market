import React, { useState } from 'react'
import type { CustomField, FieldProps, TextField } from '@puckeditor/core'

// Custom text field component that handles string[][] as rows of [type, value]
export const CustomTextField = ({
	field,
	value = [],
	onChange,
	readOnly = false,
}: FieldProps<CustomField<string[][] | undefined>, string[][]>) => {
	const [rows, setRows] = useState<string[][]>(value.length > 0 ? value : [['', '']])

	// Update the rows when value changes
	React.useEffect(() => {
		if (JSON.stringify(value) !== JSON.stringify(rows)) {
			setRows(value.length > 0 ? value : [['', '']])
		}
	}, [value])

	const handleRowChange = (rowIndex: number, colIndex: number, newValue: string) => {
		if (readOnly) return

		const newRows = [...rows]
		if (!newRows[rowIndex]) {
			newRows[rowIndex] = ['', '']
		}
		newRows[rowIndex] = [...newRows[rowIndex]]
		newRows[rowIndex][colIndex] = newValue
		setRows(newRows)
		onChange(newRows)
	}

	const addRow = () => {
		if (readOnly) return
		const newRows = [...rows, ['', '']]
		setRows(newRows)
		onChange(newRows)
	}

	const removeRow = (rowIndex: number) => {
		if (readOnly || rows.length <= 1) return
		const newRows = rows.filter((_, index) => index !== rowIndex)
		setRows(newRows)
		onChange(newRows)
	}

	return (
		<div className="flex flex-col gap-3">
			{field.label && (
				<label className="text-sm font-medium text-gray-700">
					{field.label}
					{field.labelIcon && <span className="ml-1">{field.labelIcon}</span>}
				</label>
			)}

			<div className="space-y-2">
				{rows.map((row, rowIndex) => (
					<div key={rowIndex} className="flex gap-2 items-start">
						<div className="flex-1">
							<input
								type="text"
								value={row[0] || ''}
								onChange={(e) => handleRowChange(rowIndex, 0, e.target.value)}
								placeholder="Type"
								readOnly={readOnly}
								className={`
									w-full px-3 py-2 border rounded-md shadow-sm
									focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
									disabled:cursor-not-allowed disabled:bg-gray-100
									${readOnly ? 'bg-gray-50 cursor-not-allowed' : 'bg-white'}
								`}
							/>
						</div>
						<div className="flex-1">
							<input
								type="text"
								value={row[1] || ''}
								onChange={(e) => handleRowChange(rowIndex, 1, e.target.value)}
								placeholder="Value"
								readOnly={readOnly}
								className={`
									w-full px-3 py-2 border rounded-md shadow-sm
									focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
									disabled:cursor-not-allowed disabled:bg-gray-100
									${readOnly ? 'bg-gray-50 cursor-not-allowed' : 'bg-white'}
								`}
							/>
						</div>
						{!readOnly && rows.length > 1 && (
							<button
								type="button"
								onClick={() => removeRow(rowIndex)}
								className="px-2 py-2 text-red-500 hover:text-red-700 rounded-md"
								aria-label="Remove row"
							>
								<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
									<path
										fillRule="evenodd"
										d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
										clipRule="evenodd"
									/>
								</svg>
							</button>
						)}
					</div>
				))}
			</div>

			{!readOnly && (
				<button
					type="button"
					onClick={addRow}
					className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
				>
					<svg xmlns="http://www.w3.org/2000/svg" className="-ml-0.5 mr-2 h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
						<path
							fillRule="evenodd"
							d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
							clipRule="evenodd"
						/>
					</svg>
					Add Row
				</button>
			)}

			{field.metadata?.description && <p className="text-xs text-gray-500 mt-1">{field.metadata.description}</p>}
		</div>
	)
}
