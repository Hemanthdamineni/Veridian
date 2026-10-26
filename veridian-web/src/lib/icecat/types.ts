/**
 * Icecat open product data — types.
 *
 * Icecat is a product-data syndication service: it publishes the data sheet
 * of a product (identifiers, title, specifications, media) and, for a
 * distributor account, the retailer's own listing for that product. This
 * module describes both halves of that contract:
 *
 *   * the wire format returned by `https://live.icecat.biz/api`, and
 *   * the normalised product the rest of Veridian works with.
 *
 * Two rules shape the normalised side. A value that the source did not
 * publish is `null` and never a guess, and a price is only ever present when
 * the payload actually carries one — the open demo store carries
 * specifications, not prices, so a parsed price of `null` is the normal
 * result and not a failure.
 */

/** A localised string as Icecat returns it. */
export interface IcecatValue {
  Value?: string;
  Language?: string;
}

/** The unit a feature value is measured in. Icecat leaves the sign empty
 *  for the laptop category and relies on the feature name instead. */
export interface IcecatMeasure {
  ID?: string;
  Sign?: string;
  Signs?: { ID?: string; _?: string; Language?: string };
}

/** One specification. */
export interface IcecatFeature {
  ID?: number;
  LocalID?: number;
  Type?: string;
  /** The value as Icecat formatted it for display. */
  Value?: string;
  /** The value as the brand published it. */
  RawValue?: string;
  PresentationValue?: string;
  LocalValue?: string;
  Description?: string;
  Feature?: {
    ID?: number;
    Name?: IcecatValue;
    Measure?: IcecatMeasure;
  };
}

/** A group of specifications (Design, Memory, Storage, ...). */
export interface IcecatFeaturesGroup {
  ID?: number;
  SortNo?: string;
  FeatureGroup?: { ID?: string; Name?: IcecatValue };
  Features?: IcecatFeature[];
}

/** Another product Icecat links to this one. */
export interface IcecatProductRelated {
  ID?: number;
  CategoryID?: number;
  IcecatID?: number;
  ProductCode?: string;
  ProductName?: string;
  Brand?: string;
  BrandID?: number;
  /** accessory | consumable | service | alternative | compatible | ... */
  RelationTypeCode?: string;
}

/** Identifiers and names of a product. */
export interface IcecatGeneralInfo {
  IcecatId?: number;
  Title?: string;
  Brand?: string;
  BrandID?: string;
  /** The brand's short name for the product. */
  ProductName?: string;
  /** The brand's own product code (the MPN). */
  BrandPartCode?: string;
  GTIN?: string[];
  ReleaseDate?: string;
  EndOfLifeDate?: string;
  Category?: { CategoryID?: string; Name?: IcecatValue };
  ProductFamily?: { ProductFamilyID?: string; Value?: string; Language?: string };
  ProductSeries?: { SeriesID?: string; Value?: string; Language?: string };
}

/**
 * A price block, when the service returns one.
 *
 * The open demo store does not publish prices, so this shape is not part of
 * the open data sheet today. It is declared here because a distributor
 * account can carry one, and because the connector must be able to carry a
 * price through without inventing it.
 */
export interface IcecatPriceBlock {
  amount?: number | string;
  value?: number | string;
  price?: number | string;
  currency?: string;
  region?: string;
  kind?: "retail" | "manufacturer";
  sourceName?: string;
}

/** The `data` object of a successful response. */
export interface IcecatProductData {
  GeneralInfo?: IcecatGeneralInfo;
  FeaturesGroups?: IcecatFeaturesGroup[];
  ProductRelated?: IcecatProductRelated[];
  CatalogObjectCloud?: { ProductPage?: { URL?: string; QRCodeURL?: string } };
  /** True when the request was made with the public demo account. */
  DemoAccount?: boolean;
  /** Present only when the service publishes a price for the product. */
  Price?: IcecatPriceBlock;
}

/** A successful response envelope. */
export interface IcecatProductResponse {
  msg?: string;
  data?: IcecatProductData;
}

/** An error response envelope. The HTTP status equals `Code`. */
export interface IcecatErrorResponse {
  StatusCode?: number;
  Code?: number;
  Error?: string;
  Message?: string;
}

// =============================================================================
// NORMALISED PRODUCT
// =============================================================================

/**
 * The specifications Veridian stores.
 *
 * Every field is `null` when Icecat did not publish an unambiguous value.
 * A missing field stays missing: no default is ever substituted.
 */
export interface IcecatSpecs {
  /** Installed memory, in gigabytes. */
  memoryGb: number | null;
  /** Total storage capacity, in gigabytes. */
  storageGb: number | null;
  /** The storage technology as Icecat published it ("SSD", "HDD+SSD", ...). */
  storageType: string | null;
  processorBrand: string | null;
  processorModel: string | null;
  processorFamily: string | null;
  /** Display diagonal, in inches. */
  displaySizeIn: number | null;
  /** Product weight, in kilograms. */
  weightKg: number | null;
  /** Battery capacity, in watt-hours. */
  batteryWh: number | null;
}

