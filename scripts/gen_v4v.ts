import { NDKEvent, type NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { randomBytes } from 'crypto'

// No longer using fixed recipients - will be passed as parameter

function getRandomFloat(min: number, max: number, decimals: number = 4): number {
	const rand = Math.random() * (max - min) + min
	return parseFloat(rand.toFixed(decimals))
}

function shuffleArray<T>(array: T[]): T[] {
	const newArray = [...array]
	for (let i = newArray.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[newArray[i], newArray[j]] = [newArray[j], newArray[i]]
	}
	return newArray
}

export async function createV4VSharesEvent(
	signer: NDKPrivateKeySigner,
	ndk: any,
	appPubkey: string = '',
	availableUserPubkeys: string[] = [],
	customShares?: Array<{ pubkey: string; percentage: number }>,
) {
	try {
		const uuid = Buffer.from(randomBytes(16)).toString('hex')
		let zapTags: string[][] = []

		// If custom shares provided, use them (allows creating empty V4V events)
		if (customShares !== undefined) {
			if (customShares.length === 0) {
				// Empty array = user takes 100%, V4V configured but set to 0%
				zapTags = []
			} else {
				zapTags = customShares.map((share) => ['zap', share.pubkey, share.percentage.toString()])
			}
		} else {
			// Legacy random generation
			const totalPercentage = getRandomFloat(0.05, 0.2)

			// Use available user pubkeys instead of fixed recipients
			const potentialRecipients = availableUserPubkeys.length > 0 ? availableUserPubkeys : []
			if (potentialRecipients.length === 0) {
				console.log('No potential V4V recipients available, skipping V4V shares creation')
				return true
			}

			const recipientCount = Math.floor(Math.random() * Math.min(potentialRecipients.length, 3)) + 1
			const selectedRecipients = shuffleArray(potentialRecipients).slice(0, recipientCount)

			let remainingPercentage = totalPercentage

			for (let i = 0; i < selectedRecipients.length; i++) {
				const recipient = selectedRecipients[i]
				if (i === selectedRecipients.length - 1) {
					zapTags.push(['zap', recipient, remainingPercentage.toString()])
				} else {
					const minAllocation = 0.01
					const maxForThisRecipient = remainingPercentage - minAllocation * (selectedRecipients.length - i - 1)

					const percentage = getRandomFloat(minAllocation, maxForThisRecipient)
					zapTags.push(['zap', recipient, percentage.toString()])
					remainingPercentage = parseFloat((remainingPercentage - percentage).toFixed(4))
				}
			}
		}

		const event = new NDKEvent(ndk)
		event.kind = 30078
		event.content = JSON.stringify(zapTags)
		event.tags = [
			['d', uuid],
			['l', 'v4v_share'],
		]

		if (appPubkey) {
			event.tags.push(['p', appPubkey])
		}

		event.pubkey = (await signer.user()).pubkey
		await event.sign(signer)
		await event.publish()

		return true
	} catch (error) {
		console.error('Failed to create V4V share event:', error)
		return false
	}
}
