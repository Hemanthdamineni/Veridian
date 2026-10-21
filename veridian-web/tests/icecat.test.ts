import { describe, it, expect } from "vitest";
import { parseProduct, parseSpecs, parsePrice } from "@/lib/icecat/parse";
import { MATCH_THRESHOLD, matchProductToCatalog, partNumberToken } from "@/lib/icecat/match";
import {
  bucketFor,
  listingKey,
  toSchemaMatchMethod,
  writePriceObservation,
} from "../scripts/ingest-icecat";
import type {
  CatalogSku,
  IcecatProductData,
  IcecatProductRef,
  PriceObservationInput,
  PriceStore,
  RetailerListingInput,
  SellerInput,
} from "@/lib/icecat/types";

/**
 * A payload in the shape the live service returns.
 *
 * It is a trimmed copy of the data sheet the Icecat demo store returns for
 * the DELL G5 5587 (`icecat_id=56195846`, read on 2026-10-21 with
 * `https://live.icecat.biz/api?lang=EN&shopname=openicecat-live&icecat_id=56195846`).
 * The fields, their names and their types are the service's, not the
 * connector's.
 */
const liveProductPayload: IcecatProductData = {
  GeneralInfo: {
    IcecatId: 56195846,
    ReleaseDate: "",
    EndOfLifeDate: "",
    Title:
      'DELL G5 5587 Intel® Core™ i7 i7-8750H Laptop 39.6 cm (15.6") Full HD 16 GB DDR4-SDRAM 1.25 TB HDD+SSD NVIDIA® GeForce® GTX 1060 Wi-Fi 5 (802.11ac) Ubuntu Linux Black',
    Brand: "DELL",
    BrandID: "69",
    ProductName: "5587",
    BrandPartCode: "5587-9709",
    GTIN: ["5397184119709"],
    Category: { CategoryID: "151", Name: { Value: "Laptops", Language: "EN" } },
    ProductFamily: { ProductFamilyID: "68786", Value: "G5", Language: "EN" },
    ProductSeries: { SeriesID: "1" },
  },
  FeaturesGroups: [
    {
      ID: 10674,
      SortNo: "1000",
      FeatureGroup: { ID: "148", Name: { Value: "Design", Language: "EN" } },
      Features: [
        {
          ID: 275632011,
          Type: "dropdown",
          Value: "Notebook",
          RawValue: "Notebook",
          PresentationValue: "Laptop",
          Feature: {
            ID: 14052,
            Name: { Value: "Product type", Language: "EN" },
            Measure: { ID: "29", Sign: "", Signs: { ID: "", _: "", Language: "EN" } },
          },
        },
      ],
    },
    {
      ID: 33,
      SortNo: "300",
      FeatureGroup: { ID: "5", Name: { Value: "Display", Language: "EN" } },
      Features: [
        {
          ID: 275636014,
          Type: "numerical",
          Value: "15.6",
          RawValue: "15.6",
          PresentationValue: '39.6 cm (15.6")',
          Feature: {
            ID: 944,
            Name: { Value: "Display diagonal", Language: "EN" },
            Measure: { ID: "16", Sign: "", Signs: { ID: "11", _: '"', Language: "EN" } },
          },
        },
      ],
    },
    {
      ID: 35,
      SortNo: "200",
      FeatureGroup: { ID: "1", Name: { Value: "Processor", Language: "EN" } },
      Features: [
        {
          ID: 357793220,
          Type: "dropdown",
          Value: "Intel",
          RawValue: "Intel",
          Feature: {
            ID: 2721,
            Name: { Value: "Processor manufacturer", Language: "EN" },
            Measure: { ID: "29", Sign: "", Signs: { ID: "", _: "", Language: "EN" } },
          },
        },
        {
          ID: 357793255,
          Type: "dropdown",
          Value: "Intel Core i7",
          RawValue: "Intel Core i7",
          Feature: {
            ID: 2722,
            Name: { Value: "Processor family", Language: "EN" },
            Measure: { ID: "29", Sign: "", Signs: { ID: "", _: "", Language: "EN" } },
          },
        },
        {
          ID: 357793256,
          Type: "dropdown",
          Value: "i7-8750H",
          RawValue: "i7-8750H",
          Feature: {
            ID: 2723,
            Name: { Value: "Processor model", Language: "EN" },
            Measure: { ID: "29", Sign: "", Signs: { ID: "", _: "", Language: "EN" } },
          },
        },
      ],
    },
    {
      ID: 39,
      SortNo: "100",
      FeatureGroup: { ID: "2", Name: { Value: "Memory", Language: "EN" } },
      Features: [
        {
          ID: 275636190,
          Type: "numerical",
          Value: "16",
          RawValue: "16",
          Feature: {
            ID: 1216,
            Name: { Value: "Internal memory", Language: "EN" },
            Measure: { ID: "8", Sign: "", Signs: { ID: "5", _: "GB", Language: "EN" } },
          },
        },
      ],
    },
    {
      ID: 40,
      SortNo: "200",
      FeatureGroup: { ID: "3", Name: { Value: "Storage", Language: "EN" } },
      Features: [
        {
          ID: 275636300,
          Type: "numerical",
          Value: "1256",
          RawValue: "1256",
          Feature: {
            ID: 1701,
            Name: { Value: "Total storage capacity", Language: "EN" },
            Measure: { ID: "8", Sign: "", Signs: { ID: "5", _: "GB", Language: "EN" } },
          },
        },
        {
          ID: 275636301,
          Type: "dropdown",
          Value: "HDD+SSD",
          RawValue: "HDD+SSD",
          Feature: {
            ID: 1702,
            Name: { Value: "Storage media", Language: "EN" },
            Measure: { ID: "29", Sign: "", Signs: { ID: "", _: "", Language: "EN" } },
          },
        },
      ],
    },
    {
      ID: 46,
      SortNo: "900",
      FeatureGroup: { ID: "11", Name: { Value: "Physical dimensions", Language: "EN" } },
      Features: [
        {
          ID: 275636500,
          Type: "numerical",
          Value: "2700",
          RawValue: "2700",
          PresentationValue: "2.7 kg",
          Feature: {
            ID: 1337,
            Name: { Value: "Weight", Language: "EN" },
            Measure: { ID: "5", Sign: "", Signs: { ID: "", _: "", Language: "EN" } },
          },
        },
      ],
    },
    {
      ID: 47,
      SortNo: "800",
      FeatureGroup: { ID: "12", Name: { Value: "Battery", Language: "EN" } },
      Features: [
        {
          ID: 275636600,
          Type: "numerical",
          Value: "56",
          RawValue: "56",
          Feature: {
            ID: 2222,
            Name: { Value: "Battery capacity", Language: "EN" },
            Measure: { ID: "30", Sign: "", Signs: { ID: "", _: "", Language: "EN" } },
          },
        },
      ],
    },
  ],
  ProductRelated: [
    {
      ID: 0,
      CategoryID: 577,
      IcecatID: 31038491,
      ProductCode: "960-001063",
      ProductName: "C270 HD WEBCAM",
      Brand: "Logitech",
      BrandID: 91,
      RelationTypeCode: "accessory",
    },
  ],
  CatalogObjectCloud: {
    ProductPage: {
      QRCodeURL: "https://qr.icecat.biz/coc/dcbde60a-35d0-4a08-8dbb-fa67351b67c7",
      URL: "https://coc.icecat.biz/dcbde60a-35d0-4a08-8dbb-fa67351b67c7",
    },
  },
  DemoAccount: true,
};

