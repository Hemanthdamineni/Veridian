/**
 * The OpenAPI 3.1 description of the public API.
 *
 * It is written by hand rather than generated, because the point of the
 * document is to describe the contract precisely — including the
 * provenance tier on every configuration and the fact that no price is a
 * live retail quote.
 */

const PROVENANCE_DESCRIPTION =
  "The provenance tier of the configuration. `certified` means it carries a cited certification record with a stored source payload; `manufacturer` means it was checked against the manufacturer's own specification page; `unverified` means there is no citation and the figures are unconfirmed.";

const PRICE_NOTE =
  "Manufacturer suggested price recorded at the last update. This is not a live retail price.";

export const OPENAPI_DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "Veridian Public API",
    version: "1.0.0",
    summary: "Verified, source-tracked laptop configurations.",
    description: [
      "Veridian publishes laptop configurations that carry their own provenance.",
      "Every configuration has a tier: `certified` (a cited certification record with a",
      "stored payload hash), `manufacturer` (checked against the manufacturer's own",
      "specification page) or `unverified` (no citation).",
      "",
      "Prices are manufacturer suggested prices recorded at the last update. They are",
      "reference values, not live retail quotes, and every price field says so.",
    ].join("\n"),
    license: { name: "MIT", identifier: "MIT" },
  },
  servers: [{ url: "/api/v1", description: "This deployment" }],
  security: [{ apiKeyAuth: [] }],
  components: {
    securitySchemes: {
      apiKeyAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "An API key issued by the operator, presented in the X-API-Key header or as a bearer token. Each key has an hourly request budget; exceeding it returns 429 with a Retry-After header.",
      },
    },
    schemas: {
      Provenance: {
        type: "string",
        enum: ["certified", "manufacturer", "unverified"],
        description: PROVENANCE_DESCRIPTION,
      },
      Price: {
        type: "object",
        nullable: true,
        properties: {
          region: { type: "string" },
          currency: { type: "string" },
          msrp: { type: "number" },
          note: { type: "string", const: PRICE_NOTE },
        },
      },
      Source: {
        type: "object",
        properties: {
          source: { type: "string" },
          kind: { type: "string" },
          sourceUrl: { type: ["string", "null"] },
          observedAt: { type: "string", format: "date-time" },
          confidence: { type: "number" },
          note: { type: ["string", "null"] },
        },
      },
      Configuration: {
        type: "object",
        properties: {
          id: { type: "string" },
          skuCode: { type: "string" },
          partNumber: { type: ["string", "null"] },
          modelName: { type: "string" },
          seriesName: { type: "string" },
          manufacturer: { type: "string" },
          provenance: { $ref: "#/components/schemas/Provenance" },
          cpu: {
            type: "object",
            properties: {
              brand: { type: "string" },
              model: { type: "string" },
              cores: { type: ["integer", "null"] },
            },
          },
          memory: {
            type: "object",
            properties: {
              gb: { type: "integer" },
              type: { type: ["string", "null"] },
              soldered: { type: ["boolean", "null"] },
            },
          },
          storage: {
            type: "object",
            properties: {
              gb: { type: ["integer", "null"] },
              type: { type: ["string", "null"] },
              slots: { type: ["integer", "null"] },
            },
          },
          display: {
            type: "object",
            properties: {
              sizeIn: { type: ["number", "null"] },
              resolution: { type: ["string", "null"] },
              type: { type: ["string", "null"] },
              refreshHz: { type: ["integer", "null"] },
              touch: { type: ["boolean", "null"] },
              nits: { type: ["integer", "null"] },
            },
          },
          weightKg: { type: ["number", "null"] },
          batteryWh: { type: ["number", "null"] },
          os: { type: "string" },
          price: { $ref: "#/components/schemas/Price" },
        },
      },
      Pagination: {
        type: "object",
        properties: {
          page: { type: "integer" },
          limit: { type: "integer" },
          totalResults: { type: "integer" },
          totalPages: { type: "integer" },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          message: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/": {
      get: {
        summary: "API index",
        responses: { "200": { description: "The available endpoints." } },
      },
    },
    "/skus": {
      get: {
        summary: "List configurations",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "provenance", in: "query", schema: { type: "string" } },
          { name: "manufacturer", in: "query", schema: { type: "string" } },
          { name: "cpu_brand", in: "query", schema: { type: "string" } },
          { name: "display_type", in: "query", schema: { type: "string" } },
          { name: "ram_min", in: "query", schema: { type: "integer" } },
          { name: "weight_max", in: "query", schema: { type: "number" } },
          { name: "battery_min", in: "query", schema: { type: "integer" } },
          { name: "price_max", in: "query", schema: { type: "number" } },
          { name: "region", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "limit", in: "query", schema: { type: "integer", maximum: 100 } },
        ],
        responses: {
          "200": {
            description: "A page of configurations.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    pagination: { $ref: "#/components/schemas/Pagination" },
                    results: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Configuration" },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Missing or unrecognised API key." },
          "429": { description: "The key's hourly budget is exhausted." },
        },
      },
    },
    "/skus/{id}": {
      get: {
        summary: "One configuration, with its sources and components",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "The configuration.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Configuration" },
              },
            },
          },
          "404": { description: "No such configuration." },
        },
      },
    },
    "/manufacturers": {
      get: {
        summary: "Manufacturers and their coverage",
        responses: { "200": { description: "The manufacturer list." } },
      },
    },
    "/components": {
      get: {
        summary: "The shared component graph",
        parameters: [
          { name: "kind", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", maximum: 200 } },
        ],
        responses: { "200": { description: "The component list." } },
      },
    },
    "/components/{slug}": {
      get: {
        summary: "One component and the configurations built around it",
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "The component and its configurations." },
          "404": { description: "No such component." },
        },
      },
    },
    "/compare": {
      get: {
        summary: "Compare two to five configurations",
        parameters: [
          {
            name: "ids",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Comma-separated configuration ids.",
          },
        ],
        responses: { "200": { description: "The comparison and its analysis." } },
      },
    },
    "/recommendations": {
      get: {
        summary: "Ranked recommendations with their reasoning",
        parameters: [
          { name: "budget", in: "query", schema: { type: "number" } },
          { name: "min_ram", in: "query", schema: { type: "integer" } },
          { name: "preferred_size", in: "query", schema: { type: "number" } },
          { name: "display", in: "query", schema: { type: "string" } },
          { name: "use_case", in: "query", schema: { type: "string" } },
          { name: "max_weight", in: "query", schema: { type: "number" } },
          { name: "region", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", maximum: 10 } },
        ],
        responses: { "200": { description: "The ranked recommendations." } },
      },
    },
  },
} as const;
