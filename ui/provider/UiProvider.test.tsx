import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductDisplayView } from '../components/ProductDisplayView'
import { UiImage, UiLink, UiProvider, themeToStyle } from './UiProvider'

const image = { src: 'https://images.example/a.jpg', alt: 'A' }

describe('UiProvider', () => {
	test('renders a lazy img by default', () => {
		const markup = renderToStaticMarkup(createElement(UiImage, image))
		expect(markup).toContain('<img')
		expect(markup).toContain('loading="lazy"')
	})

	test('lets the host replace the image primitive', () => {
		const markup = renderToStaticMarkup(
			createElement(UiProvider, {
				components: { Image: ({ src }) => createElement('picture', { 'data-src': src }) },
				children: createElement(UiImage, image),
			}),
		)
		expect(markup).toContain('<picture data-src="https://images.example/a.jpg"')
		expect(markup).not.toContain('<img')
	})

	test('replaced primitives reach SDK-backed views without per-call render props', () => {
		const product = {
			pubkey: 'seller',
			tags: [
				['title', 'Mug'],
				['image', 'https://images.example/mug.jpg'],
			],
		}
		const markup = renderToStaticMarkup(
			createElement(UiProvider, {
				components: { Image: ({ src }) => createElement('picture', { 'data-src': src }) },
				children: createElement(ProductDisplayView, {
					product,
					productId: 'mug',
					index: 0,
					isLoading: false,
					onRemove: () => {},
					isRemoving: false,
				}),
			}),
		)
		expect(markup).toContain('data-src="https://images.example/mug.jpg"')
	})

	test('renders a plain anchor by default and lets the host replace the link primitive', () => {
		expect(renderToStaticMarkup(<UiLink href="/products/1">Mug</UiLink>)).toBe('<a href="/products/1">Mug</a>')
		const markup = renderToStaticMarkup(
			<UiProvider components={{ Link: ({ href, children }) => <button data-to={href}>{children}</button> }}>
				<UiLink href="/products/1">Mug</UiLink>
			</UiProvider>,
		)
		expect(markup).toBe('<button data-to="/products/1">Mug</button>')
	})

	test('applies only known theme tokens as CSS variables without a layout wrapper otherwise', () => {
		expect(themeToStyle({ primary: 'red', unknown: 'x' } as never) as Record<string, string>).toEqual({ '--primary': 'red' })
		const themed = renderToStaticMarkup(<UiProvider theme={{ primary: 'red' }}>x</UiProvider>)
		expect(themed).toContain('display:contents')
		expect(themed).toContain('--primary:red')
		expect(renderToStaticMarkup(<UiProvider>x</UiProvider>)).toBe('x')
	})
})