const liveProductUrl =
  "https://live.icecat.biz/api?lang=EN&shopname=openicecat-live&icecat_id=56195846";

describe("Icecat product parsing", () => {
  it("reads the identity of a product in the shape the service returns", () => {
    const product = parseProduct(liveProductPayload, liveProductUrl);

    expect(product.icecatId).toBe("56195846");
    expect(product.brand).toBe("DELL");
    expect(product.productCode).toBe("5587-9709");
    expect(product.modelName).toBe("5587");
    expect(product.title.startsWith("DELL G5 5587")).toBe(true);
    expect(product.category).toBe("Laptops");
    expect(product.categoryId).toBe("151");
    expect(product.family).toBe("G5");
    expect(product.gtin).toEqual(["5397184119709"]);
    expect(product.sourceUrl).toBe(liveProductUrl);
  });

  it("reads the specifications Veridian stores", () => {
    const { specs } = parseProduct(liveProductPayload, liveProductUrl);

    expect(specs.memoryGb).toBe(16);
    expect(specs.storageGb).toBe(1256);
    expect(specs.storageType).toBe("HDD+SSD");
    expect(specs.processorBrand).toBe("Intel");
    expect(specs.processorFamily).toBe("Intel Core i7");
    expect(specs.processorModel).toBe("i7-8750H");
    expect(specs.displaySizeIn).toBe(15.6);
    expect(specs.weightKg).toBe(2.7);
    expect(specs.batteryWh).toBe(56);
  });

  it("leaves a specification missing when the source did not publish it", () => {
    const withoutBattery: IcecatProductData = {
      ...liveProductPayload,
      FeaturesGroups: (liveProductPayload.FeaturesGroups ?? []).filter(
        (group) => group.FeatureGroup?.Name?.Value !== "Battery"
      ),
    };

    const { specs } = parseProduct(withoutBattery, liveProductUrl);

    // A missing specification stays missing. It is never zero.
    expect(specs.batteryWh).toBeNull();
    expect(specs.memoryGb).toBe(16);
  });

  it("does not read a price the source did not publish", () => {
    const product = parseProduct(liveProductPayload, liveProductUrl);
    expect(product.price).toBeNull();
  });

  it("reads a price only when the payload carries one", () => {
    const priced = parseProduct(
      {
        ...liveProductPayload,
        Price: { amount: 1234.56, currency: "USD", region: "US", kind: "retail" },
      },
      liveProductUrl
    );

    expect(priced.price).toEqual({
      amount: 1234.56,
      currency: "USD",
      region: "US",
      kind: "retail",
      sourceName: null,
    });
  });

  it("refuses a price without a currency", () => {
    expect(parsePrice({ Price: { amount: 10 } })).toBeNull();
  });

  it("reads a manufacturer price when the record names the manufacturer", () => {
    const manufacturer = parsePrice({
      GeneralInfo: { Brand: "DELL" },
      Price: { amount: 1499, currency: "eur", sourceName: "Dell" },
    });
    const distributor = parsePrice({
      GeneralInfo: { Brand: "DELL" },
      Price: { amount: 1499, currency: "EUR", sourceName: "Icecat" },
    });

    expect(manufacturer?.kind).toBe("manufacturer");
    expect(manufacturer?.currency).toBe("EUR");
    expect(distributor?.kind).toBe("retail");
  });

  it("ignores a feature value that is not a single number", () => {
    const specs = parseSpecs([
      {
        ID: 39,
        Features: [
          {
            ID: 1,
            Type: "numerical",
            Value: "0 - 95",
            RawValue: "0 - 95",
            Feature: { Name: { Value: "Weight", Language: "EN" } },
          },
        ],
      },
    ]);

    expect(specs.weightKg).toBeNull();
  });
});

