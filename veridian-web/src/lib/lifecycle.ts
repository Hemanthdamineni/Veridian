/**
 * Product lifecycle: predecessor / successor relationships inside a family.
 *
 * The catalog knows a *family* ("ThinkPad E14") and the *models* inside it
 * ("ThinkPad E14 Gen 8", "ThinkPad E14 Gen 7"). It also knows, for every
 * certified configuration, the date the manufacturer put the product on the
 * market (`date_available_on_market`, stored as `Model.launchDate`).
 *
 * A lifecycle link says: this model is the earlier generation of that one.
 * Nothing in the source states that. It is derived, from two pieces of
 * evidence that the source *does* carry:
 *
 *  1. **A generation marker in the model name.** "Gen 8", "8th Edition",
 *     "2nd Gen", "G11", "(M4)" and a bare year ("2025") all name a
 *     generation. A name carrying a marker is a generation, and a name
 *     carrying a *strictly later* marker is a later generation of the same
 *     line.
 *  2. **The date the product reached the market.** The certification date
 *     is an independent witness to the ordering: if the later generation
 *     also reached the market later, the direction is confirmed.
 *
 * The rules are deliberately strict, because a wrong lineage is worse than
 * a missing one:
 *
 *  - Two models with the *same* marker are not a successor pair. They are
 *    two configurations of one generation.
 *  - A missing launch date is not evidence of anything. A pair whose order
 *    cannot be confirmed is reported as ambiguous, never asserted.
 *  - A launch date that contradicts the markers is reported as ambiguous.
 *  - Models that carry no marker at all are ordered by date only. That is a
 *    weaker signal and it is reported as such — it is never written to the
 *    catalog as a link.
 *
 * Every link therefore carries the evidence that produced it: which fields
 * were compared and what the values were, so a reader can check the
 * reasoning instead of taking it on trust.
 */

// =============================================================================
// TYPES
// =============================================================================

/** The kinds of generation marker Veridian recognises in a model name. */
export type GenerationMarkerKind = "gen" | "edition" | "g" | "chip" | "year";

/** A generation marker found in a model name. */
export interface GenerationMarker {
  kind: GenerationMarkerKind;
  /** The marker exactly as it appears in the name, e.g. "Gen 8". */
  text: string;
  /** The comparable number, e.g. 8 for both "Gen 8" and "8th Edition". */
  value: number;
  /** A qualifier attached to the marker, e.g. "s" in "Gen 4s", "+" in "G8+". */
  qualifier: string | null;
}

/** A model name split into the line it belongs to and its generation marker. */
export interface ParsedModelName {
  /**
   * The name with the generation marker removed — the product line inside
   * the family, e.g. "ThinkPad E14" for "ThinkPad E14 Gen 8".
   */
  baseName: string;
  /** The generation marker, when the name carries one. */
  marker: GenerationMarker | null;
}

/** One field comparison that supports (or fails to support) a relationship. */
export interface LifecycleEvidence {
  /** The field that was compared, e.g. "name" or "launchDate". */
  field: string;
  /** The value found on the earlier side. */
  from: string;
  /** The value found on the later side. */
  to: string;
  /** What the comparison means for the relationship. */
  note: string;
}

/** The model fields the derivation needs. */
export interface LifecycleModelInput {
  id: string;
  name: string;
  seriesId: string;
  seriesName: string;
  manufacturerName: string;
  /** `date_available_on_market`, as stored on the model. */
  launchDate: Date | null;
}

/** A reference to one model inside a relationship record. */
export interface LifecycleModelRef {
  id: string;
  name: string;
  launchDate: string | null;
}

/** An asserted predecessor / successor relationship. */
export interface LifecycleLink {
  predecessorId: string;
  successorId: string;
  seriesId: string;
  seriesName: string;
  manufacturerName: string;
  /** The product line inside the family (the names apart from the marker). */
  lineName: string;
  predecessorName: string;
  successorName: string;
  predecessorMarker: GenerationMarker;
  successorMarker: GenerationMarker;
  /** ISO date, or null when the source did not report one. */
  predecessorLaunchDate: string | null;
  successorLaunchDate: string | null;
  /** The rule that produced the link. */
  basis: "generation-marker+launch-date";
  evidence: LifecycleEvidence[];
}

