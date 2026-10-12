import { isSafeHref } from '@/lib/schemas/storefront'
import { cn } from '@/lib/utils'
import { ExternalLink } from 'lucide-react'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontLink } from '../StorefrontLink'
import { StorefrontEditorHint, StorefrontSection, StorefrontSectionTitle } from './shared'

export interface LinkListBlockProps {
	title: string
	links: { label: string; href: string }[]
	layout: 'row' | 'column'
}

/** The author's own links — socials, docs, anything reachable over https. */
export function LinkListBlock({ title, links, layout }: LinkListBlockProps) {
	const { isEditing } = useStorefrontContext()

	// Re-filter rather than trusting the document: this list is the most likely
	// place for a hand-edited or third-party-authored event to carry a hostile
	// href, and the cost of the check is one predicate per link.
	const safeLinks = links.filter((link) => isSafeHref(link.href) && link.label.trim().length > 0)

	if (safeLinks.length === 0) {
		return isEditing ? (
			<StorefrontSection className="py-6">
				<StorefrontSectionTitle title={title} />
				<StorefrontEditorHint>Add links. Each needs a label and an https:// address.</StorefrontEditorHint>
			</StorefrontSection>
		) : null
	}

	return (
		<StorefrontSection className="py-8">
			<StorefrontSectionTitle title={title} />
			<ul className={cn('flex gap-3', layout === 'row' ? 'flex-wrap' : 'flex-col')}>
				{safeLinks.map((link, index) => (
					<li key={`${link.href}-${index}`}>
						<StorefrontLink
							href={link.href}
							className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 font-medium text-card-foreground transition-colors hover:border-primary hover:text-primary"
						>
							{link.label}
							{!link.href.startsWith('/') && <ExternalLink className="size-3.5 opacity-60" aria-hidden />}
						</StorefrontLink>
					</li>
				))}
			</ul>
		</StorefrontSection>
	)
}
