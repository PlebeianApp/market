export interface Theme {
	id: string
	name: string
	description: string
	previewColors: {
		background: string
		primary: string
		secondary: string
		accent: string
	}
}

// Theme definitions with descriptions and preview colors
export const THEMES: Theme[] = [
	{
		id: 'default',
		name: 'Default',
		description: 'The standard theme for the application',
		previewColors: {
			background: '#ffffff',
			primary: '#3b82f6',
			secondary: '#64748b',
			accent: '#10b981',
		},
	},
	{
		id: 'amethyst-haze',
		name: 'Amethyst Haze',
		description: 'A purple-themed elegant design',
		previewColors: {
			background: '#f8f9fa',
			primary: '#8b5cf6',
			secondary: '#a78bfa',
			accent: '#c084fc',
		},
	},
	{
		id: 'caffeine',
		name: 'Caffeine',
		description: 'Coffee-inspired warm tones',
		previewColors: {
			background: '#f5f5f4',
			primary: '#a16207',
			secondary: '#d97706',
			accent: '#f59e0b',
		},
	},
	{
		id: 'celestial',
		name: 'Celestial',
		description: 'Night sky themed with deep blues',
		previewColors: {
			background: '#0f172a',
			primary: '#38bdf8',
			secondary: '#0ea5e9',
			accent: '#7dd3fc',
		},
	},
	{
		id: 'claymorphism',
		name: 'Claymorphism',
		description: 'Soft clay-like UI elements',
		previewColors: {
			background: '#f3e8ff',
			primary: '#c084fc',
			secondary: '#d8b4fe',
			accent: '#e9d5ff',
		},
	},
	{
		id: 'darkmatter',
		name: 'Dark Matter',
		description: 'Deep space dark theme',
		previewColors: {
			background: '#020617',
			primary: '#8b5cf6',
			secondary: '#7c3aed',
			accent: '#6d28d9',
		},
	},
	{
		id: 'de-swiss-design',
		name: 'De Swiss Design',
		description: 'Clean Swiss design principles',
		previewColors: {
			background: '#f8fafc',
			primary: '#0f172a',
			secondary: '#64748b',
			accent: '#94a3b8',
		},
	},
	{
		id: 'elegant-luxury',
		name: 'Elegant Luxury',
		description: 'Premium golden accents',
		previewColors: {
			background: '#fdf2f8',
			primary: '#be185d',
			secondary: '#db2777',
			accent: '#ec4899',
		},
	},
	{
		id: 'modern-minimal',
		name: 'Modern Minimal',
		description: 'Simple clean design',
		previewColors: {
			background: '#f1f5f9',
			primary: '#0ea5e9',
			secondary: '#0284c7',
			accent: '#0ea5e9',
		},
	},
	{
		id: 'retro-arcade',
		name: 'Retro Arcade',
		description: '80s arcade machine vibes',
		previewColors: {
			background: '#000435',
			primary: '#ff003c',
			secondary: '#00f0ff',
			accent: '#ffde00',
		},
	},
	{
		id: 'starry-night',
		name: 'Starry Night',
		description: 'Van Gogh inspired theme',
		previewColors: {
			background: '#0c2d48',
			primary: '#2e86de',
			secondary: '#14a7c2',
			accent: '#f1c40f',
		},
	},
	{
		id: 'twitter',
		name: 'Twitter',
		description: 'Twitter-inspired blue theme',
		previewColors: {
			background: '#f7f9f9',
			primary: '#1d9bf0',
			secondary: '#8ecdf8',
			accent: '#1d9bf0',
		},
	},
]

// Function to apply theme locally to a component by fetching CSS from public/themes
export const applyLocalTheme = async (element: HTMLElement, themeId: string): Promise<void> => {
	const elementId = element.id
	if (!element.id) {
		element.id = elementId
	}

	const oldStyleId = `${elementId}-dark-theme`
	const oldStyleElement = document.getElementById(oldStyleId)
	if (oldStyleElement) {
		oldStyleElement.remove()
	}

	// Remove the .dark class if it exists
	if (element.classList.contains('dark')) {
		element.classList.remove('dark')
	}

	// Clear existing theme variables
	const existingVars = Array.from(element.style)
		.filter((prop) => prop.startsWith('--'))
		.forEach((prop) => element.style.removeProperty(prop))

	// Clear any existing theme styles
	element.style.cssText = ''

	// Apply the new theme if it's not default
	if (themeId !== 'default') {
		try {
			// Fetch the CSS file content from public/themes directory
			const response = await fetch(`/themes/${themeId}.css`)

			if (!response.ok) {
				if (response.status === 404) {
					console.warn(`Theme file not found: /themes/${themeId}.css`)
				} else {
					console.warn(`Failed to fetch theme CSS: ${response.status} ${response.statusText}`)
				}
				// Fallback to predefined variables
				applyFallbackVariables(element, themeId)
				return
			}

			const cssContent = await response.text()
			const variables = extractCssVariables(cssContent)
			const darkVariables = extractDarkCssVariables(cssContent)

			// Apply root variables to the element
			Object.entries(variables).forEach(([key, value]) => {
				element.style.setProperty(key, value)
			})

			// Apply dark variables to a .dark class on the element
			if (Object.keys(darkVariables).length > 0) {
				// Create or update the dark class styles
				applyDarkClassStyles(element, darkVariables)
			}
		} catch (error) {
			console.warn(`Network error loading theme: ${themeId}`, error)
			// Fallback to predefined variables
			applyFallbackVariables(element, themeId)
		}
	}
}

