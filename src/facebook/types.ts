export interface FacebookCookie {
  host: string;
  name: string;
  value: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
}

export interface FacebookSession {
  cookies: FacebookCookie[];
  cookieHeader: string;
  fbDtsg: string;
  lsd: string;
  jazoest: string;
  clientRevision: string;
  userId: string;
}

export interface MarketplaceListing {
  id: string;
  title: string;
  price: string;
  location: string;
  imageUrl: string;
  sellerName: string;
  postedDate: string;
  url: string;
  isPending: boolean;
  isSold?: boolean;
  priceAmount?: number | null;
  currency?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  deliveryTypes?: string[];
}

export interface MarketplaceListingDetail extends MarketplaceListing {
  description: string;
  images: string[];
  condition: string;
  seller: {
    name: string;
    profileUrl: string;
  };
}

export interface SearchParams {
  query: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  minPrice?: number;
  maxPrice?: number;
  category?: string;
  limit: number;
  cursor?: string;
  delivery?: "all" | "local_pickup" | "shipping";
}

export interface SearchResult {
  listings: MarketplaceListing[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface SavedMonitor {
  id: string;
  name: string;
  params: Omit<SearchParams, "cursor">;
  seenIds: string[];
  createdAt: string;
  lastChecked: string | null;
}
