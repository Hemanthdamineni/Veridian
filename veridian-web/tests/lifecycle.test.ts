import { describe, it, expect } from "vitest";
import {
  deriveLifecycle,
  lifecycleAssignments,
  parseGenerationMarker,
  type LifecycleModelInput,
} from "@/lib/lifecycle";

/**
 * A model in a family. The derivation only ever looks at the name, the
 * family and the date the product reached the market.
 */
function model(overrides: Partial<LifecycleModelInput> & { id: string; name: string }): LifecycleModelInput {
  return {
    seriesId: "series-1",
    seriesName: "ThinkPad E14",
    manufacturerName: "Lenovo",
    launchDate: new Date("2025-04-17T00:00:00.000Z"),
    ...overrides,
  };
}

describe("parseGenerationMarker", () => {
  it("reads the generation markers manufacturers write into product names", () => {
    expect(parseGenerationMarker("ThinkPad E14 Gen 8").marker).toMatchObject({ kind: "gen", value: 8 });
    expect(parseGenerationMarker("Surface Laptop 8th Edition").marker).toMatchObject({ kind: "edition", value: 8 });
    expect(parseGenerationMarker("IdeaPad 2nd Gen").marker).toMatchObject({ kind: "gen", value: 2 });
    expect(parseGenerationMarker("EliteBook 640 G11").marker).toMatchObject({ kind: "g", value: 11 });
    expect(parseGenerationMarker("MacBook Pro 14 (M4 Pro)").marker).toMatchObject({ kind: "chip", value: 4 });
    expect(parseGenerationMarker("Zephyrus (2025)").marker).toMatchObject({ kind: "year", value: 2025 });
  });

  it("leaves the product line in the name when it strips the marker", () => {
    expect(parseGenerationMarker("ThinkPad E14 Gen 8").baseName).toBe("ThinkPad E14");
    expect(parseGenerationMarker("Surface Laptop 13\" 2nd Edition").baseName).toBe("Surface Laptop 13\"");
  });

  it("does not mistake a chassis code for a generation", () => {
    // A part number that merely contains letters and digits is not a marker.
    expect(parseGenerationMarker("AG15-I31P").marker).toBeNull();
    expect(parseGenerationMarker("B1403CVA").marker).toBeNull();
    expect(parseGenerationMarker("Centerm Chromebook M610").marker).toBeNull();
    expect(parseGenerationMarker("Lenovo Chrome 100e G5 M89").marker?.kind).toBe("g");
  });
});

describe("deriveLifecycle — asserted links", () => {
  it("links two generations of one family, with the right direction", () => {
    const result = deriveLifecycle([
      model({ id: "m7", name: "ThinkPad E14 Gen 7", launchDate: new Date("2025-04-17T00:00:00.000Z") }),
      model({ id: "m8", name: "ThinkPad E14 Gen 8", launchDate: new Date("2026-04-17T00:00:00.000Z") }),
    ]);

    expect(result.links).toHaveLength(1);
    const [link] = result.links;
    expect(link.predecessorId).toBe("m7");
    expect(link.successorId).toBe("m8");
    expect(link.predecessorMarker.value).toBe(7);
    expect(link.successorMarker.value).toBe(8);
    expect(link.seriesName).toBe("ThinkPad E14");
  });

  it("carries the evidence that produced the link", () => {
    const result = deriveLifecycle([
      model({ id: "m7", name: "ThinkPad E14 Gen 7", launchDate: new Date("2025-04-17T00:00:00.000Z") }),
      model({ id: "m8", name: "ThinkPad E14 Gen 8", launchDate: new Date("2026-04-17T00:00:00.000Z") }),
    ]);

    const fields = result.links[0].evidence.map((item) => item.field);
    expect(fields).toContain("name");
    expect(fields).toContain("generation marker");
    expect(fields).toContain("launchDate");

    const dateEvidence = result.links[0].evidence.find((item) => item.field === "launchDate");
    expect(dateEvidence?.from).toBe("2025-04-17");
    expect(dateEvidence?.to).toBe("2026-04-17");
  });

  it("orders a chain of three generations", () => {
    const result = deriveLifecycle([
      model({ id: "m6", name: "ThinkPad E14 Gen 6", launchDate: new Date("2024-03-19T00:00:00.000Z") }),
      model({ id: "m7", name: "ThinkPad E14 Gen 7", launchDate: new Date("2025-04-17T00:00:00.000Z") }),
      model({ id: "m8", name: "ThinkPad E14 Gen 8", launchDate: new Date("2026-04-17T00:00:00.000Z") }),
    ]);

    expect(result.links.map((link) => [link.predecessorId, link.successorId])).toEqual([
      ["m6", "m7"],
      ["m7", "m8"],
    ]);
    expect(result.families[0].chains[0].generations.map((generation) => generation.value)).toEqual([6, 7, 8]);
  });

  it("does not link models that belong to different families", () => {
    const result = deriveLifecycle([
      model({ id: "e14", name: "ThinkPad E14 Gen 8", launchDate: new Date("2026-04-17T00:00:00.000Z") }),
      model({
        id: "e16",
        name: "ThinkPad E16 Gen 8",
        seriesId: "series-2",
        seriesName: "ThinkPad E16",
        launchDate: new Date("2026-04-17T00:00:00.000Z"),
      }),
    ]);

    expect(result.links).toHaveLength(0);
  });
});

