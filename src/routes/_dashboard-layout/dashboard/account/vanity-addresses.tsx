import { DashboardListItem } from '@/components/layout/DashboardListItem'
import { VanityAddressForm } from '@/components/vanity/VanityAddressForm'
import { VanityStatusBadge } from '@/components/vanity/VanityStatusBadge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useNDK } from '@/lib/stores/ndk'
import { useUserVanityAddresses, useVanityConfig, isVanityConfigured, getVanityDomain } from '@/queries/vanity'
import { useDeleteVanityRequestMutation } from '@/publish/vanity'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import { LinkIcon, PlusIcon, TrashIcon, ExternalLinkIcon, AlertCircle } from 'lucide-react'
import { useState, useEffect } from 'react'
import type { VanityAddress } from '@/lib/schemas/vanity'
import type { NDKUser } from '@nostr-dev-kit/ndk'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/vanity-addresses')({
	component: VanityAddressesComponent,
})

function VanityAddressesComponent() {
	useDashboardTitle('Vanity Addresses')

	const { getUser } = useNDK()
	const [user, setUser] = useState<NDKUser | null>(null)

	useEffect(() => {
		getUser().then(setUser)
	}, [getUser])

	const pubkey = user?.pubkey

	const [isAddingNew, setIsAddingNew] = useState(false)
	const [expandedItem, setExpandedItem] = useState<string | null>(null)

	const vanityAddressesQuery = useUserVanityAddresses(pubkey)
	const vanityConfigQuery = useVanityConfig()
	const deleteMutation = useDeleteVanityRequestMutation()

	const isConfigured = isVanityConfigured()
	const domain = getVanityDomain()

	const handleDelete = async (address: VanityAddress) => {
		if (!confirm(`Are you sure you want to delete the vanity address "${address.name}"?`)) {
			return
		}
		deleteMutation.mutate({ dTag: address.dTag })
	}

	const handleAddSuccess = () => {
		setIsAddingNew(false)
		vanityAddressesQuery.refetch()
	}

	if (!isConfigured) {
		return (
			<div className="p-4 lg:p-8">
				<div className="flex items-center gap-3 mb-6">
					<LinkIcon className="w-6 h-6 text-muted-foreground" />
					<div>
						<h1 className="text-2xl font-bold">Vanity Addresses</h1>
						<p className="text-muted-foreground text-sm">Custom short URLs for your profile</p>
					</div>
				</div>
				<div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
					<AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
					<div>
						<p className="font-medium text-amber-900">Vanity addresses not configured</p>
						<p className="text-sm text-amber-700 mt-1">This feature requires server configuration. Please contact the administrator.</p>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div>
			{/* Desktop Header */}
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<div className="flex items-center gap-3">
					<LinkIcon className="w-6 h-6 text-muted-foreground" />
					<div>
						<h1 className="text-2xl font-bold">Vanity Addresses</h1>
						<p className="text-muted-foreground text-sm">Custom short URLs like {domain}/yourname</p>
					</div>
				</div>
				{!isAddingNew && (
					<Button onClick={() => setIsAddingNew(true)}>
						<PlusIcon className="w-4 h-4 mr-2" />
						Add Vanity Address
					</Button>
				)}
			</div>

			<div className="p-4 lg:p-8">
				{/* Mobile Header */}
				<div className="lg:hidden mb-6">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<LinkIcon className="w-6 h-6 text-muted-foreground" />
							<div>
								<h1 className="text-2xl font-bold">Vanity Addresses</h1>
								<p className="text-muted-foreground text-sm">Custom short URLs like {domain}/yourname</p>
							</div>
						</div>
					</div>
					{!isAddingNew && (
						<Button className="w-full mt-4" onClick={() => setIsAddingNew(true)}>
							<PlusIcon className="w-4 h-4 mr-2" />
							Add Vanity Address
						</Button>
					)}
				</div>

				{/* Pricing Info */}
				{vanityConfigQuery.data && (
					<div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
						<p className="text-sm text-blue-900">
							<strong>Pricing:</strong> {vanityConfigQuery.data.price} sats per year
						</p>
					</div>
				)}

				{/* Add New Form */}
				{isAddingNew && (
					<div className="mb-6">
						<VanityAddressForm onSuccess={handleAddSuccess} onCancel={() => setIsAddingNew(false)} />
					</div>
				)}

				{/* Loading State */}
				{vanityAddressesQuery.isLoading && (
					<div className="flex justify-center py-8">
						<Spinner />
					</div>
				)}

				{/* Empty State */}
				{!vanityAddressesQuery.isLoading && vanityAddressesQuery.data && vanityAddressesQuery.data.length === 0 && (
					<div className="text-center py-12 text-muted-foreground">
						<LinkIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
						<p>No vanity addresses yet</p>
						<p className="text-sm mt-2">Register a custom URL like {domain}/yourname</p>
					</div>
				)}

				{/* Address List */}
				{vanityAddressesQuery.data && vanityAddressesQuery.data.length > 0 && (
					<div className="space-y-3">
						{vanityAddressesQuery.data.map((address) => (
							<VanityAddressListItem
								key={address.dTag}
								address={address}
								domain={domain}
								isExpanded={expandedItem === address.dTag}
								onToggle={() => setExpandedItem(expandedItem === address.dTag ? null : address.dTag)}
								onDelete={() => handleDelete(address)}
								isDeleting={deleteMutation.isPending}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

interface VanityAddressListItemProps {
	address: VanityAddress
	domain: string
	isExpanded: boolean
	onToggle: () => void
	onDelete: () => void
	isDeleting: boolean
}

function VanityAddressListItem({ address, domain, isExpanded, onToggle, onDelete, isDeleting }: VanityAddressListItemProps) {
	const fullUrl = `https://${domain}/${address.name}`

	return (
		<DashboardListItem
			isOpen={isExpanded}
			onOpenChange={onToggle}
			triggerContent={
				<div className="flex items-center justify-between w-full">
					<div className="flex items-center gap-3">
						<LinkIcon className="w-5 h-5 text-muted-foreground" />
						<div>
							<div className="font-medium">{address.name}</div>
							<div className="text-sm text-muted-foreground">
								{domain}/{address.name}
							</div>
						</div>
					</div>
					<VanityStatusBadge status={address.status} />
				</div>
			}
			actions={
				<div className="flex items-center gap-2">
					{address.status === 'active' && (
						<Button
							variant="outline"
							size="sm"
							onClick={(e) => {
								e.stopPropagation()
								window.open(fullUrl, '_blank')
							}}
						>
							<ExternalLinkIcon className="w-4 h-4" />
						</Button>
					)}
					<Button
						variant="destructive"
						size="sm"
						onClick={(e) => {
							e.stopPropagation()
							onDelete()
						}}
						disabled={isDeleting}
					>
						<TrashIcon className="w-4 h-4" />
					</Button>
				</div>
			}
		>
			<div className="p-4 space-y-4">
				<div className="grid grid-cols-2 gap-4 text-sm">
					<div>
						<span className="text-muted-foreground">Status:</span>
						<span className="ml-2 font-medium capitalize">{address.status.replace('_', ' ')}</span>
					</div>
					{address.confirmation?.validUntil && (
						<div>
							<span className="text-muted-foreground">Valid until:</span>
							<span className="ml-2 font-medium">{format(new Date(address.confirmation.validUntil * 1000), 'PPP')}</span>
						</div>
					)}
					{address.request?.createdAt && (
						<div>
							<span className="text-muted-foreground">Requested:</span>
							<span className="ml-2 font-medium">{format(new Date(address.request.createdAt * 1000), 'PPP')}</span>
						</div>
					)}
				</div>

				{address.status === 'active' && (
					<div className="bg-green-50 border border-green-200 rounded-lg p-3">
						<p className="text-sm text-green-900">
							Your vanity URL is active at{' '}
							<a href={fullUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline">
								{fullUrl}
							</a>
						</p>
					</div>
				)}

				{address.status === 'pending_confirmation' && (
					<div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
						<p className="text-sm text-amber-900">Waiting for payment confirmation. This may take a few minutes after payment.</p>
					</div>
				)}

				{address.status === 'expired' && (
					<div className="bg-red-50 border border-red-200 rounded-lg p-3">
						<p className="text-sm text-red-900">This vanity address has expired. You can renew it by registering again.</p>
					</div>
				)}
			</div>
		</DashboardListItem>
	)
}