describe("Icecat matching against the catalog", () => {
  const catalog: CatalogSku[] = [
    {
      id: "sku-precision-14",
      skuCode: "PW514261-1a2b3c4d",
      modelId: "model-precision-14",
      modelName: "Dell Pro Precision 5 14 PW514261",
      brand: "Dell",
      modelSkuCount: 1,
    },
    {
      id: "sku-ideapad",
      skuCode: "IDEAPAD-VIBE-15AKP12-3f105031",
      modelId: "model-ideapad",
      modelName: "IdeaPad Vibe 15AKP12",
      brand: "Lenovo",
      modelSkuCount: 1,
    },
    {
      id: "sku-latitude-multi-1",
      skuCode: "P213G-11111111",
      modelId: "model-latitude",
      modelName: "Latitude 7450",
      brand: "Dell",
      modelSkuCount: 4,
    },
    {
      id: "sku-latitude-multi-2",
      skuCode: "P213G-22222222",
      modelId: "model-latitude",
      modelName: "Latitude 7450",
      brand: "Dell",
      modelSkuCount: 4,
    },
  ];

  it("accepts a product that names a catalog model", () => {
    const product = parseProduct(
      {
        ...liveProductPayload,
        GeneralInfo: {
          ...liveProductPayload.GeneralInfo,
          Brand: "DELL",
          ProductName: "PW514261",
          BrandPartCode: "5400001045204.1",
        },
      },
      liveProductUrl
    );

    const outcome = matchProductToCatalog(product, catalog);

    expect(outcome.status).toBe("matched");
    expect(outcome.best).not.toBeNull();
    expect(outcome.best!.confidence).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(outcome.best!.skuId).toBe("sku-precision-14");
    expect(outcome.best!.method).toBe("mpn");
    expect(outcome.reason).toContain("PW514261");
  });

  it("reports a product below the threshold as unmatched and attaches it to nothing", () => {
    const product = parseProduct(
      {
        ...liveProductPayload,
        GeneralInfo: {
          ...liveProductPayload.GeneralInfo,
          Brand: "DELL",
          ProductName: "5587",
          BrandPartCode: "5587-9709",
        },
      },
      liveProductUrl
    );

    const outcome = matchProductToCatalog(product, catalog);

    expect(outcome.status).toBe("unmatched");
    expect(outcome.best).toBeNull();
    expect(outcome.candidates).toHaveLength(0);
    expect(outcome.reason).toContain("5587");
  });

  it("never matches a product to a configuration of another brand", () => {
    const product = parseProduct(
      {
        ...liveProductPayload,
        GeneralInfo: {
          ...liveProductPayload.GeneralInfo,
          Brand: "Acer",
          ProductName: "PW514261",
        },
      },
      liveProductUrl
    );

    const outcome = matchProductToCatalog(product, catalog);

    expect(outcome.status).toBe("unmatched");
    expect(outcome.best).toBeNull();
  });

  it("does not attach a model-level product to one of several configurations", () => {
    const product = parseProduct(
      {
        ...liveProductPayload,
        GeneralInfo: {
          ...liveProductPayload.GeneralInfo,
          Brand: "DELL",
          ProductName: "Latitude 7450",
        },
      },
      liveProductUrl
    );

    const outcome = matchProductToCatalog(product, catalog);

    expect(outcome.status).toBe("unmatched");
    expect(outcome.best).toBeNull();
    expect(outcome.reason).toContain("configurations");
  });

  it("reports a product that matches two models equally well as unmatched", () => {
    const tied: CatalogSku[] = [
      {
        id: "sku-surface-a",
        skuCode: "SURFACE-LAPTOP-6-aaaaaaaa",
        modelId: "model-surface-a",
        modelName: "Surface Laptop 6",
        brand: "Microsoft",
        modelSkuCount: 1,
      },
      {
        id: "sku-surface-b",
        skuCode: "SURFACE-LAPTOP-6-bbbbbbbb",
        modelId: "model-surface-b",
        modelName: "Surface-Laptop 6",
        brand: "Microsoft",
        modelSkuCount: 1,
      },
    ];

    const product = parseProduct(
      {
        ...liveProductPayload,
        GeneralInfo: {
          ...liveProductPayload.GeneralInfo,
          Brand: "Microsoft",
          ProductName: "Surface Laptop 6",
        },
      },
      liveProductUrl
    );

    const outcome = matchProductToCatalog(product, tied);

    expect(outcome.status).toBe("unmatched");
    expect(outcome.best).toBeNull();
    expect(outcome.reason).toContain("equally well");
  });

  it("reads the part number out of a catalog code", () => {
    expect(partNumberToken("IDEAPAD-VIBE-15AKP12-3f105031")).toBe("IDEAPAD-VIBE-15AKP12");
    expect(partNumberToken("P213G")).toBe("P213G");
  });
});

