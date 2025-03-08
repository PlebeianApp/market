export const productKeys = {
    all: ['products'] as const,
    details: (id: string) => [...productKeys.all, id] as const,
}

export const postKeys = {
    all: ['posts'] as const,
    details: (id: string) => [...postKeys.all, id] as const,
}

export const userKeys = {
	all: ['users'] as const,
	details: (pubkey: string) => ['user', pubkey] as const,
} as const

export const authorKeys = {
    all: ['authors'] as const,
    details: (pubkey: string) => [...authorKeys.all, pubkey] as const,
} as const