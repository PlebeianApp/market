/**
 * instance/ProductList.tsx — the rendering rung.
 *
 * The app renders rows; the components it renders them with come from `ui/`
 * (`Badge`, `SelectableBadge`, `cn`), and every value in a row came out of the
 * SDK's discovery read model (`productListView.ts`). This file adds no commerce
 * rule of its own — it formats and lays out.
 *
 * Styling note: the app does not ship a Tailwind build. `ui/`'s components select
 * their own variants through the attributes they already set (`data-slot="badge"`,
 * `data-variant`, `data-selected`), so `styles.css` themes them from those
 * attributes rather than from a class-name convention.
 *
 * This renders on the server and hydrates in the browser, so it must not read a
 * browser-only global at render time.
 */

import * as React from 'react'

import { Badge, SelectableBadge, cn } from '@ui/index'

import type { ProductListItem, ProductListView } from './productListView'

/** A short, human pubkey: `7e7c3b5a…0f12`. */
function shortPubkey(pubkey: string): string {
	return pubkey.length <= 12 ? pubkey : `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`
}

function ProductRow({ item }: { item: ProductListItem }) {
	return (
		<li
			className="ds-row"
			data-testid="product-row"
			data-product-id={item.id}
			data-in-stock={item.inStock ? 'true' : 'false'}
			data-visibility={item.visibility}
		>
			<div className="ds-row-head">
				<h3 className="ds-row-title" data-testid="product-title">
					{item.title}
				</h3>
				<span className="ds-price" data-testid="product-price">
					{item.price ? item.price.display : 'no price'}
				</span>
			</div>

			{item.summary ? (
				<p className="ds-summary" data-testid="product-summary">
					{item.summary}
				</p>
			) : null}

			<div className="ds-badges">
				<Badge data-testid="product-stock-badge" variant={item.inStock ? 'secondary' : 'destructive'}>
					{item.inStock ? 'in stock' : 'out of stock'}
					{item.stock === null ? '' : ` · ${item.stock}`}
				</Badge>
				{item.visibility !== 'on-sale' ? (
					<Badge data-testid="product-visibility-badge" variant="outline">
						{item.visibility}
					</Badge>
				) : null}
				{item.categories.map((category) => (
					<SelectableBadge key={category} isSelected={false} data-testid="product-category">
						{category}
					</SelectableBadge>
				))}
			</div>

			<p className="ds-meta">
				<span data-testid="product-coordinates">{item.coordinates}</span>
				{' · '}
				<span data-testid="product-seller">{shortPubkey(item.sellerPubkey)}</span>
			</p>
		</li>
	)
}

export function ProductList({ view, className }: { view: ProductListView; className?: string }) {
	return (
		<section aria-labelledby="product-list-heading" data-testid="product-list" className={cn('ds-list', className)}>
			<div className="ds-list-head">
				<h2 id="product-list-heading" className="ds-section-title">
					Products
				</h2>
				<p className="ds-muted" data-testid="product-list-summary">
					{view.summaryLine}
				</p>
			</div>

			{view.items.length === 0 ? (
				<p className="ds-empty" data-testid="product-list-empty">
					No listings.
				</p>
			) : (
				<ul className="ds-rows" data-testid="product-rows">
					{view.items.map((item) => (
						<ProductRow key={item.coordinates} item={item} />
					))}
				</ul>
			)}
		</section>
	)
}