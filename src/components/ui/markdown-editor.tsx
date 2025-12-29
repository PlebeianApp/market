import { useRef, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { Button } from '@/components/ui/button'
import { Bold, Italic, Heading2, List, Link } from 'lucide-react'

interface MarkdownEditorProps {
	value: string
	onChange: (value: string) => void
	onBlur?: () => void
	placeholder?: string
	className?: string
	id?: string
	name?: string
	required?: boolean
	'data-testid'?: string
}

type MarkdownAction = 'bold' | 'italic' | 'heading' | 'list' | 'link'

export function MarkdownEditor({
	value,
	onChange,
	onBlur,
	placeholder,
	className = '',
	id,
	name,
	required,
	'data-testid': testId,
}: MarkdownEditorProps) {
	const [activeTab, setActiveTab] = useState<string>('write')
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	const insertMarkdown = (action: MarkdownAction) => {
		const textarea = textareaRef.current
		if (!textarea) return

		const start = textarea.selectionStart
		const end = textarea.selectionEnd
		const selectedText = value.substring(start, end)

		// Handle heading separately - insert on new line below
		if (action === 'heading') {
			const textBeforeCursor = value.substring(0, end)
			const textAfterCursor = value.substring(end)
			const needsNewlineBefore = textBeforeCursor.length > 0 && !textBeforeCursor.endsWith('\n')
			const prefix = needsNewlineBefore ? '\n\n## ' : '## '
			const headingText = 'Heading'
			const newValue = textBeforeCursor + prefix + headingText + textAfterCursor

			onChange(newValue)

			requestAnimationFrame(() => {
				textarea.focus()
				const newCursorPos = textBeforeCursor.length + prefix.length + headingText.length
				textarea.setSelectionRange(newCursorPos, newCursorPos)
			})
			return
		}

		let insertion: { before: string; after: string; placeholder: string }

		switch (action) {
			case 'bold':
				insertion = { before: '**', after: '**', placeholder: 'bold text' }
				break
			case 'italic':
				insertion = { before: '_', after: '_', placeholder: 'italic text' }
				break
			case 'list':
				insertion = { before: '- ', after: '', placeholder: 'List item' }
				break
			case 'link':
				insertion = { before: '[', after: '](url)', placeholder: 'link text' }
				break
			default:
				return
		}

		const textToInsert = selectedText || insertion.placeholder
		const newValue =
			value.substring(0, start) + insertion.before + textToInsert + insertion.after + value.substring(end)

		onChange(newValue)

		// Restore focus and set cursor position after the inserted text
		requestAnimationFrame(() => {
			textarea.focus()
			const newCursorPos = start + insertion.before.length + textToInsert.length + insertion.after.length
			textarea.setSelectionRange(newCursorPos, newCursorPos)
		})
	}

	return (
		<Tabs value={activeTab} onValueChange={setActiveTab} className={className}>
			<TabsList className="w-full bg-transparent h-auto p-0 flex gap-[1px] mb-2">
				<TabsTrigger
					value="write"
					className="flex-1 px-4 py-2 text-sm font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
				>
					Write
				</TabsTrigger>
				<TabsTrigger
					value="preview"
					className="flex-1 px-4 py-2 text-sm font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
				>
					Preview
				</TabsTrigger>
			</TabsList>

			<TabsContent value="write" className="mt-0">
				<div className="flex gap-1 mb-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => insertMarkdown('bold')}
						title="Bold"
						className="h-8 w-8 p-0"
					>
						<Bold className="h-4 w-4" />
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => insertMarkdown('italic')}
						title="Italic"
						className="h-8 w-8 p-0"
					>
						<Italic className="h-4 w-4" />
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => insertMarkdown('heading')}
						title="Heading"
						className="h-8 w-8 p-0"
					>
						<Heading2 className="h-4 w-4" />
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => insertMarkdown('list')}
						title="List"
						className="h-8 w-8 p-0"
					>
						<List className="h-4 w-4" />
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => insertMarkdown('link')}
						title="Link"
						className="h-8 w-8 p-0"
					>
						<Link className="h-4 w-4" />
					</Button>
				</div>
				<Textarea
					ref={textareaRef}
					id={id}
					name={name}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onBlur={onBlur}
					placeholder={placeholder}
					required={required}
					data-testid={testId}
					className="min-h-40 border-2"
				/>
			</TabsContent>

			<TabsContent value="preview" className="mt-0">
				<div className="min-h-40 border-2 rounded-md p-3 bg-white">
					{value ? (
						<MarkdownRenderer content={value} />
					) : (
						<p className="text-gray-400 italic">Nothing to preview</p>
					)}
				</div>
			</TabsContent>
		</Tabs>
	)
}
