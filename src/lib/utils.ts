import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { ndkActions } from './stores/ndk'
import type { NDKUser } from '@nostr-dev-kit/ndk'

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

export const userFromIdentifier = async (identifier: string): Promise<NDKUser | undefined> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) return undefined

	if (identifier.includes('@')) {
		return await ndk.getUserFromNip05(identifier)
	}

	if (identifier.startsWith('npub')) {
		return ndk.getUser({ npub: identifier })
	}
	return ndk.getUser({ pubkey: identifier })
}
