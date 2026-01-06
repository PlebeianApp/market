/**
 * NDK User and Profile Handling
 * 
 * Examples from: src/queries/profiles.tsx, src/components/Profile.tsx
 */

import NDK, { NDKUser, NDKUserProfile } from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'

// ============================================================
// FETCH PROFILE BY NPUB
// ============================================================

const fetchProfileByNpub = async (ndk: NDK, npub: string): Promise<NDKUserProfile | null> => {
  try {
    // Get user object from npub
    const user = ndk.getUser({ npub })
    
    // Fetch profile from relays
    const profile = await user.fetchProfile()
    
    return profile
  } catch (error) {
    console.error('Failed to fetch profile:', error)
    return null
  }
}

// ============================================================
// FETCH PROFILE BY HEX PUBKEY
// ============================================================

const fetchProfileByPubkey = async (ndk: NDK, pubkey: string): Promise<NDKUserProfile | null> => {
  try {
    const user = ndk.getUser({ hexpubkey: pubkey })
    const profile = await user.fetchProfile()
    
    return profile
  } catch (error) {
    console.error('Failed to fetch profile:', error)
    return null
  }
}

// ============================================================
// FETCH PROFILE BY NIP-05
// ============================================================

const fetchProfileByNip05 = async (ndk: NDK, nip05: string): Promise<NDKUserProfile | null> => {
  try {
    // Resolve NIP-05 identifier to user
    const user = await ndk.getUserFromNip05(nip05)
    
    if (!user) {
      console.log('User not found for NIP-05:', nip05)
      return null
    }
    
    // Fetch profile
    const profile = await user.fetchProfile()
    
    return profile
  } catch (error) {
    console.error('Failed to fetch profile by NIP-05:', error)
    return null
  }
}

// ============================================================
// FETCH PROFILE BY ANY IDENTIFIER
// ============================================================

const fetchProfileByIdentifier = async (
  ndk: NDK,
  identifier: string
): Promise<{ profile: NDKUserProfile | null; user: NDKUser | null }> => {
  try {
    // Check if it's a NIP-05 (contains @)
    if (identifier.includes('@')) {
      const user = await ndk.getUserFromNip05(identifier)
      if (!user) return { profile: null, user: null }
      
      const profile = await user.fetchProfile()
      return { profile, user }
    }
    
    // Check if it's an npub
    if (identifier.startsWith('npub')) {
      const user = ndk.getUser({ npub: identifier })
      const profile = await user.fetchProfile()
      return { profile, user }
    }
    
    // Assume it's a hex pubkey
    const user = ndk.getUser({ hexpubkey: identifier })
    const profile = await user.fetchProfile()
    return { profile, user }
  } catch (error) {
    console.error('Failed to fetch profile:', error)
    return { profile: null, user: null }
  }
}

// ============================================================
// GET CURRENT USER
// ============================================================

const getCurrentUser = async (ndk: NDK): Promise<NDKUser | null> => {
  if (!ndk.signer) {
    console.log('No signer set')
    return null
  }
  
  try {
    const user = await ndk.signer.user()
    return user
  } catch (error) {
    console.error('Failed to get current user:', error)
    return null
  }
}

// ============================================================
// PROFILE DATA STRUCTURE
// ============================================================

interface ProfileData {
  // Standard fields
  name?: string
  displayName?: string
  display_name?: string
  picture?: string
  image?: string
  banner?: string
  about?: string
  
  // Contact
  nip05?: string
  lud06?: string  // LNURL
  lud16?: string  // Lightning address
  
  // Social
  website?: string
  
  // Raw data
  [key: string]: any
}

// ============================================================
// EXTRACT PROFILE INFO
// ============================================================

const extractProfileInfo = (profile: NDKUserProfile | null) => {
  if (!profile) {
    return {
      displayName: 'Anonymous',
      avatar: null,
      bio: null,
      lightningAddress: null,
      nip05: null
    }
  }
  
  return {
    displayName: profile.displayName || profile.display_name || profile.name || 'Anonymous',
    avatar: profile.picture || profile.image || null,
    banner: profile.banner || null,
    bio: profile.about || null,
    lightningAddress: profile.lud16 || profile.lud06 || null,
    nip05: profile.nip05 || null,
    website: profile.website || null
  }
}

// ============================================================
// UPDATE PROFILE
// ============================================================

import { NDKEvent } from '@nostr-dev-kit/ndk'

const updateProfile = async (ndk: NDK, profileData: Partial<ProfileData>) => {
  if (!ndk.signer) {
    throw new Error('No signer available')
  }
  
  // Get current profile
  const currentUser = await ndk.signer.user()
  const currentProfile = await currentUser.fetchProfile()
  
  // Merge with new data
  const updatedProfile = {
    ...currentProfile,
    ...profileData
  }
  
  // Create kind 0 (metadata) event
  const event = new NDKEvent(ndk)
  event.kind = 0
  event.content = JSON.stringify(updatedProfile)
  event.tags = []
  
  await event.sign()
  await event.publish()
  
  console.log('✅ Profile updated')
  return event.id
}

// ============================================================
// BATCH FETCH PROFILES
// ============================================================

