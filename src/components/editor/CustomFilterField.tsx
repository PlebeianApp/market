import { useState, useEffect, useRef } from 'react'
import type { CustomField, FieldProps } from '@puckeditor/core'
import { PRODUCT_CATEGORIES } from '@/lib/constants'

// --- Constants ---
const STATUS_OPTIONS = ['on-sale', 'hidden', 'sold-out', 'pre-order']

const SUB_CATEGORIES: string[] = []

const FILTER_CONFIG = {
	category_t: {
		label: 'Category',
		options: PRODUCT_CATEGORIES,
		defaultValue: PRODUCT_CATEGORIES[0],
		tagKey: 't',
		priority: 1,
	},
	subcategory_t: {
		label: 'Subcategory',
		options: SUB_CATEGORIES.length > 0 ? SUB_CATEGORIES : null,
		defaultValue: SUB_CATEGORIES.length > 0 ? SUB_CATEGORIES[0] : '',
		tagKey: 't',
		priority: 2,
	},
	visibility_status: {
		label: 'Visibility',
		options: STATUS_OPTIONS,
		defaultValue: STATUS_OPTIONS[0],
		tagKey: 'status',
		priority: 3,
	},
	custom: {
		label: 'Custom Tag',
		options: null,
		defaultValue: '',
		tagKey: null,
		priority: 99,
	},
} as const

type InternalType = keyof typeof FILTER_CONFIG

// --- Encoding/Decoding Logic ---

const decodeTags = (tags: string[][]): [string, string][] => {
	const decoded: [string, string][] = []

	for (const tag of tags) {
		const [tagKey, tagValue] = tag

		if (tagKey === 't') {
			if (PRODUCT_CATEGORIES.includes(tagValue as any)) {
				decoded.push(['category_t', tagValue])
			} else if (SUB_CATEGORIES.length > 0 && SUB_CATEGORIES.includes(tagValue)) {
				decoded.push(['subcategory_t', tagValue])
			} else {
				decoded.push(['custom', tagValue])
			}
		} else if (tagKey === 'status') {
			decoded.push(['visibility_status', tagValue])
		} else {
			decoded.push(['custom', `${tagKey}:${tagValue}`])
		}
	}

	return decoded.sort((a, b) => {
		const configA = FILTER_CONFIG[a[0] as InternalType]
		const configB = FILTER_CONFIG[b[0] as InternalType]
		if (!configA || !configB) return 0
		return (configA.priority || 99) - (configB.priority || 99)
	})
}

const encodeTags = (rows: [string, string][]): string[][] => {
	return rows
		.filter(([type, value]) => type !== '')
		.map(([internalType, value]) => {
			const config = FILTER_CONFIG[internalType as InternalType]

			if (!config || config.tagKey === null) {
				const [key, val] = value.split(':')
				return [key || 'custom', val || '']
			}

			return [config.tagKey, value]
		})
}

