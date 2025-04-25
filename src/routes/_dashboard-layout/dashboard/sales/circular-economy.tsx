import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { useV4VShares, usePublishV4VShares } from '@/queries/v4v'
import { useConfigQuery } from '@/queries/config'
import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { useZapCapabilityByNpub } from '@/queries/profiles'
import { toast } from 'sonner'
import type { V4VDTO } from '@/lib/stores/cart'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { RecipientItem } from '@/components/v4v/RecipientItem'
import { RecipientPreview } from '@/components/v4v/RecipientPreview'
import { ProfileSearch } from '@/components/v4v/ProfileSearch'
import { Slider } from '@/components/ui/slider'

export const Route = createFileRoute('/_dashboard-layout/dashboard/sales/circular-economy')({
	component: CircularEconomyComponent,
})

function CircularEconomyComponent() {
	const { data: config } = useConfigQuery()
	const authState = useStore(authStore)
	const userPubkey = authState.user?.pubkey || ''
	const appPubkey = config?.appPublicKey || ''
	const { data: v4vShares = [], isLoading, refetch } = useV4VShares(userPubkey)
	const publishMutation = usePublishV4VShares()

	const [showAddForm, setShowAddForm] = useState(false)
	const [newRecipientNpub, setNewRecipientNpub] = useState('')
	const [newRecipientShare, setNewRecipientShare] = useState(10)
	const [localShares, setLocalShares] = useState<V4VDTO[]>([])
	const [isChecking, setIsChecking] = useState(false)
	// Total V4V percentage (out of 100%) that goes to all recipients
	const [totalV4VPercentage, setTotalV4VPercentage] = useState(10)

	const { data: canReceiveZaps, isLoading: isCheckingZap } = useZapCapabilityByNpub(newRecipientNpub || '')

	// Initialize local shares from fetched data
	useEffect(() => {
		if (v4vShares.length > 0) {
			// Calculate the total percentage to normalize
			const totalPercentage = v4vShares.reduce((total, share) => total + share.percentage, 0)

			// We need to normalize the percentages to get the total V4V percentage
			if (totalPercentage > 0) {
				// Set the total V4V percentage based on the first recipient's raw percentage
				setTotalV4VPercentage(Math.round(totalPercentage * 100))

				// Normalize shares so they add up to 100% of the V4V portion
				const normalizedShares = v4vShares.map((share) => ({
					...share,
					// When we save, we'll convert back to portions of the total
					percentage: share.percentage / totalPercentage,
				}))
				setLocalShares(normalizedShares)
			} else {
				setLocalShares(v4vShares)
			}
		}
	}, [v4vShares])

	// Seller gets the remaining percentage
	const sellerPercentage = 100 - totalV4VPercentage
	const formattedSellerPercentage = sellerPercentage.toFixed(0)
	const formattedTotalV4V = totalV4VPercentage.toFixed(0)

	// Handle the total V4V percentage change
	const handleTotalV4VPercentageChange = (value: number[]) => {
		setTotalV4VPercentage(value[0])
	}

	// Handle profile selection from search
	const handleProfileSelect = (npub: string) => {
		setNewRecipientNpub(npub)
	}

	// Handle adding a new recipient
	const handleAddRecipient = async () => {
		if (!newRecipientNpub) {
			toast.error('Please enter a valid npub')
			return
		}

		setIsChecking(true)

		try {
			// Check if recipient can receive zaps
			if (!canReceiveZaps) {
				toast.error('This user cannot receive zaps')
				setIsChecking(false)
				return
			}

			// Calculate percentages for V4V recipients
			// If this is the first recipient, they get 100% of the V4V portion
			// Otherwise, they get the specified percentage and we redistribute
			let newSharePercentage = 0
			let updatedShares = []

			if (localShares.length === 0) {
				// First recipient gets 100% of V4V
				newSharePercentage = 1
				updatedShares = [
					{
						id: `new-${Date.now()}`,
						name: newRecipientNpub,
						pubkey: newRecipientNpub,
						percentage: newSharePercentage, // 100% of V4V portion
					},
				]
			} else {
				// Convert input percentage to decimal for V4V portion
				newSharePercentage = newRecipientShare / 100

				// Calculate how much to reduce existing shares
				const totalExistingPercentage = localShares.reduce((sum, share) => sum + share.percentage, 0)
				const remainingPercentage = 1 - newSharePercentage
				const ratio = remainingPercentage / totalExistingPercentage

				// Update existing shares proportionally
				updatedShares = localShares.map((share) => ({
					...share,
					percentage: share.percentage * ratio,
				}))

				// Add new recipient
				updatedShares.push({
					id: `new-${Date.now()}`,
					name: newRecipientNpub,
					pubkey: newRecipientNpub,
					percentage: newSharePercentage,
				})
			}

			setLocalShares(updatedShares)

			// Reset input fields
			setNewRecipientNpub('')
			setNewRecipientShare(10)
			setShowAddForm(false)
		} catch (error) {
			toast.error('Error adding recipient')
			console.error(error)
		} finally {
			setIsChecking(false)
		}
	}

	// Handle removing a recipient
	const handleRemoveRecipient = (id: string) => {
		// Get the share we're removing
		const shareToRemove = localShares.find((share) => share.id === id)
		if (!shareToRemove) return

		// Calculate how to redistribute the percentage
		const remainingShares = localShares.filter((share) => share.id !== id)

		if (remainingShares.length === 0) {
			// If no shares left, just clear the array
			setLocalShares([])
		} else {
			// Redistribute the removed share's percentage proportionally
			const totalRemainingPercentage = remainingShares.reduce((sum, share) => sum + share.percentage, 0)
			const ratio = 1 / totalRemainingPercentage

			// Update shares with redistributed percentages
			const updatedShares = remainingShares.map((share) => ({
				...share,
				percentage: share.percentage * ratio, // Normalize to sum to 1
			}))

			setLocalShares(updatedShares)
		}
	}

	// Handle updating recipient percentage
	const handleUpdatePercentage = (id: string, newPercentage: number) => {
		// Find the share we're updating
		const shareToUpdate = localShares.find((share) => share.id === id)
		if (!shareToUpdate) return

		// Calculate the change in percentage
		const oldPercentage = shareToUpdate.percentage
		const percentageDiff = newPercentage - oldPercentage

		// If only one recipient, they always get 100%
		if (localShares.length === 1) {
			setLocalShares([
				{
					...shareToUpdate,
					percentage: 1,
				},
			])
			return
		}

		// For multiple recipients, redistribute the remaining percentage
		const otherShares = localShares.filter((share) => share.id !== id)
		const totalOtherPercentage = otherShares.reduce((sum, share) => sum + share.percentage, 0)

		// Ensure we don't go below minimum values for other shares
		if (totalOtherPercentage - percentageDiff <= 0.01 && percentageDiff > 0) {
			// Set this share to maximum while ensuring others have minimum values
			const minPerShare = 0.01
			const totalMinForOthers = minPerShare * otherShares.length
			const maxForUpdated = 1 - totalMinForOthers

			const updatedShares = localShares.map((share) => ({
				...share,
				percentage: share.id === id ? maxForUpdated : minPerShare,
			}))
			setLocalShares(updatedShares)
			return
		}

		// Maintain the original order of shares while updating percentages
		const updatedShares = localShares.map((share) => {
			if (share.id === id) {
				// This is the share being updated directly
				return { ...share, percentage: newPercentage }
			} else {
				// Other shares should be adjusted proportionally
				// Calculate factor to reduce other shares by
				const adjustmentFactor = (totalOtherPercentage - percentageDiff) / totalOtherPercentage
				return { ...share, percentage: share.percentage * adjustmentFactor }
			}
		})

		// Ensure the total is exactly 1 (100%)
		const total = updatedShares.reduce((sum, share) => sum + share.percentage, 0)
		if (Math.abs(total - 1) > 0.0001) {
			// Small threshold for floating point errors
			// Normalize to exactly 100%
			const normalizedShares = updatedShares.map((share) => ({
				...share,
				percentage: share.percentage / total,
			}))
			setLocalShares(normalizedShares)
		} else {
			setLocalShares(updatedShares)
		}
	}

	// Handle saving the V4V shares
	const handleSave = async () => {
		try {
			// Convert normalized percentages (which add up to 1) back to actual percentages of the total
			// If the total V4V is 10%, and a recipient has 50% of that, their actual percentage is 0.05
			const sharesToSave = localShares.map((share) => ({
				...share,
				percentage: share.percentage * (totalV4VPercentage / 100),
			}))

			const result = await publishMutation.mutateAsync({
				shares: sharesToSave,
				userPubkey,
				appPubkey,
			})

			if (result) {
				toast.success('V4V shares saved successfully')
				refetch()
			} else {
				toast.error('Failed to save V4V shares')
			}
		} catch (error) {
			toast.error('Error saving V4V shares')
			console.error(error)
		}
	}

	// Handle equalizing all shares
	const handleEqualizeAll = () => {
		if (localShares.length === 0) return

		const equalShare = 1 / localShares.length
		const updatedShares = localShares.map((share) => ({
			...share,
			percentage: equalShare, // Equal share of V4V percentage
		}))

		setLocalShares(updatedShares)
	}

	if (isLoading) {
		return <div>Loading...</div>
	}

	return (
		<div className="space-y-6 max-w-4xl mx-auto">
			<h1 className="text-2xl font-bold">Circular Economy</h1>

			<Alert className="bg-blue-100 text-blue-800 border-blue-200">
				<AlertDescription>
					PM (Beta) Is Powered By Your Generosity. Your Contribution Is The Only Thing That Enables Us To Continue Creating Free And Open
					Source Solutions 🙏
				</AlertDescription>
			</Alert>

			<div className="space-y-4">
				<h2 className="text-xl font-semibold">Split of total sales</h2>

				{/* Total V4V percentage slider */}
				<div className="mt-4">
					<div className="flex justify-between text-sm text-muted-foreground mb-2">
						<span>Seller: {formattedSellerPercentage}%</span>
						<span>V4V: {formattedTotalV4V}%</span>
					</div>
					<Slider value={[totalV4VPercentage]} min={1} max={100} step={1} onValueChange={handleTotalV4VPercentageChange} />
				</div>

				{/* First bar - Total split between seller and V4V */}
				<div className="w-full h-12 flex rounded-md overflow-hidden">
					<div
						className="bg-green-600 flex items-center justify-start pl-4 text-white font-medium"
						style={{ width: `${sellerPercentage}%` }}
					>
						{formattedSellerPercentage}%
					</div>
					<div
						className="bg-fuchsia-500 flex items-center justify-center text-white font-medium"
						style={{ width: `${totalV4VPercentage}%` }}
					>
						V4V
					</div>
				</div>

				<h2 className="text-xl font-semibold mt-6">V4V split between recipients</h2>

				{/* Second bar - Split between V4V recipients - always fills 100% of bar */}
				{localShares.length > 0 ? (
					<div className="w-full h-12 flex rounded-md overflow-hidden">
						{localShares.map((share, index) => (
							<div
								key={share.id}
								className={`${index === 0 ? 'bg-rose-500' : 'bg-gray-500'} flex items-center justify-center text-white font-medium`}
								style={{ width: `${share.percentage * 100}%` }}
							>
								{(share.percentage * 100).toFixed(1)}%
							</div>
						))}
					</div>
				) : (
					<div className="text-gray-500">No V4V recipients added yet</div>
				)}

				{/* Recipients list */}
				<div className="space-y-2 mt-4">
					{localShares.map((share) => (
						<RecipientItem
							key={share.id}
							share={{
								...share,
								// Convert to percentage for the RecipientItem display
								percentage: share.percentage,
							}}
							onRemove={handleRemoveRecipient}
							onPercentageChange={handleUpdatePercentage}
						/>
					))}
				</div>

				{/* Add new recipient form */}
				{showAddForm ? (
					<div className="space-y-4 mt-6 border p-4 rounded-lg">
						<div className="flex-1">
							<ProfileSearch onSelect={handleProfileSelect} placeholder="Search profiles or paste npub..." />

							{newRecipientNpub && (
								<RecipientPreview
									npub={newRecipientNpub}
									percentage={newRecipientShare}
									canReceiveZaps={canReceiveZaps}
									isLoading={isCheckingZap}
								/>
							)}
						</div>
						<div className="flex flex-wrap gap-2 items-center">
							<div className="w-20">
								<Input
									type="number"
									min="1"
									max="100"
									value={newRecipientShare}
									onChange={(e) => setNewRecipientShare(Number(e.target.value))}
								/>
							</div>
							<Button
								className="flex-grow sm:flex-grow-0"
								onClick={handleAddRecipient}
								disabled={isChecking || isCheckingZap || !newRecipientNpub || !canReceiveZaps}
							>
								+ V4V Recipient
							</Button>
							<Button variant="outline" onClick={() => setShowAddForm(false)}>
								Cancel
							</Button>
						</div>
					</div>
				) : (
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
						<Button variant="outline" onClick={() => setShowAddForm(true)}>
							+ V4V Recipient
						</Button>
						<Button variant="outline" onClick={handleEqualizeAll} disabled={localShares.length === 0}>
							<span className="i-sharing w-5 h-5 mr-2"></span>
							Equal All
						</Button>
					</div>
				)}

				{/* Save button */}
				<div className="mt-6">
					<Button
						className="w-full py-6 text-lg bg-yellow-400 hover:bg-yellow-500 text-black"
						onClick={handleSave}
						disabled={publishMutation.isPending}
					>
						{publishMutation.isPending ? 'Saving...' : 'Save'}
					</Button>
				</div>
			</div>
		</div>
	)
}
