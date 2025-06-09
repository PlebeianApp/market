import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { collectionFormActions } from '@/lib/stores/collection'
import { useNDK } from '@/lib/stores/ndk'
import type { RichShippingInfo } from '@/lib/stores/cart'
import { createShippingReference, getShippingInfo, useShippingOptionsByPubkey } from '@/queries/shipping'
import { useStore } from '@tanstack/react-store'
import { CheckIcon, PackageIcon, PlusIcon, TruckIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { collectionFormStore, type CollectionShippingForm } from '@/lib/stores/collection'

export function ShippingTab() {
	const { shippings } = useStore(collectionFormStore)
	const { getUser } = useNDK()
	const [user, setUser] = useState<any>(null)

	// Get user on mount
	useEffect(() => {
		getUser().then(setUser)
	}, [getUser])

	const shippingOptionsQuery = useShippingOptionsByPubkey(user?.pubkey || '')
	const availableShippingOptions = useMemo(() => {
		if (!shippingOptionsQuery.data || !user?.pubkey) return []

		return shippingOptionsQuery.data
			.map((event) => {
				const info = getShippingInfo(event)
				if (!info) return null

				const id = createShippingReference(user.pubkey, info.id)

				return {
					id,
					name: info.title,
					cost: parseFloat(info.price.amount),
					currency: info.price.currency,
					country: info.country,
					service: info.service,
					carrier: info.carrier,
				}
			})
			.filter(Boolean) as RichShippingInfo[]
	}, [shippingOptionsQuery.data, user?.pubkey])

	const addShippingOption = (option: RichShippingInfo) => {
		// Check if shipping option is already added
		const isAlreadyAdded = shippings.some((s) => s.shipping?.id === option.id)
		if (isAlreadyAdded) {
			toast.error('This shipping option is already added')
			return
		}

		const newShipping: CollectionShippingForm = {
			shipping: {
				id: option.id,
				name: option.name,
			},
			extraCost: '',
		}

		collectionFormActions.updateValues({
			shippings: [...shippings, newShipping],
		})
	}

	const removeShippingOption = (index: number) => {
		collectionFormActions.updateValues({
			shippings: shippings.filter((_, i) => i !== index),
		})
	}

	const updateExtraCost = (index: number, extraCost: string) => {
		const updatedShippings = [...shippings]
		updatedShippings[index] = {
			...updatedShippings[index],
			extraCost,
		}
		collectionFormActions.updateValues({
			shippings: updatedShippings,
		})
	}

	const ServiceIcon = ({ service }: { service: string }) => {
		switch (service) {
			case 'express':
			case 'overnight':
				return <TruckIcon className="w-4 h-4 text-orange-500" />
			case 'pickup':
				return <PackageIcon className="w-4 h-4 text-blue-500" />
			default:
				return <TruckIcon className="w-4 h-4" />
		}
	}

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<p className="text-gray-600">Select shipping options that will be available for all products in this collection</p>
			</div>

			{/* Selected Shipping Options */}
			{shippings.length > 0 && (
				<div className="space-y-4">
					<h3 className="font-medium">Selected Shipping Options</h3>
					<div className="space-y-3">
						{shippings.map((shipping, index) => {
							const option = availableShippingOptions.find((opt) => opt.id === shipping.shipping?.id)
							return (
								<div key={index} className="flex items-center gap-3 p-3 border rounded-md bg-gray-50">
									{option && <ServiceIcon service={option.service} />}
									<div className="flex-1">
										<div className="font-medium">{shipping.shipping?.name}</div>
										{option && (
											<div className="text-sm text-gray-500">
												{option.cost} {option.currency} • {option.country} • {option.service}
											</div>
										)}
									</div>
									<div className="flex items-center gap-2">
										<Input
											type="number"
											step="0.01"
											min="0"
											value={shipping.extraCost}
											onChange={(e) => updateExtraCost(index, e.target.value)}
											placeholder="Extra cost"
											className="w-24 text-sm"
										/>
										<Button type="button" variant="ghost" size="sm" onClick={() => removeShippingOption(index)}>
											<span className="i-delete w-4 h-4" />
										</Button>
									</div>
								</div>
							)
						})}
					</div>
				</div>
			)}

			{/* Available Shipping Options */}
			<div className="space-y-4">
				<div className="flex items-center justify-between">
					<h3 className="font-medium">Available Shipping Options</h3>
					{shippingOptionsQuery.isLoading && <Spinner />}
				</div>

				{availableShippingOptions.length === 0 && !shippingOptionsQuery.isLoading && (
					<div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-md">
						<TruckIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
						<p className="text-gray-500 mb-4">No shipping options found</p>
						<p className="text-sm text-gray-400 mb-4">You need to create shipping options first before adding them to collections</p>
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								// Navigate to shipping options page
								window.open('/dashboard/products/shipping-options', '_blank')
							}}
						>
							Create Shipping Options
						</Button>
					</div>
				)}

				{availableShippingOptions.length > 0 && (
					<div className="space-y-2">
						{availableShippingOptions.map((option) => {
							const isAdded = shippings.some((s) => s.shipping?.id === option.id)
							return (
								<div key={option.id} className="flex items-center gap-3 p-3 border rounded-md hover:bg-gray-50">
									<ServiceIcon service={option.service} />
									<div className="flex-1">
										<div className="font-medium">{option.name}</div>
										<div className="text-sm text-gray-500">
											{option.cost} {option.currency} • {option.country} • {option.service}
											{option.carrier && ` • ${option.carrier}`}
										</div>
									</div>
									<Button
										type="button"
										variant={isAdded ? 'outline' : 'secondary'}
										size="sm"
										onClick={() => (isAdded ? null : addShippingOption(option))}
										disabled={isAdded}
									>
										{isAdded ? (
											<>
												<CheckIcon className="w-4 h-4 mr-1" />
												Added
											</>
										) : (
											<>
												<PlusIcon className="w-4 h-4 mr-1" />
												Add
											</>
										)}
									</Button>
								</div>
							)
						})}
					</div>
				)}
			</div>
		</div>
	)
}
