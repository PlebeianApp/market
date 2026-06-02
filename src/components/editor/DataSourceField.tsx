import { useState, useEffect, useRef } from 'react'
import type { CustomField, FieldProps } from '@puckeditor/core'

// Define the types for our data source
export type DataSourceType = 'static' | 'dynamic'

export interface StaticDataSource {
	type: 'static'
	ids: string[]
}

export interface DynamicDataSource {
	type: 'dynamic'
	kind?: number
	limit?: number
	authors?: string[]
	tags?: string[][]
	relayUrl?: string
}

export type DataSource = StaticDataSource | DynamicDataSource

export const STATIC_DATA_SOURCE_EMPTY: StaticDataSource = {
	type: 'static',
	ids: [],
}

// Define the props for our custom field
export interface DataSourceFieldProps extends FieldProps<CustomField<DataSource | undefined>, DataSource> {
	allowedTypes?: DataSourceType[]
}

export const DataSourceField = ({
	field,
	value,
	onChange,
	readOnly = false,
	allowedTypes = ['static', 'dynamic'],
}: DataSourceFieldProps) => {
	const initialized = useRef(false)
	const [dataSource, setDataSource] = useState<DataSource>(value || { type: 'static', ids: [] })

	// Initialize with provided value
	useEffect(() => {
		if (initialized.current) return

		if (value) {
			setDataSource(value)
		}

		initialized.current = true
	}, [])

	// Notify parent of changes
	useEffect(() => {
		if (initialized.current) {
			onChange(dataSource)
		}
	}, [dataSource])

	const handleTypeChange = (type: DataSourceType) => {
		if (readOnly) return

		if (type === 'static') {
			setDataSource({
				type: 'static',
				ids: [],
			})
		} else {
			setDataSource({
				type: 'dynamic',
				kind: 30402,
				limit: 12,
				authors: [],
				tags: [],
			})
		}
	}

	const handleStaticIdsChange = (ids: string[]) => {
		if (readOnly || dataSource.type !== 'static') return
		setDataSource({
			...dataSource,
			ids,
		})
	}

	const handleDynamicChange = <K extends keyof DynamicDataSource>(key: K, val: DynamicDataSource[K]) => {
		if (readOnly || dataSource.type !== 'dynamic') return
		setDataSource({
			...dataSource,
			[key]: val,
		})
	}

	const addId = () => {
		if (readOnly || dataSource.type !== 'static') return
		handleStaticIdsChange([...dataSource.ids, ''])
	}

	const removeId = (index: number) => {
		if (readOnly || dataSource.type !== 'static') return
		const newIds = [...dataSource.ids]
		newIds.splice(index, 1)
		handleStaticIdsChange(newIds)
	}

	const updateId = (index: number, id: string) => {
		if (readOnly || dataSource.type !== 'static') return
		const newIds = [...dataSource.ids]
		newIds[index] = id
		handleStaticIdsChange(newIds)
	}

	return (
		<div className="flex flex-col gap-3">
			{field.label && (
				<label className="text-sm font-medium text-gray-700">
					{field.label}
					{field.labelIcon && <span className="ml-1">{field.labelIcon}</span>}
				</label>
			)}

			{/* Source Type Selector */}
			<div className="flex gap-2">
				{allowedTypes.includes('static') && (
					<button
						type="button"
						onClick={() => handleTypeChange('static')}
						className={`px-4 py-2 text-sm rounded-md transition-colors ${
							dataSource.type === 'static' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
						}`}
						disabled={readOnly}
					>
						Static IDs
					</button>
				)}

				{allowedTypes.includes('dynamic') && (
					<button
						type="button"
						onClick={() => handleTypeChange('dynamic')}
						className={`px-4 py-2 text-sm rounded-md transition-colors ${
							dataSource.type === 'dynamic' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
						}`}
						disabled={readOnly}
					>
						Dynamic Filter
					</button>
				)}
			</div>

			{/* Static IDs Input */}
			{dataSource.type === 'static' && (
				<div className="space-y-2">
					<div className="flex justify-between items-center">
						<label className="text-sm font-medium text-gray-700">Product IDs</label>
						<button
							type="button"
							onClick={addId}
							className="inline-flex items-center px-2 py-1 border border-gray-300 shadow-sm text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
							disabled={readOnly}
						>
							<svg xmlns="http://www.w3.org/2000/svg" className="-ml-0.5 mr-1 h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
								<path
									fillRule="evenodd"
									d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
									clipRule="evenodd"
								/>
							</svg>
							Add ID
						</button>
					</div>

					{dataSource.ids.length === 0 ? (
						<div className="text-sm text-gray-500 py-2">No IDs added yet</div>
					) : (
						<div className="space-y-2">
							{dataSource.ids.map((id, index) => (
								<div key={index} className="flex gap-2">
									<input
										type="text"
										value={id}
										onChange={(e) => updateId(index, e.target.value)}
										placeholder="Enter product ID"
										className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
										disabled={readOnly}
									/>
									<button
										type="button"
										onClick={() => removeId(index)}
										className="px-2 py-2 text-red-500 hover:text-red-700 rounded-md transition-colors"
										disabled={readOnly}
									>
										<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
											<path
												fillRule="evenodd"
												d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
												clipRule="evenodd"
											/>
										</svg>
									</button>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{/* Dynamic Filter Input */}
			{dataSource.type === 'dynamic' && (
				<div className="space-y-4">
					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">Event Kind</label>
						<input
							type="number"
							value={dataSource.kind || 30402}
							onChange={(e) => handleDynamicChange('kind', parseInt(e.target.value) || 30402)}
							className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
							disabled={readOnly}
						/>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">Limit</label>
						<input
							type="number"
							value={dataSource.limit || 12}
							onChange={(e) => handleDynamicChange('limit', parseInt(e.target.value) || 12)}
							className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
							disabled={readOnly}
						/>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">Authors (Pubkeys)</label>
						<textarea
							value={dataSource.authors?.join('\n') || ''}
							onChange={(e) =>
								handleDynamicChange(
									'authors',
									e.target.value.split('\n').filter((a) => a.trim()),
								)
							}
							placeholder="Enter one pubkey per line"
							rows={3}
							className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
							disabled={readOnly}
						/>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">Relay URL (optional)</label>
						<input
							type="text"
							value={dataSource.relayUrl || ''}
							onChange={(e) => handleDynamicChange('relayUrl', e.target.value)}
							placeholder="wss://relay.example.com"
							className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
							disabled={readOnly}
						/>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">Tags Filter</label>
						<p className="text-xs text-gray-500 mb-2">Enter tags in format: tag:value (e.g., t:electronics)</p>
						<textarea
							value={dataSource.tags?.map((t) => `${t[0]}:${t[1]}`).join('\n') || ''}
							onChange={(e) => {
								const tags = e.target.value
									.split('\n')
									.filter((line) => line.trim())
									.map((line) => {
										const [key, ...valueParts] = line.split(':')
										return [key.trim(), valueParts.join(':').trim()]
									})
								handleDynamicChange('tags', tags)
							}}
							placeholder="t:electronics&#10;status:available"
							rows={3}
							className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
							disabled={readOnly}
						/>
					</div>
				</div>
			)}

			{field.metadata?.description && <p className="text-xs text-gray-500 mt-1">{field.metadata.description}</p>}
		</div>
	)
}