/** Why a candidate relationship could not be asserted. */
export type LifecycleAmbiguityKind =
  /** The markers order the pair, but a launch date is missing. */
  | "missing-launch-date"
  /** The markers order the pair, but the dates disagree with them. */
  | "launch-date-contradiction"
  /** Two different marker kinds in one line cannot be compared. */
  | "incomparable-markers"
  /** Only the certification dates order these models. */
  | "date-only-order";

/** A candidate relationship that was deliberately not asserted. */
export interface LifecycleAmbiguity {
  kind: LifecycleAmbiguityKind;
  /** A plain-language explanation of what blocked the link. */
  reason: string;
  seriesId: string;
  seriesName: string;
  manufacturerName: string;
  /** The product line, when the candidate sits inside one. */
  lineName: string | null;
  fromModel: LifecycleModelRef | null;
  toModel: LifecycleModelRef | null;
  evidence: LifecycleEvidence[];
}

/** One generation inside a chain, with every configuration that carries it. */
export interface LifecycleGeneration {
  /** The comparable generation number, e.g. 8 for "Gen 8". */
  value: number;
  /** The marker as written in the name, e.g. "Gen 8". */
  markerText: string;
  /** A qualifier attached to the marker, e.g. "s" in "Gen 4s". */
  qualifier: string | null;
  /** The model that represents the generation. */
  modelId: string;
  modelName: string;
  /** The earliest date this generation reached the market. */
  launchDate: string | null;
  /** Every model that carries this generation marker. */
  modelIds: string[];
  modelNames: string[];
}

/** An ordered run of generations inside one product line. */
export interface LifecycleChain {
  lineName: string;
  markerKind: GenerationMarkerKind;
  generations: LifecycleGeneration[];
}

/** One product family and what the derivation could say about it. */
export interface LifecycleFamily {
  seriesId: string;
  seriesName: string;
  manufacturerName: string;
  modelCount: number;
  /** The generation chains derived for this family, oldest first. */
  chains: LifecycleChain[];
  ambiguities: LifecycleAmbiguity[];
}

/** The result of a derivation run. */
export interface LifecycleDerivation {
  families: LifecycleFamily[];
  links: LifecycleLink[];
  ambiguities: LifecycleAmbiguity[];
  /** How many families (series) were examined. */
  seriesExamined: number;
  /** How many models were examined. */
  modelsExamined: number;
}

/** The successor / predecessor a model should carry. */
export interface LifecycleAssignment {
  modelId: string;
  predecessorId: string | null;
  successorId: string | null;
}

// =============================================================================
// MARKER PARSING
// =============================================================================

/** "2nd Gen" — an ordinal that names a generation. */
const ORDINAL_GEN = /\b(\d{1,2})(?:st|nd|rd|th)\s+gen(?:eration)?\b/i;
/** "Gen 8", "Gen 4s", "Generation 10". */
const GEN = /\bgen(?:eration)?[\s\-_]*(\d{1,3})(?!\d)([a-z]?)/i;
/** "8th Edition", "2nd Edition". */
const ORDINAL_EDITION = /\b(\d{1,2})(?:st|nd|rd|th)\s+edition\b/i;
/** "(M4)", "(M4 Pro)" — an Apple chip generation. */
const CHIP = /\(\s*m(\d{1,2})(?:\s+(pro|max|ultra))?\s*\)/i;
/** "G9", "G11", "G1q" — the HP / Lenovo / Chromebook generation shorthand. */
const G_SERIES = /\bG(\d{1,3})(?!\d)([a-z]?)/;
/** "2025" — a model year used as a generation marker. */
const YEAR = /\b((?:19|20)\d{2})\b/;

/**
 * Remove a leading enumeration counter, e.g. "1) ThinkPad L13" or
 * "(1) ThinkPad L13". The source adds these to a few records; they say
 * nothing about the product.
 */
function stripLeadingCounter(value: string): string {
  return value.replace(/^\(?\d+\)\s*/, "").trim();
}

