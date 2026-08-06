import { createContext, useContext, useEffect, useRef, useState, type HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

/**
 * Context that provides the portal container element and the theme class
 * name for subtree-aware theme migration.
 *
 * Portalled content (dialogs, popovers, tooltips) renders to `document.body`
 * by default, which is outside the `.theme-new` DOM scope. To fix this,
 * `ThemeMigrationWrapper` mounts a hidden container element carrying the
 * `theme-new` class. Portalled components should point their Radix `Portal`
 * `container` prop at this element (via `useThemePortal()`) so portalled
 * content inherits the scoped CSS custom properties automatically.
 */
interface ThemeMigrationContextValue {
	/** The theme class name applied to the wrapper and portal container. */
	className: string
	/** A DOM element (inside document.body) carrying the theme class, suitable as a Radix Portal container. */
	portalContainer: HTMLElement | null
}

const ThemeMigrationContext = createContext<ThemeMigrationContextValue | null>(null)

/**
 * Returns the theme migration context when inside a `ThemeMigrationWrapper`,
 * or `null` when outside. Use this to access the theme class name and the
 * portal container for portalled content.
 */
export function useThemeMigration(): ThemeMigrationContextValue | null {
	return useContext(ThemeMigrationContext)
}

/**
 * Returns a DOM element suitable as a Radix `Portal` `container` prop,
 * or `undefined` when not inside a `ThemeMigrationWrapper`. When inside a
 * migrated subtree, the returned element carries the `theme-new` class so
 * portalled content inherits scoped tokens automatically.
 *
 * @example
 * const portalContainer = useThemePortal()
 * <DialogPortal container={portalContainer}>
 */
export function useThemePortal(): HTMLElement | undefined {
	return useContext(ThemeMigrationContext)?.portalContainer ?? undefined
}

/**
 * ThemeMigrationWrapper — opts a subtree into the `.theme-new` token scope.
 *
 * Wrapping a subtree in this component applies the `theme-new` CSS class,
 * which redefines all design tokens (colors, fonts, radii) for that subtree
 * only. This enables slice-by-slice migration: migrated UI uses the new
 * token system while unmigrated UI continues using the legacy `:root` tokens
 * from `globals.css`. Both can coexist on the same page without conflict.
 *
 * Usage:
 *   <ThemeMigrationWrapper>{children}</ThemeMigrationWrapper>
 *
 * The wrapper renders a plain `<div>` with the `theme-new` class. When the
 * entire app is migrated, the wrapper can be moved to the root layout and the
 * legacy `:root` token block removed from `globals.css`.
 *
 * ## Portal handling
 *
 * Radix UI portals (used by Shadcn dialogs, popovers, tooltips) render their
 * content to `document.body` by default, which is **outside** the
 * `.theme-new` DOM scope. To fix this, `ThemeMigrationWrapper` creates a
 * hidden container element appended to `document.body` that carries the
 * `theme-new` class. Portalled components should use `useThemePortal()` to
 * get this container and pass it to their Radix `Portal`'s `container` prop:
 *
 * ```tsx
 * const portalContainer = useThemePortal()
 * <DialogPortal container={portalContainer}>
 * ```
 *
 * This automatically scopes portalled content to the new token system. When
 * the entire app is eventually wrapped, the portal container becomes
 * redundant because all content — portalled or not — will be inside the
 * global `.theme-new` scope.
 *
 * @see docs/adr/ADR-0007-component-ui-migration-and-widget-book.md §1a, §2b
 */
export function ThemeMigrationWrapper({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
	const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)

	useEffect(() => {
		const container = document.createElement('div')
		container.className = 'theme-new'
		container.setAttribute('data-theme-portal-host', '')
		container.style.position = 'absolute'
		container.style.width = '0'
		container.style.height = '0'
		container.style.overflow = 'hidden'
		document.body.appendChild(container)
		setPortalContainer(container)

		return () => {
			document.body.removeChild(container)
		}
	}, [])

	return (
		<ThemeMigrationContext.Provider value={{ className: 'theme-new', portalContainer }}>
			<div className={cn('theme-new', className)} {...props}>
				{children}
			</div>
		</ThemeMigrationContext.Provider>
	)
}
