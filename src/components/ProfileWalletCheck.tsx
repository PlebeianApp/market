import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import type { NDKUserProfile } from '@nostr-dev-kit/ndk'
import { useStore } from '@tanstack/react-store'
import { CheckCircle2Icon, InfoIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

export function ProfileWalletCheck() {
	const [profile, setProfile] = useState<NDKUserProfile | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const authState = useStore(authStore)

	useEffect(() => {
		if (!authState.user?.pubkey) {
			setIsLoading(false)
			return
		}

		const fetchProfile = async () => {
			const pubkey = authState.user?.pubkey
			if (!pubkey) {
				setIsLoading(false)
				return
			}

			try {
				const ndk = ndkActions.getNDK()
				if (!ndk) {
					throw new Error('NDK not initialized')
				}

				const user = ndk.getUser({ pubkey })
				const profilePromise = await user.fetchProfile()
				setProfile(profilePromise)
			} catch (error) {
				console.error('Error fetching profile:', error)
			} finally {
				setIsLoading(false)
			}
		}

		fetchProfile()
	}, [authState.user?.pubkey])

	if (isLoading) {
		return (
			<Card className="border-blue-200 bg-blue-50">
				<CardHeader>
					<div className="flex items-center gap-3">
						<Spinner className="w-6 h-6 text-blue-600" />
						<div>
							<CardTitle className="text-blue-900 text-base">Checking your public wallet settings</CardTitle>
							<CardDescription className="text-blue-700">Loading your Nostr profile information...</CardDescription>
						</div>
					</div>
				</CardHeader>
			</Card>
		)
	}

	const hasLud16 = profile?.lud16 && profile.lud16.trim().length > 0

	if (hasLud16) {
		return (
			<Card className="border-green-200 bg-green-50">
				<CardHeader>
					<div className="flex items-start gap-3">
						<CheckCircle2Icon className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
						<div className="flex-1">
							<CardTitle className="text-green-900 text-base">Lightning Address Found</CardTitle>
							<CardDescription className="text-green-700 mt-1">Your Nostr profile has a Lightning address configured</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="bg-white p-3 rounded-md border border-green-200">
						<p className="text-sm font-medium text-gray-700 mb-1">Lightning Address</p>
						<p className="font-mono text-sm break-all text-gray-900">{profile.lud16}</p>
					</div>
					<div className="text-sm text-green-800 space-y-2">
						<p>
							<strong>By default</strong>, payments go to your Lightning address on your Nostr profile.
						</p>
						<p>Want to use a different one? Add new addresses below for specific products or collections.</p>
					</div>
				</CardContent>
			</Card>
		)
	}

	return (
		<Card className="border-amber-200 bg-amber-50">
			<CardHeader>
				<div className="flex items-start gap-3">
					<InfoIcon className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
					<div className="flex-1">
						<CardTitle className="text-amber-900 text-base">No Lightning Address in Profile</CardTitle>
						<CardDescription className="text-amber-700 mt-1">Set up a wallet to receive Bitcoin payments</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="text-sm text-amber-800 space-y-2">
					<p>
						Your Nostr profile doesn't have a Lightning address (lud16) configured. To receive payments on Plebeian Market, you'll need to
						set up a Bitcoin wallet.
					</p>
					<p>
						You can choose a wallet from the recommended options below (or any other Lightning-compatible wallet). Once you have a Lightning
						address, you can either:
					</p>
					<ul className="list-disc list-inside space-y-1 ml-2">
						<li>Add it to your Nostr profile so it works everywhere</li>
						<li>Add it here specifically for Plebeian Market</li>
					</ul>
				</div>
			</CardContent>
		</Card>
	)
}
