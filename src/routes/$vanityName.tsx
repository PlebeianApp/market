import { vanityActions } from '@/lib/stores/vanity'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/$vanityName')({
    beforeLoad: ({ params }) => {
        const { vanityName } = params

        // Try to resolve the vanity URL
        const entry = vanityActions.resolveVanity(vanityName)

        if (entry) {
            // Redirect to the profile page
            throw redirect({
                to: '/profile/$profileId',
                params: { profileId: entry.pubkey },
            })
        }

        // If not found, we'll show the component which handles the "not found" case
        return { vanityName, entry }
    },
    component: VanityRouteComponent,
})

function VanityRouteComponent() {
    const { vanityName } = Route.useParams()
    const navigate = useNavigate()

    // Double-check resolution in case store wasn't loaded during beforeLoad
    useEffect(() => {
        const entry = vanityActions.resolveVanity(vanityName)
        if (entry) {
            navigate({
                to: '/profile/$profileId',
                params: { profileId: entry.pubkey },
                replace: true,
            })
        }
    }, [vanityName, navigate])

    // Check if vanity store is loaded
    const isLoaded = vanityActions.isVanityLoaded()

    if (!isLoaded) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
                    <p className="text-muted-foreground">Loading...</p>
                </div>
            </div>
        )
    }

    // Vanity URL not found - show 404-like message
    return (
        <div className="flex items-center justify-center min-h-screen">
            <div className="text-center max-w-md mx-auto p-8">
                <h1 className="text-4xl font-bold mb-4">Page Not Found</h1>
                <p className="text-muted-foreground mb-6">
                    The vanity URL <span className="font-mono text-primary">/{vanityName}</span> is not registered or has expired.
                </p>
                <button onClick={() => navigate({ to: '/' })} className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity">
                    Go Home
                </button>
            </div>
        </div>
    )
}
