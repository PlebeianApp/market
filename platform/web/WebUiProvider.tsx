import { Media } from '@ui/components/Media'
import { Link } from '@tanstack/react-router'
import { UiProvider, type UiComponents, type UiImageProps, type UiLinkProps } from '@ui/provider/UiProvider'
import type { ReactNode } from 'react'

function HostImage({ src, alt, className }: UiImageProps) {
	return <Media src={src} alt={alt} className={className} />
}

function HostLink({ href, className, onClick, children }: UiLinkProps) {
	const isInternal = href.startsWith('/') && !href.startsWith('//')
	if (!isInternal) {
		// Hrefs may originate from relay data; only allow safe external schemes.
		if (!/^(https?:|mailto:)/i.test(href)) return <span className={className}>{children}</span>
		return (
			<a href={href} className={className} onClick={onClick} target="_blank" rel="noopener noreferrer">
				{children}
			</a>
		)
	}
	// UI passes untyped paths; the router still resolves and validates them at runtime.
	return (
		<Link to={href as never} className={className} onClick={onClick}>
			{children}
		</Link>
	)
}

const hostComponents: Partial<UiComponents> = { Image: HostImage, Link: HostLink }

/** Platform composition: supplies the web host's primitives to UI components. */
export function WebUiProvider({ children }: { children: ReactNode }) {
	return <UiProvider components={hostComponents}>{children}</UiProvider>
}
