# Styling Guide

## Tailwind CSS v4 Configuration

### Global Styles

Located in `styles/globals.css`:

```css
@import 'tailwindcss';
@plugin "tailwindcss-animate";

/* Custom fonts */
@font-face {
	font-family: 'reglisse';
	src: url('../assets/fonts/reglisse-fill.woff2') format('woff2');
	font-weight: 700;
	font-display: swap;
}

@font-face {
	font-family: 'IBM Plex Mono';
	src: url('../assets/fonts/IBMPlexMono-Regular.woff2') format('woff2');
	font-weight: 400;
	font-display: swap;
}

@theme {
	/* Typography */
	--font-sans: 'IBM Plex Mono', monospace;
	--font-heading: 'reglisse', sans-serif;

	/* Custom font family */
	--font-family-reglisse: 'reglisse', sans-serif;
	--font-family-ibm-plex-mono: 'IBM Plex Mono', monospace;
	--font-family-theylive: 'theylive', monospace;
}

/* Theme colors */
:root {
	--background: #ffffff;
	--foreground: #1a1a1a;
	--card: #ffffff;
	--card-foreground: #1a1a1a;
	--primary: #000000;
	--primary-foreground: #ffffff;
	/* ...other CSS variables */
}

.dark {
	--background: #0a0a0a;
	--foreground: #ededed;
	/* ...dark mode overrides */
}
```

## Styling Approach

### Utility-First with Tailwind

Use Tailwind utility classes exclusively. No CSS modules or styled-components:

```typescript
// Good - Utility classes
<div className="flex flex-col gap-4 p-4 border border-zinc-800 rounded-lg">
  <h2 className="text-lg font-semibold">Title</h2>
  <p className="text-sm text-zinc-600">Description</p>
</div>

// Avoid - Inline styles
<div style={{ display: 'flex', padding: '16px' }}>...</div>
```

### Class Composition

Use helper utilities for conditional classes:

```typescript
import { cn } from '@/lib/utils'

// cn() combines clsx and tailwind-merge
<button className={cn(
  "px-4 py-2 rounded-md",
  isActive && "bg-black text-white",
  isDisabled && "opacity-50 cursor-not-allowed"
)}>
  Click me
</button>
```

## Component Patterns

### shadcn/ui Components

Use shadcn/ui components from `components/ui/`:

```typescript
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'

<Card>
  <CardHeader>
    <h2>Product Title</h2>
  </CardHeader>
  <CardContent>
    <Button>Add to Cart</Button>
  </CardContent>
</Card>
```

### Component Variants (CVA)

Use `class-variance-authority` for component variants:

```typescript
import { cva, type VariantProps } from 'class-variance-authority'

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md font-medium",
  {
    variants: {
      variant: {
        default: "bg-black text-white hover:bg-zinc-800",
        outline: "border border-zinc-800 hover:bg-zinc-100",
        ghost: "hover:bg-zinc-100",
      },
      size: {
        sm: "px-3 py-1 text-sm",
        md: "px-4 py-2",
        lg: "px-6 py-3 text-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
)

interface ButtonProps extends VariantProps<typeof buttonVariants> {
  children: React.ReactNode
}

export function Button({ variant, size, children }: ButtonProps) {
  return (
    <button className={buttonVariants({ variant, size })}>
      {children}
    </button>
  )
}
```

## Common Patterns

### Layout Containers

```typescript
// Page container
<div className="container mx-auto px-4 py-8 max-w-7xl">
  {children}
</div>

// Flex layouts
<div className="flex flex-col gap-4">          // Vertical stack
<div className="flex items-center gap-2">      // Horizontal row
<div className="grid grid-cols-3 gap-4">       // Grid
```

### Cards and Borders

```typescript
<div className="border border-zinc-800 rounded-lg bg-white shadow-sm p-4">
  {/* Card content */}
</div>

// Dark mode aware
<div className="border border-zinc-800 dark:border-zinc-700 rounded-lg">
  {/* Content */}
</div>
```

### Hover Effects

