/**
 * Parsing manufacturer technical-specification pages (ADR-005).
 *
 * A manufacturer page is turned into a {@link SpecTable}: the configuration
 * columns it publishes and, for each column, the text it publishes per row.
 * That text is then turned into the values the manufacturer states.
 *
 * The second step is where the ambiguity rule lives. A field is reported only
 * when the manufacturer states a single unambiguous value for it. A cell that
 * lists several options - several memory sizes, several displays - is
 * ambiguous, and an ambiguous cell is never reported, so it can never be used
 * to claim that a reference row is wrong.
 *
 * The HTML is parsed by a small parser in this module rather than by a
 * dependency: the project takes no new runtime dependencies, and the
 * structural hooks a manufacturer page needs are simple enough to read
 * directly.
 */

import type { ObservedFields, SpecColumn, SpecTable } from "./types";

/* ---- A minimal HTML document model ---- */

export interface TextNode {
  kind: "text";
  text: string;
}

export interface Element {
  kind: "element";
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
  parent: Element | null;
}

export type Node = TextNode | Element;

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  reg: "®", trade: "™", copy: "©", deg: "°", times: "×", middot: "·",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(body[1] === "x" || body[1] === "X" ? 2 : 1), body[1] === "x" || body[1] === "X" ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function parseAttributes(body: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const name = match[1].toLowerCase();
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** Find the `>` that closes a tag, ignoring `>` inside quoted attribute values. */
function findTagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < html.length; i += 1) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i;
    }
  }
  return -1;
}

function parseTag(body: string): { tag: string; attrs: Record<string, string> } {
  const match = /^([a-zA-Z][^\s/>]*)/.exec(body.trim());
  const tag = match ? match[1].toLowerCase() : "div";
  return { tag, attrs: parseAttributes(body.slice(match ? match[1].length : 0)) };
}

/**
 * Parse an HTML document into a tree of {@link Element}s.
 *
 * The parser is deliberately forgiving: it never throws on malformed markup
 * and it recovers from unclosed tags by closing the innermost open element.
 */
export function parseHtml(html: string): Element {
  const root: Element = { kind: "element", tag: "#root", attrs: {}, children: [], parent: null };
  const stack: Element[] = [root];
  let index = 0;
  const pushText = (value: string): void => {
    if (!value) return;
    stack[stack.length - 1].children.push({ kind: "text", text: decodeEntities(value) });
  };
  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open < 0) {
      pushText(html.slice(index));
      break;
    }
    if (open > index) pushText(html.slice(index, open));
    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", open)) {
      const end = html.indexOf(">", open);
      index = end < 0 ? html.length : end + 1;
      continue;
    }
    if (html.startsWith("</", open)) {
      const end = html.indexOf(">", open);
      const name = html.slice(open + 2, end < 0 ? html.length : end).trim().toLowerCase();
      for (let depth = stack.length - 1; depth >= 1; depth -= 1) {
        if (stack[depth].tag === name) {
          stack.length = depth;
          break;
        }
      }
      index = end < 0 ? html.length : end + 1;
      continue;
    }
    const end = findTagEnd(html, open);
    const raw = html.slice(open + 1, end < 0 ? html.length : end);
    const selfClosing = raw.endsWith("/");
    const { tag, attrs } = parseTag(selfClosing ? raw.slice(0, -1) : raw);
    const element: Element = { kind: "element", tag, attrs, children: [], parent: stack[stack.length - 1] };
    element.parent!.children.push(element);
    index = end < 0 ? html.length : end + 1;
    if (selfClosing || VOID_TAGS.has(tag)) continue;
    if (tag === "script" || tag === "style") {
      const close = html.toLowerCase().indexOf(`</${tag}`, index);
      index = close < 0 ? html.length : close;
      continue;
    }
    stack.push(element);
  }
  return root;
}

