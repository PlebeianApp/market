import { useActiveVanityLinks, isVanityConfigured } from '@/queries/vanity'
import { LinkIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface VanityLinkBadgeProps {
	pubkey: string | undefined
	className?: string
}

export function VanityLinkBadge({ pubkey, className = '' }: VanityLinkBadgeProps) {
	const { data: vanityLinks, isLoading } = useActiveVanityLinks(pubkey)

	// Don't render if vanity feature is not configured
	if (!isVanityConfigured()) {
		return null
	}

	// Don't render while loading or if no links
	if (isLoading || !vanityLinks || vanityLinks.length === 0) {
		return null
	}

	// Show the first active vanity link
	const primaryLink = vanityLinks[0]

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<a
						href={primaryLink.url}
						target="_blank"
						rel="noopener noreferrer"
						className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-purple-600/80 text-white hover:bg-purple-500 transition-colors ${className}`}
						onClick={(e) => e.stopPropagation()}
					>
						<LinkIcon className="w-3 h-3" />
						<span>
							{primaryLink.domain}/{primaryLink.name}
						</span>
					</a>
				</TooltipTrigger>
				<TooltipContent>
					<p>Visit vanity URL</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	)
}
