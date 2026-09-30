import { isSafeHref } from '@/lib/schemas/storefront'
import type { ReactNode } from 'react'
import { useStorefrontContext } from './StorefrontContext'

/**
 * The single anchor used by every storefront block.
 *
 * Centralising it means the href gate is applied in one place instead of nine.
 * The schema already refused unsafe hrefs on the way in, but this re-checks on
 * the way out: the document crossed a relay between those two points, and a
 * value that is only validated once is only validated on the path we thought
 * about.
 *
 * Cross-origin links get `rel="noopener noreferrer nofollow"` — `noopener`
 * because `window.opener` in a wallet-bearing app is a real handle, `nofollow`
 * because these links are user-submitted content.
 */
export function StorefrontLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
	const { isEditing } = useStorefrontContext()

	if (!isSafeHref(href)) {
		return <span className={className}>{children}</span>
	}

	const isInternal = href.startsWith('/')

	// In the canvas a click means "select this block". Letting it navigate would
	// drop the author out of the editor, unsaved work and all.
	if (isEditing) {
		return (
			<span className={className} data-storefront-href={href}>
				{children}
			</span>
		)
	}

	return (
		<a
			href={href}
			className={className}
			target={isInternal ? undefined : '_blank'}
			rel={isInternal ? undefined : 'noopener noreferrer nofollow'}
		>
			{children}
		</a>
	)
}
