import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { parse } from "csv-parse/sync";
import {
  ACCEPTED_FINDINGS,
  EXPECTED_HEADER,
  PART_NUMBER_FORMATS,
  PUBLISHED_CPU_CORES,
  PUBLISHED_NPU_TOPS,
  auditReferenceDataset,
} from "../scripts/audit-reference-dataset";
import {
  FIELD_FIXES,
  applyReferenceDatasetFixes,
  detectLineEnding,
  serialiseReferenceDataset,
} from "../scripts/fix-reference-dataset";

const DATASET = path.join(process.cwd(), "data", "laptops.csv");
const AUDIT_SCRIPT = path.join(process.cwd(), "scripts", "audit-reference-dataset.ts");
const TSX_CLI = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

interface Row {
  [column: string]: string;
}

const datasetText = fs.readFileSync(DATASET, "utf-8");
const rows = parse(datasetText, { columns: true, skip_empty_lines: true }) as Row[];

/** Replace the value of one column in one row of the raw CSV text. */
function corrupt(
  text: string,
  sku: string,
  column: string,
  value: string
): string {
  const matrix = parse(text, { skip_empty_lines: true }) as string[][];
  const header = matrix[0];
  const body = matrix.slice(1);
  const columnIndex = header.indexOf(column);
  const skuIndex = header.indexOf("sku_code");
  const row = body.find((cells) => cells[skuIndex] === sku);
  if (!row) throw new Error(`no row for ${sku}`);
  row[columnIndex] = value;
  return serialiseReferenceDataset([header, ...body], detectLineEnding(text));
}

/** Run the audit script the way CI would and report its exit code. */
function runAudit(csvPath: string): { status: number | null; output: string } {
  const result = spawnSync(
    process.execPath,
    [TSX_CLI, AUDIT_SCRIPT, "--csv", csvPath],
    { encoding: "utf-8", cwd: process.cwd() }
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe("the reference dataset parses the way the seed script reads it", () => {
  it("keeps the exact header and column order the seed script expects", () => {
    const header = parse(datasetText, { skip_empty_lines: true })[0];
    expect(header).toEqual([...EXPECTED_HEADER]);
  });

  it("gives every row the same number of fields", () => {
    const matrix = parse(datasetText, { skip_empty_lines: true }) as string[][];
    for (const [index, row] of matrix.slice(1).entries()) {
      expect(row.length, `line ${index + 2}`).toBe(EXPECTED_HEADER.length);
    }
  });

  it("exposes every column the seed script reads", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const column of EXPECTED_HEADER) {
        expect(Object.prototype.hasOwnProperty.call(row, column)).toBe(true);
      }
    }
  });

  it("keeps the CRLF line endings the file is stored with", () => {
    expect(datasetText).toContain("\r\n");
    expect(detectLineEnding(datasetText)).toBe("\r\n");
  });
});

