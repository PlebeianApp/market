import { StorefrontSection } from './shared'

/** Horizontal rule between sections. */
export function DividerBlock() {
	return (
		<StorefrontSection className="py-6">
			<hr className="border-border" />
		</StorefrontSection>
	)
}

export interface SpacerBlockProps {
	size: 'sm' | 'md' | 'lg' | 'xl'
}

const spacerHeight: Record<SpacerBlockProps['size'], string> = {
	sm: 'h-4',
	md: 'h-10',
	lg: 'h-20',
	xl: 'h-32',
}

/** Vertical breathing room, as an explicit block so the author controls rhythm. */
export function SpacerBlock({ size }: SpacerBlockProps) {
	return <div className={spacerHeight[size]} aria-hidden />
}
