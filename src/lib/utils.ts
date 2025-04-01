import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

export function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text
	return text.slice(0, maxLength) + '...'
}

export function getHexColorFingerprintFromHexPubkey(pubkey: string): string {
	// Simple hash function to generate a color from the pubkey
	let hash = 0
	for (let i = 0; i < pubkey.length; i++) {
		hash = pubkey.charCodeAt(i) + ((hash << 5) - hash)
	}

	// Convert to HSL color
	const hue = hash % 360
	return `hsl(${hue}, 70%, 50%)`
}
