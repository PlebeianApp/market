import { ndkActions } from '@/lib/stores/ndk'
import { type NDKUserProfile } from '@nostr-dev-kit/ndk'
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