/** A price, with the evidence class it carries. */
export interface IcecatPrice {
  amount: number;
  currency: string;
  /** The region the price belongs to, when the source names one. */
  region: string | null;
  /**
   * `retail` when a distributor quotes the price, `manufacturer` when the
   * record names the manufacturer as the source of the price.
   */
  kind: "retail" | "manufacturer";
  /** Who the price came from, when the record names a source. */
  sourceName: string | null;
}

/** A product as Veridian uses it after parsing. */
export interface IcecatProduct {
  /** Icecat's own product id. Stable for the life of the product. */
  icecatId: string;
  /** The brand's product code (the MPN). */
  productCode: string;
  brand: string;
  /** The brand's short name for the product. */
  modelName: string;
  /** The full title Icecat published. */
  title: string;
  family: string | null;
  series: string | null;
  category: string | null;
  categoryId: string | null;
  gtin: string[];
  /** The exact URL the product was read from. */
  sourceUrl: string;
  specs: IcecatSpecs;
  /** `null` when the source published no price. */
  price: IcecatPrice | null;
}

/**
 * One entry of the collected product-id list (`data/icecat-products.json`).
 *
 * `productCode` is the brand's product code, `sourceUrl` is the exact URL the
 * product can be read from. Both are needed to fetch the product again.
 */
export interface IcecatProductRef {
  productCode: string;
  brand: string;
  name: string;
  sourceUrl: string;
}

// =============================================================================
// MATCHING
// =============================================================================

/** How a match was made. */
export type MatchMethod = "mpn" | "name" | "name-subset" | "name-similarity";

/** A catalog configuration a product may correspond to. */
export interface CatalogSku {
  id: string;
  skuCode: string;
  modelId: string;
  modelName: string;
  brand: string;
  /** How many configurations the model of this configuration has. */
  modelSkuCount: number;
}

/** One candidate match, with the evidence that produced it. */
export interface MatchCandidate {
  skuId: string;
  modelId: string;
  modelName: string;
  brand: string;
  /** 0..1. */
  confidence: number;
  method: MatchMethod;
  /** A human-readable explanation of why this candidate was scored. */
  reason: string;
}

/** The outcome of matching one product against the catalog. */
export interface MatchOutcome {
  status: "matched" | "unmatched";
  /** The winning candidate, or `null` when nothing matched. */
  best: MatchCandidate | null;
  /** Every candidate above the threshold, best first. */
  candidates: MatchCandidate[];
  /** Why the outcome is what it is. Never empty. */
  reason: string;
}

// =============================================================================
// WRITING
// =============================================================================

/** The evidence class of a price observation, as stored in the catalog. */
export type PriceKind = "retail" | "manufacturer" | "review";

/** A price observation to append. */
export interface PriceObservationInput {
  skuId: string;
  listingId: string | null;
  region: string;
  currency: string;
  price: number;
  retailer: string | null;
  sourceUrl: string;
  timestamp: Date;
  sourceName: string;
  kind: PriceKind;
  inStock: boolean;
  confidence: number;
}

/** A retail listing to upsert. */
export interface RetailerListingInput {
  sellerId: string;
  skuId: string | null;
  retailerSkuString: string;
  title: string | null;
  url: string | null;
  region: string;
  currency: string;
  matchConfidence: number | null;
  matchMethod: string | null;
  inStock: boolean;
}

/** The seller a listing belongs to. */
export interface SellerInput {
  name: string;
  slug: string;
  region: string;
  baseUrl: string;
  scrapeMethod: string;
}

/**
 * The narrow slice of the database the writer needs.
 *
 * Keeping it structural means the write path can be exercised without a
 * database, and keeps the connector honest about what it touches.
 */
export interface PriceStore {
  ensureSeller(data: SellerInput): Promise<{ id: string }>;
  findObservation(input: {
    skuId: string;
    price: number;
    currency: string;
    sourceUrl: string;
    bucketStart: Date;
    bucketEnd: Date;
  }): Promise<{ id: string } | null>;
  createObservation(data: PriceObservationInput): Promise<{ id: string }>;
  upsertListing(data: RetailerListingInput): Promise<{ id: string }>;
  createPriceHistory(data: {
    listingId: string;
    skuId: string;
    price: number;
    currency: string;
    scrapedAt: Date;
  }): Promise<{ id: string }>;
}

/** The summary the CLI prints. */
export interface IngestSummary {
  fetched: number;
  matched: number;
  unmatched: number;
  observationsWritten: number;
  errors: string[];
}
