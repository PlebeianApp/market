import { useState, useRef, useEffect, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { COUNTRIES_ISO, COUNTRY_DIALING_CODES } from '@/lib/constants'
import { ChevronDownIcon, CheckIcon } from 'lucide-react'

interface PhoneInputProps {
	value: string
	onChange: (value: string) => void
	onBlur?: () => void
	placeholder?: string
	id?: string
	selectedCountry?: string // Country name from the country field
}

// Build list of countries with their dialing codes
const countryCodeList = Object.entries(COUNTRIES_ISO)
	.map(([iso2, data]) => ({
		iso2,
		name: data.name,
		dialCode: COUNTRY_DIALING_CODES[iso2] || '',
	}))
	.filter((c) => c.dialCode) // Only include countries with dialing codes
	.sort((a, b) => a.name.localeCompare(b.name))

// Helper to find country by name
const findCountryByName = (name: string) => {
	if (!name) return null
	const search = name.toLowerCase()
	return countryCodeList.find((c) => c.name.toLowerCase() === search)
}

export function PhoneInput({ value, onChange, onBlur, placeholder = '7751892718', id, selectedCountry }: PhoneInputProps) {
	const [isOpen, setIsOpen] = useState(false)
	const [openUpward, setOpenUpward] = useState(false)
	const [showFullList, setShowFullList] = useState(false)
	const [searchValue, setSearchValue] = useState('')
	const [selectedDialCode, setSelectedDialCode] = useState('')
	const [phoneNumber, setPhoneNumber] = useState('')
	const [highlightedIndex, setHighlightedIndex] = useState(-1)
	const [scrollToMatch, setScrollToMatch] = useState(false)

	const containerRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const listRef = useRef<HTMLDivElement>(null)
	const justSelectedRef = useRef(false)
	const lastAutoSelectedCountryRef = useRef<string | null>(null)

	// Parse initial value into dial code and number
	useEffect(() => {
		if (value && value.startsWith('+')) {
			// Try to find matching dial code
			const matchingCountry = countryCodeList.find((c) => value.startsWith(c.dialCode))
			if (matchingCountry) {
				setSelectedDialCode(matchingCountry.dialCode)
				setPhoneNumber(value.slice(matchingCountry.dialCode.length))
			} else {
				setPhoneNumber(value)
			}
		} else {
			setPhoneNumber(value)
		}
	}, [])

	// Auto-select country code when country field changes and phone number is empty
	useEffect(() => {
		if (selectedCountry && !phoneNumber && lastAutoSelectedCountryRef.current !== selectedCountry) {
			const country = findCountryByName(selectedCountry)
			if (country) {
				lastAutoSelectedCountryRef.current = selectedCountry
				setSelectedDialCode(country.dialCode)
				onChange(country.dialCode)
			}
		}
	}, [selectedCountry, phoneNumber, onChange])

	// Filter countries based on search
	const filteredCountries = useMemo(() => {
		if (showFullList || !searchValue.trim()) return countryCodeList
		const search = searchValue.toLowerCase()
		return countryCodeList.filter(
			(country) => country.name.toLowerCase().includes(search) || country.dialCode.includes(search),
		)
	}, [searchValue, showFullList])

	// Reset highlighted index when filtered list changes
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
				setSearchValue('')
			}
		}

		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [])

	// Determine if dropdown should open upward
	useEffect(() => {
		if (isOpen && containerRef.current) {
			const rect = containerRef.current.getBoundingClientRect()
			const dropdownHeight = 240
			const spaceBelow = window.innerHeight - rect.bottom
			const spaceAbove = rect.top
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

	const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newNumber = e.target.value.replace(/[^\d]/g, '') // Only allow digits
		setPhoneNumber(newNumber)
		onChange(selectedDialCode + newNumber)
	}

	const handleSelectCountry = (country: (typeof countryCodeList)[0]) => {
		setSelectedDialCode(country.dialCode)
		setIsOpen(false)
		setShowFullList(false)
		setSearchValue('')
		justSelectedRef.current = true
		onChange(country.dialCode + phoneNumber)
		inputRef.current?.focus()
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (!isOpen) return

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
				}
				break
			case 'Escape':
				e.preventDefault()
				setIsOpen(false)
				setShowFullList(false)
				setSearchValue('')
				break
			case 'Tab':
				setIsOpen(false)
				setShowFullList(false)
				setSearchValue('')
				break
		}
	}

	const toggleDropdown = () => {
		if (!isOpen) {
			setShowFullList(true)
			setIsOpen(true)

			// Find and highlight current selection
			if (selectedDialCode) {
				const matchIndex = countryCodeList.findIndex((c) => c.dialCode === selectedDialCode)
				if (matchIndex >= 0) {
					setHighlightedIndex(matchIndex)
					setScrollToMatch(true)
				}
			}
		} else {
			setIsOpen(false)
			setShowFullList(false)
			setSearchValue('')
		}
	}

	const handleBlur = () => {
		setTimeout(() => {
			onBlur?.()
		}, 150)
	}

	return (
		<div ref={containerRef} className="relative w-full">
			<div className="flex">
				{/* Country code selector */}
				<div className="relative">
					<button
						type="button"
						onClick={toggleDropdown}
						className="flex h-10 items-center gap-1 rounded-l-md border border-r-0 border-input bg-background px-3 text-sm hover:bg-accent/50 transition-colors"
					>
						<span className="min-w-[3.5rem] text-left">{selectedDialCode || '+?'}</span>
						<ChevronDownIcon className="size-4 opacity-50" />
					</button>
				</div>

				{/* Phone number input */}
				<Input
					ref={inputRef}
					id={id}
					type="tel"
					value={phoneNumber}
					onChange={handlePhoneChange}
					onFocus={() => {
						if (justSelectedRef.current) {
							justSelectedRef.current = false
							return
						}
					}}
					onBlur={handleBlur}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					className="rounded-l-none"
				/>
			</div>

			{/* Dropdown */}
			{isOpen && (
				<div
					ref={listRef}
					className={cn(
						'absolute z-50 w-full max-h-60 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md',
						openUpward ? 'bottom-full mb-1' : 'top-full mt-1',
					)}
				>
					{/* Search input inside dropdown */}
					<div className="sticky top-0 bg-popover border-b p-2">
						<input
							type="text"
							value={searchValue}
							onChange={(e) => {
								setSearchValue(e.target.value)
								setShowFullList(false)
							}}
							onKeyDown={handleKeyDown}
							placeholder="Search country..."
							className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:border-secondary"
							autoFocus
						/>
					</div>

					{filteredCountries.length === 0 ? (
						<div className="px-3 py-2 text-sm text-muted-foreground">No countries found</div>
					) : (
						filteredCountries.map((country, index) => {
							const isSelected = country.dialCode === selectedDialCode
							const isHighlighted = index === highlightedIndex

							return (
								<div
									key={country.iso2}
									data-country-item
									onClick={() => handleSelectCountry(country)}
									className={cn(
										'relative flex cursor-pointer items-center px-3 py-2 text-sm outline-none select-none',
										isHighlighted && 'bg-accent text-accent-foreground',
										isSelected && !isHighlighted && 'bg-accent/50',
									)}
									onMouseEnter={() => setHighlightedIndex(index)}
								>
									<span className="w-16 font-mono text-muted-foreground">{country.dialCode}</span>
									<span className="flex-1">{country.name}</span>
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
