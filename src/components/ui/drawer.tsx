import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@tanstack/react-store'
import { uiActions, uiStore, type DrawerType } from '@/lib/stores/ui'

const drawerVariants = cva('fixed h-full bg-white shadow-xl transform transition-transform duration-300 ease-in-out z-50', {
	variants: {
		side: {
			right: 'top-0 right-0 w-full sm:w-96 translate-x-full data-[state=open]:translate-x-0',
			left: 'top-0 left-0 w-full sm:w-96 -translate-x-full data-[state=open]:translate-x-0',
			top: 'top-0 left-0 w-full h-96 -translate-y-full data-[state=open]:translate-y-0',
			bottom: 'bottom-0 left-0 w-full h-96 translate-y-full data-[state=open]:translate-y-0',
		},
	},
	defaultVariants: {
		side: 'right',
	},
})

const backdropVariants = cva('fixed inset-0 bg-black/50 z-40 transition-opacity duration-300', {
	variants: {
		state: {
			open: 'opacity-100',
			closed: 'opacity-0 pointer-events-none',
		},
	},
	defaultVariants: {
		state: 'closed',
	},
})

export interface DrawerProps extends VariantProps<typeof drawerVariants> {
	type: DrawerType
	children: React.ReactNode
	className?: string
}

export function Drawer({ type, children, side, className }: DrawerProps) {
	const { drawers } = useStore(uiStore)
	const isOpen = drawers[type]

	// Handle Escape key to close drawer
	React.useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && isOpen) {
				uiActions.closeDrawer(type)
			}
		}

		document.addEventListener('keydown', handleEscape)

		// Prevent body scroll when drawer is open
		if (isOpen) {
			document.body.style.overflow = 'hidden'
		} else {
			document.body.style.overflow = ''
		}

		return () => {
			document.removeEventListener('keydown', handleEscape)
			document.body.style.overflow = ''
		}
	}, [isOpen, type])

	return (
		<>
			{/* Backdrop - always rendered for smooth transitions */}
			<div
				className={cn(backdropVariants({ state: isOpen ? 'open' : 'closed' }))}
				onClick={() => uiActions.closeDrawer(type)}
				aria-hidden="true"
			/>

			{/* Drawer */}
			<div
				className={cn(drawerVariants({ side }), className)}
				data-state={isOpen ? 'open' : 'closed'}
				role="dialog"
				aria-modal="true"
				aria-labelledby={`drawer-${type}-title`}
			>
				{children}
			</div>
		</>
	)
}

// Additional drawer components for shadcn/ui compatibility
interface DrawerContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export function DrawerContent({ className, children, ...props }: DrawerContentProps) {
	return (
		<div className={cn("flex flex-col h-full", className)} {...props}>
			{children}
		</div>
	)
}

interface DrawerHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export function DrawerHeader({ className, ...props }: DrawerHeaderProps) {
	return (
		<div className={cn("flex flex-col space-y-1.5 p-4 border-b", className)} {...props} />
	)
}

interface DrawerFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

export function DrawerFooter({ className, ...props }: DrawerFooterProps) {
	return (
		<div className={cn("mt-auto", className)} {...props} />
	)
}

interface DrawerTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}

export function DrawerTitle({ className, ...props }: DrawerTitleProps) {
	return (
		<h2 className={cn("text-xl font-semibold", className)} {...props} />
	)
}

interface DrawerDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {}

export function DrawerDescription({ className, ...props }: DrawerDescriptionProps) {
	return (
		<p className={cn("text-sm text-muted-foreground", className)} {...props} />
	)
}

interface DrawerCloseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	asChild?: boolean
}

export function DrawerClose({ className, onClick, asChild, children, ...props }: DrawerCloseProps) {
	const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
		// Get the drawer type from the closest drawer element
		const drawer = (e.target as HTMLElement).closest('[role="dialog"]');
		const type = drawer?.getAttribute('aria-labelledby')?.replace('drawer-', '').replace('-title', '') as DrawerType;
		
		if (type) {
			uiActions.closeDrawer(type);
		}
		
		if (onClick) {
			onClick(e);
		}
	};

	if (asChild && React.isValidElement(children)) {
		return React.cloneElement(children as React.ReactElement<any>, {
			...props,
			className: cn(className, (children as React.ReactElement<any>).props.className),
			onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
				handleClick(e);
				if ((children as React.ReactElement<any>).props.onClick) {
					(children as React.ReactElement<any>).props.onClick(e);
				}
			},
		});
	}

	return (
		<button 
			className={cn("p-2 rounded-full hover:bg-gray-100", className)} 
			onClick={handleClick}
			aria-label="Close drawer"
			{...props}
		>
			{children || <X size={24} />}
		</button>
	);
}
