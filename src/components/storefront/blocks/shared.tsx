import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/**
 * Layout primitives shared by storefront blocks, so width/alignment vocabulary
 * stays identical across block types and the page reads as one design rather
 * than nine unrelated sections.
 */

export type StorefrontAlign = 'left' | 'center' | 'right'
export type StorefrontWidth = 'narrow' | 'normal' | 'wide' | 'full'

export const alignClass: Record<StorefrontAlign, string> = {
	left: 'text-left items-start',
	center: 'text-center items-center',
	right: 'text-right items-end',
}

export const widthClass: Record<StorefrontWidth, string> = {
	narrow: 'max-w-2xl',
	normal: 'max-w-4xl',
	wide: 'max-w-6xl',
	full: 'max-w-none',
}

/** Centred content column. Every block sits inside one so gutters line up. */
export function StorefrontSection({
	children,
	width = 'normal',
	className,
}: {
	children: ReactNode
	width?: StorefrontWidth
	className?: string
}) {
	return <section className={cn('mx-auto w-full px-4 sm:px-6', widthClass[width], className)}>{children}</section>
}

/**
 * Placeholder shown in the editor where live data or a required setting is
 * missing. Never rendered on a published page — a visitor should see the page
 * the author meant, not scaffolding explaining what they forgot.
 */
export function StorefrontEditorHint({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-24 items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
			{children}
		</div>
	)
}

/** Optional section heading, consistent across blocks that offer one. */
export function StorefrontSectionTitle({ title, align = 'left' }: { title?: string; align?: StorefrontAlign }) {
	if (!title || title.trim().length === 0) return null
	return (
		<h2
			className={cn(
				'mb-6 font-heading text-2xl font-bold text-foreground sm:text-3xl',
				align === 'center' && 'text-center',
				align === 'right' && 'text-right',
			)}
		>
			{title}
		</h2>
	)
}