/**
 * Find the generation marker in a model name, if there is one.
 *
 * The patterns are tried in a fixed order, so the same name always yields
 * the same marker. The first pattern that matches wins:
 *
 * | order | pattern        | example        | kind      |
 * |-------|----------------|----------------|-----------|
 * | 1     | ordinal + Gen  | "2nd Gen"      | `gen`     |
 * | 2     | Gen + number   | "Gen 8"        | `gen`     |
 * | 3     | ordinal + Ed.  | "8th Edition"  | `edition` |
 * | 4     | chip in ()     | "(M4 Pro)"     | `chip`    |
 * | 5     | G + number     | "G11"          | `g`       |
 * | 6     | year           | "2025"         | `year`    |
 *
 * The "G" and the chip patterns are deliberately narrow. "G" only matches
 * in upper case and only when it starts a token, so "AG15" and "16Z*90U**"
 * are not generations; a chip marker only matches inside brackets, so
 * "M610" and "M89" are chassis codes rather than chip generations.
 */
function matchMarker(name: string): { marker: GenerationMarker; index: number; length: number } | null {
  const ordinalGen = ORDINAL_GEN.exec(name);
  if (ordinalGen) {
    return {
      marker: { kind: "gen", text: ordinalGen[0], value: Number(ordinalGen[1]), qualifier: null },
      index: ordinalGen.index,
      length: ordinalGen[0].length,
    };
  }

  const gen = GEN.exec(name);
  if (gen) {
    return {
      marker: {
        kind: "gen",
        text: gen[0],
        value: Number(gen[1]),
        qualifier: gen[2] ? gen[2].toLowerCase() : null,
      },
      index: gen.index,
      length: gen[0].length,
    };
  }

  const edition = ORDINAL_EDITION.exec(name);
  if (edition) {
    return {
      marker: { kind: "edition", text: edition[0], value: Number(edition[1]), qualifier: null },
      index: edition.index,
      length: edition[0].length,
    };
  }

  const chip = CHIP.exec(name);
  if (chip) {
    return {
      marker: {
        kind: "chip",
        text: chip[0],
        value: Number(chip[1]),
        qualifier: chip[2] ? chip[2].toLowerCase() : null,
      },
      index: chip.index,
      length: chip[0].length,
    };
  }

  const gSeries = G_SERIES.exec(name);
  if (gSeries) {
    const end = gSeries.index + gSeries[0].length;
    // "G8+" is a refreshed generation; the plus is part of the marker.
    const qualified = name[end] === "+";
    return {
      marker: {
        kind: "g",
        text: qualified ? `${gSeries[0]}+` : gSeries[0],
        value: Number(gSeries[1]),
        qualifier: qualified ? "+" : gSeries[2] ? gSeries[2].toLowerCase() : null,
      },
      index: gSeries.index,
      length: qualified ? gSeries[0].length + 1 : gSeries[0].length,
    };
  }

  const year = YEAR.exec(name);
  if (year) {
    return {
      marker: { kind: "year", text: year[0], value: Number(year[1]), qualifier: null },
      index: year.index,
      length: year[0].length,
    };
  }

  return null;
}

/**
 * Split a model name into the line it belongs to and its generation marker.
 *
 * The base name is the name with the marker text removed and whitespace
 * collapsed, so "ThinkPad E14 Gen 8" and "ThinkPad E14 Gen 7" share the
 * base name "ThinkPad E14" — the same product line, two generations.
 */
export function parseGenerationMarker(name: string): ParsedModelName {
  const cleaned = name.replace(/\s+/g, " ").trim();
  const match = matchMarker(cleaned);
  if (!match) {
    return { baseName: stripLeadingCounter(cleaned), marker: null };
  }
  const baseName = `${cleaned.slice(0, match.index)} ${cleaned.slice(match.index + match.length)}`
    .replace(/\s+/g, " ")
    .trim();
  return { baseName: stripLeadingCounter(baseName), marker: match.marker };
}