// Function to extract CSS variables from a CSS file content (:root section)
export const extractCssVariables = (cssContent: string): Record<string, string> => {
	const variables: Record<string, string> = {}

	// Match :root variables
	const rootRegex = /:root\s*{([^}]+)}/g
	let rootMatch
	while ((rootMatch = rootRegex.exec(cssContent)) !== null) {
		const rootContent = rootMatch[1]
		const variableRegex = /--([\w-]+):\s*([^;]+);/g
		let variableMatch
		while ((variableMatch = variableRegex.exec(rootContent)) !== null) {
			variables[`--${variableMatch[1]}`] = variableMatch[2].trim()
		}
	}

	// Also match variables defined outside :root blocks (like inline)
	const inlineVariableRegex = /--([\w-]+):\s*([^;]+);/g
	let inlineMatch
	while ((inlineMatch = inlineVariableRegex.exec(cssContent)) !== null) {
		// Only add if not already defined from :root (to preserve specificity)
		if (!variables[`--${inlineMatch[1]}`]) {
			variables[`--${inlineMatch[1]}`] = inlineMatch[2].trim()
		}
	}

	return variables
}

// Function to extract dark class CSS variables from a CSS file content (.dark section)
export const extractDarkCssVariables = (cssContent: string): Record<string, string> => {
	const variables: Record<string, string> = {}

	// Match .dark class variables
	const darkRegex = /\.dark\s*{([^}]+)}/g
	let darkMatch
	while ((darkMatch = darkRegex.exec(cssContent)) !== null) {
		const darkContent = darkMatch[1]
		const variableRegex = /--([\w-]+):\s*([^;]+);/g
		let variableMatch
		while ((variableMatch = variableRegex.exec(darkContent)) !== null) {
			variables[`--${variableMatch[1]}`] = variableMatch[2].trim()
		}
	}

	// Also match variables in dark variant selectors like &:is(.dark *)
	const darkVariantRegex = /&:is\(\.dark \*\)\s*{([^}]+)}/g
	let darkVariantMatch
	while ((darkVariantMatch = darkVariantRegex.exec(cssContent)) !== null) {
		const darkContent = darkVariantMatch[1]
		const variableRegex = /--([\w-]+):\s*([^;]+);/g
		let variableMatch
		while ((variableMatch = variableRegex.exec(darkContent)) !== null) {
			variables[`--${variableMatch[1]}`] = variableMatch[2].trim()
		}
	}

	return variables
}

// Apply dark class styles to the element
const applyDarkClassStyles = (element: HTMLElement, darkVariables: Record<string, string>): void => {
	// Generate a unique class name for this element
	const elementId = element.id || `theme-${Math.random().toString(36).substr(2, 9)}`
	if (!element.id) {
		element.id = elementId
	}

	// Create or update the style element for dark class
	let styleElement = document.getElementById(`${elementId}-dark-theme`)
	if (!styleElement) {
		styleElement = document.createElement('style')
		styleElement.id = `${elementId}-dark-theme`
		document.head.appendChild(styleElement)
	}

	// Generate CSS for the dark class scoped to this element
	let cssContent = `#${elementId}.dark {\n`
	Object.entries(darkVariables).forEach(([key, value]) => {
		cssContent += `  ${key}: ${value};\n`
	})
	cssContent += '}\n'

	// Also add descendant selector for when dark class is applied to descendants
	cssContent += `#${elementId} .dark {\n`
	Object.entries(darkVariables).forEach(([key, value]) => {
		cssContent += `  ${key}: ${value};\n`
	})
	cssContent += '}\n'

	styleElement.textContent = cssContent
}

// Apply fallback CSS variables when theme loading fails
const applyFallbackVariables = (element: HTMLElement, themeId: string): void => {
	const fallbackVariables = getFallbackCssVariables(themeId)
	if (fallbackVariables) {
		Object.entries(fallbackVariables).forEach(([key, value]) => {
			element.style.setProperty(key, value)
		})
	}
}

