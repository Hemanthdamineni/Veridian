/**
 * The EPA / ENERGY STAR open-data sources Veridian may cite, and the pinned
 * host allowlist that the adapters are allowed to contact (ADR-003).
 *
 * Every entry here was discovered and probed live on 2026-10-21; the
 * measurements are recorded verbatim in
 * `veridian-web/data/energy-star-source-register.json`, which is the
 * documentary register. This module is the machine-readable subset that the
 * code actually uses: the endpoint, the product types that are laptops, and
 * whether the source carries the specification fields a *configuration*
 * needs.
 *
 * Two rules hold everywhere in this file:
 *
 * 1. **The host allowlist is pinned.** A source may only be fetched from a
 *    host that is listed here, and the path must be the one registered for
 *    that source. No redirect is followed and no other origin is contacted.
 * 2. **A source is only listed once it has been fetched.** Nothing here is
 *    written from a catalogue entry or a search result; every status comes
 *    from an actual HTTP response.
 */

import { ENERGY_STAR_SOURCE } from "./types";

/** The EPA Standard Open Data License that every ENERGY STAR dataset cites. */
export const EPA_DATA_LICENSE_URL = "https://edg.epa.gov/EPA_Data_License.html";

/** The licence text the EPA datasets publish in their own metadata. */
export const EPA_DATA_LICENSE = "US Public Domain - EPA Standard Open Data License (data.gov Open Government Data Initiative)";

/**
 * The only origins an adapter may contact. Pinned by name: there is no
 * wildcard, no suffix match and no DNS resolution step.
 */
export const ALLOWED_SOURCE_HOSTS = ["data.energystar.gov"] as const;

export type AllowedSourceHost = (typeof ALLOWED_SOURCE_HOSTS)[number];

/**
 * The lifecycle of a candidate source, as measured - never as assumed.
 *
 * - `live` - the endpoint answered and returned the rows described.
 * - `live-no-laptop-rows` - the endpoint answered but the source has no
 *   laptop product type, so it can never produce a laptop configuration.
 * - `live-no-specifications` - the endpoint answered and does carry laptop
 *   rows, but it does not carry the specification fields a configuration
 *   needs, so it cannot produce a canonical configuration.
 * - `not-publicly-served` - the dataset id exists in the record but the
 *   endpoint refuses anonymous access (HTTP 403).
 * - `ruled-out` - checked and excluded, with the reason recorded.
 */
export type SourceStatus =
  | "live"
  | "live-no-laptop-rows"
  | "live-no-specifications"
  | "not-publicly-served"
  | "ruled-out";

/** How a source states its terms. */
export interface SourceTerms {
  /** Where the terms are published. */
  termsUrl: string;
  /** The short form of the licence, as the source states it. */
  license: string;
}

/** A source that may be cited, with everything the fetch layer needs. */
export interface EnergyStarSource extends SourceTerms {
  /** The Socrata dataset id, e.g. `rxdj-2c88`. */
  id: string;
  /** The dataset's published name. */
  name: string;
  /** The exact JSON endpoint rows are read from. */
  endpoint: string;
  /** The Socrata metadata endpoint that describes the dataset. */
  metadataUrl: string;
  /** The host the adapter is allowed to contact for this source. */
  host: AllowedSourceHost;
  /** The column that carries the source's own product-type enumeration. */
  productTypeField: string;
  /**
   * The product types in the source's own enumeration that are laptops.
   *
   * These were read from the live source, not guessed. Where the source
   * separates a portable product from a fixed one, the decision is recorded
   * in `laptopTypeEvidence`.
   */
  laptopProductTypes: readonly string[];
  /** The evidence that the listed product types are laptops. */
  laptopTypeEvidence: string;
  /** The column that carries the ENERGY STAR model identifier. */
  energyStarIdField: string;
  /** Optional scoping filter (a category column) the source needs. */
  categoryFilter?: { field: string; value: string };
  /**
   * True when the source carries the specification fields (CPU, RAM,
   * display, battery, storage) that a *configuration* is made of.
   */
  carriesSpecifications: boolean;
  /** The measured status of the source. */
  status: SourceStatus;
}

/**
 * The ENERGY STAR "Certified Computers" dataset - the source of Veridian's
 * certified tier.
 *
 * Its own product-type enumeration is: Notebook, Two-In-One Notebook,
 * Ruggedized Notebook, Mobile Workstation, Desktop, Integrated Desktop,
 * Workstation, Slate/Tablet, Thin Client, Integrated Thin Client.
 *
 * The base pipeline took the first three. `Mobile Workstation` is the
 * fourth laptop: every one of its rows carries an integrated display
 * diagonal and a battery capacity, while every `Workstation` row carries
 * neither and is marked as a workstation. See
 * `laptopTypeEvidence` and the `es-expansion` test suite.
 */