describe("the reference dataset is internally consistent", () => {
  it("reports no unresolved defect", () => {
    const result = auditReferenceDataset(datasetText);
    const unresolved = result.unresolved.map((finding) => `${finding.check}: ${finding.sample}`);
    expect(unresolved).toEqual([]);
  });

  it("uses no part number twice", () => {
    const partNumbers = rows.map((row) => row.sku_code);
    expect(new Set(partNumbers).size).toBe(partNumbers.length);
  });

  it("describes no configuration twice", () => {
    const signature = (row: Row) =>
      [
        row.manufacturer,
        row.model,
        row.cpu_model,
        row.ram_gb,
        row.storage_gb,
        row.display_size,
        row.display_resolution,
        row.display_type,
        row.display_refresh,
        row.display_touch,
      ].join("|");
    const signatures = rows.map(signature);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("gives every part number the format its manufacturer publishes, or a documented flag", () => {
    for (const row of rows) {
      const format = PART_NUMBER_FORMATS[row.manufacturer];
      expect(format, `${row.sku_code}: unknown manufacturer`).toBeDefined();
      if (format!.pattern.test(row.sku_code)) continue;
      expect(
        ACCEPTED_FINDINGS[`part-number/format:${row.sku_code}`],
        `${row.sku_code}: the part number matches no published format and is not documented`
      ).toBeDefined();
    }
  });

  it("records the published NPU figure and core count for every processor it names", () => {
    for (const row of rows) {
      const cores = PUBLISHED_CPU_CORES[row.cpu_model];
      if (cores !== undefined) {
        expect(Number(row.cpu_cores), `${row.sku_code}: core count`).toBe(cores);
      }
      const npu = PUBLISHED_NPU_TOPS[row.cpu_model];
      if (npu !== undefined && row.npu_tops !== "") {
        expect(Number(row.npu_tops), `${row.sku_code}: NPU figure`).toBe(npu);
      }
    }
  });

  it("prices a better configuration of the same model no lower than a worse one", () => {
    const byModel = new Map<string, Row[]>();
    for (const row of rows) {
      const key = `${row.manufacturer}|${row.model}`;
      byModel.set(key, [...(byModel.get(key) ?? []), row]);
    }
    for (const [key, siblings] of byModel) {
      for (const row of siblings) {
        for (const other of siblings) {
          if (row === other) continue;
          const score = (r: Row) => Number(r.ram_gb) + Number(r.storage_gb) / 8;
          if (score(row) > score(other)) {
            expect(
              Number(row.price_usd),
              `${key}: ${row.sku_code} against ${other.sku_code}`
            ).toBeGreaterThanOrEqual(Number(other.price_usd));
          }
        }
      }
    }
  });

  it("implies an exchange rate that is plausible and consistent inside a manufacturer", () => {
    const byManufacturer = new Map<string, number[]>();
    for (const row of rows) {
      if (!row.price_inr) continue;
      const rate = Number(row.price_inr) / Number(row.price_usd);
      expect(rate, `${row.sku_code}: exchange rate`).toBeGreaterThan(70);
      expect(rate, `${row.sku_code}: exchange rate`).toBeLessThan(120);
      byManufacturer.set(row.manufacturer, [
        ...(byManufacturer.get(row.manufacturer) ?? []),
        rate,
      ]);
    }
    for (const [manufacturer, rates] of byManufacturer) {
      const spread = Math.max(...rates) - Math.min(...rates);
      expect(spread, `${manufacturer}: exchange rate spread`).toBeLessThanOrEqual(8);
    }
  });

  it("publishes a price only for the region it is published in", () => {
    for (const row of rows) {
      expect(Boolean(row.price_usd), `${row.sku_code}: US price`).toBe(row.region_us === "true");
      expect(Boolean(row.price_inr), `${row.sku_code}: IN price`).toBe(row.region_in === "true");
    }
  });
});

describe("the corrections this change set made are still in place", () => {
  const find = (sku: string) => {
    const row = rows.find((candidate) => candidate.sku_code === sku);
    if (!row) throw new Error(`no row for ${sku}`);
    return row;
  };

  it("records the NPU figure the manufacturer publishes for the Core Ultra 9 285H", () => {
    for (const sku of ["UX8406CA-MY123WS", "83A3000VUS", "9640-1628SIL", "9440-1628BLU"]) {
      expect(find(sku).npu_tops, sku).toBe("13");
    }
  });

  it("records the touch panel the manufacturer publishes for the ASUS families", () => {
    for (const sku of ["UX3405CA-UQ123WS", "UX3405CA-UQ124WS", "UX8406CA-MY123WS"]) {
      expect(find(sku).display_touch, sku).toBe("true");
    }
  });

  it("records the processor, graphics, panel and slots the ProArt P16 H7606WI ships with", () => {
    const proart = find("H7606WI-MY123WS");
    expect(proart.cpu_brand).toBe("AMD");
    expect(proart.cpu_model).toBe("Ryzen AI 9 HX 370");
    expect(proart.cpu_cores).toBe("12");
    expect(proart.gpu_model).toBe("NVIDIA GeForce RTX 4070 Laptop GPU");
    expect(proart.npu_tops).toBe("50");
    expect(proart.display_refresh).toBe("60");
    expect(proart.storage_slots).toBe("2");
    expect(proart.source_url).toBe(
      "https://www.asus.com/us/laptops/for-creators/proart/proart-p16-h7606/techspec/"
    );
  });

  it("prices the 24 GB MacBook Air 13 at the tier Apple charges for it", () => {
    const air = find("MRXN3LL/A");
    expect(air.price_usd).toBe("1399");
    expect(air.price_inr).toBe("134900");
  });
});

describe("the audit script fails on a dataset that has rotted", () => {
  let workspace = "";

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veridian-reference-"));
  });

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const write = (name: string, text: string): string => {
    const target = path.join(workspace, name);
    fs.writeFileSync(target, text, "utf-8");
    return target;
  };

  it("exits zero on the real dataset", () => {
    const result = runAudit(DATASET);
    expect(result.status, result.output).toBe(0);
  });

  it("exits non-zero on a duplicated part number", () => {
    const corrupted = corrupt(datasetText, "83A3000VUS", "sku_code", "83A3000UUS");
    const result = runAudit(write("duplicate-part-number.csv", corrupted));
    expect(result.status).toBe(1);
    expect(result.output).toContain("identity/duplicate-part-number");
  });

  it("exits non-zero on an NPU figure the manufacturer does not publish", () => {
    const corrupted = corrupt(datasetText, "UX3405CA-UQ123WS", "npu_tops", "34");
    const result = runAudit(write("wrong-npu.csv", corrupted));
    expect(result.status).toBe(1);
    expect(result.output).toContain("processor/npu-tops");
  });

  it("exits non-zero on a price that does not belong to the configuration", () => {
    const corrupted = corrupt(datasetText, "MRXN3LL/A", "price_usd", "999");
    const result = runAudit(write("wrong-price.csv", corrupted));
    expect(result.status).toBe(1);
    expect(result.output).toContain("price/tier-consistency");
  });

  it("exits non-zero on a row that lost a field", () => {
    const corrupted = corrupt(datasetText, "21KC000UUS", "cpu_model", "");
    const result = runAudit(write("missing-field.csv", corrupted));
    expect(result.status).toBe(1);
    expect(result.output).toContain("structure/required-fields");
  });
});

