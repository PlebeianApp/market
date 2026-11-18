import { createContext, useContext, useLayoutEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

const PageLayoutContext = createContext<{
	standalone: boolean
	setStandalone: Dispatch<SetStateAction<boolean>>
} | null>(null)

export function PageLayoutProvider({ children }: { children: ReactNode }) {
	const [standalone, setStandalone] = useState(false)
	return <PageLayoutContext value={{ standalone, setStandalone }}>{children}</PageLayoutContext>
}

export function usePageLayout() {
	const context = useContext(PageLayoutContext)
	if (!context) throw new Error('Page layout requires PageLayoutProvider')
	return context
}

export function useStandalonePage(standalone: boolean) {
	const { setStandalone } = usePageLayout()
	useLayoutEffect(() => {
		setStandalone(standalone)
		return () => setStandalone(false)
	}, [standalone, setStandalone])
}
