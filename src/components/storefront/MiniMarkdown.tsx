import { parseMiniMarkdown, type MiniMarkdownBlock, type MiniMarkdownInline } from '@/lib/utils/miniMarkdown'
import { cn } from '@/lib/utils'
import { useMemo } from 'react'
import { StorefrontLink } from './StorefrontLink'

/**
 * Renders the restricted markdown subset as a React element tree.
 *
 * The whole point is what this file does *not* contain: there is no
 * `dangerouslySetInnerHTML` and no HTML string anywhere on the path from relay
 * bytes to the DOM. `parseMiniMarkdown` produces tokens, and every token maps
 * to an element created by React, which escapes text nodes for us. An author
 * who writes `<img onerror=...>` gets those characters rendered as characters.
 */

function renderInline(nodes: MiniMarkdownInline[], keyPrefix: string) {
	return nodes.map((node, index) => {
		const key = `${keyPrefix}-${index}`
		switch (node.kind) {
			case 'text':
				return <span key={key}>{node.value}</span>
			case 'strong':
				return <strong key={key}>{renderInline(node.children, key)}</strong>
			case 'em':
				return <em key={key}>{renderInline(node.children, key)}</em>
			case 'code':
				return (
					<code key={key} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">
						{node.value}
					</code>
				)
			case 'link':
				return (
					<StorefrontLink key={key} href={node.href} className="text-primary underline underline-offset-2 hover:opacity-80">
						{renderInline(node.children, key)}
					</StorefrontLink>
				)
		}
	})
}

function renderBlock(block: MiniMarkdownBlock, key: string) {
	switch (block.kind) {
		case 'heading': {
			const className = cn(
				'font-heading font-bold text-foreground',
				block.level === 1 && 'mt-8 mb-4 text-3xl first:mt-0',
				block.level === 2 && 'mt-6 mb-3 text-2xl first:mt-0',
				block.level === 3 && 'mt-5 mb-2 text-xl first:mt-0',
			)
			const children = renderInline(block.children, key)
			if (block.level === 1) {
				return (
					<h1 key={key} className={className}>
						{children}
					</h1>
				)
			}
			if (block.level === 2) {
				return (
					<h2 key={key} className={className}>
						{children}
					</h2>
				)
			}
			return (
				<h3 key={key} className={className}>
					{children}
				</h3>
			)
		}
		case 'paragraph':
			return (
				<p key={key} className="mb-4 leading-relaxed text-foreground last:mb-0">
					{renderInline(block.children, key)}
				</p>
			)
		case 'list':
			return (
				<ul key={key} className="mb-4 list-disc space-y-1 pl-6 text-foreground last:mb-0">
					{block.items.map((item, index) => (
						<li key={`${key}-${index}`}>{renderInline(item, `${key}-${index}`)}</li>
					))}
				</ul>
			)
		case 'quote':
			return (
				<blockquote key={key} className="mb-4 border-l-4 border-primary/40 pl-4 italic text-muted-foreground last:mb-0">
					{renderInline(block.children, key)}
				</blockquote>
			)
	}
}

export function MiniMarkdown({ source, className }: { source: string; className?: string }) {
	const blocks = useMemo(() => parseMiniMarkdown(source), [source])
	if (blocks.length === 0) return null
	return <div className={className}>{blocks.map((block, index) => renderBlock(block, `md-${index}`))}</div>
}
