import { useState, useRef, useEffect, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { COUNTRIES_ISO } from '@/lib/constants'
import { ChevronDownIcon, CheckIcon } from 'lucide-react'

interface CountryComboboxProps {
	value: string
	onChange: (value: string) => void
	onBlur?: () => void
	placeholder?: string
	required?: boolean
	id?: string
}

// Get sorted list of country names
const countryList = Object.values(COUNTRIES_ISO)
	.map((c) => c.name)
	.sort((a, b) => a.localeCompare(b))

// Helper to check if a country name is valid
export const isValidCountry = (name: string): boolean => {
	if (!name) return false
	return countryList.some((c) => c.toLowerCase() === name.toLowerCase())
}

// Export country list for external use
export { countryList }

export function CountryCombobox({ value, onChange, onBlur, placeholder = 'e.g. United Kingdom', required, id }: CountryComboboxProps) {
	const [isOpen, setIsOpen] = useState(false)
	const [inputValue, setInputValue] = useState(value)
	const [openUpward, setOpenUpward] = useState(false)
	const [showFullList, setShowFullList] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const listRef = useRef<HTMLDivElement>(null)
	const [highlightedIndex, setHighlightedIndex] = useState(-1)
	const [scrollToMatch, setScrollToMatch] = useState(false)
	const justSelectedRef = useRef(false)

	// Sync input value with external value changes
	useEffect(() => {
		setInputValue(value)
	}, [value])

	// Filter countries based on input (contains matching), or show full list when button clicked
	const filteredCountries = useMemo(() => {
		if (showFullList || !inputValue.trim()) return countryList
		const search = inputValue.toLowerCase()
		return countryList.filter((country) => country.toLowerCase().includes(search))
	}, [inputValue, showFullList])

	// Reset highlighted index when filtered list changes (but not when showing full list with scroll-to-match)
	useEffect(() => {
		if (!scrollToMatch) {
			setHighlightedIndex(-1)
		}
	}, [filteredCountries, scrollToMatch])

	// Handle click outside to close dropdown
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
				setIsOpen(false)
			}
		}

		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [])

	// Determine if dropdown should open upward based on available space
	useEffect(() => {
		if (isOpen && containerRef.current) {
			const rect = containerRef.current.getBoundingClientRect()
			const dropdownHeight = 240 // max-h-60 = 15rem = 240px
			const spaceBelow = window.innerHeight - rect.bottom
			const spaceAbove = rect.top

			// Open upward if not enough space below but enough above
			setOpenUpward(spaceBelow < dropdownHeight && spaceAbove > spaceBelow)
		}
	}, [isOpen])

	// Scroll highlighted item into view
	useEffect(() => {
		if (isOpen && highlightedIndex >= 0 && listRef.current) {
			const items = listRef.current.querySelectorAll('[data-country-item]')
			const highlightedItem = items[highlightedIndex] as HTMLElement
			if (highlightedItem) {
				highlightedItem.scrollIntoView({ block: scrollToMatch ? 'center' : 'nearest' })
				if (scrollToMatch) {
					setScrollToMatch(false)
				}
			}
		}
	}, [highlightedIndex, isOpen, scrollToMatch])

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newValue = e.target.value
		setInputValue(newValue)
		onChange(newValue)
		setShowFullList(false)
		setIsOpen(true)
	}

	const handleSelectCountry = (country: string) => {
		setInputValue(country)
		onChange(country)
		setIsOpen(false)
		setShowFullList(false)
		justSelectedRef.current = true
		inputRef.current?.focus()
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (!isOpen) {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
				setIsOpen(true)
				e.preventDefault()
			}
			return
		}

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault()
				setHighlightedIndex((prev) => (prev < filteredCountries.length - 1 ? prev + 1 : prev))
				break
			case 'ArrowUp':
				e.preventDefault()
				setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev))
				break
			case 'Enter':
				e.preventDefault()
				if (highlightedIndex >= 0 && highlightedIndex < filteredCountries.length) {
					handleSelectCountry(filteredCountries[highlightedIndex])
				} else if (filteredCountries.length === 1) {
					handleSelectCountry(filteredCountries[0])
				}
				break
			case 'Escape':
				e.preventDefault()
				setIsOpen(false)
				setShowFullList(false)
				break
			case 'Tab':
				setIsOpen(false)
				setShowFullList(false)
				break
		}
	}

	const handleBlur = () => {
		// Small delay to allow click events on dropdown items to fire first
		setTimeout(() => {
			onBlur?.()
		}, 150)
	}

	const toggleDropdown = () => {
		if (!isOpen) {
			// Opening dropdown via button - show full list and scroll to matching item
			setShowFullList(true)
			setIsOpen(true)
			inputRef.current?.focus()

			// Find matching country in full list and highlight it
			if (inputValue.trim()) {
				const search = inputValue.toLowerCase()
				const matchIndex = countryList.findIndex((country) => country.toLowerCase().includes(search))
				if (matchIndex >= 0) {
					setHighlightedIndex(matchIndex)
					setScrollToMatch(true)
				}
			}
		} else {
			setIsOpen(false)
			setShowFullList(false)
		}
	}

	return (
		<div ref={containerRef} className="relative w-full">
			<div className="relative">
				<Input
					ref={inputRef}
					id={id}
					type="text"
					value={inputValue}
					onChange={handleInputChange}
					onKeyDown={handleKeyDown}
					onFocus={() => {
						if (justSelectedRef.current) {
							justSelectedRef.current = false
							return
						}
						setIsOpen(true)
					}}
					onBlur={handleBlur}
					placeholder={placeholder}
					required={required}
					className="pr-10"
					autoComplete="off"
				/>
				<button
					type="button"
					onClick={toggleDropdown}
					className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center"
					tabIndex={-1}
					aria-label="Toggle country list"
				>
					<ChevronDownIcon className="size-4 opacity-50" />
				</button>
			</div>

			{isOpen && (
				<div
					ref={listRef}
					className={cn(
						'absolute z-50 w-full max-h-60 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md',
						openUpward ? 'bottom-full mb-1' : 'top-full mt-1',
					)}
				>
					{filteredCountries.length === 0 ? (
						<div className="px-3 py-2 text-sm text-muted-foreground">No countries found</div>
					) : (
						filteredCountries.map((country, index) => {
							const isSelected = country === value
							const isHighlighted = index === highlightedIndex

							return (
								<div
									key={country}
									data-country-item
									onClick={() => handleSelectCountry(country)}
									className={cn(
										'relative flex cursor-pointer items-center px-3 py-2 text-sm outline-none select-none',
										isHighlighted && 'bg-accent text-accent-foreground',
										isSelected && !isHighlighted && 'bg-accent/50',
									)}
									onMouseEnter={() => setHighlightedIndex(index)}
								>
									<span className="flex-1">{country}</span>
									{isSelected && <CheckIcon className="size-4 ml-2 text-primary" />}
								</div>
							)
						})
					)}
				</div>
			)}
		</div>
	)
}
