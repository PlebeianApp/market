import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { ndkActions } from './stores/ndk'
import type { NDKUser } from '@nostr-dev-kit/ndk'
import { toast } from 'sonner'
import { HEX_KEYS_REGEX } from './constants'
import { EMAIL_REGEX } from './constants'
import { decode } from 'nostr-tools/nip19'

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

export function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text
	return text.slice(0, maxLength) + '...'
}

export function getHexColorFingerprintFromHexPubkey(pubkey: string): string {
	// Simple hash function to generate a color from the pubkey
	const hash = parseInt(pubkey.slice(0, 6), 16)

	// Convert to HSL color
	const hue = hash % 360
	return `hsl(${hue}, 70%, 50%)`
}

export function getColorFromNpub(npub: string): string {
	if (!isValidNpub(npub)) {
		console.warn('Invalid npub provided to getColorFromNpub')
		return 'hsl(0, 0%, 50%)' // Default gray color for invalid npubs
	}

	try {
		const { data } = decode(npub)
		if (typeof data === 'string' && isValidHexKey(data)) {
			return getHexColorFingerprintFromHexPubkey(data)
		}
		return 'hsl(0, 0%, 50%)' // Fallback gray
	} catch {
		return 'hsl(0, 0%, 50%)' // Fallback gray
	}
}

export function isValidNip05(input: string): boolean {
	return EMAIL_REGEX.test(input)
}

export function isValidHexKey(input: string): boolean {
	return HEX_KEYS_REGEX.test(input)
}

export function isValidNpub(input: string): boolean {
	try {
		const { type, data } = decode(input)
		return type === 'npub' && typeof data === 'string' && isValidHexKey(data)
	} catch {
		return false
	}
}

export const userFromIdentifier = async (identifier: string): Promise<NDKUser | undefined> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) return undefined

		if (identifier.includes('@')) {
			if (!isValidNip05(identifier)) {
				throw new Error('Invalid NIP-05 identifier')
			}
			return await ndk.getUserFromNip05(identifier)
		}

		if (identifier.startsWith('npub')) {
			if (!isValidNpub(identifier)) {
				throw new Error('Invalid npub')
			}
			return ndk.getUser({ npub: identifier })
		}

		if (!isValidHexKey(identifier)) {
			throw new Error('Invalid hex key')
		}
		return ndk.getUser({ pubkey: identifier })
	} catch (error) {
		console.error('Error in userFromIdentifier:', error)
		return undefined
	}
}

export async function copyToClipboard(data: BlobPart, mimeType = 'text/plain') {
	try {
		if (navigator.clipboard.write) {
			await navigator.clipboard.write([
				new ClipboardItem({
					[mimeType]: new Blob([data], {
						type: mimeType,
					}),
					['text/plain']: new Blob([data], {
						type: 'text/plain',
					}),
				}),
			])
		} else {
			await new Promise((resolve) => {
				resolve(navigator.clipboard.writeText(String(data)))
			})
		}
		toast.success('Copied 👍')
	} catch (e) {
		toast.error(`Error: ${e}`)
		console.log(e)
	}
}

export function debounce<F extends (...args: any[]) => any>(func: F, waitFor: number): (...args: Parameters<F>) => Promise<ReturnType<F>> {
	let timeout: ReturnType<typeof setTimeout> | null = null

	return (...args: Parameters<F>): Promise<ReturnType<F>> => {
		return new Promise((resolve) => {
			if (timeout !== null) {
				clearTimeout(timeout)
			}

			timeout = setTimeout(() => {
				const result = func(...args)
				resolve(result)
			}, waitFor)
		})
	}
}

// Generate distinct colors for a list of recipients to avoid color conflicts
export function getDistinctColorsForRecipients(recipients: { pubkey: string }[]): { [pubkey: string]: string } {
	const colorMap: { [pubkey: string]: string } = {}
	const usedHues = new Set<number>()
	const minHueDistance = 30 // Minimum distance between hues to ensure distinctness

	// Predefined distinct colors with good contrast
	const distinctColors = [
		'hsl(0, 70%, 50%)',     // Red
		'hsl(240, 70%, 50%)',   // Blue  
		'hsl(120, 70%, 50%)',   // Green
		'hsl(300, 70%, 50%)',   // Magenta
		'hsl(60, 70%, 50%)',    // Yellow
		'hsl(180, 70%, 50%)',   // Cyan
		'hsl(30, 70%, 50%)',    // Orange
		'hsl(270, 70%, 50%)',   // Purple
		'hsl(210, 70%, 50%)',   // Light Blue
		'hsl(330, 70%, 50%)',   // Pink
		'hsl(90, 70%, 50%)',    // Light Green
		'hsl(150, 70%, 50%)',   // Teal
	]

	recipients.forEach((recipient, index) => {
		if (index < distinctColors.length) {
			// Use predefined distinct colors first
			colorMap[recipient.pubkey] = distinctColors[index]
		} else {
			// Generate a unique hue that's sufficiently different from existing ones
			const baseHash = parseInt(recipient.pubkey.slice(0, 6), 16)
			let hue = baseHash % 360
			
			// Ensure minimum distance from used hues
			let attempts = 0
			while (attempts < 360) {
				const tooClose = Array.from(usedHues).some(usedHue => 
					Math.abs(hue - usedHue) < minHueDistance || 
					Math.abs(hue - usedHue) > (360 - minHueDistance)
				)
				
				if (!tooClose) {
					break
				}
				
				hue = (hue + minHueDistance) % 360
				attempts++
			}
			
			usedHues.add(hue)
			colorMap[recipient.pubkey] = `hsl(${hue}, 70%, 50%)`
		}
	})

	return colorMap
}
