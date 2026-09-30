import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

function extractModels(schemaContent: string): Map<string, Set<string>> {
  const models = new Map<string, Set<string>>();
  const lines = schemaContent.split("\n");
  let currentModel: string | null = null;
  let currentFields = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (line.startsWith("model ")) {
      const match = line.match(/^model\s+([A-Za-z0-9_]+)\s*\{?/);
      if (match) {
        currentModel = match[1];
        currentFields = new Set<string>();
        models.set(currentModel, currentFields);
      }
    } else if (trimmed === "}" && currentModel) {
      currentModel = null;
    } else if (currentModel && trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("@@")) {
      const fieldMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+/);
      if (fieldMatch) {
        currentFields.add(fieldMatch[1]);
      }
    }
  }

  return models;
}

describe("Schema Parity Verification (SQLite <-> PostgreSQL)", () => {
  const sqliteSchemaPath = path.resolve(__dirname, "../prisma/schema.prisma");
  const postgresSchemaPath = path.resolve(__dirname, "../prisma/schema.postgres.prisma");

  it("both schema files exist on disk", () => {
    expect(fs.existsSync(sqliteSchemaPath)).toBe(true);
    expect(fs.existsSync(postgresSchemaPath)).toBe(true);
  });

  it("PostgreSQL schema contains all models defined in SQLite schema", () => {
    const sqliteContent = fs.readFileSync(sqliteSchemaPath, "utf-8");
    const postgresContent = fs.readFileSync(postgresSchemaPath, "utf-8");

    const sqliteModels = extractModels(sqliteContent);
    const postgresModels = extractModels(postgresContent);

    for (const [modelName, fields] of sqliteModels.entries()) {
      expect(postgresModels.has(modelName), `Model ${modelName} missing from PostgreSQL schema`).toBe(true);
      const pgFields = postgresModels.get(modelName)!;
      for (const field of fields) {
        expect(pgFields.has(field), `Field ${modelName}.${field} missing from PostgreSQL schema`).toBe(true);
      }
    }
  });

  it("PostgreSQL schema contains CertifiedSkuSpec and RawObservation with provenance fields", () => {
    const postgresContent = fs.readFileSync(postgresSchemaPath, "utf-8");
    const postgresModels = extractModels(postgresContent);

    expect(postgresModels.has("CertifiedSkuSpec")).toBe(true);
    const certFields = postgresModels.get("CertifiedSkuSpec")!;
    expect(certFields.has("energyStarId")).toBe(true);
    expect(certFields.has("cpuBrand")).toBe(true);
    expect(certFields.has("ramGb")).toBe(true);
    expect(certFields.has("displaySizeIn")).toBe(true);

    expect(postgresModels.has("RawObservation")).toBe(true);
    const rawFields = postgresModels.get("RawObservation")!;
    expect(rawFields.has("payloadHash")).toBe(true);
    expect(rawFields.has("status")).toBe(true);
  });
});
