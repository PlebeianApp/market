import { NDKEvent } from "@nostr-dev-kit/ndk";
import type { NDKFilter } from "@nostr-dev-kit/ndk";
import { nostrService } from "@/lib/nostr";
import { authorKeys } from "./queryKeyFactory";
import { queryOptions } from "@tanstack/react-query";

export type NostrAuthor = {
  id: string;
  name?: string;
  about?: string;
  picture?: string;
  nip05?: string;
};

const transformEvent = (event: NDKEvent): NostrAuthor => ({
  id: event.pubkey,
  name: event.tags.find(t => t[0] === "name")?.[1] || JSON.parse(event.content)?.name,
  about: JSON.parse(event.content)?.about,
  picture: JSON.parse(event.content)?.picture,
  nip05: JSON.parse(event.content)?.nip05,
});

export const fetchAuthor = async (pubkey: string) => {
  // Wait for connection if not already connected
  if (!nostrService.isConnected) {
    await nostrService.connect();
  }

  const filter: NDKFilter = {
    kinds: [0], // kind 0 is metadata
    authors: [pubkey],
  };

  const events = await nostrService.ndkInstance.fetchEvents(filter);
  const eventArray = Array.from(events);
  
  if (eventArray.length === 0) {
    throw new Error("Author not found");
  }
  
  // Get the most recent metadata event
  const latestEvent = eventArray.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
  return transformEvent(latestEvent);
};

export const authorQueryOptions = (pubkey: string) => queryOptions({
  queryKey: authorKeys.details(pubkey),
  queryFn: () => fetchAuthor(pubkey),
});
