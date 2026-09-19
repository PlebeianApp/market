import type { StorefrontBlock, StorefrontPage } from '@/lib/schemas/storefront'

interface StorefrontRendererProps {
	page: StorefrontPage
}

function SafeLink({ href, children }: { href: string; children: React.ReactNode }) {
	const external = href.startsWith('https://')
	return (
		<a
			href={href}
			target={external ? '_blank' : undefined}
			rel={external ? 'noreferrer' : undefined}
			className="text-primary underline underline-offset-4 hover:opacity-80"
		>
			{children}
		</a>
	)
}

function StorefrontBlockView({ block }: { block: StorefrontBlock }) {
	switch (block.type) {
		case 'hero':
			return (
				<section className="overflow-hidden rounded-lg border bg-card">
					{block.image ? <img src={block.image} alt="" className="max-h-80 w-full object-cover" /> : null}
					<div className="space-y-3 p-6">
						<h1 className="text-3xl font-semibold tracking-tight">{block.title}</h1>
						{block.text ? <p className="max-w-2xl text-muted-foreground">{block.text}</p> : null}
						{block.link ? <SafeLink href={block.link}>Explore</SafeLink> : null}
					</div>
				</section>
			)
		case 'text':
			return <p className="whitespace-pre-wrap text-base leading-7">{block.text}</p>
		case 'linkList':
			return (
				<nav aria-label="Storefront links" className="grid gap-3 sm:grid-cols-2">
					{block.links.map((link) => (
						<SafeLink key={`${link.label}-${link.url}`} href={link.url}>
							{link.label}
						</SafeLink>
					))}
				</nav>
			)
		case 'contact':
			return (
				<section className="border-l-2 border-primary pl-4">
					<h2 className="font-medium">{block.label}</h2>
					<p className="mt-1 whitespace-pre-wrap text-muted-foreground">{block.text}</p>
				</section>
			)
		case 'productGrid':
			return (
				<section className="space-y-3">
					<h2 className="text-xl font-semibold">Featured products</h2>
					<p className="text-sm text-muted-foreground">{block.products.length} product references published by this seller.</p>
					<SafeLink href="/products">Browse products</SafeLink>
				</section>
			)
		case 'collectionRow':
			return (
				<section className="space-y-3">
					<h2 className="text-xl font-semibold">Collection</h2>
					<p className="text-sm text-muted-foreground">A published collection from this seller.</p>
					<SafeLink href="/community">Browse collection</SafeLink>
				</section>
			)
	}
}

export function StorefrontRenderer({ page }: StorefrontRendererProps) {
	return (
		<main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
			{page.blocks.map((block, index) => (
				<StorefrontBlockView key={`${block.type}-${index}`} block={block} />
			))}
		</main>
	)
}
