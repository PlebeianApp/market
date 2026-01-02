import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
			<Tooltip open={isOpen ? false : undefined}>
				<TooltipTrigger asChild>
					<Button
						variant="primary"
						className="p-2 px-3 relative flex items-center gap-1 hover:[&>span]:text-secondary hover:[&>svg]:text-secondary"
						onClick={toggleDropdown}
						data-testid="currency-dropdown-button"
					>
						<span className="text-sm font-medium">{selectedCurrency}</span>
						<ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">Select currency</TooltipContent>
			</Tooltip>

			{isOpen && (
				<>
					{/* Backdrop to close dropdown when clicking outside */}
					<div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

					{/* Dropdown menu */}
					<div className="absolute right-0 top-full mt-1 bg-primary rounded-lg shadow-lg z-50 min-w-24 max-h-60 overflow-y-auto">
						{CURRENCIES.map((currency) => (
							<Button
								key={currency}
								className={`w-full ${currency === selectedCurrency ? 'bg-black-500 text-white hover:bg-gray-500' : 'text-gray-500'}`}
								onClick={() => handleCurrencySelect(currency)}
								data-testid={`currency-option-${currency}`}
							>
								{currency}
							</Button>
						))}
					</div>
				</>
			)}
		</div>
	)
}