export const CustomFilterField = ({
	field,
	value = [],
	onChange,
	readOnly = false,
}: FieldProps<CustomField<string[][] | undefined>, string[][]>) => {
	const initialized = useRef(false)

	const [rows, setRows] = useState<[string, string][]>([['', '']])

	// Decode external value to internal format
	useEffect(() => {
		if (initialized.current) return

		if (value && value.length > 0) {
			const decoded = decodeTags(value)
			setRows(decoded.length > 0 ? decoded : [['', '']])
		} else {
			setRows([['', '']])
		}

		initialized.current = true
	}, []) // Only run once on mount

	const handleRowChange = (rowIndex: number, colIndex: number, newValue: string) => {
		if (readOnly) return

		const newRows = [...rows]
		const [currentType] = newRows[rowIndex]

		if (colIndex === 0) {
			const config = FILTER_CONFIG[newValue as InternalType]
			if (config?.options && config.options.length > 0) {
				// Explicitly assign as tuple
				newRows[rowIndex] = [newValue, config.defaultValue] as [string, string]
			} else {
				newRows[rowIndex] = [newValue, ''] as [string, string]
			}
		} else {
			newRows[rowIndex] = [currentType, newValue] as [string, string]
		}

		setRows(newRows)
		onChange(encodeTags(newRows))
	}

	const addRow = () => {
		if (readOnly) return

		// Check if there is an empty row
		if (rows.find((row) => row[0] === '')) return

		const newRow: [string, string] = ['', '']
		const newRows = [...rows, newRow]

		setRows(newRows)

		// Encode and send to parent
		const encoded = encodeTags(newRows)
		onChange(encoded)
	}

	const removeRow = (rowIndex: number) => {
		if (readOnly) return
		const newRows = rows.filter((_, index) => index !== rowIndex)
		setRows(newRows)
		onChange(encodeTags(newRows))
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
				{rows.map((row, rowIndex) => {
					const [currentType, currentValue] = row
					const config = FILTER_CONFIG[currentType as InternalType]
					const hasOptions = config?.options && config.options.length > 0
					const isCustomType = currentType === 'custom'

					return (
						<div key={rowIndex} className="flex gap-2 items-start">
							{/* 1. TYPE SELECTOR */}
							<div className="flex-[2]">
								<select
									value={currentType}
									onChange={(e) => handleRowChange(rowIndex, 0, e.target.value)}
									disabled={readOnly}
									className={`
										w-full px-3 py-2 border rounded-md shadow-sm bg-white
										focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
										disabled:cursor-not-allowed disabled:bg-gray-100
										${readOnly ? 'bg-gray-50 cursor-not-allowed' : ''}
									`}
								>
									<option value="" disabled>
										Select Filter Type
									</option>
									{Object.entries(FILTER_CONFIG).map(([key, conf]) => (
										<option key={key} value={key}>
											{conf.label}
										</option>
									))}
								</select>
							</div>

							{/* 2. VALUE INPUT */}
							<div className="flex-[3]">
								{hasOptions ? (
									<select
										value={currentValue}
										onChange={(e) => handleRowChange(rowIndex, 1, e.target.value)}
										disabled={readOnly}
										className={`
											w-full px-3 py-2 border rounded-md shadow-sm bg-white
											focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
											disabled:cursor-not-allowed disabled:bg-gray-100
											${readOnly ? 'bg-gray-50 cursor-not-allowed' : ''}
										`}
									>
										<option value="" disabled>
											Select Value
										</option>
										{config.options!.map((opt) => (
											<option key={opt} value={opt}>
												{opt}
											</option>
										))}
									</select>
								) : (
									<input
										type="text"
										value={currentValue}
										onChange={(e) => handleRowChange(rowIndex, 1, e.target.value)}
										placeholder={isCustomType ? 'key:value (e.g., brand:nike)' : 'Enter value'}
										disabled={readOnly}
										className={`
											w-full px-3 py-2 border rounded-md shadow-sm
											focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
											disabled:cursor-not-allowed disabled:bg-gray-100
											${readOnly ? 'bg-gray-50 cursor-not-allowed' : ''}
										`}
									/>
								)}

								{isCustomType && (
									<p className="text-xs text-gray-500 mt-1 ml-1">
										Enter tag as <code>key:value</code> (e.g., <code>brand:nike</code>)
									</p>
								)}
							</div>

							{/* 3. REMOVE BUTTON */}
							{!readOnly && (
								<button
									type="button"
									onClick={() => removeRow(rowIndex)}
									className="px-2 py-2 rounded-md transition-colors mt-1"
									aria-label="Remove filter row"
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
					)
				})}
			</div>

			{!readOnly && (
				<button
					type="button"
					onClick={addRow}
					className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
				>
					<svg xmlns="http://www.w3.org/2000/svg" className="-ml-0.5 mr-2 h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
						<path
							fillRule="evenodd"
							d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
							clipRule="evenodd"
						/>
					</svg>
					Add Filter
				</button>
			)}

			{field.metadata?.description && <p className="text-xs text-gray-500 mt-1">{field.metadata.description}</p>}
		</div>
	)
}
