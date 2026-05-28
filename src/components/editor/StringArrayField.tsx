import React, { useState } from 'react'
import { FieldLabel } from '@puckeditor/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X, Plus, ArrowUp, ArrowDown } from 'lucide-react'

export interface StringArrayFieldProps {
	field: {
		label?: string
		description?: string
		[key: string]: any
	}
	value?: string[]
	onChange: (value: string[]) => void
	name: string
}

export const StringArrayField: React.FC<StringArrayFieldProps> = ({ field, value = [], onChange, name }) => {
	const [inputValue, setInputValue] = useState('')

	const handleAdd = () => {
		if (!inputValue.trim()) return
		const newValue = [...value, inputValue.trim()]
		onChange(newValue)
		setInputValue('')
	}

	const handleRemove = (index: number) => {
		const newValue = value.filter((_, i) => i !== index)
		onChange(newValue)
	}

	const handleMove = (index: number, direction: 'up' | 'down') => {
		const newValue = [...value]
		const targetIndex = direction === 'up' ? index - 1 : index + 1

		if (targetIndex < 0 || targetIndex >= newValue.length) return // Swap
		;[newValue[index], newValue[targetIndex]] = [newValue[targetIndex], newValue[index]]
		onChange(newValue)
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			handleAdd()
		}
	}

	return (
		<FieldLabel label={field.label ?? ''}>
			<div className="space-y-3">
				<div className="flex gap-2">
					<Input
						value={inputValue}
						onChange={(e) => setInputValue(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Paste Event ID and press Enter"
						className="flex-1"
					/>
					<Button type="button" onClick={handleAdd} size="sm" disabled={!inputValue.trim()}>
						<Plus className="w-4 h-4 mr-1" />
						Add
					</Button>
				</div>

				{value.length === 0 ? (
					<p className="text-sm text-gray-500 italic">No IDs added yet.</p>
				) : (
					<div className="flex flex-wrap gap-2">
						{value.map((id, index) => (
							<div
								key={`${id}-${index}`}
								className="flex items-center gap-1 bg-gray-100 border border-gray-200 rounded-md px-2 py-1 text-sm"
							>
								<span className="truncate max-w-[150px] text-gray-700" title={id}>
									{id.substring(0, 8)}...{id.substring(id.length - 4)}
								</span>

								<div className="flex items-center gap-1 ml-1">
									{index > 0 && (
										<button
											type="button"
											onClick={() => handleMove(index, 'up')}
											className="p-0.5 hover:bg-gray-200 rounded text-gray-500"
											title="Move Up"
										>
											<ArrowUp className="w-3 h-3" />
										</button>
									)}
									{index < value.length - 1 && (
										<button
											type="button"
											onClick={() => handleMove(index, 'down')}
											className="p-0.5 hover:bg-gray-200 rounded text-gray-500"
											title="Move Down"
										>
											<ArrowDown className="w-3 h-3" />
										</button>
									)}
									<button
										type="button"
										onClick={() => handleRemove(index)}
										className="p-0.5 hover:bg-red-100 rounded text-red-500"
										title="Remove"
									>
										<X className="w-3 h-3" />
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</FieldLabel>
	)
}
