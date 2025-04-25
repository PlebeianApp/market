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
import './emoji-animations.css'

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
	const [totalV4VPercentage, setTotalV4VPercentage] = useState(10)

	const { data: canReceiveZaps, isLoading: isCheckingZap } = useZapCapabilityByNpub(newRecipientNpub || '')

	useEffect(() => {
		if (v4vShares.length > 0) {
			const totalPercentage = v4vShares.reduce((total, share) => total + share.percentage, 0)

			if (totalPercentage > 0) {
				setTotalV4VPercentage(Math.round(totalPercentage * 100))

				const normalizedShares = v4vShares.map((share) => ({
					...share,
					percentage: share.percentage / totalPercentage,
				}))
				setLocalShares(normalizedShares)
			} else {
				setLocalShares(v4vShares)
			}
		}
	}, [v4vShares])

	const sellerPercentage = 100 - totalV4VPercentage
	const formattedSellerPercentage = sellerPercentage.toFixed(0)
	const formattedTotalV4V = totalV4VPercentage.toFixed(0)

	const v4vDecimal = totalV4VPercentage / 100
	const emojiSize = 16 + v4vDecimal * 100
	const shouldWiggle = v4vDecimal > 0.04
	const shouldShake = v4vDecimal > 0.09
	const shouldGlow = v4vDecimal > 0.14
	let emojiClass = ''
	if (shouldGlow) emojiClass = 'wiggle-shake-glow'
	else if (shouldShake) emojiClass = 'wiggle-shake'
	else if (shouldWiggle) emojiClass = 'wiggle'
	const emoji = v4vDecimal > 0.14 ? '🤙' : v4vDecimal > 0.09 ? '🤙' : v4vDecimal > 0.04 ? '🤙' : v4vDecimal < 0.01 ? '💩' : '🎁'

	const handleTotalV4VPercentageChange = (value: number[]) => {
		setTotalV4VPercentage(value[0])
	}

	const handleProfileSelect = (npub: string) => {
		setNewRecipientNpub(npub)
	}

	const handleAddRecipient = async () => {
		if (!newRecipientNpub) {
			toast.error('Please enter a valid npub')
			return
		}

		setIsChecking(true)

		try {
			if (!canReceiveZaps) {
				toast.error('This user cannot receive zaps')
				setIsChecking(false)
				return
			}

			let newSharePercentage = 0
			let updatedShares = []

			if (localShares.length === 0) {
				newSharePercentage = 1
				updatedShares = [
					{
						id: `new-${Date.now()}`,
						name: newRecipientNpub,
						pubkey: newRecipientNpub,
						percentage: newSharePercentage,
					},
				]
			} else {
				newSharePercentage = newRecipientShare / 100

				const totalExistingPercentage = localShares.reduce((sum, share) => sum + share.percentage, 0)
				const remainingPercentage = 1 - newSharePercentage
				const ratio = remainingPercentage / totalExistingPercentage

				updatedShares = localShares.map((share) => ({
					...share,
					percentage: share.percentage * ratio,
				}))

				updatedShares.push({
					id: `new-${Date.now()}`,
					name: newRecipientNpub,
					pubkey: newRecipientNpub,
					percentage: newSharePercentage,
				})
			}

			setLocalShares(updatedShares)

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

	const handleRemoveRecipient = (id: string) => {
		const shareToRemove = localShares.find((share) => share.id === id)
		if (!shareToRemove) return

		const remainingShares = localShares.filter((share) => share.id !== id)

		if (remainingShares.length === 0) {
			setLocalShares([])
		} else {
			const totalRemainingPercentage = remainingShares.reduce((sum, share) => sum + share.percentage, 0)
			const ratio = 1 / totalRemainingPercentage

			const updatedShares = remainingShares.map((share) => ({
				...share,
				percentage: share.percentage * ratio,
			}))

			setLocalShares(updatedShares)
		}
	}

	const handleUpdatePercentage = (id: string, newPercentage: number) => {
		const shareToUpdate = localShares.find((share) => share.id === id)
		if (!shareToUpdate) return

		const oldPercentage = shareToUpdate.percentage
		const percentageDiff = newPercentage - oldPercentage

		if (localShares.length === 1) {
			setLocalShares([
				{
					...shareToUpdate,
					percentage: 1,
				},
			])
			return
		}

		const otherShares = localShares.filter((share) => share.id !== id)
		const totalOtherPercentage = otherShares.reduce((sum, share) => sum + share.percentage, 0)

		if (totalOtherPercentage - percentageDiff <= 0.01 && percentageDiff > 0) {
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

		const updatedShares = localShares.map((share) => {
			if (share.id === id) {
				return { ...share, percentage: newPercentage }
			} else {
				const adjustmentFactor = (totalOtherPercentage - percentageDiff) / totalOtherPercentage
				return { ...share, percentage: share.percentage * adjustmentFactor }
			}
		})

		const total = updatedShares.reduce((sum, share) => sum + share.percentage, 0)
		if (Math.abs(total - 1) > 0.0001) {
			const normalizedShares = updatedShares.map((share) => ({
				...share,
				percentage: share.percentage / total,
			}))
			setLocalShares(normalizedShares)
		} else {
			setLocalShares(updatedShares)
		}
	}

	const handleSave = async () => {
		try {
			if (totalV4VPercentage === 0 || localShares.length === 0) {
				const result = await publishMutation.mutateAsync({
					shares: [],
					userPubkey,
					appPubkey,
				})

				if (result) {
					toast.success('V4V shares cleared')
					refetch()
				} else {
					toast.error('Failed to clear V4V shares')
				}
				return
			}

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

	const handleEqualizeAll = () => {
		if (localShares.length === 0) return

		const equalShare = 1 / localShares.length
		const updatedShares = localShares.map((share) => ({
			...share,
			percentage: equalShare,
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
					<Slider value={[totalV4VPercentage]} min={0} max={100} step={1} onValueChange={handleTotalV4VPercentageChange} />
				</div>

				{/* Emoji animation section */}
				<div className="text-center my-8">
					<div
						className={`p-4 rounded-full bg-gray-200 inline-flex items-center justify-center ${emojiClass}`}
						style={{
							fontSize: `${emojiSize}px`,
							width: `${emojiSize * 1.5}px`,
							height: `${emojiSize * 1.5}px`,
						}}
					>
						{emoji}
					</div>
				</div>

				{/* First bar - Total split between seller and V4V */}
				<div className="w-full h-12 flex rounded-md overflow-hidden">
					<div
						className="bg-green-600 flex items-center justify-start pl-4 text-white font-medium"
						style={{ width: `${sellerPercentage}%` }}
					>
						{formattedSellerPercentage}%
					</div>
					{totalV4VPercentage > 0 && (
						<div
							className="bg-fuchsia-500 flex items-center justify-center text-white font-medium"
							style={{ width: `${totalV4VPercentage}%` }}
						>
							V4V
						</div>
					)}
				</div>

				<h2 className="text-xl font-semibold mt-6">V4V split between recipients</h2>

				{/* Second bar - Split between V4V recipients - always fills 100% of bar */}
				{localShares.length > 0 && totalV4VPercentage > 0 ? (
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
								disabled={isChecking || isCheckingZap || !newRecipientNpub || !canReceiveZaps || totalV4VPercentage === 0}
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
						<Button variant="outline" onClick={() => setShowAddForm(true)} disabled={totalV4VPercentage === 0}>
							+ V4V Recipient
						</Button>
						<Button variant="outline" onClick={handleEqualizeAll} disabled={localShares.length === 0 || totalV4VPercentage === 0}>
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
