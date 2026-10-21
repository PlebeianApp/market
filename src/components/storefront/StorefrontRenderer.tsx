import { getStorefrontPalette, getStorefrontTheme, storefrontThemeCssVars } from '@/config/storefrontThemes'
import { cn } from '@/lib/utils'
import type { StorefrontBlock, StorefrontPage, StorefrontRootProps } from '@/lib/schemas/storefront'
import type { ReactNode } from 'react'
import { StorefrontProvider, useStorefrontContext } from './StorefrontContext'

// The tune variables this wrapper sets are consumed here and nowhere else.
import './storefront-theme.css'
import { FeaturedProductBlock } from './blocks/FeaturedProductBlock'
import { HeroBlock } from './blocks/HeroBlock'
import { ImageBlock } from './blocks/ImageBlock'
import { LinkListBlock } from './blocks/LinkListBlock'
import { ProductGridBlock } from './blocks/ProductGridBlock'
import { ProfileHeaderBlock } from './blocks/ProfileHeaderBlock'
import { TextBlock } from './blocks/TextBlock'
import { DividerBlock, SpacerBlock } from './blocks/SpacingBlocks'

/**
 * Turns a validated page document into elements.
 *
 * This is the only place a block type becomes a component, and the switch is
 * exhaustive over the schema's discriminated union — adding a block type
 * without a case here is a TypeScript error, not a blank space on somebody's
 * storefront.
 *
 * The same renderer draws the published page and the Puck canvas. That is
 * deliberate: an editor with its own preview implementation drifts from
 * production, and the author discovers the difference after publishing.
 */

/**
 * Root-level page styling. Exported so every surface that renders a page —
 * the published page, the Puck canvas, and the setup wizard's template/theme
 * previews — wraps its children in the identical element. Without this, a
 * theme the author picks would look different in each place, which is
 * exactly the preview drift this design exists to prevent.
 *
 * The theme is applied as CSS custom properties on this wrapper (ADR-0006
 * §"Theme Integration"), not as a Tailwind class switch: every block already
 * styles itself with token classes (`bg-card`, `text-primary`, …), so
 * overriding the token *values* here is enough — no block needs to know a
 * theme exists.
 */
export function StorefrontRoot({
	props,
	children,
	className,
	/** False for compact previews (wizard cards) that must not claim the viewport height they're scaled inside. */
	fullHeight = true,
}: {
	props: StorefrontRootProps
	children: ReactNode
	className?: string
	fullHeight?: boolean
}) {
	const { isEditing } = useStorefrontContext()
	const theme = getStorefrontTheme(props.theme)
	const palette = getStorefrontPalette(theme, props.palette)
	return (
		<div
			// Only the live page carries the marker. The editor canvas and wizard
			// previews render the same element, and a test asserting "the visitor
			// sees a storefront" must not be satisfied by either of those.
			data-testid={isEditing ? undefined : 'storefront-page'}
			data-storefront-theme={theme.id}
			data-storefront-palette={palette.key}
			className={cn('w-full bg-background text-foreground', fullHeight && 'min-h-screen', className)}
			style={storefrontThemeCssVars(theme, props.palette, props.tune)}
		>
			{children}
		</div>
	)
}

export function StorefrontBlockView({ block }: { block: StorefrontBlock }) {
	switch (block.type) {
		case 'ProfileHeader':
			return <ProfileHeaderBlock {...block.props} />
		case 'Hero':
			return <HeroBlock {...block.props} />
		case 'Text':
			return <TextBlock {...block.props} />
		case 'ProductGrid':
			return <ProductGridBlock {...block.props} />
		case 'FeaturedProduct':
			return <FeaturedProductBlock {...block.props} />
		case 'LinkList':
			return <LinkListBlock {...block.props} />
		case 'Image':
			return <ImageBlock {...block.props} />
		case 'Divider':
			return <DividerBlock />
		case 'Spacer':
			return <SpacerBlock {...block.props} />
		default: {
			// Unreachable while the switch matches the union. The assignment
			// makes that a compile-time guarantee; the `null` keeps a page that
			// somehow reached here rendering its other blocks at runtime.
			const exhaustive: never = block
			void exhaustive
			return null
		}
	}
}

export interface StorefrontRendererProps {
	page: StorefrontPage
	/** The page author. Data blocks resolve their queries against this pubkey. */
	pubkey: string
	className?: string
}

export function StorefrontRenderer({ page, pubkey, className }: StorefrontRendererProps) {
	return (
		<StorefrontProvider value={{ pubkey, isEditing: false }}>
			<StorefrontRoot props={page.root.props} className={className}>
				{page.content.map((block) => (
					<StorefrontBlockView key={block.props.id} block={block} />
				))}
			</StorefrontRoot>
		</StorefrontProvider>
	)
}
