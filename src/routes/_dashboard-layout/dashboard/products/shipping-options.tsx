import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { COUNTRIES_ISO, CURRENCIES } from '@/lib/constants'
import { useNDK } from '@/lib/stores/ndk'
import {
	useDeleteShippingOptionMutation,
	usePublishShippingOptionMutation,
	useUpdateShippingOptionMutation,
	type ShippingFormData,
} from '@/publish/shipping'
import {
	getShippingCarrier,
	getShippingCountry,
	getShippingDescription,
	getShippingDimensionLimits,
	getShippingDuration,
	getShippingId,
	getShippingLocation,
	getShippingPrice,
	getShippingService,
	getShippingTitle,
	getShippingWeightLimits,
	useShippingOptionsByPubkey,
} from '@/queries/shipping'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronDownIcon, GlobeIcon, PackageIcon, PlusIcon, TrashIcon, TruckIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

const SERVICE_TYPES = [
	{ value: 'standard', label: 'Standard Shipping' },
	{ value: 'express', label: 'Express Shipping' },
	{ value: 'overnight', label: 'Overnight Shipping' },
	{ value: 'pickup', label: 'Local Pickup' },
] as const

const WEIGHT_UNITS = ['kg', 'lb', 'g', 'oz']
const DIMENSION_UNITS = ['cm', 'in', 'm', 'mm']
const DURATION_UNITS = [
	{ value: 'D', label: 'Days' },
	{ value: 'W', label: 'Weeks' },
	{ value: 'M', label: 'Months' },
] as const

interface ShippingOptionFormProps {
	shippingOption: NDKEvent | null
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	onSuccess?: () => void
}