// Fallback CSS variables for themes (simplified version)
const getFallbackCssVariables = (themeId: string): Record<string, string> | null => {
	const themeMap: Record<string, Record<string, string>> = {
		'amethyst-haze': {
			'--background': '#fafafa',
			'--foreground': '#5d5d5d',
			'--primary': '#8b5cf6',
			'--primary-foreground': '#ffffff',
			'--secondary': '#a78bfa',
			'--secondary-foreground': '#ffffff',
			'--accent': '#c084fc',
			'--accent-foreground': '#ffffff',
		},
		caffeine: {
			'--background': '#fcf8f0',
			'--foreground': '#3d2c18',
			'--primary': '#a16207',
			'--primary-foreground': '#ffffff',
			'--secondary': '#d97706',
			'--secondary-foreground': '#ffffff',
			'--accent': '#f59e0b',
			'--accent-foreground': '#ffffff',
		},
		celestial: {
			'--background': '#0f172a',
			'--foreground': '#e2e8f0',
			'--primary': '#38bdf8',
			'--primary-foreground': '#0f172a',
			'--secondary': '#0ea5e9',
			'--secondary-foreground': '#0f172a',
			'--accent': '#7dd3fc',
			'--accent-foreground': '#0f172a',
		},
		claymorphism: {
			'--background': '#f0f4f8',
			'--foreground': '#1f2937',
			'--primary': '#6366f1',
			'--primary-foreground': '#ffffff',
			'--secondary': '#d1d5db',
			'--secondary-foreground': '#1f2937',
			'--accent': '#fbcfe8',
			'--accent-foreground': '#1f2937',
		},
		darkmatter: {
			'--background': '#020617',
			'--foreground': '#f1f5f9',
			'--primary': '#8b5cf6',
			'--primary-foreground': '#020617',
			'--secondary': '#3b82f6',
			'--secondary-foreground': '#020617',
			'--accent': '#6d28d9',
			'--accent-foreground': '#f1f5f9',
		},
		'de-swiss-design': {
			'--background': '#ffffff',
			'--foreground': '#000000',
			'--primary': '#ef4444',
			'--primary-foreground': '#ffffff',
			'--secondary': '#000000',
			'--secondary-foreground': '#ffffff',
			'--accent': '#fde047',
			'--accent-foreground': '#000000',
		},
		'elegant-luxury': {
			'--background': '#fdf2f8',
			'--foreground': '#1a1a1a',
			'--primary': '#be185d',
			'--primary-foreground': '#ffffff',
			'--secondary': '#db2777',
			'--secondary-foreground': '#ffffff',
			'--accent': '#ec4899',
			'--accent-foreground': '#ffffff',
		},
		'modern-minimal': {
			'--background': '#ffffff',
			'--foreground': '#374151',
			'--primary': '#3b82f6',
			'--primary-foreground': '#ffffff',
			'--secondary': '#e2e8f0',
			'--secondary-foreground': '#374151',
			'--accent': '#93c5fd',
			'--accent-foreground': '#374151',
		},
		'retro-arcade': {
			'--background': '#f0f9ff',
			'--foreground': '#0c4a6e',
			'--primary': '#ef4444',
			'--primary-foreground': '#ffffff',
			'--secondary': '#0ea5e9',
			'--secondary-foreground': '#ffffff',
			'--accent': '#f59e0b',
			'--accent-foreground': '#ffffff',
		},
		'starry-night': {
			'--background': '#0c2d48',
			'--foreground': '#e0f2fe',
			'--primary': '#2563eb',
			'--primary-foreground': '#ffffff',
			'--secondary': '#f59e0b',
			'--secondary-foreground': '#0c2d48',
			'--accent': '#10b981',
			'--accent-foreground': '#ffffff',
		},
		twitter: {
			'--background': '#ffffff',
			'--foreground': '#0f172a',
			'--primary': '#3b82f6',
			'--primary-foreground': '#ffffff',
			'--secondary': '#1e293b',
			'--secondary-foreground': '#ffffff',
			'--accent': '#dbeafe',
			'--accent-foreground': '#3b82f6',
		},
	}

	return themeMap[themeId] || null
}

// Function to get theme by ID
export const getThemeById = (themeId: string): Theme | undefined => {
	return THEMES.find((theme) => theme.id === themeId)
}

// Storage functions (for global theme preference if needed)
export const saveThemePreference = (themeId: string): void => {
	localStorage.setItem('preferred-theme', themeId)
}

export const loadThemePreference = (): string => {
	return localStorage.getItem('preferred-theme') || 'default'
}
