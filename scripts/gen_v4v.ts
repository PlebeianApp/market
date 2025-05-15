import { NDKEvent, type NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { randomBytes } from 'crypto'

const POTENTIAL_V4V_RECIPEINTS = [
	'npub10pensatlcfwktnvjjw2dtem38n6rvw8g6fv73h84cuacxn4c28eqyfn34f',
	'npub1dergggklka99wwrs92yz8wdjs952h2ux2ha2ed598ngwu9w7a6fsh9xzpc',
	'npub12rv5lskctqxxs2c8rf2zlzc7xx3qpvzs3w4etgemauy9thegr43sf485vg',
]

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

export async function createV4VSharesEvent(signer: NDKPrivateKeySigner, ndk: any, appPubkey: string = '') {
	try {
		const uuid = Buffer.from(randomBytes(16)).toString('hex')
		const totalPercentage = getRandomFloat(0.05, 0.2)
		const recipientCount = Math.floor(Math.random() * Math.min(POTENTIAL_V4V_RECIPEINTS.length, 3)) + 1

		const selectedRecipients = shuffleArray(POTENTIAL_V4V_RECIPEINTS).slice(0, recipientCount)

		let remainingPercentage = totalPercentage
		const zapTags: string[][] = []

		for (let i = 0; i < selectedRecipients.length; i++) {
			if (i === selectedRecipients.length - 1) {
				zapTags.push(['zap', selectedRecipients[i], remainingPercentage.toString()])
			} else {
				const minAllocation = 0.01
				const maxForThisRecipient = remainingPercentage - minAllocation * (selectedRecipients.length - i - 1)

				const percentage = getRandomFloat(minAllocation, maxForThisRecipient)
				zapTags.push(['zap', selectedRecipients[i], percentage.toString()])
				remainingPercentage = parseFloat((remainingPercentage - percentage).toFixed(4))
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