function ShippingOptionForm({ shippingOption, isOpen, onOpenChange, onSuccess }: ShippingOptionFormProps) {
	const { getUser } = useNDK()
	const [user, setUser] = useState<any>(null)
	const [isSubmitting, setIsSubmitting] = useState(false)

	const publishMutation = usePublishShippingOptionMutation()
	const updateMutation = useUpdateShippingOptionMutation()
	const deleteMutation = useDeleteShippingOptionMutation()

	const isEditing = !!shippingOption

	const [formData, setFormData] = useState<ShippingFormData>(() => {
		if (shippingOption) {
			const priceTag = getShippingPrice(shippingOption)
			const countryTag = getShippingCountry(shippingOption)
			const serviceTag = getShippingService(shippingOption)
			const carrierTag = getShippingCarrier(shippingOption)
			const durationTag = getShippingDuration(shippingOption)
			const locationTag = getShippingLocation(shippingOption)
			const weightLimits = getShippingWeightLimits(shippingOption)
			const dimensionLimits = getShippingDimensionLimits(shippingOption)

			return {
				title: getShippingTitle(shippingOption),
				description: getShippingDescription(shippingOption),
				price: priceTag?.[1] || '',
				currency: priceTag?.[2] || 'USD',
				country: countryTag?.[1] || '',
				additionalCountries: countryTag?.slice(2) || [],
				service: (serviceTag?.[1] as any) || 'standard',
				carrier: carrierTag?.[1] || '',
				location: locationTag?.[1] || '',
				duration: durationTag
					? {
							min: durationTag[1],
							max: durationTag[2],
							unit: durationTag[3] as 'D' | 'W' | 'M',
						}
					: undefined,
				weightLimits: {
					min: weightLimits.min ? { value: weightLimits.min[1], unit: weightLimits.min[2] } : undefined,
					max: weightLimits.max ? { value: weightLimits.max[1], unit: weightLimits.max[2] } : undefined,
				},
				dimensionLimits: {
					min: dimensionLimits.min ? { value: dimensionLimits.min[1], unit: dimensionLimits.min[2] } : undefined,
					max: dimensionLimits.max ? { value: dimensionLimits.max[1], unit: dimensionLimits.max[2] } : undefined,
				},
			}
		}
		return {
			title: '',
			description: '',
			price: '',
			currency: 'USD',
			country: '',
			service: 'standard',
		}
	})

	// Get user on mount
	useEffect(() => {
		getUser().then(setUser)
	}, [getUser])

	const resetForm = useCallback(() => {
		setFormData({
			title: '',
			description: '',
			price: '',
			currency: 'USD',
			country: '',
			service: 'standard',
		})
		setIsSubmitting(false)
	}, [])

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!formData.title.trim() || !formData.price.trim() || !formData.country) {
			toast.error('Please fill in all required fields')
			return
		}

		setIsSubmitting(true)

		try {
			if (isEditing) {
				const shippingId = getShippingId(shippingOption)
				if (!shippingId) {
					throw new Error('Shipping ID not found')
				}
				await updateMutation.mutateAsync({
					shippingDTag: shippingId,
					formData,
				})
			} else {
				await publishMutation.mutateAsync(formData)
			}

			onOpenChange(false)
			if (!isEditing) resetForm()
			onSuccess?.()
		} catch (error) {
			console.error('Error saving shipping option:', error)
		} finally {
			setIsSubmitting(false)
		}
	}

	const handleDelete = async () => {
		if (isEditing && shippingOption) {
			const shippingId = getShippingId(shippingOption)
			if (!shippingId) {
				toast.error('Shipping ID not found')
				return
			}

			try {
				await deleteMutation.mutateAsync(shippingId)
				onOpenChange(false)
				onSuccess?.()
			} catch (error) {
				console.error('Error deleting shipping option:', error)
			}
		}
	}

	const ServiceIcon = ({ service }: { service: string }) => {
		switch (service) {
			case 'express':
			case 'overnight':
				return <TruckIcon className="w-5 h-5 text-orange-500" />
			case 'pickup':
				return <PackageIcon className="w-5 h-5 text-blue-500" />
			default:
				return <TruckIcon className="w-5 h-5" />
		}
	}

	const getServiceLabel = (service: string) => {
		const serviceType = SERVICE_TYPES.find((s) => s.value === service)
		return serviceType?.label || service
	}

	const getCountryName = (code: string) => {
		const country = Object.values(COUNTRIES_ISO).find((c) => c.iso3 === code)
		return country?.name || code
	}

	return (
		<Collapsible open={isOpen} onOpenChange={onOpenChange}>
			<CollapsibleTrigger asChild>
				<div className="flex w-full justify-between items-center gap-2 p-4 border rounded-md bg-white hover:bg-gray-50 cursor-pointer">
					{isEditing ? (
						<div className="flex items-center gap-3 min-w-0 flex-1">
							<ServiceIcon service={formData.service} />
							<div className="min-w-0 flex-1">
								<div className="font-medium truncate">{formData.title}</div>
								<div className="text-sm text-muted-foreground">
									{formData.price} {formData.currency} • {getCountryName(formData.country)} • {getServiceLabel(formData.service)}
								</div>
							</div>
						</div>
					) : (
						<div className="flex items-center gap-2">
							<PlusIcon className="w-6 h-6" />
							<span>Add new shipping option</span>
						</div>
					)}

					{isEditing && (
						<div className="flex items-center gap-2">
							<GlobeIcon className="w-5 h-5 text-muted-foreground" />
						</div>
					)}

					<ChevronDownIcon className="w-4 h-4" />
				</div>
			</CollapsibleTrigger>

			<CollapsibleContent className="px-4 pb-4">
				<div className="pt-4">
					<form onSubmit={handleSubmit} className="space-y-6">
						{/* Basic Information */}
						<div className="space-y-4">
							<h3 className="text-lg font-semibold">Basic Information</h3>
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label htmlFor="title" className="font-medium">
										Title *
									</Label>
									<Input
										id="title"
										value={formData.title}
										onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
										placeholder="e.g., Standard Shipping to US"
										required
									/>
								</div>

								<div className="space-y-2">
									<Label htmlFor="service" className="font-medium">
										Service Type *
									</Label>
									<Select value={formData.service} onValueChange={(value: any) => setFormData((prev) => ({ ...prev, service: value }))}>
										<SelectTrigger>
											<SelectValue placeholder="Select service type" />
										</SelectTrigger>
										<SelectContent>
											{SERVICE_TYPES.map((service) => (
												<SelectItem key={service.value} value={service.value}>
													<div className="flex items-center gap-2">
														<ServiceIcon service={service.value} />
														{service.label}
													</div>
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>

								<div className="space-y-2">
									<Label htmlFor="price" className="font-medium">
										Price *
									</Label>
									<div className="flex gap-2">
										<Input
											id="price"
											type="number"
											step="0.01"
											min="0"
											value={formData.price}
											onChange={(e) => setFormData((prev) => ({ ...prev, price: e.target.value }))}
											placeholder="0.00"
											className="flex-1"
											required
										/>
										<Select value={formData.currency} onValueChange={(value) => setFormData((prev) => ({ ...prev, currency: value }))}>
											<SelectTrigger className="w-20">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{CURRENCIES.map((currency) => (
													<SelectItem key={currency} value={currency}>
														{currency}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								</div>

								<div className="space-y-2">
									<Label htmlFor="country" className="font-medium">
										Country *
									</Label>
									<Select value={formData.country} onValueChange={(value) => setFormData((prev) => ({ ...prev, country: value }))}>
										<SelectTrigger>
											<SelectValue placeholder="Select country" />
										</SelectTrigger>
										<SelectContent>
											{Object.values(COUNTRIES_ISO).map((country) => (
												<SelectItem key={country.iso3} value={country.iso3}>
													{country.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>

							<div className="space-y-2">
								<Label htmlFor="description" className="font-medium">
									Description
								</Label>
								<Textarea
									id="description"
									value={formData.description}
									onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
									placeholder="Describe your shipping option..."
									rows={3}
								/>
							</div>
						</div>

						{/* Optional Details */}
						<div className="space-y-4">
							<h3 className="text-lg font-semibold">Optional Details</h3>
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label htmlFor="carrier" className="font-medium">
										Carrier
									</Label>
									<Input
										id="carrier"
										value={formData.carrier || ''}
										onChange={(e) => setFormData((prev) => ({ ...prev, carrier: e.target.value }))}
										placeholder="e.g., FedEx, UPS, DHL"
									/>
								</div>

								<div className="space-y-2">
									<Label htmlFor="location" className="font-medium">
										Location
									</Label>
									<Input
										id="location"
										value={formData.location || ''}
										onChange={(e) => setFormData((prev) => ({ ...prev, location: e.target.value }))}
										placeholder="e.g., New York, Tokyo"
									/>
								</div>
							</div>

							{/* Duration */}
							<div className="space-y-2">
								<Label className="font-medium">Delivery Duration</Label>
								<div className="flex gap-2 items-center">
									<Input
										type="number"
										min="1"
										value={formData.duration?.min || ''}
										onChange={(e) =>
											setFormData((prev) => ({
												...prev,
												duration: {
													...prev.duration,
													min: e.target.value,
													max: prev.duration?.max || e.target.value,
													unit: prev.duration?.unit || 'D',
												},
											}))
										}
										placeholder="Min"
										className="w-20"
									/>
									<span>-</span>
									<Input
										type="number"
										min="1"
										value={formData.duration?.max || ''}
										onChange={(e) =>
											setFormData((prev) => ({
												...prev,
												duration: {
													...prev.duration,
													min: prev.duration?.min || '1',
													max: e.target.value,
													unit: prev.duration?.unit || 'D',
												},
											}))
										}
										placeholder="Max"
										className="w-20"
									/>
									<Select
										value={formData.duration?.unit || 'D'}
										onValueChange={(value: any) =>
											setFormData((prev) => ({
												...prev,
												duration: {
													...prev.duration,
													min: prev.duration?.min || '1',
													max: prev.duration?.max || '1',
													unit: value,
												},
											}))
										}
									>
										<SelectTrigger className="w-32">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{DURATION_UNITS.map((unit) => (
												<SelectItem key={unit.value} value={unit.value}>
													{unit.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>

							{/* Weight Limits */}
							<div className="space-y-2">
								<Label className="font-medium">Weight Limits</Label>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div className="flex gap-2 items-center">
										<Label className="text-sm">Min:</Label>
										<Input
											type="number"
											step="0.1"
											min="0"
											value={formData.weightLimits?.min?.value || ''}
											onChange={(e) =>
												setFormData((prev) => ({
													...prev,
													weightLimits: {
														...prev.weightLimits,
														min: {
															value: e.target.value,
															unit: prev.weightLimits?.min?.unit || 'kg',
														},
													},
												}))
											}
											placeholder="0.0"
											className="flex-1"
										/>
										<Select
											value={formData.weightLimits?.min?.unit || 'kg'}
											onValueChange={(value) =>
												setFormData((prev) => ({
													...prev,
													weightLimits: {
														...prev.weightLimits,
														min: {
															value: prev.weightLimits?.min?.value || '0',
															unit: value,
														},
													},
												}))
											}
										>
											<SelectTrigger className="w-20">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{WEIGHT_UNITS.map((unit) => (
													<SelectItem key={unit} value={unit}>
														{unit}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>

									<div className="flex gap-2 items-center">
										<Label className="text-sm">Max:</Label>
										<Input
											type="number"
											step="0.1"
											min="0"
											value={formData.weightLimits?.max?.value || ''}
											onChange={(e) =>
												setFormData((prev) => ({
													...prev,
													weightLimits: {
														...prev.weightLimits,
														max: {
															value: e.target.value,
															unit: prev.weightLimits?.max?.unit || 'kg',
														},
													},
												}))
											}
											placeholder="0.0"
											className="flex-1"
										/>
										<Select
											value={formData.weightLimits?.max?.unit || 'kg'}
											onValueChange={(value) =>
												setFormData((prev) => ({
													...prev,
													weightLimits: {
														...prev.weightLimits,
														max: {
															value: prev.weightLimits?.max?.value || '0',
															unit: value,
														},
													},
												}))
											}
										>
											<SelectTrigger className="w-20">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{WEIGHT_UNITS.map((unit) => (
													<SelectItem key={unit} value={unit}>
														{unit}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								</div>
							</div>

							{/* Dimension Limits */}
							<div className="space-y-2">
								<Label className="font-medium">Dimension Limits (LxWxH)</Label>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div className="flex gap-2 items-center">
										<Label className="text-sm">Min:</Label>
										<Input
											value={formData.dimensionLimits?.min?.value || ''}
											onChange={(e) =>
												setFormData((prev) => ({
													...prev,
													dimensionLimits: {
														...prev.dimensionLimits,
														min: {
															value: e.target.value,
															unit: prev.dimensionLimits?.min?.unit || 'cm',
														},
													},
												}))
											}
											placeholder="10x10x10"
											className="flex-1"
										/>
										<Select
											value={formData.dimensionLimits?.min?.unit || 'cm'}
											onValueChange={(value) =>
												setFormData((prev) => ({
													...prev,
													dimensionLimits: {
														...prev.dimensionLimits,
														min: {
															value: prev.dimensionLimits?.min?.value || '',
															unit: value,
														},
													},
												}))
											}
										>
											<SelectTrigger className="w-20">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{DIMENSION_UNITS.map((unit) => (
													<SelectItem key={unit} value={unit}>
														{unit}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>

									<div className="flex gap-2 items-center">
										<Label className="text-sm">Max:</Label>
										<Input
											value={formData.dimensionLimits?.max?.value || ''}
											onChange={(e) =>
												setFormData((prev) => ({
													...prev,
													dimensionLimits: {
														...prev.dimensionLimits,
														max: {
															value: e.target.value,
															unit: prev.dimensionLimits?.max?.unit || 'cm',
														},
													},
												}))
											}
											placeholder="100x100x100"
											className="flex-1"
										/>
										<Select
											value={formData.dimensionLimits?.max?.unit || 'cm'}
											onValueChange={(value) =>
												setFormData((prev) => ({
													...prev,
													dimensionLimits: {
														...prev.dimensionLimits,
														max: {
															value: prev.dimensionLimits?.max?.value || '',
															unit: value,
														},
													},
												}))
											}
										>
											<SelectTrigger className="w-20">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{DIMENSION_UNITS.map((unit) => (
													<SelectItem key={unit} value={unit}>
														{unit}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								</div>
							</div>
						</div>

						{/* Actions */}
						<div className="flex justify-end gap-2 pt-4 border-t">
							<Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
								Cancel
							</Button>

							{isEditing && (
								<Button type="button" variant="destructive" onClick={handleDelete} disabled={isSubmitting}>
									<TrashIcon className="w-4 h-4" />
								</Button>
							)}

							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting && <Spinner />}
								{isEditing ? 'Update' : 'Create'}
							</Button>
						</div>
					</form>
				</div>
			</CollapsibleContent>
		</Collapsible>
	)
}

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/shipping-options')({
	component: ShippingOptionsComponent,
})

function ShippingOptionsComponent() {
	const { getUser } = useNDK()
	const [user, setUser] = useState<any>(null)
	const [openShippingOptionId, setOpenShippingOptionId] = useState<string | null>(null)
	const [serviceFilter, setServiceFilter] = useState<string>('all')

	useDashboardTitle('Shipping Options')

	useEffect(() => {
		getUser().then(setUser)
	}, [getUser])

	const shippingOptionsQuery = useShippingOptionsByPubkey(user?.pubkey || '')

	const filteredShippingOptions =
		shippingOptionsQuery.data?.filter((option) => {
			if (serviceFilter === 'all') return true
			const serviceTag = getShippingService(option)
			return serviceTag?.[1] === serviceFilter
		}) || []

	const handleOpenChange = (shippingOptionId: string | null, open: boolean) => {
		setOpenShippingOptionId(open ? shippingOptionId : null)
	}

	return (
		<div className="space-y-6">
			<div className="flex justify-between items-center">
				<div>
					<p className="text-muted-foreground">Manage your shipping options for customers</p>
				</div>
				<div className="flex items-center gap-4">
					<div className="flex items-center gap-2">
						<Label htmlFor="service-filter" className="text-sm font-medium">
							Filter:
						</Label>
						<Select value={serviceFilter} onValueChange={setServiceFilter}>
							<SelectTrigger className="w-[180px]">
								<SelectValue placeholder="All services" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All services</SelectItem>
								{SERVICE_TYPES.map((service) => (
									<SelectItem key={service.value} value={service.value}>
										{service.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
			</div>

			<div className="space-y-4">
				{/* Add new shipping option */}
				<ShippingOptionForm
					shippingOption={null}
					isOpen={openShippingOptionId === 'new'}
					onOpenChange={(open) => handleOpenChange('new', open)}
					onSuccess={() => shippingOptionsQuery.refetch()}
				/>

				{/* Existing shipping options */}
				{filteredShippingOptions.map((shippingOption) => {
					const shippingId = getShippingId(shippingOption)
					if (!shippingId) return null
					return (
						<ShippingOptionForm
							key={shippingOption.id}
							shippingOption={shippingOption}
							isOpen={openShippingOptionId === shippingId}
							onOpenChange={(open) => handleOpenChange(shippingId, open)}
							onSuccess={() => shippingOptionsQuery.refetch()}
						/>
					)
				})}

				{shippingOptionsQuery.isLoading && (
					<div className="flex items-center justify-center p-8">
						<Spinner />
						<span className="ml-2">Loading shipping options...</span>
					</div>
				)}

				{filteredShippingOptions.length === 0 && !shippingOptionsQuery.isLoading && (
					<Card>
						<CardContent className="py-10 flex flex-col items-center justify-center">
							<TruckIcon className="w-16 h-16 text-muted-foreground mb-4" />
							<p className="text-center text-muted-foreground mb-4">
								{serviceFilter === 'all'
									? 'No shipping options configured yet. Add a shipping option to start offering delivery to your customers.'
									: `No ${SERVICE_TYPES.find((s) => s.value === serviceFilter)?.label.toLowerCase()} shipping options found.`}
							</p>
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	)
}
