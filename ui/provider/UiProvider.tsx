import { createContext, useContext, useMemo, type ComponentType, type CSSProperties, type MouseEvent, type ReactNode } from 'react'

export interface UiImageProps {
	src: string
	alt: string
	className?: string
}

export interface UiLinkProps {
	/** In-app path or absolute URL; the host decides how to navigate. */
	href: string
	className?: string
	onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
	children: ReactNode
}

/** Host-replaceable primitives; components fall back to these when no per-call render prop is given. */
export interface UiComponents {
	Image: ComponentType<UiImageProps>
	Link: ComponentType<UiLinkProps>
}

export const UI_THEME_TOKENS = [
	'background',
	'foreground',
	'card',
	'card-foreground',
	'primary',
	'primary-foreground',
	'secondary',
	'secondary-foreground',
	'muted',
	'muted-foreground',
	'accent',
	'accent-foreground',
	'destructive',
	'border',
	'ring',
	'radius',
] as const

export type UiThemeToken = (typeof UI_THEME_TOKENS)[number]
export type UiTheme = Partial<Record<UiThemeToken, string>>

function DefaultImage({ src, alt, className }: UiImageProps) {
	return <img src={src} alt={alt} loading="lazy" className={className} />
}

function DefaultLink({ href, className, onClick, children }: UiLinkProps) {
	return (
		<a href={href} className={className} onClick={onClick}>
			{children}
		</a>
	)
}

const defaultComponents: UiComponents = { Image: DefaultImage, Link: DefaultLink }

const UiComponentsContext = createContext<UiComponents>(defaultComponents)

export function themeToStyle(theme: UiTheme): CSSProperties {
	const style: Record<string, string> = {}
	for (const token of UI_THEME_TOKENS) {
		const value = theme[token]
		if (value) style[`--${token}`] = value
	}
	return style as CSSProperties
}

export interface UiProviderProps {
	components?: Partial<UiComponents>
	theme?: UiTheme
	children: ReactNode
}

/** Theme overrides apply as CSS variables to the subtree; `display: contents` keeps layout unchanged. */
export function UiProvider({ components, theme, children }: UiProviderProps) {
	const parent = useContext(UiComponentsContext)
	const value = useMemo(() => ({ ...parent, ...components }), [parent, components])
	const style = theme ? themeToStyle(theme) : null

	return (
		<UiComponentsContext.Provider value={value}>
			{style && Object.keys(style).length > 0 ? (
				<div data-slot="ui-theme" style={{ display: 'contents', ...style }}>
					{children}
				</div>
			) : (
				children
			)}
		</UiComponentsContext.Provider>
	)
}

export function useUiComponents(): UiComponents {
	return useContext(UiComponentsContext)
}

export function UiImage(props: UiImageProps) {
	const { Image } = useUiComponents()
	return <Image {...props} />
}

export function UiLink(props: UiLinkProps) {
	const { Link } = useUiComponents()
	return <Link {...props} />
}