```typescript
// Scale on hover
<img className="transition-transform duration-200 hover:scale-105" />

// Background change on hover
<button className="hover:bg-zinc-100 transition-colors">
  Click me
</button>

// Opacity on hover
<div className="opacity-80 hover:opacity-100 transition-opacity">
  {/* Content */}
</div>
```

### Responsive Design

```typescript
// Mobile-first responsive classes
<div className="
  flex flex-col           // Mobile: stack vertically
  md:flex-row            // Tablet: horizontal
  lg:gap-8               // Desktop: larger gap
  xl:max-w-7xl           // Extra large: max width
">
  {children}
</div>

// Responsive grid
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
  {items.map(...)}
</div>
```

### Typography

```typescript
// Headings with custom font
<h1 className="font-heading text-4xl font-bold">
  {/* Uses 'reglisse' font */}
</h1>

// Body text
<p className="font-sans text-base text-zinc-700">
  {/* Uses 'IBM Plex Mono' */}
</p>

// Sizes
<h2 className="text-2xl font-semibold">Large heading</h2>
<p className="text-sm text-zinc-600">Small text</p>
```

### Spacing

Use consistent spacing scale:

- `gap-1` = 0.25rem (4px)
- `gap-2` = 0.5rem (8px)
- `gap-4` = 1rem (16px)
- `gap-8` = 2rem (32px)

### Colors

Common color patterns:

```typescript
// Text colors
text - zinc - 900 // Primary text
text - zinc - 600 // Secondary text
text - zinc - 400 // Tertiary/disabled text

// Background colors
bg - white // Default background
bg - zinc - 50 // Light background
bg - zinc - 100 // Hover background
bg - black // Primary button

// Border colors
border - zinc - 800 // Default border
border - zinc - 300 // Light border
```

## Icon Usage

Use Lucide React for icons:

```typescript
import { ShoppingCart, User, ChevronRight } from 'lucide-react'

<Button>
  <ShoppingCart className="w-4 h-4 mr-2" />
  Add to Cart
</Button>

// Icon sizes
className="w-4 h-4"     // Small
className="w-6 h-6"     // Medium
className="w-8 h-8"     // Large
```

## Animation

Use `tailwindcss-animate` for transitions:

```typescript
// Fade in
<div className="animate-in fade-in duration-200">
  {content}
</div>

// Slide in from bottom
<div className="animate-in slide-in-from-bottom-4">
  {content}
</div>

// Custom transitions
<div className="transition-all duration-300 ease-in-out">
  {content}
</div>
```

## Theme Support

Use `next-themes` for dark mode:

```typescript
import { useTheme } from 'next-themes'

function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      Toggle theme
    </button>
  )
}

// Theme-aware classes
<div className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white">
  {content}
</div>
```

## Best Practices

1. **Use utility classes** - Don't create custom CSS unless absolutely necessary
2. **Compose with cn()** - Use the `cn()` utility for conditional classes
3. **Follow spacing scale** - Use Tailwind's spacing scale (4, 8, 16, etc.)
4. **Mobile-first** - Design for mobile, enhance for desktop
5. **Consistent borders** - Use `border-zinc-800` as default
6. **Rounded corners** - Use `rounded-lg` for cards, `rounded-md` for buttons
7. **Transitions** - Add smooth transitions for hover effects
8. **Dark mode** - Always consider dark mode variants
9. **shadcn/ui first** - Use existing shadcn components before creating new ones
10. **Semantic HTML** - Use proper HTML elements with Tailwind classes

## Component Library Reference

All UI components are in `src/components/ui/`:

- `Button` - Primary action component
- `Card` - Content container
- `Dialog` - Modal dialogs
- `Select` - Dropdown selects
- `Tabs` - Tab navigation
- `Avatar` - User avatars
- `Badge` - Status indicators
- `Tooltip` - Hover tooltips
- `Accordion` - Collapsible sections
- `Separator` - Visual dividers
- `ScrollArea` - Scrollable containers
- `Drawer` - Bottom sheet on mobile

Refer to existing components for usage examples.
