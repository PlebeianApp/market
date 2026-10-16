import { format } from 'date-fns'
import { Ban, Check, CheckCircle, Clock, Download, MapPin, Package, Truck, X } from 'lucide-react'
import type { ComponentType, ReactNode, SVGProps } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../primitives/card'
import { DetailField } from '../primitives/DetailField'
import { cn } from '../utils/cn'
import { PickupAddressDisplay } from './PickupAddressDisplay'
import { ShippingInfoDisplay } from './ShippingInfoDisplay'

const STATUS_ICON_MAP: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
	truck: Truck,
	tick: Check,
	check: Check,
	clock: Clock,
	cross: X,
	ban: Ban,
	circle: CheckCircle,
}

export interface OrderStatusDisplay {
	label?: string
	iconName?: string | null
	headerBgColor?: string
	badgeBgColor?: string
	explanation?: string | null
}

export interface OrderDetailHeaderProps {
	title: string
	subText?: string
	totalSats: number
	createdAt?: number
	status: OrderStatusDisplay
	/** Host-owned order management controls. */
	actions?: ReactNode
}

export function OrderDetailHeader({ title, subText, totalSats, createdAt, status, actions }: OrderDetailHeaderProps) {
	const StatusIcon = status.iconName ? STATUS_ICON_MAP[status.iconName] : undefined

	return (
		<Card>
			<CardHeader className="p-0">
				<div className={cn('rounded-t-xl p-4', status.headerBgColor)}>
					<div className="mb-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
						<div className="flex items-center space-x-3">
							<div className="rounded-lg bg-blue-100 p-2">
								<Package className="h-5 w-5 text-blue-700" />
							</div>
							<div>
								<p className="text-sm font-medium text-gray-900">Products</p>
								<h2 className="max-w-[300px] truncate font-semibold text-gray-800" title={title}>
									{title}
								</h2>
								{subText && <p className="mt-0.5 text-xs text-gray-600">{subText}</p>}
							</div>
						</div>
					</div>

					<div className="border-t border-white/20 pt-4">
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<DetailField label="Amount:" value={`${totalSats} sats`} valueClassName="font-bold text-gray-900" />
							<DetailField
								label="Date:"
								value={createdAt ? format(new Date(createdAt * 1000), 'dd.MM.yyyy, HH:mm') : 'N/A'}
								valueClassName="text-gray-900"
							/>
						</div>
					</div>
				</div>
			</CardHeader>

			<CardContent className="pt-4">
				<div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
					<div className="mb-2 flex items-center gap-2">
						<div className={cn('rounded-md p-1.5', status.badgeBgColor)}>{StatusIcon && <StatusIcon className="h-4 w-4" />}</div>
						<span className="font-semibold capitalize text-gray-900">{status.label}</span>
					</div>
					<p className="ml-9 text-sm text-gray-700">{status.explanation || 'No pending actions required.'}</p>
				</div>
				{actions}
			</CardContent>
		</Card>
	)
}

export function OrderBuyerContactCard({ deliveryContact }: { deliveryContact: string }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Buyer Contact</CardTitle>
			</CardHeader>
			<CardContent>
				<p className="text-sm text-gray-700">
					<strong>Delivery contact:</strong> {deliveryContact}
				</p>
				<p className="mt-2 text-xs text-gray-500">The seller can use this contact for order coordination after payment settles.</p>
			</CardContent>
		</Card>
	)
}

export interface PrivateAuctionClaimDetails {
	shippingAddress: {
		name?: string
		firstLineOfAddress?: string
		additionalInformation?: string
		city?: string
		zipPostcode?: string
		country?: string
	}
	email?: string
	phone?: string
	notes?: string
}

export function formatPrivateAuctionClaimAddress({ shippingAddress }: PrivateAuctionClaimDetails): string {
	return [
		shippingAddress.name,
		shippingAddress.firstLineOfAddress,
		shippingAddress.additionalInformation,
		[shippingAddress.city, shippingAddress.zipPostcode].filter(Boolean).join(' '),
		shippingAddress.country,
	]
		.filter(Boolean)
		.join('\n')
}

export interface PrivateAuctionClaimCardProps {
	isLoading: boolean
	claim: PrivateAuctionClaimDetails | null
	unavailableMessage: string
}

export function PrivateAuctionClaimCard({ isLoading, claim, unavailableMessage }: PrivateAuctionClaimCardProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Private Auction Claim Details</CardTitle>
			</CardHeader>
			<CardContent>
				{isLoading && <p className="text-sm text-gray-600">Loading private auction claim details...</p>}

				{!isLoading && claim && (
					<div className="space-y-4">
						<div>
							<p className="text-sm font-semibold text-gray-900">Private shipping address</p>
							<p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{formatPrivateAuctionClaimAddress(claim)}</p>
						</div>

						<div className="grid gap-3 sm:grid-cols-2">
							{claim.email && (
								<p className="text-sm text-gray-700">
									<strong>Contact email:</strong> {claim.email}
								</p>
							)}
							{claim.phone && (
								<p className="text-sm text-gray-700">
									<strong>Contact phone:</strong> {claim.phone}
								</p>
							)}
						</div>

						{claim.notes && (
							<div>
								<p className="text-sm font-semibold text-gray-900">Message to seller</p>
								<p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{claim.notes}</p>
							</div>
						)}
					</div>
				)}

				{!isLoading && !claim && <p className="text-sm text-gray-600">{unavailableMessage}</p>}
			</CardContent>
		</Card>
	)
}

export type OrderFulfillmentMode = 'pickup' | 'digital' | 'shipping'

export interface OrderShippingCardProps {
	mode: OrderFulfillmentMode
	shippingInfo?: Parameters<typeof ShippingInfoDisplay>[0]['shippingInfo'] | null
	pickupAddress?: string | null
	/** Host-rendered buyer delivery address (only passed when the viewer may see it). */
	deliveryAddress?: ReactNode
	/** Host-rendered tracking details. */
	tracking?: ReactNode
}

export function OrderShippingCard({ mode, shippingInfo, pickupAddress, deliveryAddress, tracking }: OrderShippingCardProps) {
	const Icon = mode === 'pickup' ? MapPin : mode === 'digital' ? Download : Truck
	const title = mode === 'pickup' ? 'Pickup Information' : mode === 'digital' ? 'Digital Delivery' : 'Shipping Information'

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-2">
					<Icon className="h-5 w-5" />
					<CardTitle>{title}</CardTitle>
				</div>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					{shippingInfo && <ShippingInfoDisplay shippingInfo={shippingInfo} />}

					{mode === 'pickup' && pickupAddress && <PickupAddressDisplay pickupAddress={pickupAddress} />}

					{mode === 'digital' && (
						<div className="mt-4 rounded-lg border border-purple-200 bg-purple-50 p-4">
							<div className="flex items-start gap-2">
								<Download className="mt-0.5 h-4 w-4 text-purple-600" />
								<div>
									<p className="font-medium text-purple-900">Digital Delivery</p>
									<p className="mt-1 text-sm text-purple-800">
										The seller will use the buyer-provided delivery contact after payment settles.
									</p>
								</div>
							</div>
						</div>
					)}

					{mode === 'shipping' && deliveryAddress}

					{tracking}

					{shippingInfo?.description && (
						<div className="mt-4 rounded-lg bg-gray-50 p-3">
							<p className="text-sm text-gray-700">{shippingInfo.description}</p>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	)
}
