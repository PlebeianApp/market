import type { AppSettings } from '../schemas/app'

interface AppConfig {
	appRelay: string
	appSettings: AppSettings | null
	appPublicKey: string
	needsSetup: boolean
}

class AppService {
	private static instance: AppService
	private config: AppConfig | null = null

	private constructor() {}

	public static getInstance(): AppService {
		if (!AppService.instance) {
			AppService.instance = new AppService()
		}
		return AppService.instance
	}

	public async initialize(): Promise<void> {
		const response = await fetch('/api/config')
		if (!response.ok) {
			throw new Error('Failed to fetch app config')
		}
		this.config = await response.json()
	}

	public getConfig(): AppConfig | null {
		return this.config
	}

	public isInitialized(): boolean {
		return this.config !== null
	}
}

export const appService = AppService.getInstance()
