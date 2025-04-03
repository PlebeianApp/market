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
	const hash = parseInt(pubkey.slice(0, 6), 16)

	// Convert to HSL color
	const hue = hash % 360
	return `hsl(${hue}, 70%, 50%)`
}
