import type { ProductCollectionSchema } from "@/lib/schemas/productCollection";
import { faker } from "@faker-js/faker";
import NDK, { NDKEvent, type NDKPrivateKeySigner, type NDKTag } from "@nostr-dev-kit/ndk";
import type { z } from "zod";

export function createProductReference(pubkey: string, productId: string): string {
    return `30402:${pubkey}:${productId}`;
  }
  
  export function generateCollectionData(productRefs: string[]): Omit<z.infer<typeof ProductCollectionSchema>, 'tags'> & { tags: NDKTag[] } {
    const collectionId = faker.string.alphanumeric(10);
    
    // Get random product references (between 1 and 5 products per collection)
    const selectedProducts = faker.helpers.arrayElements(
      productRefs,
      faker.number.int({ min: 1, max: Math.min(5, productRefs.length) })
    );
  
    return {
      kind: 30405,
      created_at: Math.floor(Date.now() / 1000),
      content: faker.commerce.productDescription(),
      tags: [
        ["d", collectionId],
        ["title", faker.commerce.department()],
        // Add product references
        ...selectedProducts.map(ref => ["a", ref]),
        // Optional tags
        ["image", faker.image.url()],
        ["summary", faker.commerce.productDescription()],
        ["location", faker.location.city()],
        ["g", faker.string.alphanumeric(8).toLowerCase()]
      ] as NDKTag[]
    };
  }
  
  export async function createCollectionEvent(signer: NDKPrivateKeySigner, ndk: NDK, collectionData: ReturnType<typeof generateCollectionData>) {
    const event = new NDKEvent(ndk);
    event.kind = collectionData.kind;
    event.content = collectionData.content;
    event.tags = collectionData.tags;
    event.created_at = collectionData.created_at;
  
    try {
      await event.sign(signer);
      await event.publish();
      console.log(`Published collection: ${collectionData.tags.find(tag => tag[0] === "title")?.[1]}`);
      return true;
    } catch (error) {
      console.error(`Failed to publish collection`, error);
      return false;
    }
  }
  