describe("deriveLifecycle — what is never asserted", () => {
  it("does not link two models that carry the same generation marker", () => {
    const result = deriveLifecycle([
      model({ id: "g4", name: "500e Chromebook Gen 4", launchDate: new Date("2024-01-10T00:00:00.000Z") }),
      model({ id: "g4s", name: "500e Chromebook Gen 4s", launchDate: new Date("2024-06-01T00:00:00.000Z") }),
    ]);

    expect(result.links).toHaveLength(0);
  });

  it("does not link two models of one family that carry the same marker", () => {
    const result = deriveLifecycle([
      model({ id: "g8", name: "ThinkPad E14 Gen 8", launchDate: new Date("2026-04-17T00:00:00.000Z") }),
      model({ id: "g8amd", name: "ThinkPad E14 Gen 8 AMD", launchDate: new Date("2026-05-01T00:00:00.000Z") }),
    ]);

    expect(result.links).toHaveLength(0);
  });

  it("produces no link when a launch date is missing", () => {
    const result = deriveLifecycle([
      model({ id: "m7", name: "ThinkPad E14 Gen 7", launchDate: null }),
      model({ id: "m8", name: "ThinkPad E14 Gen 8", launchDate: new Date("2026-04-17T00:00:00.000Z") }),
    ]);

    expect(result.links).toHaveLength(0);
    expect(result.ambiguities.map((ambiguity) => ambiguity.kind)).toContain("missing-launch-date");
  });

  it("produces no link when the launch dates contradict the markers", () => {
    const result = deriveLifecycle([
      model({ id: "m7", name: "ThinkPad E14 Gen 7", launchDate: new Date("2026-04-17T00:00:00.000Z") }),
      model({ id: "m8", name: "ThinkPad E14 Gen 8", launchDate: new Date("2025-04-17T00:00:00.000Z") }),
    ]);

    expect(result.links).toHaveLength(0);
    expect(result.ambiguities.map((ambiguity) => ambiguity.kind)).toContain("launch-date-contradiction");
  });
});

