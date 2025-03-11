import { NostrService } from '@/lib/nostr';
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { config } from 'dotenv';
import { generateSecretKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils';
import { createCollectionEvent, createProductReference, generateCollectionData } from './gen_collections';
import { createProductEvent, generateProductData } from './gen_products';
import { createShippingEvent, generateShippingData } from './gen_shipping';

config();

const RELAY_URL = process.env.APP_RELAY_URL;
const PRIVATE_KEY = process.env.APP_PRIVATE_KEY;

if (!RELAY_URL || !PRIVATE_KEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const nostrService = NostrService.getInstance([RELAY_URL]);

async function seedData() {
  await nostrService.connect();
  const privateKey = generateSecretKey();
  const signer = new NDKPrivateKeySigner(bytesToHex(privateKey));
  await signer.blockUntilReady();

  // Create products
  const numberOfProducts = 10;
  const products = Array.from({ length: numberOfProducts }, () => generateProductData());
  
  console.log(`Starting to seed ${numberOfProducts} products...`);
  
  // Keep track of published product references
  const productRefs: string[] = [];
  
  for (const product of products) {
    const success = await createProductEvent(signer, nostrService.ndkInstance, product);
    if (success) {
      const productId = product.tags.find(tag => tag[0] === "d")?.[1];
      if (productId) {
        productRefs.push(createProductReference((await signer.user()).pubkey, productId));
      }
    }
  }

  // Create shippings
  const numberOfShippingOptions = 5;
  const shippingOptions = Array.from({ length: numberOfShippingOptions }, () => generateShippingData());
  
  console.log(`Starting to seed ${numberOfShippingOptions} shipping options...`);
  
  const shippingRefs: string[] = [];
  for (const shipping of shippingOptions) {
    const success = await createShippingEvent(signer, nostrService.ndkInstance, shipping);
    if (success) {
      const shippingId = shipping.tags.find(tag => tag[0] === "d")?.[1];
      if (shippingId) {
        shippingRefs.push(`30406:${(await signer.user()).pubkey}:${shippingId}`);
      }
    }
  }

  // Create collections
  const numberOfCollections = 3;
  const collections = Array.from(
    { length: numberOfCollections },
    () => generateCollectionData(productRefs)
  );

  console.log(`Starting to seed ${numberOfCollections} collections...`);

  for (const collection of collections) {
    await createCollectionEvent(signer, nostrService.ndkInstance, collection);
  }

  console.log('Seeding complete!');
  process.exit(0);
}

seedData().catch(error => {
  console.error('Seeding failed:', error);
  process.exit(1);
});