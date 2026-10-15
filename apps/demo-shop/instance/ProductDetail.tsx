/**
 * instance/ProductDetail.tsx — one listing's page, and the buy control.
 *
 * Every value on this page comes out of the SDK's discovery read model through
 * `productDetailView.ts`; this file formats and lays out, and adds no commerce
 * rule of its own. The two rules it *does* state are the app's own, and both are
 * visible on screen rather than silent:
 *
 * 1. **A listing that is not in stock cannot be added.** The SDK's cart would
 *    happily fold it in — the cart knows about quantities, not availability — so
 *    the refusal is the surface's, and it is said in words rather than rendered as
 *    a dead control. (The old house style carries the same state as
 *    `.add-to-cart.off`.)
 * 2. **Nothing is added before the browser's cart has been read.** At the server
 *    render the count is unknown, so the control is disabled and says which of the
 *    two reasons applies. That is the same state the skeleton in the nav shows,
 *    and it is why an add can never race the load.
 *
 * THE IMAGE IS A LINE OF DATA, NOT A FETCH. `getProductImages` returns the URL the
 * listing published; this demo catalog points at a non-resolving example host, and
 * a page that fetched it would put a failed request in the console of every
 * visitor. So the URL is shown as the string it is.
 */

import * as React from 'react'

import { Badge, SelectableBadge, cn } from '@ui/index'

import { cartLineFrom } from './cartState'
import type { ProductDetailView, ProductMissingView } from './productDetailView'
import { shortPubkey, stockLabel } from './productListView'
import { PRODUCTS_PATH } from './routes'
import type { CartControl } from './useCart'

/** What the buy control last said, or `null` before it has been used. */
interface BuyStatus {
	readonly tone: 'ok' | 'refused'
	readonly text: string
}

/** The quantity a listing may be added in. The SDK clamps to this range; the input offers it. */
const MIN_QUANTITY = 1
const MAX_QUANTITY = 999

function QuantityAndBuy({ detail, cart }: { detail: ProductDetailView; cart: CartControl }) {
	const [quantity, setQuantity] = React.useState(MIN_QUANTITY)
	const [status, setStatus] = React.useState<BuyStatus | null>(null)

	const item = detail.item
	const readingCart = cart.status === 'reading'

	/**
	 * The two states the control itself can be in before it is used, and why.
	 * Both are named, because a disabled button with no words is the defect this
	 * whole surface is trying not to be.
	 */
	const waitText = readingCart
		? 'reading this browser’s cart…'
		: cart.status === 'unavailable'
			? 'this browser has no reachable cart storage, so nothing can be added here'
			: null

	const onAdd = () => {
		if (!item.inStock) {
			setStatus({ tone: 'refused', text: `Not added: ${stockLabel(item)}.` })
			return
		}

		const count = cart.add(cartLineFrom(item, quantity))
		if (count === null) {
			setStatus({ tone: 'refused', text: 'Not added: this browser did not accept the cart write.' })
			return
		}

		setStatus({
			tone: 'ok',
			text: `Added ${quantity} × ${item.title} — the cart holds ${count} item${count === 1 ? '' : 's'}.`,
		})
	}

	return (
		<div className="ds-buy">
			<label className="ds-qty-label" htmlFor="buy-quantity">
				Quantity
				<input
					id="buy-quantity"
					className="ds-qty"
					type="number"
					inputMode="numeric"
					min={MIN_QUANTITY}
					max={MAX_QUANTITY}
					value={quantity}
					disabled={readingCart}
					onChange={(event) => setQuantity(Number(event.target.value) || MIN_QUANTITY)}
				/>
			</label>

			<button
				type="button"
				className="ds-btn"
				data-testid="add-to-cart"
				data-buy-state={!item.inStock ? 'refused' : readingCart ? 'off' : 'on'}
				disabled={readingCart}
				onClick={onAdd}
			>
				Add to cart
			</button>

			<p
				className="ds-status"
				data-testid="add-to-cart-status"
				data-tone={status?.tone ?? 'off'}
			>
				{status ? status.text : (waitText ?? 'Ready to add to this browser’s cart.')}
			</p>
		</div>
	)
}

