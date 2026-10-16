import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EditorTextField } from './EditorFields'

describe('EditorTextField', () => {
	test('marks required fields and keeps test ids on the control', () => {
		const markup = renderToStaticMarkup(
			<EditorTextField id="name" label="Title" required value="Mug" onChange={() => {}} data-testid="product-name-input" />,
		)
		expect(markup).toContain('after:text-red-500')
		expect(markup).toContain('data-testid="product-name-input"')
		expect(markup).toContain('value="Mug"')
		expect(markup).toContain('required=""')
	})

	test('renders a textarea for multiline and shows a hint', () => {
		const markup = renderToStaticMarkup(
			<EditorTextField id="d" label="Description" multiline value="" onChange={() => {}} hint="Shown in listings" />,
		)
		expect(markup).toContain('<textarea')
		expect(markup).toContain('Shown in listings')
	})

	test('shows host validation errors only after touch', () => {
		const props = { id: 'n', label: 'Title', value: '', onChange: () => {}, errors: ['Product name is required', undefined] }
		expect(renderToStaticMarkup(<EditorTextField {...props} touched={false} />)).not.toContain('required</div>')
		expect(renderToStaticMarkup(<EditorTextField {...props} touched />)).toContain('Product name is required</div>')
	})
})