/** The visible text of an element, with whitespace collapsed. */
export function textOf(element: Element): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.kind === "text") {
      const trimmed = node.text.trim();
      if (trimmed) parts.push(trimmed);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(element);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** The class tokens of an element. */
export function classList(element: Element): string[] {
  return (element.attrs["class"] ?? "").split(/\s+/).filter(Boolean);
}

/** The previous sibling element, optionally restricted to one tag. */
export function previousElementSibling(element: Element, tag?: string): Element | null {
  const siblings = element.parent?.children ?? [];
  for (let i = siblings.indexOf(element) - 1; i >= 0; i -= 1) {
    const sibling = siblings[i];
    if (sibling.kind !== "element") continue;
    if (tag && sibling.tag !== tag) continue;
    return sibling;
  }
  return null;
}

/* ---- A small selector engine ---- */

interface SimpleSelector {
  tag?: string;
  classes: string[];
  id?: string;
  attributes: Array<{ name: string; operator: string; value: string }>;
}

/** One compound selector, e.g. `div.rowTableItemViewBox`. */
type Compound = SimpleSelector[];
/** A descendant chain of compounds, e.g. `div.rowTableItemBox div.pdName`. */
type SelectorGroup = Compound[];
/** A comma-separated list of selector groups. */
type Selector = SelectorGroup[];

function parseCompound(text: string): Compound {
  const selector: SimpleSelector = { classes: [], attributes: [] };
  const pattern = /([.#]?[\w-]+)|(\[[^\]]*\])/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const token = match[0];
    if (token.startsWith(".")) {
      selector.classes.push(token.slice(1));
    } else if (token.startsWith("#")) {
      selector.id = token.slice(1);
    } else if (token.startsWith("[")) {
      const body = token.slice(1, -1);
      const parts =
        /^([\w-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s"'\]]+)))?$/.exec(body);
      if (parts) {
        selector.attributes.push({
          name: parts[1].toLowerCase(),
          operator: parts[2] ?? "",
          value: parts[3] ?? parts[4] ?? parts[5] ?? "",
        });
      }
    } else if (selector.tag === undefined) {
      selector.tag = token.toLowerCase();
    }
  }
  return [selector];
}

function parseSelector(selector: string): Selector {
  return selector
    .split(",")
    .map((group) => group.trim())
    .filter(Boolean)
    .map((group) => group.split(/\s+/).map(parseCompound));
}

function matchesCompound(element: Element, compound: Compound): boolean {
  return compound.every((simple) => matchesSimple(element, simple));
}

function matchesSimple(element: Element, simple: SimpleSelector): boolean {
  if (simple.tag && element.tag !== simple.tag) return false;
  if (simple.id && element.attrs["id"] !== simple.id) return false;
  if (simple.classes.length > 0) {
    const classes = classList(element);
    if (!simple.classes.every((name) => classes.includes(name))) return false;
  }
  for (const attribute of simple.attributes) {
    const actual = element.attrs[attribute.name];
    if (actual === undefined) return false;
    if (attribute.operator === "=" && actual !== attribute.value) return false;
    if (attribute.operator === "*=" && !actual.includes(attribute.value)) return false;
    if (attribute.operator === "^=" && !actual.startsWith(attribute.value)) return false;
    if (attribute.operator === "$=" && !actual.endsWith(attribute.value)) return false;
  }
  return true;
}

/** Every descendant of `root` that matches `selector`. */
export function queryAll(root: Element, selector: string): Element[] {
  const groups = parseSelector(selector);
  const found: Element[] = [];
  const walk = (element: Element): void => {
    for (const child of element.children) {
      if (child.kind !== "element") continue;
      for (const group of groups) {
        if (!matchesCompound(child, group[group.length - 1])) continue;
        let ancestor = child.parent;
        let ok = true;
        for (let depth = group.length - 2; depth >= 0; depth -= 1) {
          let matched = false;
          while (ancestor) {
            if (matchesCompound(ancestor, group[depth])) {
              matched = true;
              ancestor = ancestor.parent;
              break;
            }
            ancestor = ancestor.parent;
          }
          if (!matched) {
            ok = false;
            break;
          }
        }
        if (ok) {
          found.push(child);
          break;
        }
      }
      walk(child);
    }
  };
  walk(root);
  return found;
}

/** The first descendant of `root` that matches `selector`. */
export function query(root: Element, selector: string): Element | null {
  return queryAll(root, selector)[0] ?? null;
}

/* ---- Manufacturer adapters ---- */

/**
 * ASUS publishes one technical-specification table per family.
 *
 * The table is rendered by a Vue component whose class names are hashed per
 * build, so the stable hooks are the literal class names the component adds
 * (`rowTableItemViewBox`, `rowTableTitle`, `pdName`) and an attribute-contains
 * match for the hashed value cells (`rowTableItems`). The "Model" row
 * establishes the column order for the whole table, so every later row is
 * aligned to it by position. A family code can appear in several columns -
 * the manufacturer publishes several configurations under one code - and those
 * columns are kept apart so a processor can still tell them apart.
 */
export function parseAsusTable(root: Element, sourceUrl: string): SpecTable | null {
  const columns: SpecColumn[] = [];
  const columnByCell: number[] = [];
  for (const viewBox of queryAll(root, "div.rowTableItemViewBox")) {
    const titleBox = previousElementSibling(viewBox, "div");
    if (!titleBox) continue;
    const titleElement = query(titleBox, ".rowTableTitle");
    const title = titleElement ? textOf(titleElement) : "";
    if (!title) continue;
    const cellBox = query(viewBox, "div[class*='rowTableItemBox']");
    if (!cellBox) continue;
    const cells = queryAll(cellBox, "div[class*='rowTableItems']");
    if (title.toLowerCase() === "model") {
      for (const cell of cells) {
        const nameElement = query(cell, ".pdName");
        const name = nameElement ? textOf(nameElement) : "";
        columnByCell.push(name ? columns.length : -1);
        if (name) columns.push({ name, values: {} });
      }
      continue;
    }
    cells.forEach((cell, index) => {
      const columnIndex = columnByCell[index];
      if (columnIndex === undefined || columnIndex < 0) return;
      columns[columnIndex].values[title] = textOf(cell);
    });
  }
  if (columns.length === 0) return null;
  return { sourceUrl, columns, hasPartNumbers: columns.some((column) => column.name.length > 0) };
}

/**
 * Apple publishes one technical-specification table per product family.
 *
 * The table is a set of `techspecs-row` blocks, each with one
 * `techspecs-rowheader` title and one `techspecs-column` cell per
 * configuration. Apple labels its columns "Model 1", "Model 2", ... and does
 * not publish part numbers in the table, so a reference row cannot be matched
 * to a column. The adapter still reads the table so that the reason for the
 * non-confirmation is specific rather than a guess. A family page can carry
 * more than one table - the MacBook Air page carries one for the 13-inch and
 * one for the 15-inch model - so each is read separately.
 */
export function parseAppleTable(root: Element, sourceUrl: string): SpecTable | null {
  const panels = queryAll(root, ".table-tab");
  const tables: SpecTable[] = [];
  for (const panel of panels.length > 0 ? panels : [root]) {
    const labels: string[] = [];
    for (const header of queryAll(panel, "[role='columnheader']")) {
      const label = textOf(header);
      if (label) labels.push(label);
    }
    if (labels.length === 0) continue;
    const columns: SpecColumn[] = labels.map((label) => ({ name: label, values: {} }));
    for (const row of queryAll(panel, ".techspecs-row")) {
      const header = query(row, ".techspecs-rowheader");
      if (!header) continue;
      const title = textOf(header);
      if (!title) continue;
      const cells = queryAll(row, ".techspecs-column");
      if (cells.length === 1 && columns.length > 1) {
        // A full-width row describes every configuration.
        for (const column of columns) column.values[title] = textOf(cells[0]);
        continue;
      }
      cells.forEach((cell, index) => {
        if (index < columns.length) columns[index].values[title] = textOf(cell);
      });
    }
    if (columns.length === 0) continue;
    const hasPartNumbers = columns.every((column) => looksLikePartNumber(column.name));
    tables.push({ sourceUrl, columns, hasPartNumbers });
  }
  if (tables.length === 0) return null;
  return tables.find((table) => table.hasPartNumbers) ?? tables[0];
}

/** Does this column label look like a manufacturer part number? */
export function looksLikePartNumber(label: string): boolean {
  return /^[A-Z0-9]{2,10}(?:[-/][A-Z0-9]{1,10})+$/i.test(label.trim());
}

/**
 * Parse a manufacturer page into a specification table.
 *
 * The adapter is chosen by the manufacturer the page belongs to; an unknown
 * manufacturer has no adapter and therefore no table.
 */
export function parseSpecTable(html: string, sourceUrl: string, manufacturer: string): SpecTable | null {
  const root = parseHtml(html);
  const name = manufacturer.trim().toUpperCase();
  if (name === "ASUS") return parseAsusTable(root, sourceUrl);
  if (name === "APPLE") return parseAppleTable(root, sourceUrl);
  return null;
}

/* ---- Reading the values a column states ---- */

const RESOLUTION_RE = /\(?\d{3,4}\s*x\s*\d{3,4}\)?/gi;
const SIZE_RE = /\d{1,2}(?:\.\d)?\s*(?:-|\s)?(?:inch|")/gi;
const REFRESH_RE = /Refresh\s*Rate\s*:?\s*\d{2,3}\s*Hz/gi;
const NITS_RE = /\d{3,4}\s*nits/gi;
const WEIGHT_RE = /\d\.\d{2}\s*kg/gi;
const BATTERY_RE = /\d{2,3}\s*WHrs/gi;
const RAM_OPTION_RE = /(\d{1,3})\s*GB\s+(LPDDR\d+X?|DDR\d+)/gi;
const RAM_TYPE_RE = /(LPDDR\d+X?|DDR\d+)/gi;
const STORAGE_OPTION_RE = /(\d{1,3})\s*(TB|GB)\s+(?:M\.2\s+)?NVMe/gi;
const CPU_RE =
  /(Snapdragon[^)]*?Processor|Core(?:\s*™)?\s+Ultra\s+\d+(?:\s+Processor)?\s+\d+\w*|Ryzen[^)]*?Processor)/gi;
const PANEL_RE = /\b(OLED|IPS|TN|VA)\b/g;

function all(text: string, pattern: RegExp): string[] {
  return text.match(pattern) ?? [];
}

/** The one value a cell states for a field, or undefined when it is ambiguous. */
function single(text: string, pattern: RegExp): string | undefined {
  const values = [...new Set(all(text, pattern))];
  return values.length === 1 ? values[0] : undefined;
}

/** The processor name, stripped of the trademark marks and the word "Processor". */
export function cleanCpu(value: string): string {
  return value
    .replace(/®/g, "")
    .replace(/™/g, "")
    .replace(/\bProcessor\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The values a configuration column states, when each one is unambiguous.
 *
 * A field is reported only when the manufacturer states a single value for
 * it. When the cell lists several options the field is ambiguous, and an
 * ambiguous field is left out entirely rather than guessed at.
 */
export function parseColumnFields(column: SpecColumn): ObservedFields {
  const values = column.values;
  const observed: ObservedFields = {};
  const display = values["Display"] ?? "";
  const resolution = single(display, RESOLUTION_RE);
  if (resolution) {
    observed.display_resolution = resolution
      .replace(/\s*x\s*/gi, "x")
      .replace(/^[()]+|[()]+$/g, "")
      .trim();
  }
  const size = single(display, SIZE_RE);
  if (size) observed.display_size = size.replace(/[^\d.]/g, "");
  const panel = single(display.toUpperCase(), PANEL_RE);
  if (panel) observed.display_type = panel;
  const refresh = single(display, REFRESH_RE);
  const hertz = refresh ? /\d{2,3}/.exec(refresh) : null;
  if (hertz) observed.display_refresh = hertz[0];
  const nits = single(display, NITS_RE);
  const brightness = nits ? /\d{3,4}/.exec(nits) : null;
  if (brightness) observed.display_nits = brightness[0];

  const weight = single(values["Weight"] ?? "", WEIGHT_RE);
  if (weight) observed.weight_kg = weight.replace(/[^\d.]/g, "");
  const battery = single(values["Battery"] ?? "", BATTERY_RE);
  if (battery) observed.battery_wh = battery.replace(/[^\d.]/g, "");

  const memory = values["Memory"] ?? "";
  const memoryOptions = [...memory.matchAll(RAM_OPTION_RE)];
  if (memoryOptions.length === 1) observed.ram_gb = memoryOptions[0][1];
  const memoryTypes = all(memory, RAM_TYPE_RE);
  if (memoryTypes.length === 1) observed.ram_type = memoryTypes[0].toUpperCase();

  const storage = values["Storage"] ?? "";
  const storageOptions = [...storage.matchAll(STORAGE_OPTION_RE)];
  if (storageOptions.length === 1) {
    const size = Number.parseInt(storageOptions[0][1], 10);
    const unit = storageOptions[0][2].toUpperCase();
    observed.storage_gb = String(unit === "TB" ? size * 1024 : size);
  }

  const processors = all(values["Processor"] ?? "", CPU_RE);
  if (processors.length === 1) observed.cpu_model = cleanCpu(processors[0]);
  return observed;
}