export const ENERGY_STAR_COMPUTERS_SOURCE: EnergyStarSource = {
  id: "rxdj-2c88",
  name: "US EPA ENERGY STAR Certified Computers V9.0",
  endpoint: "https://data.energystar.gov/resource/rxdj-2c88.json",
  metadataUrl: "https://data.energystar.gov/api/views/rxdj-2c88",
  host: "data.energystar.gov",
  productTypeField: "type",
  laptopProductTypes: [
    "Notebook",
    "Two-In-One Notebook",
    "Ruggedized Notebook",
    "Mobile Workstation",
  ],
  laptopTypeEvidence:
    "Read from the source's own `type` column: Notebook 1162, Two-In-One Notebook 9, Ruggedized Notebook 9, Mobile Workstation 12 rows (2026-10-21). Mobile Workstation is a laptop: 12 of 12 rows carry both an integrated display diagonal and a battery capacity, while 0 of 70 `Workstation` rows carry either and all 70 are marked `product_marketed_as_a_workstation = Yes`. `Slate/Tablet`, `Desktop`, `Integrated Desktop`, `Thin Client` and `Integrated Thin Client` are not laptops and are not fetched.",
  energyStarIdField: "energy_star_model_identifier",
  carriesSpecifications: true,
  status: "live",
  termsUrl: EPA_DATA_LICENSE_URL,
  license: EPA_DATA_LICENSE,
};

/**
 * The ENERGY STAR Model Index - a second EPA dataset that lists every
 * currently certified model across every product category.
 *
 * It returns laptop rows (813 on 2026-10-21) but it carries no
 * specification fields, and Veridian's `Sku` requires a CPU, a RAM size and
 * an operating system. It therefore cannot produce a canonical
 * configuration; it is registered, measured and reported, not ingested.
 */
export const ENERGY_STAR_MODEL_INDEX_SOURCE: EnergyStarSource = {
  id: "8wj2-sec8",
  name: "US EPA ENERGY STAR Model Index",
  endpoint: "https://data.energystar.gov/resource/8wj2-sec8.json",
  metadataUrl: "https://data.energystar.gov/api/views/8wj2-sec8",
  host: "data.energystar.gov",
  productTypeField: "product_type",
  laptopProductTypes: [
    "Notebook",
    "Two-In-One Notebook",
    "Ruggedized Notebook",
    "Mobile Workstation",
  ],
  laptopTypeEvidence:
    "Read from the source's own `product_type` column, scoped to `product_category = 'Computers'`: Notebook 793, Two-In-One Notebook 4, Ruggedized Notebook 6, Mobile Workstation 10 rows (2026-10-21). 741 of the 813 laptop certifications are also in the certified-computers dataset; the remaining 72 are additional certified laptop models that the certified-computers dataset does not carry, but the source publishes no specifications for them.",
  energyStarIdField: "energy_star_model_identifier",
  categoryFilter: { field: "product_category", value: "Computers" },
  carriesSpecifications: false,
  status: "live-no-specifications",
  termsUrl: EPA_DATA_LICENSE_URL,
  license: EPA_DATA_LICENSE,
};

/**
 * The ENERGY STAR Certified Products UPC Codes - a third EPA dataset that
 * publishes one row per UPC code.
 *
 * It returns laptop rows (13,004 on 2026-10-21) but only 552 distinct
 * certifications, and every one of them is already in the certified
 * computers dataset with the same UPC list. It adds no configuration and no
 * UPC; it is registered, measured and reported, not ingested.
 */
