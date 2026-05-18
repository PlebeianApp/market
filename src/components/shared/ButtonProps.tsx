import type { Button } from '@/components/ui/button'

/** Helper type to extract "ButtonProps" type from shadcn "Button" component */
export type ButtonProps = React.ComponentPropsWithoutRef<typeof Button>

/** Helper type to use valid string values for Button Variants */
export type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
