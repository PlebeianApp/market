import type { RichShippingInfo } from '@/lib/stores/cart'
import { cartActions } from '@/lib/stores/cart'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { 
  useShippingOptionsByPubkey, 
  getShippingInfo,
  createShippingReference
} from '@/queries/shipping'
import { useProductPubkey } from '@/queries/products'
import { useMemo } from 'react'

interface ShippingSelectorProps {
  productId?: string;
  options?: RichShippingInfo[];
  selectedId?: string;
  onSelect: (option: RichShippingInfo) => void;
  className?: string;
}

export function ShippingSelector({ 
  productId, 
  options: propOptions, 
  selectedId, 
  onSelect, 
  className 
}: ShippingSelectorProps) {
  // Get seller's pubkey from product if we have a productId
  const { data: sellerPubkey } = useProductPubkey(productId || '') || { data: undefined };
  
  // Fetch shipping options by seller pubkey
  const { data: shippingEvents = [], isLoading, error } = 
    useShippingOptionsByPubkey(sellerPubkey || '');
  
  // Transform shipping events to RichShippingInfo format
  const hookOptions = useMemo(() => {
    if (!shippingEvents.length || !sellerPubkey) return [];
    
    return shippingEvents.map(event => {
      // Use the comprehensive helper function to extract all shipping info
      const info = getShippingInfo(event);
      if (!info) return null;
      
      // Create a reference ID in the format used by the cart
      const id = createShippingReference(sellerPubkey, info.id);
      
      return {
        id,
        name: info.title,
        cost: parseFloat(info.price.amount),
        currency: info.price.currency,
        country: info.country,
        service: info.service,
        carrier: info.carrier
      };
    }).filter(Boolean) as RichShippingInfo[];
  }, [shippingEvents, sellerPubkey]);
  
  // Use provided options or options from the hook
  const options = propOptions || hookOptions;
  
  const handleSelect = (id: string) => {
    const option = options.find((o: RichShippingInfo) => o.id === id);
    if (option) {
      // If we have a productId, update the cart directly
      if (productId) {
        cartActions.setShippingMethod(productId, option);
      }
      
      // Call the callback
      onSelect(option);
    }
  };

  if (isLoading && !propOptions) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading shipping options...</span>
      </div>
    );
  }

  if (error && !propOptions) {
    return <div className="text-sm text-red-500">Error loading shipping options</div>;
  }

  if (!options || options.length === 0) {
    return <div className="text-sm text-muted-foreground">No shipping options available</div>;
  }

  return (
    <Select onValueChange={handleSelect} defaultValue={selectedId}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Select shipping method" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Shipping Options</SelectLabel>
          {options.map((option: RichShippingInfo) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name} - {option.cost} {option.currency}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
} 