import { useState, useEffect, useRef } from 'react'
import type { CustomField, FieldProps } from '@puckeditor/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Plus, Trash2 } from 'lucide-react'

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
				<Label className="text-sm font-medium">
					{field.label}
					{field.labelIcon && <span className="ml-1">{field.labelIcon}</span>}
				</Label>
			)}

			{/* Source Type Selector */}
			<div className="flex gap-2">
				{allowedTypes.includes('static') && (
					<Button
						variant={dataSource.type === 'static' ? 'default' : 'outline'}
						size="sm"
						onClick={() => handleTypeChange('static')}
						disabled={readOnly}
					>
						Static IDs
					</Button>
				)}

				{allowedTypes.includes('dynamic') && (
					<Button
						variant={dataSource.type === 'dynamic' ? 'default' : 'outline'}
						size="sm"
						onClick={() => handleTypeChange('dynamic')}
						disabled={readOnly}
					>
						Dynamic Filter
					</Button>
				)}
			</div>

			{/* Static IDs Input */}
			{dataSource.type === 'static' && (
				<div className="space-y-2">
					<div className="flex justify-between items-center">
						<Label className="text-sm font-medium">Product IDs</Label>
						<Button variant="outline" size="sm" onClick={addId} disabled={readOnly}>
							<Plus className="w-4 h-4 mr-1" />
							Add ID
						</Button>
					</div>

					{dataSource.ids.length === 0 ? (
						<div className="text-sm text-muted-foreground py-2">No IDs added yet</div>
					) : (
						<div className="space-y-2">
							{dataSource.ids.map((id, index) => (
								<div key={index} className="flex gap-2">
									<Input value={id} onChange={(e) => updateId(index, e.target.value)} placeholder="Enter product ID" disabled={readOnly} />
									<Button
										variant="ghost"
										size="icon"
										onClick={() => removeId(index)}
										disabled={readOnly}
										className="text-destructive hover:text-destructive"
									>
										<Trash2 className="w-4 h-4" />
									</Button>
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
						<Label className="text-sm font-medium mb-1">Event Kind</Label>
						<Input
							type="number"
							value={dataSource.kind || 30402}
							onChange={(e) => handleDynamicChange('kind', parseInt(e.target.value) || 30402)}
							disabled={readOnly}
						/>
					</div>

					<div>
						<Label className="text-sm font-medium mb-1">Limit</Label>
						<Input
							type="number"
							value={dataSource.limit || 12}
							onChange={(e) => handleDynamicChange('limit', parseInt(e.target.value) || 12)}
							disabled={readOnly}
						/>
					</div>

					<div>
						<Label className="text-sm font-medium mb-1">Authors (Pubkeys)</Label>
						<Textarea
							value={dataSource.authors?.join('\n') || ''}
							onChange={(e) =>
								handleDynamicChange(
									'authors',
									e.target.value.split('\n').filter((a) => a.trim()),
								)
							}
							placeholder="Enter one pubkey per line"
							rows={3}
							disabled={readOnly}
						/>
					</div>

					<div>
						<Label className="text-sm font-medium mb-1">Relay URL (optional)</Label>
						<Input
							type="text"
							value={dataSource.relayUrl || ''}
							onChange={(e) => handleDynamicChange('relayUrl', e.target.value)}
							placeholder="wss://relay.example.com"
							disabled={readOnly}
						/>
					</div>

					<div>
						<Label className="text-sm font-medium mb-1">Tags Filter</Label>
						<p className="text-xs text-muted-foreground mb-2">Enter tags in format: tag:value (e.g., t:electronics)</p>
						<Textarea
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
							disabled={readOnly}
						/>
					</div>
				</div>
			)}

			{field.metadata?.description && <p className="text-xs text-muted-foreground mt-1">{field.metadata.description}</p>}
		</div>
	)
}
