import type { V4VDTO } from '@/lib/stores/cart'
import { getDistinctColorsForRecipients } from '@/lib/utils'
import { useConfigQuery } from '@/queries/config'
import { useZapCapabilityByNpub } from '@/queries/profiles'
import { usePublishV4VShares } from '@/queries/v4v'
import { nip19 } from 'nostr-tools'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

interface UseV4VManagerProps {
	userPubkey: string
	initialShares?: V4VDTO[]
	initialTotalPercentage?: number
	onSaveSuccess?: () => void
}

export function useV4VManager({ userPubkey, initialShares = [], initialTotalPercentage = 10, onSaveSuccess }: UseV4VManagerProps) {
	const { data: config } = useConfigQuery()
	const appPubkey = config?.appPublicKey || ''
	const publishMutation = usePublishV4VShares()

	const [showAddForm, setShowAddForm] = useState(false)
	const [newRecipientNpub, setNewRecipientNpub] = useState('')
	const [newRecipientShare, setNewRecipientShare] = useState(10)
	const [localShares, setLocalShares] = useState<V4VDTO[]>(initialShares)
	const [isChecking, setIsChecking] = useState(false)
	const [totalV4VPercentage, setTotalV4VPercentage] = useState(initialTotalPercentage)

	const { data: canReceiveZaps, isLoading: isCheckingZap } = useZapCapabilityByNpub(newRecipientNpub || '')

	// Sync local shares when initialShares change (e.g., after refetch)
	useEffect(() => {
		if (initialShares.length > 0) {
			setLocalShares(initialShares)
		}
	}, [initialShares])

	// Sync total percentage when it changes
	useEffect(() => {
		setTotalV4VPercentage(initialTotalPercentage)
	}, [initialTotalPercentage])

	// Initialize with app's npub as default recipient if no initial shares
	useEffect(() => {
		if (appPubkey && localShares.length === 0 && initialShares.length === 0) {
			try {
				const appNpub = nip19.npubEncode(appPubkey)
				setLocalShares([
					{
						id: 'app-default',
						name: appNpub,
						pubkey: appPubkey,
						percentage: 1, // 100% of the V4V share
					},
				])
			} catch (error) {
				console.error('Error encoding app npub:', error)
			}
		}
	}, [appPubkey, localShares.length, initialShares.length])

	useEffect(() => {
		if (showAddForm) {
			if (localShares.length === 0) {
				setNewRecipientShare(100)
			} else {
				setNewRecipientShare(10)
			}
		}
	}, [showAddForm, localShares.length])

	// Computed values
	const sellerPercentage = 100 - totalV4VPercentage
	const formattedSellerPercentage = sellerPercentage.toFixed(0)
	const formattedTotalV4V = totalV4VPercentage.toFixed(0)
	const recipientColors = getDistinctColorsForRecipients(localShares)

	// Emoji animation calculations
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

	// Event handlers
	const handleTotalV4VPercentageChange = (value: number[]) => {
		setTotalV4VPercentage(value[0])
	}

	const handleProfileSelect = (npub: string) => {
		setNewRecipientNpub(npub)
	}

	// Convert npub to hex pubkey
	const getNormalizedPubkey = (input: string): string => {
		if (input.startsWith('npub')) {
			try {
				const { data } = nip19.decode(input)
				if (typeof data === 'string') {
					return data
				}
			} catch (error) {
				console.error('Error decoding npub:', error)
			}
		}
		return input
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

			const hexPubkey = getNormalizedPubkey(newRecipientNpub)

			// Check for duplicates
			if (localShares.some((share) => share.pubkey === hexPubkey)) {
				toast.error('This recipient is already in the list')
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
						name: '', // Will be resolved by UserWithAvatar component
						pubkey: hexPubkey,
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
					name: '', // Will be resolved by UserWithAvatar component
					pubkey: hexPubkey,
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

	const handleEqualizeAll = () => {
		if (localShares.length === 0) return

		const equalShare = 1 / localShares.length
		const updatedShares = localShares.map((share) => ({
			...share,
			percentage: equalShare,
		}))

		setLocalShares(updatedShares)
	}

	const saveShares = async (clearShares = false) => {
		try {
			if (clearShares || totalV4VPercentage === 0 || localShares.length === 0) {
				const result = await publishMutation.mutateAsync({
					shares: [],
					userPubkey,
					appPubkey,
				})

				if (result) {
					toast.success('V4V shares cleared')
					if (onSaveSuccess) onSaveSuccess()
					return true
				} else {
					toast.error('Failed to clear V4V shares')
					return false
				}
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
				if (onSaveSuccess) onSaveSuccess()
				return true
			} else {
				toast.error('Failed to save V4V shares')
				return false
			}
		} catch (error) {
			toast.error('Error saving V4V shares')
			console.error(error)
			return false
		}
	}

	return {
		// State
		showAddForm,
		setShowAddForm,
		newRecipientNpub,
		setNewRecipientNpub,
		newRecipientShare,
		setNewRecipientShare,
		localShares,
		setLocalShares,
		isChecking,
		totalV4VPercentage,
		setTotalV4VPercentage,
		canReceiveZaps,
		isCheckingZap,
		publishMutation,

		// Computed values
		sellerPercentage,
		formattedSellerPercentage,
		formattedTotalV4V,
		recipientColors,
		emojiSize,
		emojiClass,
		emoji,

		// Handlers
		handleTotalV4VPercentageChange,
		handleProfileSelect,
		handleAddRecipient,
		handleRemoveRecipient,
		handleUpdatePercentage,
		handleEqualizeAll,
		saveShares,
	}
}
