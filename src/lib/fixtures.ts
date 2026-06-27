import { generateTestKeyPair } from './test-keys'

const devUser1 = generateTestKeyPair('devUser1')
const devUser2 = generateTestKeyPair('devUser2')
const devUser3 = generateTestKeyPair('devUser3')
const devUser4 = generateTestKeyPair('devUser4')
const devUser5 = generateTestKeyPair('devUser5')

export { devUser1, devUser2, devUser3, devUser4, devUser5 }

export const XPUB = 'xpub6CK51df37SEz9q2EztLtHX6mE1NoAGBAKaQamafguE2vPq6pBuW5i9KVeb1SeJuhTsgD4ED8L8y66ocN68WEVc7BHYxHU6dmxHVJBHPLkYa'
export const WALLETED_USER_LUD16 = 'plebeianuser@coinos.io'