describe("deriveLifecycle — ambiguous cases are reported, not asserted", () => {
  it("reports a date-only ordering as ambiguous when no name carries a marker", () => {
    const result = deriveLifecycle([
      model({ id: "a", name: "B1403CVA", launchDate: new Date("2024-02-01T00:00:00.000Z") }),
      model({ id: "b", name: "B1403CTA", launchDate: new Date("2025-06-01T00:00:00.000Z") }),
    ]);

    expect(result.links).toHaveLength(0);
    expect(result.ambiguities).toHaveLength(1);
    expect(result.ambiguities[0].kind).toBe("date-only-order");
    expect(result.ambiguities[0].fromModel?.id).toBe("a");
    expect(result.ambiguities[0].toModel?.id).toBe("b");
  });

  it("reports two different kinds of marker in one line as incomparable", () => {
    const result = deriveLifecycle([
      model({ id: "a", name: "Family Gen 7", launchDate: new Date("2024-02-01T00:00:00.000Z") }),
      model({ id: "b", name: "Family 8th Edition", launchDate: new Date("2025-06-01T00:00:00.000Z") }),
    ]);

    expect(result.links).toHaveLength(0);
    expect(result.ambiguities.map((ambiguity) => ambiguity.kind)).toContain("incomparable-markers");
  });

  it("keeps the ambiguity attached to the family it came from", () => {
    const result = deriveLifecycle([
      model({ id: "a", name: "B1403CVA", launchDate: new Date("2024-02-01T00:00:00.000Z") }),
      model({ id: "b", name: "B1403CTA", launchDate: new Date("2025-06-01T00:00:00.000Z") }),
    ]);

    expect(result.ambiguities[0].seriesName).toBe("ThinkPad E14");
    expect(result.ambiguities[0].manufacturerName).toBe("Lenovo");
    expect(result.families[0].ambiguities).toHaveLength(1);
  });
});

describe("deriveLifecycle — determinism and idempotency", () => {
  const models: LifecycleModelInput[] = [
    model({ id: "m6", name: "ThinkPad E14 Gen 6", launchDate: new Date("2024-03-19T00:00:00.000Z") }),
    model({ id: "m7", name: "ThinkPad E14 Gen 7", launchDate: new Date("2025-04-17T00:00:00.000Z") }),
    model({ id: "m8", name: "ThinkPad E14 Gen 8", launchDate: new Date("2026-04-17T00:00:00.000Z") }),
    model({ id: "x1", name: "B1403CVA", launchDate: new Date("2024-02-01T00:00:00.000Z") }),
    model({ id: "x2", name: "B1403CTA", launchDate: new Date("2025-06-01T00:00:00.000Z") }),
  ];

  it("derives the same result every time it runs on the same input", () => {
    const first = deriveLifecycle(models);
    const second = deriveLifecycle(models);

    expect(second.links).toEqual(first.links);
    expect(second.ambiguities).toEqual(first.ambiguities);
    expect(second.seriesExamined).toBe(first.seriesExamined);
  });

  it("is idempotent: writing the derived links changes nothing on a second pass", () => {
    const first = deriveLifecycle(models);
    const assignments = lifecycleAssignments(first, models);

    // Apply the derived links, exactly as the CLI writes them.
    const applied = models.map((entry) => {
      const assignment = assignments.find((item) => item.modelId === entry.id)!;
      return { ...entry, predecessorId: assignment.predecessorId, successorId: assignment.successorId };
    });

    const second = deriveLifecycle(applied);
    const secondAssignments = lifecycleAssignments(second, applied);

    expect(second.links).toEqual(first.links);
    expect(secondAssignments).toEqual(assignments);
  });

  it("assigns a successor and a predecessor to both ends of a link", () => {
    const result = deriveLifecycle(models);
    const assignments = lifecycleAssignments(result, models);
    const byId = new Map(assignments.map((assignment) => [assignment.modelId, assignment]));

    expect(byId.get("m6")?.successorId).toBe("m7");
    expect(byId.get("m6")?.predecessorId).toBeNull();
    expect(byId.get("m7")?.predecessorId).toBe("m6");
    expect(byId.get("m7")?.successorId).toBe("m8");
    expect(byId.get("m8")?.predecessorId).toBe("m7");
    expect(byId.get("m8")?.successorId).toBeNull();
    // A model with no evidence carries no link at all.
    expect(byId.get("x1")?.successorId).toBeNull();
    expect(byId.get("x1")?.predecessorId).toBeNull();
  });
});
