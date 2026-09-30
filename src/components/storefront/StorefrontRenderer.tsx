import { cn } from '@/lib/utils'
import type { StorefrontBlock, StorefrontPage, StorefrontRootProps } from '@/lib/schemas/storefront'
import type { ReactNode } from 'react'
import { StorefrontProvider, useStorefrontContext } from './StorefrontContext'
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

const backgroundClass: Record<StorefrontRootProps['background'], string> = {
	default: 'bg-background text-foreground',
	muted: 'bg-muted/40 text-foreground',
	dark: 'bg-secondary-black text-white',
}

/**
 * Root-level page styling. Exported so the Puck canvas can wrap its children in
 * the identical element — without this, the background the author picks would
 * show on the published page but not in the editor, which is exactly the
 * preview drift this design exists to prevent.
 */
export function StorefrontRoot({ props, children, className }: { props: StorefrontRootProps; children: ReactNode; className?: string }) {
	const { isEditing } = useStorefrontContext()
	return (
		<div
			// Only the live page carries the marker. The editor canvas renders the
			// same element, and a test asserting "the visitor sees a storefront"
			// must not be satisfied by the builder.
			data-testid={isEditing ? undefined : 'storefront-page'}
			className={cn('min-h-screen w-full', backgroundClass[props.background], className)}
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