describe("the repair script is deterministic and idempotent", () => {
  it("changes nothing when the dataset is already correct", () => {
    const outcome = applyReferenceDatasetFixes(datasetText);
    expect(outcome.applied).toEqual([]);
    expect(outcome.unmatched).toEqual([]);
    expect(outcome.csv).toBe(datasetText);
  });

  it("applies every correction it declares and none of them twice", () => {
    const outcome = applyReferenceDatasetFixes(datasetText);
    expect(outcome.alreadyApplied.length).toBe(FIELD_FIXES.length);

    const second = applyReferenceDatasetFixes(outcome.csv);
    expect(second.applied).toEqual([]);
    expect(second.csv).toBe(outcome.csv);
  });

  it("restores a value that was reverted", () => {
    const reverted = corrupt(datasetText, "UX3405CA-UQ123WS", "display_touch", "false");
    const outcome = applyReferenceDatasetFixes(reverted);
    expect(
      outcome.applied.map((fix) => `${fix.sku}.${fix.field}`),
    ).toEqual(["UX3405CA-UQ123WS.display_touch"]);
    expect(outcome.csv).toContain(",true,500,1.28,75,18,13,Windows 11 Home");
  });

  it("refuses to force a correction onto a row that has drifted", () => {
    const drifted = corrupt(datasetText, "UX3405CA-UQ123WS", "display_touch", "maybe");
    const outcome = applyReferenceDatasetFixes(drifted);
    expect(outcome.unmatched.map((fix) => `${fix.sku}.${fix.field}`)).toEqual([
      "UX3405CA-UQ123WS.display_touch",
    ]);
  });

  it("keeps the header and the line endings when it writes", () => {
    const outcome = applyReferenceDatasetFixes(datasetText);
    const header = parse(outcome.csv, { skip_empty_lines: true })[0];
    expect(header).toEqual([...EXPECTED_HEADER]);
    expect(outcome.csv).toContain("\r\n");
  });
});
