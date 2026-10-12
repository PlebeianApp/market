import { cn } from '@/lib/utils'
import { MiniMarkdown } from '../MiniMarkdown'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontEditorHint, StorefrontSection, type StorefrontAlign } from './shared'

export interface TextBlockProps {
	markdown: string
	align: StorefrontAlign
	width: 'narrow' | 'normal' | 'wide'
}

/** Prose, rendered through the restricted markdown token tree — never as HTML. */
export function TextBlock({ markdown, align, width }: TextBlockProps) {
	const { isEditing } = useStorefrontContext()

	if (markdown.trim().length === 0) {
		return isEditing ? (
			<StorefrontSection width={width} className="py-4">
				<StorefrontEditorHint>Write something. Markdown: # heading, **bold**, *italic*, - list, [link](https://…)</StorefrontEditorHint>
			</StorefrontSection>
		) : null
	}

	return (
		<StorefrontSection width={width} className="py-8">
			<MiniMarkdown source={markdown} className={cn(align === 'center' && 'text-center', align === 'right' && 'text-right')} />
		</StorefrontSection>
	)
}
