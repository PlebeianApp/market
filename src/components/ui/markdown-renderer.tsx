import ReactMarkdown from 'react-markdown'

interface MarkdownRendererProps {
	content: string
	className?: string
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
	if (!content) {
		return null
	}

	return (
		<div className={`prose prose-gray max-w-none ${className}`}>
			<ReactMarkdown
				components={{
					// Headings
					h1: ({ children }) => <h1 className="text-2xl font-bold mt-6 mb-4 first:mt-0">{children}</h1>,
					h2: ({ children }) => <h2 className="text-xl font-bold mt-5 mb-3 first:mt-0">{children}</h2>,
					h3: ({ children }) => <h3 className="text-lg font-semibold mt-4 mb-2 first:mt-0">{children}</h3>,
					h4: ({ children }) => <h4 className="text-base font-semibold mt-3 mb-2 first:mt-0">{children}</h4>,
					h5: ({ children }) => <h5 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h5>,
					h6: ({ children }) => <h6 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h6>,

					// Paragraphs
					p: ({ children }) => <p className="mb-4 last:mb-0 leading-relaxed">{children}</p>,

					// Lists
					ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>,
					ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>,
					li: ({ children }) => <li className="leading-relaxed">{children}</li>,

					// Links
					a: ({ href, children }) => (
						<a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
							{children}
						</a>
					),

					// Emphasis
					strong: ({ children }) => <strong className="font-bold">{children}</strong>,
					em: ({ children }) => <em className="italic">{children}</em>,
					del: ({ children }) => <del className="line-through">{children}</del>,

					// Code
					code: ({ className, children }) => {
						const isInline = !className
						if (isInline) {
							return <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
						}
						return (
							<code className="block bg-gray-100 p-4 rounded-md text-sm font-mono overflow-x-auto whitespace-pre">{children}</code>
						)
					},
					pre: ({ children }) => <pre className="bg-gray-100 p-4 rounded-md overflow-x-auto mb-4">{children}</pre>,

					// Blockquotes
					blockquote: ({ children }) => (
						<blockquote className="border-l-4 border-gray-300 pl-4 py-2 my-4 italic text-gray-600">{children}</blockquote>
					),

					// Horizontal rules
					hr: () => <hr className="my-6 border-gray-200" />,
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	)
}