/** A store that keeps what it is given, so the write path can be observed. */
class FakeStore implements PriceStore {
  sellers: SellerInput[] = [];
  listings: RetailerListingInput[] = [];
  observations: PriceObservationInput[] = [];
  history: Array<{ listingId: string; skuId: string; price: number; currency: string }> = [];

  async ensureSeller(data: SellerInput): Promise<{ id: string }> {
    this.sellers.push(data);
    return { id: "seller-icecat" };
  }

  async findObservation(input: {
    skuId: string;
    price: number;
    currency: string;
    sourceUrl: string;
    bucketStart: Date;
    bucketEnd: Date;
  }): Promise<{ id: string } | null> {
    const found = this.observations.find(
      (observation) =>
        observation.skuId === input.skuId &&
        observation.price === input.price &&
        observation.currency === input.currency &&
        observation.sourceUrl === input.sourceUrl &&
        observation.timestamp >= input.bucketStart &&
        observation.timestamp < input.bucketEnd
    );
    return found ? { id: "existing-observation" } : null;
  }

  async createObservation(data: PriceObservationInput): Promise<{ id: string }> {
    this.observations.push(data);
    return { id: `observation-${this.observations.length}` };
  }

  async upsertListing(data: RetailerListingInput): Promise<{ id: string }> {
    this.listings.push(data);
    return { id: "listing-icecat" };
  }