export const ENERGY_STAR_UPC_SOURCE: EnergyStarSource = {
  id: "8edu-y555",
  name: "US EPA ENERGY STAR Certified Products UPC Codes",
  endpoint: "https://data.energystar.gov/resource/8edu-y555.json",
  metadataUrl: "https://data.energystar.gov/api/views/8edu-y555",
  host: "data.energystar.gov",
  productTypeField: "product_type",
  laptopProductTypes: [
    "Notebook",
    "Two-In-One Notebook",
    "Ruggedized Notebook",
    "Mobile Workstation",
  ],
  laptopTypeEvidence:
    "Read from the source's own `product_type` column, scoped to `product_program_category = 'Computers'`: Notebook 12,787, Two-In-One Notebook 138, Ruggedized Notebook 7, Mobile Workstation 72 rows (2026-10-21). Those 13,004 rows cover only 552 distinct ENERGY STAR certifications, all of which are already in the certified-computers dataset, which publishes the same (semicolon separated) UPC list for each of them. The source therefore yields no new configuration and no new UPC.",
  energyStarIdField: "energy_star_model_identifier",
  categoryFilter: { field: "product_program_category", value: "Computers" },
  carriesSpecifications: false,
  status: "live-no-specifications",
  termsUrl: EPA_DATA_LICENSE_URL,
  license: EPA_DATA_LICENSE,
};

/**
 * The ENERGY STAR Certified Displays - a live EPA dataset with no laptop
 * product type at all.
 *
 * It is registered because it is the honest negative case: a real, official,
 * government dataset that yields zero laptop configurations.
 */
export const ENERGY_STAR_DISPLAYS_SOURCE: EnergyStarSource = {
  id: "qbg3-d468",
  name: "US EPA ENERGY STAR Certified Displays",
  endpoint: "https://data.energystar.gov/resource/qbg3-d468.json",
  metadataUrl: "https://data.energystar.gov/api/views/qbg3-d468",
  host: "data.energystar.gov",
  productTypeField: "display_type",
  laptopProductTypes: [],
  laptopTypeEvidence:
    "Read from the source's own `display_type` column: Monitor 1,603 rows and Signage Display 1,327 rows (2026-10-21). Neither is a laptop, so the source yields zero laptop rows.",
  energyStarIdField: "energy_star_model_identifier",
  carriesSpecifications: false,
  status: "live-no-laptop-rows",
  termsUrl: EPA_DATA_LICENSE_URL,
  license: EPA_DATA_LICENSE,
};

/** Every source the code may fetch, keyed by dataset id. */
export const ENERGY_STAR_SOURCES: Record<string, EnergyStarSource> = {
  [ENERGY_STAR_COMPUTERS_SOURCE.id]: ENERGY_STAR_COMPUTERS_SOURCE,
  [ENERGY_STAR_MODEL_INDEX_SOURCE.id]: ENERGY_STAR_MODEL_INDEX_SOURCE,
  [ENERGY_STAR_UPC_SOURCE.id]: ENERGY_STAR_UPC_SOURCE,
  [ENERGY_STAR_DISPLAYS_SOURCE.id]: ENERGY_STAR_DISPLAYS_SOURCE,
};

/** The registered sources, in the order the discovery report presents them. */
export const REGISTERED_SOURCES: readonly EnergyStarSource[] = [
  ENERGY_STAR_COMPUTERS_SOURCE,
  ENERGY_STAR_MODEL_INDEX_SOURCE,
  ENERGY_STAR_UPC_SOURCE,
  ENERGY_STAR_DISPLAYS_SOURCE,
];

/** Look a source up by dataset id. Throws for an unregistered id. */
export function getSource(id: string): EnergyStarSource {
  const source = ENERGY_STAR_SOURCES[id];
  if (!source) {
    throw new Error(
      `Unregistered ENERGY STAR source '${id}'. Registered: ${Object.keys(ENERGY_STAR_SOURCES).join(", ")}`
    );
  }
  return source;
}

/**
 * Assert that a URL points at a registered source on a pinned host.
 *
 * The path must be exactly the registered path, so a registered host can
 * never be used to reach an unregistered resource.
 */
export function assertRegisteredSourceUrl(source: EnergyStarSource, url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Source fetch must use HTTPS");
  if (parsed.hostname !== source.host) {
    throw new Error(`Host '${parsed.hostname}' is not the registered host '${source.host}'`);
  }
  if (!ALLOWED_SOURCE_HOSTS.includes(parsed.hostname as AllowedSourceHost)) {
    throw new Error(`Host '${parsed.hostname}' is not in the pinned allowlist`);
  }
  const registered = new URL(source.endpoint);
  if (parsed.origin !== registered.origin || parsed.pathname !== registered.pathname) {
    throw new Error(`Path '${parsed.pathname}' is not the registered path for source '${source.id}'`);
  }
  return parsed;
}

/**
 * The canonical dataset the base pipeline ingests. Kept here so the
 * expansion code can prove it is expanding the *same* dataset rather than a
 * look-alike.
 */
export const BASE_DATASET_ID = ENERGY_STAR_SOURCE.datasetId;
