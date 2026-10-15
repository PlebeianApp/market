import { Media } from '@/components/Media'
import { UiProvider, type UiComponents, type UiImageProps } from '@ui/provider/UiProvider'
import type { ReactNode } from 'react'

function HostImage({ src, alt, className }: UiImageProps) {
	return <Media src={src} alt={alt} className={className} />
}

const hostComponents: Partial<UiComponents> = { Image: HostImage }

/** Platform composition: supplies the web host's primitives to UI components. */
export function WebUiProvider({ children }: { children: ReactNode }) {
	return <UiProvider components={hostComponents}>{children}</UiProvider>
}