/**
 * The key that decides whether two models are the same product line.
 *
 * Two models of one line must have names that are identical apart from the
 * generation marker; that is what makes them comparable at all. "Surface
 * Laptop 13\" 2nd Edition" and "Surface Laptop 13\" 1st Edition" are one
 * line; "Surface Laptop 8th Edition" is a different one, because its name
 * differs by more than the marker.
 */
export function lineKey(baseName: string): string {
  return baseName.toLowerCase().replace(/\s+/g, " ").trim();
}

// =============================================================================
// DERIVATION
// =============================================================================

function isoDate(value: Date | null): string | null {
  if (!value) return null;
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

function modelRef(model: LifecycleModelInput): LifecycleModelRef {
  return { id: model.id, name: model.name, launchDate: isoDate(model.launchDate) };
}

function compareModels(a: LifecycleModelInput, b: LifecycleModelInput): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/**
 * The model that represents a generation.
 *
 * A generation can be certified in several configurations, but
 * `Model.successorId` holds a single model. The generation is therefore
 * represented by the configuration that reached the market first — the
 * earliest certification date — with the name and the id as tie-breakers.
 * The comparison itself uses that same earliest date, so the evidence and
 * the representative always agree.
 */
function pickRepresentative(group: LifecycleModelInput[]): LifecycleModelInput {
  return [...group].sort((a, b) => {
    const aTime = a.launchDate ? a.launchDate.getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.launchDate ? b.launchDate.getTime() : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return compareModels(a, b);
  })[0];
}

/** The earliest date a group of models reached the market. */
function earliestDate(group: LifecycleModelInput[]): Date | null {
  let earliest: Date | null = null;
  for (const model of group) {
    if (!model.launchDate || Number.isNaN(model.launchDate.getTime())) continue;
    if (!earliest || model.launchDate.getTime() < earliest.getTime()) earliest = model.launchDate;
  }
  return earliest;
}

interface LineMember {
  model: LifecycleModelInput;
  parsed: ParsedModelName;
}

/**
 * Derive the lifecycle relationships of a catalog.
 *
 * The function is pure: it reads the models it is given and returns the
 * links, the ambiguities and the per-family view. It never touches a
 * database, so the same input always produces the same output.
 */
export function deriveLifecycle(models: LifecycleModelInput[]): LifecycleDerivation {
  const links: LifecycleLink[] = [];
  const ambiguities: LifecycleAmbiguity[] = [];
  const families: LifecycleFamily[] = [];

  const bySeries = new Map<string, LifecycleModelInput[]>();
  for (const model of models) {
    const list = bySeries.get(model.seriesId) ?? [];
    list.push(model);
    bySeries.set(model.seriesId, list);
  }

  const orderedSeries = [...bySeries.entries()].sort(([, a], [, b]) => {
    const nameA = `${a[0].manufacturerName} ${a[0].seriesName}`;
    const nameB = `${b[0].manufacturerName} ${b[0].seriesName}`;
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    return a[0].seriesId < b[0].seriesId ? -1 : 1;
  });

  for (const [, members] of orderedSeries) {
    const sorted = [...members].sort(compareModels);
    const head = sorted[0];
    const family: LifecycleFamily = {
      seriesId: head.seriesId,
      seriesName: head.seriesName,
      manufacturerName: head.manufacturerName,
      modelCount: sorted.length,
      chains: [],
      ambiguities: [],
    };

    // Group the family into product lines: the models whose names are
    // identical apart from their generation marker.
    const lines = new Map<string, LineMember[]>();
    for (const model of sorted) {
      const parsed = parseGenerationMarker(model.name);
      const key = lineKey(parsed.baseName);
      const list = lines.get(key) ?? [];
      list.push({ model, parsed });
      lines.set(key, list);
    }

    for (const key of [...lines.keys()].sort()) {
      const lineMembers = lines.get(key)!;
      const withMarker = lineMembers.filter((member) => member.parsed.marker !== null);
      if (withMarker.length === 0) continue;

      const baseName = lineMembers[0].parsed.baseName;
      const kinds = [...new Set(withMarker.map((member) => member.parsed.marker!.kind))].sort();

      if (kinds.length > 1) {
        family.ambiguities.push({
          kind: "incomparable-markers",
          reason: `The line carries ${kinds.length} different kinds of generation marker (${kinds.join(", ")}), so no two models in it can be ordered.`,
          seriesId: family.seriesId,
          seriesName: family.seriesName,
          manufacturerName: family.manufacturerName,
          lineName: baseName,
          fromModel: null,
          toModel: null,
          evidence: kinds.map((kind) => ({
            field: "name",
            from: withMarker.find((member) => member.parsed.marker!.kind === kind)!.model.name,
            to: "",
            note: `A ${kind} marker was found in this line.`,
          })),
        });
      }

      // Compare the generations of one marker kind at a time. Markers of
      // different kinds are not comparable, so each kind is handled alone.
      for (const kind of kinds) {
        const sameKind = withMarker.filter((member) => member.parsed.marker!.kind === kind);
        const byValue = new Map<number, LineMember[]>();
        for (const member of sameKind) {
          const value = member.parsed.marker!.value;
          const list = byValue.get(value) ?? [];
          list.push(member);
          byValue.set(value, list);
        }
        const values = [...byValue.keys()].sort((a, b) => a - b);
        if (values.length < 2) continue;

        const generations: LifecycleGeneration[] = [];
        for (const value of values) {
          const group = (byValue.get(value) ?? []).map((member) => member.model);
          const representative = pickRepresentative(group);
          generations.push({
            value,
            markerText: (byValue.get(value) ?? [])[0].parsed.marker!.text,
            qualifier: (byValue.get(value) ?? [])[0].parsed.marker!.qualifier,
            modelId: representative.id,
            modelName: representative.name,
            launchDate: isoDate(earliestDate(group)),
            modelIds: group.map((model) => model.id),
            modelNames: group.map((model) => model.name),
          });
        }

        for (let index = 1; index < values.length; index += 1) {
          const older = generations[index - 1];
          const newer = generations[index];
          const olderGroup = (byValue.get(older.value) ?? []).map((member) => member.model);
          const newerGroup = (byValue.get(newer.value) ?? []).map((member) => member.model);
          const olderDate = earliestDate(olderGroup);
          const newerDate = earliestDate(newerGroup);
          const olderModel = pickRepresentative(olderGroup);
          const newerModel = pickRepresentative(newerGroup);

          const evidence: LifecycleEvidence[] = [
            {
              field: "series",
              from: family.seriesName,
              to: family.seriesName,
              note: "Both models belong to the same product family.",
            },
            {
              field: "name",
              from: olderModel.name,
              to: newerModel.name,
              note: "The two names are identical apart from the generation marker, so they are the same product line.",
            },
            {
              field: "generation marker",
              from: older.markerText,
              to: newer.markerText,
              note: "The later model carries a strictly later generation marker.",
            },
          ];

          if (!olderDate || !newerDate) {
            family.ambiguities.push({
              kind: "missing-launch-date",
              reason: !olderDate
                ? `No date available on the market was reported for "${olderModel.name}", so the order cannot be confirmed.`
                : `No date available on the market was reported for "${newerModel.name}", so the order cannot be confirmed.`,
              seriesId: family.seriesId,
              seriesName: family.seriesName,
              manufacturerName: family.manufacturerName,
              lineName: baseName,
              fromModel: modelRef(olderModel),
              toModel: modelRef(newerModel),
              evidence: [
                ...evidence,
                {
                  field: "launchDate",
                  from: isoDate(olderDate) ?? "not reported",
                  to: isoDate(newerDate) ?? "not reported",
                  note: "A missing date is not evidence in either direction, so no link is asserted.",
                },
              ],
            });
            continue;
          }

          if (newerDate.getTime() <= olderDate.getTime()) {
            family.ambiguities.push({
              kind: "launch-date-contradiction",
              reason:
                newerDate.getTime() === olderDate.getTime()
                  ? "Both generations carry the same date available on the market, so the markers and the dates cannot be reconciled."
                  : "The later generation reached the market earlier than the earlier one, so the markers and the dates disagree.",
              seriesId: family.seriesId,
              seriesName: family.seriesName,
              manufacturerName: family.manufacturerName,
              lineName: baseName,
              fromModel: modelRef(olderModel),
              toModel: modelRef(newerModel),
              evidence: [
                ...evidence,
                {
                  field: "launchDate",
                  from: isoDate(olderDate)!,
                  to: isoDate(newerDate)!,
                  note: "The dates do not confirm the order the markers imply, so no link is asserted.",
                },
              ],
            });
            continue;
          }

          links.push({
            predecessorId: olderModel.id,
            successorId: newerModel.id,
            seriesId: family.seriesId,
            seriesName: family.seriesName,
            manufacturerName: family.manufacturerName,
            lineName: baseName,
            predecessorName: olderModel.name,
            successorName: newerModel.name,
            predecessorMarker: { kind, text: older.markerText, value: older.value, qualifier: older.qualifier },
            successorMarker: { kind, text: newer.markerText, value: newer.value, qualifier: newer.qualifier },
            predecessorLaunchDate: isoDate(olderDate),
            successorLaunchDate: isoDate(newerDate),
            basis: "generation-marker+launch-date",
            evidence: [
              ...evidence,
              {
                field: "launchDate",
                from: isoDate(olderDate)!,
                to: isoDate(newerDate)!,
                note: "The later generation also reached the market later, which confirms the direction.",
              },
            ],
          });
        }

        family.chains.push({ lineName: baseName, markerKind: kind, generations });
      }
    }

    // The weaker signal: models whose names carry no generation marker at
    // all. Their certification dates order them, but a date alone does not
    // make one model the successor of another, so these are reported as
    // ambiguous and never written to the catalog.
    const unclassified = sorted.filter((model) => parseGenerationMarker(model.name).marker === null);
    const dated = unclassified
      .filter((model) => model.launchDate && !Number.isNaN(model.launchDate.getTime()))
      .sort((a, b) => {
        const aTime = a.launchDate!.getTime();
        const bTime = b.launchDate!.getTime();
        if (aTime !== bTime) return aTime - bTime;
        return compareModels(a, b);
      });

    for (let index = 1; index < dated.length; index += 1) {
      const earlier = dated[index - 1];
      const later = dated[index];
      if (earlier.launchDate!.getTime() === later.launchDate!.getTime()) continue;
      family.ambiguities.push({
        kind: "date-only-order",
        reason:
          "Neither model name carries a generation marker, so the certification dates are the only ordering available. The later date is a weaker signal and no link is asserted.",
        seriesId: family.seriesId,
        seriesName: family.seriesName,
        manufacturerName: family.manufacturerName,
        lineName: null,
        fromModel: modelRef(earlier),
        toModel: modelRef(later),
        evidence: [
          {
            field: "series",
            from: family.seriesName,
            to: family.seriesName,
            note: "Both models belong to the same product family.",
          },
          {
            field: "name",
            from: earlier.name,
            to: later.name,
            note: "Neither name carries a generation marker.",
          },
          {
            field: "launchDate",
            from: isoDate(earlier.launchDate)!,
            to: isoDate(later.launchDate)!,
            note: "The later model reached the market later, but a date alone does not establish a lineage.",
          },
        ],
      });
    }

    families.push(family);
    ambiguities.push(...family.ambiguities);
  }

  return {
    families,
    links,
    ambiguities,
    seriesExamined: bySeries.size,
    modelsExamined: models.length,
  };
}

/**
 * The successor / predecessor every model should carry.
 *
 * The result covers every model that was examined, including the models
 * that get no link at all — their fields are `null`, so the writer can
 * reconcile the catalog instead of leaving stale values behind.
 */
export function lifecycleAssignments(
  result: LifecycleDerivation,
  models: LifecycleModelInput[]
): LifecycleAssignment[] {
  const predecessor = new Map<string, string>();
  const successor = new Map<string, string>();
  for (const link of result.links) {
    successor.set(link.predecessorId, link.successorId);
    predecessor.set(link.successorId, link.predecessorId);
  }
  return models.map((model) => ({
    modelId: model.id,
    predecessorId: predecessor.get(model.id) ?? null,
    successorId: successor.get(model.id) ?? null,
  }));
}
