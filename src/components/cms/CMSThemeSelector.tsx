// src/components/cms/CMSThemeSelector.tsx
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Palette } from 'lucide-react'
import { cn } from '@/lib/utils'
import { THEMES } from '@/lib/utils/theme'

interface CMSThemeSelectorProps {
	initialTheme?: string
	onThemeChange?: (themeId: string) => void
	className?: string
}

export function CMSThemeSelector({ initialTheme = 'default', onThemeChange, className = '' }: CMSThemeSelectorProps) {
	const [currentTheme, setCurrentTheme] = useState<string>(initialTheme)

	const handleThemeChange = (themeId: string) => {
		setCurrentTheme(themeId)
		// Notify parent of theme change
		if (onThemeChange) {
			onThemeChange(themeId)
		}
	}

	return (
		<div className={className}>
			<Popover>
				<PopoverTrigger asChild>
					<Button variant="outline" size="sm" className="gap-2">
						<Palette className="h-4 w-4" />
						<span>Theme</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-80 p-0" align="start">
					<div className="p-4">
						<h3 className="font-medium text-lg mb-3">Select Theme</h3>
						<div className="grid grid-cols-1 gap-2 max-h-96 overflow-y-auto">
							{THEMES.map((theme) => (
								<button
									key={theme.id}
									className={cn(
										'flex items-center gap-3 w-full p-3 rounded-lg text-left transition-colors hover:bg-accent',
										currentTheme === theme.id && 'bg-accent',
									)}
									onClick={() => handleThemeChange(theme.id)}
								>
									<div className="flex gap-1">
										<div className="w-4 h-4 rounded-full border" style={{ backgroundColor: theme.previewColors.background }} />
										<div className="w-4 h-4 rounded-full border" style={{ backgroundColor: theme.previewColors.primary }} />
										<div className="w-4 h-4 rounded-full border" style={{ backgroundColor: theme.previewColors.secondary }} />
										<div className="w-4 h-4 rounded-full border" style={{ backgroundColor: theme.previewColors.accent }} />
									</div>
									<div>
										<div className="font-medium">{theme.name}</div>
										<div className="text-xs text-muted-foreground">{theme.description}</div>
									</div>
								</button>
							))}
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	)
}
