import { useMedia } from 'react-use'

type Breakpoint = 'sm' | 'md' | 'lg' | 'xl'

export function useBreakpoint(): Breakpoint {
	const isSm = useMedia('(min-width: 640px)', false)
	const isMd = useMedia('(min-width: 768px)', false)
	const isLg = useMedia('(min-width: 1024px)', false)

	if (!isSm) return 'sm'
	if (!isMd) return 'md'
	if (!isLg) return 'lg'
	return 'xl'
}
