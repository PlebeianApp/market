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
 * This section is the `region-products` **region** — the named landmark the shell
 * declares, carrying its own `aria-label` — so a reader addresses the product
 * catalogue by name and never by the class that happens to lay it out.
 *
 * This renders on the server and hydrates in the browser, so it must not read a
 * browser-only global at render time.
 */

import * as React from 'react'

import { Badge, SelectableBadge, cn } from '@ui/index'

import { shortPubkey, stockLabel, type ProductListItem, type ProductListView } from './productListView'
import { productPath } from './routes'

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
				<h3 className="ds-row-title">
					<a className="ds-row-link" href={productPath(item.coordinates)} data-testid="product-title">
						{item.title}
					</a>
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
					{stockLabel(item)}
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

/**
 * The product list.
 *
 * A row's title is a link to the listing's own address — the **coordinates** the
 * SDK's head rule keys on (`30402:<seller>:<d>`), which is the same value the
 * detail route resolves against. The address a row emits and the address the
 * route serves are therefore one string, not two spellings of one idea.
 */
export function ProductList({ view, className }: { view: ProductListView; className?: string }) {
	return (
		<section
			aria-label="The product catalogue"
			data-testid="product-list"
			className={cn('ds-region region region-products ds-list', className)}
		>
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