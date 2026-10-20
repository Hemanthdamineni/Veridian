#!/usr/bin/env node
/**
 * Generate `prisma/schema.postgres.prisma` from `prisma/schema.prisma`.
 *
 * The two engines must expose exactly the same models and fields; keeping two
 * hand-written files in sync is what allowed the catalog schema to drift
 * (the PostgreSQL file had six models the SQLite file did not, and the parity
 * test only checked one direction). This script removes that class of defect:
 * the SQLite schema is the single source of truth and the PostgreSQL schema is
 * a mechanical, reviewable projection of it.
 *
 * Transformation rules:
 *   * `cuid()` ids become `uuid()` with `@db.Uuid`.
 *   * Foreign keys become UUID columns.
 *   * camelCase field names are mapped to snake_case columns.
 *   * Model names become snake_case table names.
 *
 * Usage: node scripts/generate-postgres-schema.mjs [--check]
 *   --check  fail (exit 1) when the generated file differs from the one on
 *            disk, without writing anything. Used by CI.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const prismaDir = path.join(here, "..", "prisma");
const sourcePath = path.join(prismaDir, "schema.prisma");
const targetPath = path.join(prismaDir, "schema.postgres.prisma");

/** Table names that are not the mechanical plural of the model name. */
const TABLE_NAME_OVERRIDES = {
  SkuRegionalPricing: "sku_regional_pricing",
  PriceHistory: "price_history",
  Sku: "skus",
  ApiKey: "api_keys",
  // "series" is already plural; the mechanical rule would produce "serieses".
  Series: "series",
};

/** Foreign-key field name -> the model it points at. */
const FOREIGN_KEYS = {
  skuId: "Sku",
  modelId: "Model",
  seriesId: "Series",
  manufacturerId: "Manufacturer",
  userId: "User",
  sellerId: "Seller",
  listingId: "RetailerListing",
  categoryId: "Category",
  contributionId: "Contribution",
  componentId: "Component",
};

function snakeCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function pluralize(word) {
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

function tableNameFor(model) {
  if (TABLE_NAME_OVERRIDES[model]) return TABLE_NAME_OVERRIDES[model];
  return pluralize(snakeCase(model));
}

/**
 * Parse the Prisma schema into models with their raw field lines and their
 * block-level attributes (`@@index`, `@@unique`, `@@map`).
 *
 * A field named `model` (for example `model Model @relation(...)`) must not be
 * mistaken for a model declaration, so the declaration pattern requires an
 * opening brace.
 */
function parseSchema(source) {
  const lines = source.split("\n");
  const models = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const declaration = /^model\s+(\w+)\s*\{/.exec(line);
    if (declaration) {
      current = { name: declaration[1], fields: [], attributes: [] };
      models.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("}")) {
      current = null;
      continue;
    }
    if (line.startsWith("@@")) {
      current.attributes.push(line);
      continue;
    }
    if (!line || line.startsWith("//")) continue;
    current.fields.push(line);
  }
  return models;
}

/** True when the field's type is a relation to another model. */
function isRelationField(line, modelNames) {
  const type = line.split(/\s+/)[1] ?? "";
  const bare = type.replace(/\[\]$/, "");
  return modelNames.has(bare);
}

/** Transform one field line for PostgreSQL. */
function transformField(line, modelNames) {
  // Strip an existing @map so the transformation is idempotent.
  const withoutMap = line.replace(/\s*@map\("[^"]*"\)/g, "");

  if (isRelationField(withoutMap, modelNames)) {
    // Relation fields carry no column and must not be mapped.
    return withoutMap;
  }

  const isId = /^id\s+/.test(withoutMap);
  const fieldName = withoutMap.split(/\s+/)[0];
  const isForeignKey = Object.prototype.hasOwnProperty.call(FOREIGN_KEYS, fieldName);

  let out = withoutMap;
  if (isId) {
    out = out.replace("@default(cuid())", "@default(uuid())");
    out = `${out} @db.Uuid`;
  } else if (isForeignKey) {
    out = `${out} @db.Uuid`;
  }

  const column = snakeCase(fieldName);
  if (column !== fieldName) {
    out = `${out} @map("${column}")`;
  }
  return out;
}

function generate(models) {
  const modelNames = new Set(models.map((m) => m.name));
  const out = [];
  out.push("// Veridian Database Schema — PostgreSQL edition.");
  out.push("//");
  out.push("// GENERATED FILE — do not edit by hand.");
  out.push("// Run `npm run db:schema:pg` to regenerate it from prisma/schema.prisma.");
  out.push("// The SQLite schema is the single source of truth; this file is its");
  out.push("// physical projection (UUID ids, snake_case columns). The parity test");
  out.push("// enforces that both engines expose the same models and fields.");
  out.push("");
  out.push("generator client {");
  out.push('  provider = "prisma-client-js"');
  out.push("}");
  out.push("");
  out.push("datasource db {");
  out.push('  provider = "postgresql"');
  out.push('  url      = env("DATABASE_URL")');
  out.push("}");

  for (const model of models) {
    out.push("");
    out.push(`model ${model.name} {`);
    for (const field of model.fields) {
      out.push(`  ${transformField(field, modelNames)}`);
    }
    for (const attribute of model.attributes) {
      // The SQLite file carries no @@map directives; table names are derived.
      if (attribute.startsWith("@@map")) continue;
      out.push(`  ${attribute}`);
    }
    out.push(`  @@map("${tableNameFor(model.name)}")`);
    out.push("}");
  }
  out.push("");
  return out.join("\n");
}

const source = fs.readFileSync(sourcePath, "utf8");
const models = parseSchema(source);
const generated = generate(models);

if (process.argv.includes("--check")) {
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      "prisma/schema.postgres.prisma is out of date with prisma/schema.prisma.\n" +
        "Run `npm run db:schema:pg` to regenerate it."
    );
    process.exit(1);
  }
  console.log("PostgreSQL schema is in sync with the SQLite schema.");
} else {
  fs.writeFileSync(targetPath, generated, "utf8");
  console.log(
    `Wrote ${path.relative(process.cwd(), targetPath)} (${models.length} models) from ` +
      `${path.relative(process.cwd(), sourcePath)}.`
  );
}