  async createPriceHistory(data: {
    listingId: string;
    skuId: string;
    price: number;
    currency: string;
    scrapedAt: Date;
  }): Promise<{ id: string }> {
    this.history.push(data);
    return { id: "history-1" };
  }
}

describe("Icecat price observations", () => {
  const product = parseProduct(
    {
      ...liveProductPayload,
      Price: { amount: 1299, currency: "USD", region: "US", kind: "retail" },
    },
    liveProductUrl
  );
  const candidate = {
    skuId: "sku-precision-14",
    modelId: "model-precision-14",
    modelName: "Dell Pro Precision 5 14 PW514261",
    brand: "Dell",
    confidence: 0.98,
    method: "mpn" as const,
    reason: "the brand's product code is the part number",
  };

  it("appends an observation for a price the source published", async () => {
    const store = new FakeStore();
    const now = new Date("2026-10-21T12:30:00.000Z");

    const outcome = await writePriceObservation(store, {
      product,
      candidate,
      price: product.price,
      now,
    });

    expect(outcome.written).toBe(true);
    expect(store.observations).toHaveLength(1);
    expect(store.observations[0]).toMatchObject({
      skuId: "sku-precision-14",
      price: 1299,
      currency: "USD",
      region: "US",
      kind: "retail",
      sourceName: "Icecat open product data",
      sourceUrl: liveProductUrl,
      confidence: 0.98,
    });
    // The listing is attached to the configuration the product matched.
    expect(store.listings[0]).toMatchObject({
      skuId: "sku-precision-14",
      retailerSkuString: "DELL 5587-9709",
      url: liveProductUrl,
      matchMethod: "mpn",
    });
    expect(store.history).toHaveLength(1);
  });

  it("does not write the same observation twice", async () => {
    const store = new FakeStore();
    const now = new Date("2026-10-21T12:30:00.000Z");

    const first = await writePriceObservation(store, {
      product,
      candidate,
      price: product.price,
      now,
    });
    const second = await writePriceObservation(store, {
      product,
      candidate,
      price: product.price,
      now: new Date(now.getTime() + 60 * 1000),
    });

    expect(first.written).toBe(true);
    expect(second.written).toBe(false);
    expect(second.reason).toContain("already exists");
    expect(store.observations).toHaveLength(1);
  });

  it("writes no observation when the source published no price", async () => {
    const store = new FakeStore();
    const priceless = parseProduct(liveProductPayload, liveProductUrl);

    const outcome = await writePriceObservation(store, {
      product: priceless,
      candidate,
      price: priceless.price,
      now: new Date("2026-10-21T12:30:00.000Z"),
    });

    expect(outcome.written).toBe(false);
    expect(outcome.reason).toContain("no price");
    expect(store.observations).toHaveLength(0);
    expect(store.history).toHaveLength(0);
  });

  it("buckets observations by the hour", () => {
    const first = bucketFor(new Date("2026-10-21T12:05:00.000Z"));
    const second = bucketFor(new Date("2026-10-21T12:55:00.000Z"));
    const next = bucketFor(new Date("2026-10-21T13:05:00.000Z"));

    expect(first.bucketStart.toISOString()).toBe(second.bucketStart.toISOString());
    expect(first.bucketStart.toISOString()).not.toBe(next.bucketStart.toISOString());
    // One bucket ends where the next one begins.
    expect(first.bucketEnd.toISOString()).toBe(next.bucketStart.toISOString());
  });

  it("identifies the listing by the brand and the product code", () => {
    expect(listingKey(product)).toBe("DELL 5587-9709");
    expect(toSchemaMatchMethod("mpn")).toBe("mpn");
    expect(toSchemaMatchMethod("name-subset")).toBe("name+spec");
  });
});

describe("the collected product-id list", () => {
  it("holds the four fields every entry needs", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = path.join(process.cwd(), "data", "icecat-products.json");
    const entries = JSON.parse(fs.readFileSync(file, "utf-8")) as IcecatProductRef[];

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.productCode).toBeTruthy();
      expect(entry.brand).toBeTruthy();
      expect(entry.sourceUrl).toContain("live.icecat.biz/api");
    }
  });
});
