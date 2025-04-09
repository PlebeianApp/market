export const productKeys = {
	all: ['products'] as const,
	details: (id: string) => [...productKeys.all, id] as const,
	byPubkey: (pubkey: string) => [...productKeys.all, 'byPubkey', pubkey] as const,
} as const

export const profileKeys = {
	all: ['profiles'] as const,
	details: (p: string) => [...profileKeys.all, p] as const,
	nip05: (p: string) => [...profileKeys.all, 'nip05', p] as const,
	detailsByNip05: (nip05: string) => [...profileKeys.all, 'byNip05', nip05] as const,
} as const

export const postKeys = {
	all: ['posts'] as const,
	details: (id: string) => [...postKeys.all, id] as const,
} as const

export const userKeys = {
	all: ['users'] as const,
	details: (pubkey: string) => ['user', pubkey] as const,
} as const

export const authorKeys = {
	all: ['authors'] as const,
	details: (id: string) => [...authorKeys.all, id] as const,
} as const

export const configKeys = {
	all: ['config'] as const,
	appRelay: () => [...configKeys.all, 'appRelay'] as const,
} as const

export const appSettingsKeys = {
	all: ['appSettings'] as const,
} as const
