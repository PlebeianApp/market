import { Button } from '@/components/ui/button'
import { CURRENCIES } from '@/lib/constants'
import { uiActions, uiStore, type SupportedCurrency } from '@/lib/stores/ui'
import { useStore } from '@tanstack/react-store'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

export function CurrencyDropdown() {
	const [isOpen, setIsOpen] = useState(false)
	const { selectedCurrency } = useStore(uiStore)

	const handleCurrencySelect = (currency: SupportedCurrency) => {
		uiActions.setCurrency(currency)
		setIsOpen(false)
	}

	const toggleDropdown = () => {
		setIsOpen(!isOpen)
	}

	return (
		<div className="relative">
			<Button
				variant="primary"
				className="p-2 px-3 relative hover:bg-secondary/20 flex items-center gap-1"
				onClick={toggleDropdown}
				data-testid="currency-dropdown-button"
			>
				<span className="text-sm font-medium">{selectedCurrency}</span>
				<ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
			</Button>

			{isOpen && (
				<>
					{/* Backdrop to close dropdown when clicking outside */}
					<div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

					{/* Dropdown menu */}
					<div className="absolute right-0 top-full mt-1 bg-primary border border-zinc-200 rounded-lg shadow-lg z-50 min-w-[120px] max-h-60 overflow-y-auto">
						{CURRENCIES.map((currency) => (
							<button
								key={currency}
								className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 first:rounded-t-lg last:rounded-b-lg transition-colors ${
									currency === selectedCurrency ? 'bg-gray-100 font-medium' : ''
								}`}
								onClick={() => handleCurrencySelect(currency)}
								data-testid={`currency-option-${currency}`}
							>
								{currency}
							</button>
						))}
					</div>
				</>
			)}
		</div>
	)
}
