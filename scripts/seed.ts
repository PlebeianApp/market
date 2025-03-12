// seed.ts
import { NostrService } from '@/lib/nostr';
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { config } from 'dotenv';
import { createCollectionEvent, createProductReference, generateCollectionData } from './gen_collections';
import { createProductEvent, generateProductData } from './gen_products';
import { createShippingEvent, generateShippingData } from './gen_shipping';
import { createReviewEvent, generateReviewData } from './gen_review';
import { devUser1, devUser2, devUser3, devUser4, devUser5 }  from '@/lib/fixtures';

config();

const RELAY_URL = process.env.APP_RELAY_URL;
if (!RELAY_URL) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const nostrService = NostrService.getInstance([RELAY_URL]);
const devUsers = [devUser1, devUser2, devUser3, devUser4, devUser5];

async function seedData() {
  const PRODUCTS_PER_USER = 6;
  const SHIPPING_OPTIONS_PER_USER = 2;
  const COLLECTIONS_PER_USER = 2;
  const REVIEWS_PER_USER = 2;

  await nostrService.connect();
  const productsByUser: Record<string, string[]> = {};
  const allProductRefs: string[] = [];
  const shippingsByUser: Record<string, string[]> = {};
  
  console.log('Starting seeding...');
  
  // Create products and shipping options for each user
  for (const user of devUsers) {
    const signer = new NDKPrivateKeySigner(user.sk);
    await signer.blockUntilReady();
    const pubkey = (await signer.user()).pubkey;
    
    console.log(`Creating products for user ${pubkey.substring(0, 8)}...`);
    productsByUser[pubkey] = [];
    
    // Create products
    for (let i = 0; i < PRODUCTS_PER_USER; i++) {
      const product = generateProductData();
      const success = await createProductEvent(signer, nostrService.ndkInstance, product);
      if (success) {
        const productId = product.tags.find(tag => tag[0] === "d")?.[1];
        if (productId) {
          const productRef = createProductReference(pubkey, productId);
          productsByUser[pubkey].push(productRef);
          allProductRefs.push(productRef);
        }
      }
    }
    
    // Create shipping options
    console.log(`Creating shipping options for user ${pubkey.substring(0, 8)}...`);
    shippingsByUser[pubkey] = [];
    
    for (let i = 0; i < SHIPPING_OPTIONS_PER_USER; i++) {
      const shipping = generateShippingData();
      const success = await createShippingEvent(signer, nostrService.ndkInstance, shipping);
      if (success) {
        const shippingId = shipping.tags.find(tag => tag[0] === "d")?.[1];
        if (shippingId) {
          shippingsByUser[pubkey].push(`30406:${pubkey}:${shippingId}`);
        }
      }
    }
  }
  
  // Create collections
  console.log('Creating collections...');
  for (const user of devUsers) {
    const signer = new NDKPrivateKeySigner(user.sk);
    await signer.blockUntilReady();
    const pubkey = (await signer.user()).pubkey;
    
    console.log(`Creating collections for user ${pubkey.substring(0, 8)}...`);
    
    for (let i = 0; i < COLLECTIONS_PER_USER; i++) {
      const collectionProducts = productsByUser[pubkey] || [];
      const collection = generateCollectionData(collectionProducts);
      await createCollectionEvent(signer, nostrService.ndkInstance, collection);
    }
  }
  
  // Create reviews
  console.log('Creating reviews...');
  for (const user of devUsers) {
    const signer = new NDKPrivateKeySigner(user.sk);
    await signer.blockUntilReady();
    const pubkey = (await signer.user()).pubkey;
    
    // Get products to review (excluding own products)
    const productsToReview = allProductRefs.filter(ref => {
      const refPubkey = ref.split(':')[2];
      return refPubkey !== pubkey;
    });
    
    console.log(`Creating reviews for user ${pubkey.substring(0, 8)}...`);
    
    for (let i = 0; i < REVIEWS_PER_USER; i++) {
      if (productsToReview[i]) {
        const review = generateReviewData([productsToReview[i]]);
        await createReviewEvent(signer, nostrService.ndkInstance, review);
      }
    }
  }
  
  console.log('Seeding complete!');
  process.exit(0);
}

seedData().catch(error => {
  console.error('Seeding failed:', error);
  process.exit(1);
});