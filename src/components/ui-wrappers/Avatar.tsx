import * as React from 'react'

import { Avatar as AvatarPrimitive, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export interface AvatarWrapperProps extends React.ComponentProps<typeof AvatarPrimitive> {
	/** Image URL for the avatar. If omitted, shows the fallback. */
	src?: string
	/** Fallback text or initials shown when no image is available. */
	fallback?: string
	/** Size variant. Maps to Tailwind size utilities. */
	size?: 'xs' | 'sm' | 'md' | 'lg'
}

const sizeMap = {
	xs: 'size-6',
	sm: 'size-8',
	md: 'size-10',
	lg: 'size-12',
} as const

/**
 * Avatar — a wrapper around the Shadcn `ui/avatar` primitive that adds:
 * - A `size` variant prop for consistent sizing across the app
 * - A `src` + `fallback` prop pair so callers don't need to compose
 *   `AvatarImage` + `AvatarFallback` manually
 * - Tokenized fallback colors (`bg-muted text-muted-foreground`) instead of
 *   hardcoded `bg-neo-purple text-white`
 *
 * This component demonstrates the `ui-wrappers/` pattern:
 * - Wraps Shadcn primitives, adding behavior and styling
 * - Uses `forwardRef`, `cn()`, and forwards ref through the primitive's
 *   `{...props}` spread (no extra DOM element)
 * - Uses semantic tokens, not hardcoded colors
 *
 * Replaces the pattern in `AvatarUser.tsx` (which reaches directly into
 * `@radix-ui/react-avatar` and uses string-concat className with
 * `bg-neo-purple text-white`). The actual replacement of `AvatarUser`
 * consumers happens in a later migration slice.
 */
const Avatar = React.forwardRef<HTMLSpanElement, AvatarWrapperProps>(
	({ src, fallback, size = 'sm', className, children, ...props }, ref) => {
		return (
			<AvatarPrimitive ref={ref} className={cn(sizeMap[size], className)} {...props}>
				{src && <AvatarImage src={src} alt={fallback ?? 'Avatar'} />}
				<AvatarFallback>{fallback?.charAt(0).toUpperCase() ?? '?'}</AvatarFallback>
				{children}
			</AvatarPrimitive>
		)
	},
)

Avatar.displayName = 'Avatar'

export { Avatar }