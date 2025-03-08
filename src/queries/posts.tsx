import { NDKEvent } from "@nostr-dev-kit/ndk";
import type { NDKFilter } from "@nostr-dev-kit/ndk";
import { nostrService } from "@/lib/nostr";
import { postKeys } from "./queryKeyFactory";
import { queryOptions } from "@tanstack/react-query";

export type NostrPost = {
  id: string;
  content: string;
  author: string;
  createdAt: number;
};

const transformEvent = (event: NDKEvent): NostrPost => ({
  id: event.id,
  content: event.content,
  author: event.pubkey,
  createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
});

export const fetchPosts = async () => {
  // Wait for connection if not already connected
  if (!nostrService.isConnected) {
    await nostrService.connect();
  }

  const filter: NDKFilter = {
    kinds: [1], // kind 1 is text notes
    limit: 20,
  };

  const events = await nostrService.ndkInstance.fetchEvents(filter);
  const posts = Array.from(events).map(transformEvent);
  
  // Sort by newest first
  return posts.sort((a, b) => b.createdAt - a.createdAt);
}; 

export const fetchPost = async (id: string) => {
  // Wait for connection if not already connected
  if (!nostrService.isConnected) {
    await nostrService.connect();
  }

  const event = await nostrService.ndkInstance.fetchEvent(id);
  if (!event) {
    throw new Error("Post not found");
  }
  return transformEvent(event);
};

export const postQueryOptions = (id: string) => queryOptions({
  queryKey: postKeys.details(id),
  queryFn: () => fetchPost(id),
})

export const postsQueryOptions = queryOptions({
  queryKey: postKeys.all,
  queryFn: fetchPosts,
})