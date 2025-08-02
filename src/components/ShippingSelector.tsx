import type { RichShippingInfo } from '@/lib/stores/cart'
import { cartActions } from '@/lib/stores/cart'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { useShippingOptionsByPubkey, getShippingInfo, createShippingReference } from '@/queries/shipping'
import { useProductPubkey } from '@/queries/products'
import { useMemo, useState, useEffect } from 'react'

interface ShippingSelectorProps {
	productId?: string
	options?: RichShippingInfo[]
	selectedId?: string
	onSelect: (option: RichShippingInfo) => void
	className?: string
}

const getBestShippingOptions = (options: RichShippingInfo[], selectedId?: string): RichShippingInfo[] => {
	if (options.length <= 4) return options

	const selectedOption = selectedId ? options.find((opt) => opt.id === selectedId) : undefined

	let remainingOptions = options.filter((opt) => opt.id !== selectedId)

	remainingOptions = remainingOptions.sort((a, b) => {
		const aIsStandard = a.name?.toLowerCase().includes('standard') || false
		const bIsStandard = b.name?.toLowerCase().includes('standard') || false
		if (aIsStandard && !bIsStandard) return -1
		if (!aIsStandard && bIsStandard) return 1

		return (a.cost || 0) - (b.cost || 0)
	})

	const limitedOptions = selectedOption ? [selectedOption, ...remainingOptions.slice(0, 3)] : remainingOptions.slice(0, 4)

	return limitedOptions
}

export function ShippingSelector({
	productId,
	options: propOptions,
	selectedId: propSelectedId,
	onSelect,
	className,
}: ShippingSelectorProps) {
	const [selectedId, setSelectedId] = useState<string | undefined>(propSelectedId)

	useEffect(() => {
		if (propSelectedId) {
			setSelectedId(propSelectedId)
		}
	}, [propSelectedId])

	const { data: sellerPubkey = '' } = useProductPubkey(productId || '') || { data: '' }
	const { data: shippingEvents = [], isLoading, error } = useShippingOptionsByPubkey(sellerPubkey)

	const hookOptions = useMemo(() => {
		if (!shippingEvents.length || !sellerPubkey) return []

		return shippingEvents
			.map((event) => {
				const info = getShippingInfo(event)
				if (!info) return null

				const id = createShippingReference(sellerPubkey, info.id)

				return {
					id,
					name: info.title,
					cost: parseFloat(info.price.amount),
					currency: info.price.currency,
					countries: info.countries,
					service: info.service,
					carrier: info.carrier,
				}
			})
			.filter(Boolean) as RichShippingInfo[]
	}, [shippingEvents, sellerPubkey])

	const rawOptions = propOptions || hookOptions

	const options = useMemo(() => {
		return getBestShippingOptions(rawOptions, selectedId)
	}, [rawOptions, selectedId])

	const hasValidOptions = useMemo(() => {
		return options && options.length > 0
	}, [options])

	useEffect(() => {
		if (options.length === 1 && !selectedId) {
			handleSelect(options[0].id)
		}
	}, [options, selectedId])

	const handleSelect = async (id: string) => {
		setSelectedId(id)

		const option = rawOptions.find((o: RichShippingInfo) => o.id === id)

		if (option) {
			if (productId) {
				await cartActions.setShippingMethod(productId, option)
			}

			onSelect(option)
		}
	}

	const renderContent = () => {
		if (isLoading && !propOptions) {
			return (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					<span>Loading shipping options...</span>
				</div>
			)
		}

		if (error && !propOptions) {
			return <div className="text-sm text-red-500">Error loading shipping options</div>
		}

		if (!hasValidOptions) {
			return <div className="text-sm text-muted-foreground">No shipping options available</div>
		}

		return (
			<div className={`${!selectedId ? 'flex items-center gap-2' : ''}`}>
				{!selectedId && <div className="w-1 h-8 bg-yellow-400 rounded-sm flex-shrink-0" />}
				<Select onValueChange={handleSelect} value={selectedId}>
					<SelectTrigger className={className}>
						<SelectValue placeholder="Select shipping method">
							{selectedId && options.find(opt => opt.id === selectedId)?.name}
						</SelectValue>
					</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						<SelectLabel>Shipping Options</SelectLabel>
						{options.map((option: RichShippingInfo) => (
							<SelectItem key={option.id} value={option.id} className="break-all">
								{option.name} - {option.cost} {option.currency}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</div>
		)
	}

	return renderContent()
}
