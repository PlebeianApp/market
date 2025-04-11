import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
	'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border-2 border-black box hover:translated',
	{
		variants: {
			variant: {
				primary:
					'bg-primary text-primary-foreground border-primary-border hover:bg-transparent hover:text-primary-foreground-hover hover:border-primary-border-hover active:ho',
				secondary:
					'bg-secondary text-secondary-foreground border-secondary-border hover:bg-transparent hover:text-secondary-foreground-hover hover:border-secondary-border-hover',
				tertiary:
					'bg-tertiary text-tertiary-foreground border-tertiary-border hover:bg-tertiary-hover hover:text-tertiary-foreground-hover hover:border-tertiary-border-hover',
				focus:
					'bg-focus text-focus-foreground border-focus-border hover:bg-transparent hover:text-focus-foreground-hover hover:border-focus-border-hover',
				destructive: 'bg-destructive text-destructive-foreground hover:bg-transparent hover:text-destructive-foreground',

				outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
				ghost: 'hover:border-primary-border border-none',
				link: 'text-secondary border-none underline-offset-4 hover:underline',
				none: 'border-0 p-0 text-base justify-start',
			},
			size: {
				default: 'h-10 px-4 py-2',
				sm: 'h-9 px-3',
				lg: 'h-11  px-8',
				icon: 'h-10 aspect-square',
				none: 'h-6 w-fit',
			},
		},
		defaultVariants: {
			variant: 'primary',
			size: 'default',
		},
	},
)

type IconPosition = 'left' | 'right'

function Button({
	className,
	variant,
	size,
	asChild = false,
	icon,
	iconPosition = 'left',
	children,
	...props
}: React.ComponentProps<'button'> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean
		icon?: React.ReactNode
		iconPosition?: IconPosition
	}) {
	const Comp = asChild ? Slot : 'button'

	const hasIcon = !!icon
	const buttonClasses = cn(buttonVariants({ variant, size, className }), hasIcon && 'inline-flex items-center gap-2')

	return (
		<Comp data-slot="button" className={buttonClasses} {...props}>
			{hasIcon && iconPosition === 'right' ? (
				<>
					{children}
					{icon}
				</>
			) : (
				<>
					{hasIcon && icon}
					{children}
				</>
			)}
		</Comp>
	)
}

export { Button, buttonVariants }
