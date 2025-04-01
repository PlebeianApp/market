import { ndkActions } from '@/lib/stores/ndk'
import { type NDKUserProfile, NDKUser } from '@nostr-dev-kit/ndk'
import { queryOptions } from '@tanstack/react-query'
import { profileKeys } from './queryKeyFactory'

export const fetchProfile = async (npub: string): Promise<NDKUserProfile | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	try {
		const user = ndk.getUser({ npub })
		return await user.fetchProfile()
	} catch (e) {
		console.error('Failed to fetch profile with NDK user method', e)
		return null
	}
}

export const profileQueryOptions = (npub: string) =>
	queryOptions({
		queryKey: profileKeys.details(npub),
		queryFn: () => fetchProfile(npub),
	})

export const validateNip05 = async (npub: string): Promise<boolean | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	try {
		const user = ndk.getUser({ npub })
		const profile = await user.fetchProfile()
		if (!profile?.nip05) return null

		const [name, domain] = profile.nip05.split('@')

		let punycodeDomain = domain
		if (!/^[a-z0-9.-]+$/.test(domain)) {
			try {
				console.log(`Domain might need punycode conversion: ${domain}`)
			} catch (err) {
				console.warn(`Punycode conversion failed for domain: ${domain}. Using original domain.`)
			}
		}

		const parsedNip05 = `${name}@${punycodeDomain}`

		return true
	} catch (e) {
		console.error('Error validating NIP-05:', e)
		return false
	}
}

export const nip05ValidationQueryOptions = (npub: string) =>
	queryOptions({
		queryKey: profileKeys.nip05(npub),
		queryFn: () => validateNip05(npub),
	})