const fetchMultipleProfiles = async (
  ndk: NDK,
  pubkeys: string[]
): Promise<Map<string, NDKUserProfile | null>> => {
  const profiles = new Map<string, NDKUserProfile | null>()
  
  // Fetch all profiles in parallel
  await Promise.all(
    pubkeys.map(async (pubkey) => {
      try {
        const user = ndk.getUser({ hexpubkey: pubkey })
        const profile = await user.fetchProfile()
        profiles.set(pubkey, profile)
      } catch (error) {
        console.error(`Failed to fetch profile for ${pubkey}:`, error)
        profiles.set(pubkey, null)
      }
    })
  )
  
  return profiles
}

// ============================================================
// CONVERT BETWEEN FORMATS
// ============================================================

const convertPubkeyFormats = (identifier: string) => {
  try {
    // If it's npub, convert to hex
    if (identifier.startsWith('npub')) {
      const decoded = nip19.decode(identifier)
      if (decoded.type === 'npub') {
        return {
          hex: decoded.data as string,
          npub: identifier
        }
      }
    }
    
    // If it's hex, convert to npub
    if (/^[0-9a-f]{64}$/.test(identifier)) {
      return {
        hex: identifier,
        npub: nip19.npubEncode(identifier)
      }
    }
    
    throw new Error('Invalid pubkey format')
  } catch (error) {
    console.error('Format conversion failed:', error)
    return null
  }
}

// ============================================================
// REACT HOOK FOR PROFILE
// ============================================================

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

function useProfile(ndk: NDK | null, npub: string | undefined) {
  return useQuery({
    queryKey: ['profile', npub],
    queryFn: async () => {
      if (!ndk || !npub) throw new Error('NDK or npub missing')
      return await fetchProfileByNpub(ndk, npub)
    },
    enabled: !!ndk && !!npub,
    staleTime: 5 * 60 * 1000,  // 5 minutes
    cacheTime: 30 * 60 * 1000  // 30 minutes
  })
}

// ============================================================
// REACT COMPONENT EXAMPLE
// ============================================================

interface ProfileDisplayProps {
  ndk: NDK
  pubkey: string
}

function ProfileDisplay({ ndk, pubkey }: ProfileDisplayProps) {
  const [profile, setProfile] = useState<NDKUserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    const loadProfile = async () => {
      setLoading(true)
      try {
        const user = ndk.getUser({ hexpubkey: pubkey })
        const fetchedProfile = await user.fetchProfile()
        setProfile(fetchedProfile)
      } catch (error) {
        console.error('Failed to load profile:', error)
      } finally {
        setLoading(false)
      }
    }
    
    loadProfile()
  }, [ndk, pubkey])
  
  if (loading) {
    return <div>Loading profile...</div>
  }
  
  const info = extractProfileInfo(profile)
  
  return (
    <div className="profile">
      {info.avatar && <img src={info.avatar} alt={info.displayName} />}
      <h2>{info.displayName}</h2>
      {info.bio && <p>{info.bio}</p>}
      {info.nip05 && <span>✓ {info.nip05}</span>}
      {info.lightningAddress && <span>⚡ {info.lightningAddress}</span>}
    </div>
  )
}

// ============================================================
// FOLLOW/UNFOLLOW USER
// ============================================================

const followUser = async (ndk: NDK, pubkeyToFollow: string) => {
  if (!ndk.signer) {
    throw new Error('No signer available')
  }
  
  // Fetch current contact list (kind 3)
  const currentUser = await ndk.signer.user()
  const contactListFilter = {
    kinds: [3],
    authors: [currentUser.pubkey]
  }
  
  const existingEvents = await ndk.fetchEvents(contactListFilter)
  const existingContactList = existingEvents.size > 0
    ? Array.from(existingEvents)[0]
    : null
  
  // Get existing p tags
  const existingPTags = existingContactList
    ? existingContactList.tags.filter(tag => tag[0] === 'p')
    : []
  
  // Check if already following
  const alreadyFollowing = existingPTags.some(tag => tag[1] === pubkeyToFollow)
  if (alreadyFollowing) {
    console.log('Already following this user')
    return
  }
  
  // Create new contact list with added user
  const event = new NDKEvent(ndk)
  event.kind = 3
  event.content = existingContactList?.content || ''
  event.tags = [
    ...existingPTags,
    ['p', pubkeyToFollow]
  ]
  
  await event.sign()
  await event.publish()
  
  console.log('✅ Now following user')
}

// ============================================================
// USAGE EXAMPLE
// ============================================================

async function profileExample(ndk: NDK) {
  // Fetch by different identifiers
  const profile1 = await fetchProfileByNpub(ndk, 'npub1...')
  const profile2 = await fetchProfileByNip05(ndk, 'user@domain.com')
  const profile3 = await fetchProfileByPubkey(ndk, 'hex pubkey...')
  
  // Extract display info
  const info = extractProfileInfo(profile1)
  console.log('Display name:', info.displayName)
  console.log('Avatar:', info.avatar)
  
  // Update own profile
  await updateProfile(ndk, {
    name: 'My Name',
    about: 'My bio',
    picture: 'https://example.com/avatar.jpg',
    lud16: 'me@getalby.com'
  })
  
  // Follow someone
  await followUser(ndk, 'pubkey to follow')
}

export {
  fetchProfileByNpub,
  fetchProfileByPubkey,
  fetchProfileByNip05,
  fetchProfileByIdentifier,
  getCurrentUser,
  extractProfileInfo,
  updateProfile,
  fetchMultipleProfiles,
  convertPubkeyFormats,
  useProfile,
  followUser
}

