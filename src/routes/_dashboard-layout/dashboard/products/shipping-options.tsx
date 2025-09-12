import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { COUNTRIES_ISO, CURRENCIES, SHIPPING_TEMPLATES } from '@/lib/constants'
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
	getShippingPickupAddress,
	getShippingPrice,
	getShippingService,
	getShippingTitle,
	getShippingWeightLimits,
	useShippingOptionsByPubkey,
} from '@/queries/shipping'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { createFileRoute } from '@tanstack/react-router'

import { DashboardListItem } from '@/components/layout/DashboardListItem'
import { AlertCircleIcon, ChevronLeftIcon, PackageIcon, PlusIcon, TrashIcon, TruckIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { DashboardListItem } from '@/components/layout/DashboardListItem'
import { useAutoAnimate } from '@formkit/auto-animate/react'

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
	const [isOptionalDetailsOpen, setIsOptionalDetailsOpen] = useState(false)
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

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
			const pickupAddressTag = getShippingPickupAddress(shippingOption)
			const weightLimits = getShippingWeightLimits(shippingOption)
			const dimensionLimits = getShippingDimensionLimits(shippingOption)

			return {
				title: getShippingTitle(shippingOption),
				description: getShippingDescription(shippingOption),
				price: priceTag?.[1] || '',
				currency: priceTag?.[2] || 'USD',
				countries: countryTag?.slice(1) || [],
				service: (serviceTag?.[1] as any) || 'standard',
				carrier: carrierTag?.[1] || '',
				location: locationTag?.[1] || '',
				pickupAddress: pickupAddressTag || {
					street: '',
					city: '',
					state: '',
					postalCode: '',
					country: '',
				},
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
			countries: [],
			service: 'standard',
			pickupAddress: {
				street: '',
				city: '',
				state: '',
				postalCode: '',
				country: '',
			},
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
			countries: [],
			service: 'standard',
			pickupAddress: {
				street: '',
				city: '',
				state: '',
				postalCode: '',
				country: '',
			},
		})
		setFieldErrors({})
		setIsSubmitting(false)
	}, [])

	const validateForm = (): boolean => {
		const errors: Record<string, string> = {}

		if (!formData.title.trim()) {
			errors.title = 'Title is required'
		}
		if (!formData.description.trim()) {
			errors.description = 'Description is required'
		}
		if (!formData.price.trim()) {
			errors.price = 'Price is required'
		} else if (isNaN(Number(formData.price))) {
			errors.price = 'Price must be a valid number'
		}
		if (!formData.currency.trim()) {
			errors.currency = 'Currency is required'
		}
		// Countries are only required for non-pickup services
		if (formData.service !== 'pickup' && !formData.countries.length) {
			errors.countries = 'At least one country is required'
		}

		if (formData.service === 'pickup') {
			if (!formData.pickupAddress?.street?.trim()) {
				errors.pickupStreet = 'Street address is required for local pickup'
			}
			if (!formData.pickupAddress?.city?.trim()) {
				errors.pickupCity = 'City is required for local pickup'
			}
		}

		setFieldErrors(errors)
		return Object.keys(errors).length === 0
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!validateForm()) {
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
				toast.success('Shipping option updated successfully')
			} else {
				await publishMutation.mutateAsync(formData)
				toast.success('Shipping option created successfully')
			}

			onOpenChange(false)
			if (!isEditing) resetForm()
			onSuccess?.()
		} catch (error) {
			toast.error('Failed to save shipping option')
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
				toast.error('Failed to delete shipping option')
			}
		}
	}

	const ServiceIcon = ({ service }: { service: string }) => {
		switch (service) {
			case 'express':
			case 'overnight':
				return <TruckIcon className="w-5 h-5 text-black" />
			case 'pickup':
				return <PackageIcon className="w-5 h-5 text-black" />
			default:
				return <TruckIcon className="w-5 h-5 text-black" />
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

	const triggerContent = isEditing ? (
		<div className="min-w-0 flex-1">
			<div className="font-medium truncate">{formData.title}</div>
			{/* Stack details vertically on mobile, inline on desktop */}
			<div className="text-sm text-muted-foreground">
				<div className="hidden md:block truncate">
					{formData.price} {formData.currency} • {formData.countries.map(getCountryName).join(', ')} • {getServiceLabel(formData.service)}
				</div>
				<div className="md:hidden space-y-1">
					<div className="truncate">
						{formData.price} {formData.currency}
					</div>
					<div className="truncate">{formData.countries.map(getCountryName).join(', ')}</div>
					<div className="truncate">{getServiceLabel(formData.service)}</div>
				</div>
			</div>
		</div>
	) : (
		<div className="flex items-center gap-2">
			<PlusIcon className="w-6 h-6" />
			<span>Add new shipping option</span>
		</div>
	)

	const triggerActions = null

	return (
		<DashboardListItem
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			triggerContent={triggerContent}
			actions={triggerActions}
			icon={<ServiceIcon service={formData.service} />}
			data-testid={isEditing ? `shipping-option-item-${getShippingId(shippingOption)}` : 'add-shipping-option-button'}
			className="w-full max-w-full overflow-hidden"
			useCloseIcon={true}
		>
			<div className="p-4 border-t">
				<form onSubmit={handleSubmit} className="space-y-6 w-full max-w-2xl">
					{/* Use a template */}
					<div className="space-y-4">
						<h3 className="text-lg font-semibold">Use a template</h3>
						<div className="space-y-4">
							{/* Templates - Renamed and restructured */}
							<div className="space-y-2">
								<Label className="font-medium">Templates</Label>
								<Select
									onValueChange={(templateName) => {
										const template = SHIPPING_TEMPLATES.find((t) => t.name === templateName)
										if (template) {
											setFormData((prev) => ({
												...prev,
												title: template.name,
												price: template.cost,
												countries: template.countries || [],
												// Auto-set service type to pickup for Local Pickup template
												service: template.name === 'Local Pickup' ? 'pickup' : prev.service,
											}))
										}
									}}
								>
									<SelectTrigger data-testid="shipping-template-select">
										<SelectValue placeholder="Choose a template (optional)" />
									</SelectTrigger>
									<SelectContent>
										{SHIPPING_TEMPLATES.map((template) => (
											<SelectItem
												key={template.name}
												value={template.name}
												data-testid={`template-${template.name.toLowerCase().replace(/\s+/g, '-')}`}
											>
												{template.name} {template.countries ? `(${template.countries.length} countries)` : '(Worldwide)'}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<h3 className="text-lg font-semibold pt-4">Shipping Option Details</h3>

							<div className="space-y-2">
								<Label htmlFor="title" className="font-medium">
									Title *
								</Label>
								<Input
									id="title"
									data-testid="shipping-title-input"
									value={formData.title}
									onChange={(e) => {
										setFormData((prev) => ({ ...prev, title: e.target.value }))
										if (fieldErrors.title) {
											setFieldErrors((prev) => ({ ...prev, title: '' }))
										}
									}}
									placeholder="e.g., Standard Shipping to US"
									className={fieldErrors.title ? 'border-red-500' : ''}
								/>
								{fieldErrors.title && (
									<div className="flex items-center gap-1 text-sm text-red-600">
										<AlertCircleIcon className="h-4 w-4" />
										{fieldErrors.title}
									</div>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="service" className="font-medium">
									Service Type *
								</Label>
								<Select
									value={formData.service}
									onValueChange={(value: any) => {
										setFormData((prev) => {
											const newFormData = { ...prev, service: value }
											// Auto-populate country and price for pickup services
											if (value === 'pickup') {
												// Set price to 0 for pickup services
												newFormData.price = '0'
												// Auto-populate country from pickup address if available
												if (prev.pickupAddress?.country && !prev.countries.includes(prev.pickupAddress.country)) {
													newFormData.countries = [prev.pickupAddress.country]
												} else if (!prev.countries.length) {
													// Default to USA if no country is set
													newFormData.countries = ['USA']
												}
											}
											return newFormData
										})
									}}
								>
									<SelectTrigger data-testid="shipping-service-select">
										<SelectValue placeholder="Select service type" />
									</SelectTrigger>
									<SelectContent>
										{SERVICE_TYPES.map((service) => (
											<SelectItem key={service.value} value={service.value} data-testid={`service-${service.value}`}>
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
										data-testid="shipping-price-input"
										type="number"
										step="0.01"
										min="0"
										value={formData.price}
										onChange={(e) => {
											setFormData((prev) => ({ ...prev, price: e.target.value }))
											if (fieldErrors.price) {
												setFieldErrors((prev) => ({ ...prev, price: '' }))
											}
										}}
										placeholder="0.00"
										className={`flex-1 ${fieldErrors.price ? 'border-red-500' : ''}`}
									/>
									<Select
										value={formData.currency}
										onValueChange={(value) => {
											setFormData((prev) => ({ ...prev, currency: value }))
											if (fieldErrors.currency) {
												setFieldErrors((prev) => ({ ...prev, currency: '' }))
											}
										}}
									>
										<SelectTrigger
											className={`w-20 ${fieldErrors.currency ? 'border-red-500' : ''}`}
											data-testid="shipping-currency-select"
										>
											<SelectValue>{formData.currency}</SelectValue>
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
								{(fieldErrors.price || fieldErrors.currency) && (
									<div className="flex items-center gap-1 text-sm text-red-600">
										<AlertCircleIcon className="h-4 w-4" />
										{fieldErrors.price || fieldErrors.currency}
									</div>
								)}
							</div>

							{/* Countries - Hide for pickup services */}
							{formData.service !== 'pickup' && (
								<div className="space-y-2">
									<Label htmlFor="countries" className="font-medium">
										Countries *
									</Label>

									{/* Country Selection */}
									<div className="space-y-2">
										<Select
											key={formData.countries.length}
											onValueChange={(countryCode) => {
												if (!formData.countries.includes(countryCode)) {
													setFormData((prev) => ({
														...prev,
														countries: [...prev.countries, countryCode],
													}))
												}
											}}
										>
											<SelectTrigger data-testid="shipping-country-select">
												<SelectValue placeholder="Select countries" />
											</SelectTrigger>
											<SelectContent>
												{Object.values(COUNTRIES_ISO)
													.filter((country) => !formData.countries.includes(country.iso3))
													.map((country) => (
														<SelectItem key={country.iso3} value={country.iso3} data-testid={`country-${country.iso3.toLowerCase()}`}>
															{country.name}
														</SelectItem>
													))}
											</SelectContent>
										</Select>

										<div className="flex flex-wrap gap-2 min-h-[40px] p-2 border rounded-md">
											{formData.countries.map((countryCode) => (
												<Badge key={countryCode} variant="secondary" className="flex items-center gap-1 bg-black text-white">
													{getCountryName(countryCode)}
													<XIcon
														className="w-3 h-3 cursor-pointer pointer-events-auto"
														onClick={() =>
															setFormData((prev) => ({
																...prev,
																countries: prev.countries.filter((c) => c !== countryCode),
															}))
														}
													/>
												</Badge>
											))}
											{formData.countries.length === 0 && <span className="text-muted-foreground text-sm">No countries selected</span>}
										</div>
									</div>
								</div>
							)}
						</div>

						<div className="space-y-2">
							<Label htmlFor="description" className="font-medium">
								Description *
							</Label>
							<Textarea
								id="description"
								data-testid="shipping-description-input"
								value={formData.description}
								onChange={(e) => {
									setFormData((prev) => ({ ...prev, description: e.target.value }))
									if (fieldErrors.description) {
										setFieldErrors((prev) => ({ ...prev, description: '' }))
									}
								}}
								placeholder="Describe your shipping option..."
								rows={3}
								className={fieldErrors.description ? 'border-red-500' : ''}
							/>
							{fieldErrors.description && (
								<div className="flex items-center gap-1 text-sm text-red-600">
									<AlertCircleIcon className="h-4 w-4" />
									{fieldErrors.description}
								</div>
							)}
						</div>

						{/* Pickup Address - Only show for pickup service */}
						{formData.service === 'pickup' && (
							<div className="space-y-4">
								<Label className="font-medium text-base">Pickup Address *</Label>
								<div className="grid grid-cols-1 gap-4">
									<div className="space-y-2">
										<Label htmlFor="pickup-street" className="text-sm font-medium">
											Street Address *
										</Label>
										<Input
											id="pickup-street"
											data-testid="pickup-street-input"
											value={formData.pickupAddress?.street || ''}
											onChange={(e) => {
												setFormData((prev) => ({
													...prev,
													pickupAddress: {
														...(prev.pickupAddress || { street: '', city: '', state: '', postalCode: '', country: '' }),
														street: e.target.value,
													},
												}))
												if (fieldErrors.pickupStreet) {
													setFieldErrors((prev) => ({ ...prev, pickupStreet: '' }))
												}
											}}
											placeholder="123 Main Street"
											className={fieldErrors.pickupStreet ? 'border-red-500' : ''}
										/>
										{fieldErrors.pickupStreet && (
											<div className="flex items-center gap-1 text-sm text-red-600">
												<AlertCircleIcon className="h-4 w-4" />
												{fieldErrors.pickupStreet}
											</div>
										)}
									</div>
									<div className="grid grid-cols-2 gap-4">
										<div className="space-y-2">
											<Label htmlFor="pickup-city" className="text-sm font-medium">
												City *
											</Label>
											<Input
												id="pickup-city"
												data-testid="pickup-city-input"
												value={formData.pickupAddress?.city || ''}
												onChange={(e) => {
													setFormData((prev) => ({
														...prev,
														pickupAddress: {
															...(prev.pickupAddress || {
																street: '',
																city: '',
																state: '',
																postalCode: '',
																country: '',
															}),
															city: e.target.value,
														},
													}))
													if (fieldErrors.pickupCity) {
														setFieldErrors((prev) => ({ ...prev, pickupCity: '' }))
													}
												}}
												placeholder="New York"
												className={fieldErrors.pickupCity ? 'border-red-500' : ''}
											/>
											{fieldErrors.pickupCity && (
												<div className="flex items-center gap-1 text-sm text-red-600">
													<AlertCircleIcon className="h-4 w-4" />
													{fieldErrors.pickupCity}
												</div>
											)}
										</div>
										<div className="space-y-2">
											<Label htmlFor="pickup-state" className="text-sm font-medium">
												State/Province
											</Label>
											<Input
												id="pickup-state"
												data-testid="pickup-state-input"
												value={formData.pickupAddress?.state || ''}
												onChange={(e) =>
													setFormData((prev) => ({
														...prev,
														pickupAddress: {
															...(prev.pickupAddress || {
																street: '',
																city: '',
																state: '',
																postalCode: '',
																country: '',
															}),
															state: e.target.value,
														},
													}))
												}
												placeholder="NY"
											/>
										</div>
									</div>
									<div className="grid grid-cols-2 gap-4">
										<div className="space-y-2">
											<Label htmlFor="pickup-postal-code" className="text-sm font-medium">
												Postal Code
											</Label>
											<Input
												id="pickup-postal-code"
												data-testid="pickup-postal-code-input"
												value={formData.pickupAddress?.postalCode || ''}
												onChange={(e) =>
													setFormData((prev) => ({
														...prev,
														pickupAddress: {
															...(prev.pickupAddress || {
																street: '',
																city: '',
																state: '',
																postalCode: '',
																country: '',
															}),
															postalCode: e.target.value,
														},
													}))
												}
												placeholder="10001"
											/>
										</div>
										<div className="space-y-2">
											<Label htmlFor="pickup-country" className="text-sm font-medium">
												Country
											</Label>
											<Input
												id="pickup-country"
												data-testid="pickup-country-input"
												value={formData.pickupAddress?.country || ''}
												onChange={(e) =>
													setFormData((prev) => {
														const newFormData = {
															...prev,
															pickupAddress: {
																...(prev.pickupAddress || {
																	street: '',
																	city: '',
																	state: '',
																	postalCode: '',
																	country: '',
																}),
																country: e.target.value,
															},
														}
														// Auto-populate countries for pickup services
														if (prev.service === 'pickup' && e.target.value && !prev.countries.includes(e.target.value)) {
															newFormData.countries = [e.target.value]
														}
														return newFormData
													})
												}
												placeholder="United States"
											/>
										</div>
									</div>
								</div>
							</div>
						)}
					</div>

					{/* Optional Details */}
					<Collapsible open={isOptionalDetailsOpen} onOpenChange={setIsOptionalDetailsOpen}>
						<CollapsibleTrigger asChild>
							<div className="group flex w-full justify-between items-center cursor-pointer">
								<h3 className="text-lg font-semibold">Optional Details</h3>
								<ChevronLeftIcon className="w-4 h-4 transition-transform duration-200 group-data-[state=open]:-rotate-90" />
							</div>
						</CollapsibleTrigger>
						<CollapsibleContent>
							<div className="space-y-4 pt-4">
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
										placeholder="e.g., 123 Main St, Downtown, FL"
									/>
								</div>

								<div className="space-y-2">
									<Label htmlFor="region" className="font-medium">
										Region
									</Label>
									<Input
										id="region"
										value={formData.region || ''}
										onChange={(e) => setFormData((prev) => ({ ...prev, region: e.target.value }))}
										placeholder="e.g., US-FL (ISO 3166-2 format)"
									/>
								</div>

								<div className="space-y-2">
									<Label htmlFor="geohash" className="font-medium">
										Geohash
									</Label>
									<Input
										id="geohash"
										value={formData.geohash || ''}
										onChange={(e) => setFormData((prev) => ({ ...prev, geohash: e.target.value }))}
										placeholder="e.g., dhwm9c4ws (precise location hash)"
									/>
								</div>

								{/* Duration */}
								<div className="space-y-2">
									<Label className="font-medium">Delivery Duration</Label>
									<div className="flex flex-col gap-2">
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
											<SelectTrigger className="w-full">
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
											className="w-full"
										/>
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
											className="w-full"
										/>
									</div>
								</div>

								{/* Weight Limits */}
								<div className="space-y-2">
									<Label className="font-medium">Weight Limits</Label>
									<div className="space-y-4">
										<div className="flex gap-2 items-center">
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
												placeholder="Min e.g. 0.0"
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
												placeholder="Max e.g. 0.0"
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
										{fieldErrors.price && (
											<div className="flex items-center gap-1 text-sm text-red-600">
												<AlertCircleIcon className="h-4 w-4" />
												{fieldErrors.price}
											</div>
										)}
									</div>
								</div>

								{/* Dimension Limits (LxWxH) */}
								<div className="space-y-2">
									<Label className="font-medium">Dimension Limits (LxWxH)</Label>
									<div className="space-y-4">
										<div className="flex gap-2 items-center">
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
												placeholder="Min e.g. 10x10x10"
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
												placeholder="Max e.g. 100x100x100"
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
						</CollapsibleContent>
					</Collapsible>

					{/* Actions */}
					<div className="flex justify-end gap-2 pt-4">
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
							Cancel
						</Button>

						{isEditing && (
							<Button type="button" variant="destructive" onClick={handleDelete} disabled={isSubmitting}>
								<TrashIcon className="w-4 h-4" />
							</Button>
						)}

						<Button type="submit" disabled={isSubmitting} data-testid="shipping-submit-button">
							{isSubmitting && <Spinner />}
							{isEditing ? 'Update' : 'Create'}
						</Button>
					</div>
				</form>
			</div>
		</DashboardListItem>
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

	// Auto-animate for smooth list transitions
	const [animationParent] = (() => {
		try {
			return useAutoAnimate()
		} catch (error) {
			console.warn('Auto-animate not available:', error)
			return [null]
		}
	})()

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
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 fg-layer-elevated border-b border-black py-4 px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">Shipping Options</h1>
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
					<Button
						onClick={() => handleOpenChange('new', true)}
						className="btn-black flex items-center gap-2 px-4 py-2 text-sm font-semibold"
					>
						<PlusIcon className="w-5 h-5" />
						Add Shipping Option
					</Button>
				</div>
			</div>
			<div className="space-y-6 p-4 lg:p-6 bg-layer-base">
				<div className="lg:hidden space-y-4">
					<div>
						<p className="text-muted-foreground">Manage your shipping options for customers</p>
					</div>

					<Select value={serviceFilter} onValueChange={setServiceFilter}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Filter by service type" />
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

					<Button
						onClick={() => handleOpenChange('new', true)}
						className="w-full btn-black flex items-center justify-center gap-2 py-3 text-base font-semibold rounded-t-md rounded-b-none border-b border-neutral-600"
					>
						<PlusIcon className="w-5 h-5" />
						Add Shipping Option
					</Button>
				</div>

				{/* Shipping option form - shows at top when opened */}
				{openShippingOptionId === 'new' && (
					<Card className="mt-4 fg-layer-elevated border-layer-subtle">
						<CardContent className="p-0">
							<ShippingOptionForm
								shippingOption={null}
								isOpen={openShippingOptionId === 'new'}
								onOpenChange={(open) => handleOpenChange('new', open)}
								onSuccess={() => shippingOptionsQuery.refetch()}
							/>
						</CardContent>
					</Card>
				)}

				<div ref={animationParent} className="space-y-4">
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
		</div>
	)
}