export function ProductDetail({ detail, cart, className }: { detail: ProductDetailView; cart: CartControl; className?: string }) {
	const item = detail.item

	return (
		<section
			aria-label="The product page"
			data-testid="product-detail"
			className={cn('ds-region region region-product ds-detail', className)}
		>
			<p className="ds-eyebrow">
				<a className="ds-back" href={PRODUCTS_PATH}>
					← Products
				</a>
			</p>

			<div className="ds-detail-head">
				<h1 className="ds-detail-title" data-testid="product-detail-title">
					{item.title}
				</h1>

				<div className="ds-detail-meta">
					<span className="ds-price" data-testid="product-detail-price">
						{item.price ? item.price.display : 'no price'}
					</span>
					<Badge data-testid="product-detail-stock" variant={item.inStock ? 'secondary' : 'destructive'}>
						{stockLabel(item)}
					</Badge>
					{item.visibility !== 'on-sale' ? (
						<Badge data-testid="product-detail-visibility" variant="outline">
							{item.visibility}
						</Badge>
					) : null}
					{item.categories.map((category) => (
						<SelectableBadge key={category} isSelected={false} data-testid="product-detail-category">
							{category}
						</SelectableBadge>
					))}
				</div>

				<p className="ds-detail-summary" data-testid="product-detail-summary">
					{item.summary || 'No summary was published.'}
				</p>
			</div>

			<div className="ds-detail-body">
				<h2 className="ds-section-title">Description</h2>
				<p className="ds-desc" data-testid="product-detail-description">
					{detail.description || 'No description was published.'}
				</p>
			</div>

			<div>
				<h2 className="ds-section-title">Specs</h2>
				{detail.specs.length === 0 ? (
					<p className="ds-muted" data-testid="product-detail-specs-empty">
						This listing published no specs.
					</p>
				) : (
					<dl className="ds-specs" data-testid="product-detail-specs">
						{detail.specs.map((spec) => (
							<div className="ds-spec-row" key={`${spec.key}:${spec.value}`}>
								<dt className="ds-spec-key">{spec.key}</dt>
								<dd className="ds-spec-value">{spec.value}</dd>
							</div>
						))}
					</dl>
				)}
			</div>

			<div>
				<h2 className="ds-section-title">Shipping</h2>
				{detail.shipping.length === 0 ? (
					<p className="ds-muted" data-testid="product-detail-shipping-empty">
						This listing published no shipping option.
					</p>
				) : (
					<ul className="ds-shipping" data-testid="product-detail-shipping">
						{detail.shipping.map((option) => (
							<li className="ds-shipping-option" key={option.ref}>
								<span className="ds-shipping-name">{option.ref}</span>
								{/* Reported exactly as tagged: the read model declares no unit for it. */}
								<span className="ds-shipping-cost">{option.amount}</span>
							</li>
						))}
					</ul>
				)}
			</div>

			<QuantityAndBuy detail={detail} cart={cart} />

			<p className="ds-meta">
				<span data-testid="product-detail-coordinates">{item.coordinates}</span>
				{' · '}
				<span data-testid="product-detail-seller">{shortPubkey(item.sellerPubkey)}</span>
				{' · '}
				<span data-testid="product-detail-image">{detail.imageUrl ?? 'no image was published'}</span>
			</p>
		</section>
	)
}

/** The product address that resolved to no listing — a named reason, in words. */
export function ProductMissing({ missing, className }: { missing: ProductMissingView; className?: string }) {
	const sentence =
		missing.reason === 'not-on-sale'
			? 'That listing is not on sale, so this instance does not serve a page for it.'
			: 'This instance never admitted a listing at that address.'

	return (
		<section
			aria-label="The product page"
			data-testid="product-missing"
			className={cn('ds-region region region-product ds-detail', className)}
		>
			<p className="ds-eyebrow">
				<a className="ds-back" href={PRODUCTS_PATH}>
					← Products
				</a>
			</p>
			<h1 className="ds-detail-title" data-testid="product-missing-title">
				No listing here
			</h1>
			<p className="ds-detail-body" data-testid="product-missing-reason">
				{sentence}
			</p>
			<p className="ds-meta" data-testid="product-missing-coordinates">
				{missing.coordinates}
			</p>
		</section>
	)
}
