import { ProfilePage } from '@/components/pages/ProfilePage'
import { loadStorefrontDraft } from '@/components/storefront/builder/draftStorage'
import { StorefrontRenderer } from '@/components/storefront/StorefrontRenderer'
import { authStore } from '@/lib/stores/auth'
import { isValidHexKey } from '@/lib/utils'
import { profileByIdentifierQueryOptions } from '@/queries/profiles'
import { shouldRenderStorefrontPage, useStorefrontPage } from '@/queries/storefront'
import { useQuery } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'

/**
 * Resolution point for any URL that names a person: the custom page if the
 * author built one and switched it on, the standard profile otherwise.
 *
 * Three layers of fallback, per ADR-019:
 *   1. resolve the identifier to a pubkey;
 *   2. fetch that pubkey's storefront page and render it if valid and enabled;
 *   3. otherwise render `ProfilePage` unchanged.
 *
 * A storefront that fails to parse is not an error state for the visitor — it
 * is simply the profile page. The author is the one who needs to know, and
 * they find out in the builder, which validates strictly before signing.
 */
export function StorefrontOrProfilePage({ profileId }: { profileId: string }) {
	const { user } = useStore(authStore)
	const isDraftPreview = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === 'draft'
	// npub, nprofile and NIP-05 identifiers all have to become a hex pubkey
	// before a page can be addressed. Hex skips the lookup; everything else
	// borrows the profile query `ProfilePage` is about to run anyway, so the
	// resolution costs no extra relay round trip.
	const needsResolution = !isValidHexKey(profileId)
	const profileOptions = profileByIdentifierQueryOptions(profileId)
	const { data: profileData, isLoading: isResolvingProfile } = useQuery({
		...profileOptions,
		enabled: profileOptions.enabled && needsResolution,
	})

	const pubkey = needsResolution ? (profileData?.user?.pubkey ?? '') : profileId

	const { data: storefront, isLoading: isLoadingStorefront } = useStorefrontPage(pubkey)
	const isAuthorPreview = isDraftPreview && isValidHexKey(pubkey) && user?.pubkey === pubkey
	const previewPage = isAuthorPreview ? (loadStorefrontDraft(pubkey) ?? storefront?.page ?? null) : null

	// The preview URL is intentionally local to the signed-in author: it reads
	// their validated local draft (or their stored page when no draft exists),
	// without publishing or exposing that draft to other visitors.
	if (previewPage && previewPage.content.length > 0) {
		return <StorefrontRenderer page={previewPage} pubkey={pubkey} />
	}

	// Both queries are in flight concurrently, so this waits on the slower of
	// two requests that would have happened regardless. Deciding before they
	// settle would flash the profile page and then replace it, which reads as a
	// bug to the visitor and undoes the author's first impression.
	const isDeciding = (needsResolution && isResolvingProfile) || (pubkey.length > 0 && isLoadingStorefront)

	if (isDeciding) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
			</div>
		)
	}

	if (shouldRenderStorefrontPage(storefront) && storefront.pubkey) {
		return <StorefrontRenderer page={storefront.page} pubkey={storefront.pubkey} />
	}

	return <ProfilePage profileId={profileId} />
}
