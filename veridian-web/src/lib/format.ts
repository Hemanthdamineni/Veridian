// Shared display formatting for the Veridian catalog.
// Centralized so cards, detail pages, and compare all render identically.

export function formatPrice(msrp: number | null, currency?: string): string {
  if (msrp === null || msrp === undefined) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(msrp);
  } catch {
    return String(msrp);
  }
}

export function formatWeight(kg: number | null | undefined): string {
  if (kg === null || kg === undefined) return "—";
  return `${kg.toFixed(2)} kg`;
}

export function formatStorage(gb: number | null | undefined): string {
  if (gb === null || gb === undefined) return "—";
  return gb >= 1024 ? `${gb / 1024} TB` : `${gb} GB`;
}

export function formatBattery(wh: number | null | undefined): string {
  if (wh === null || wh === undefined) return "—";
  return `${wh} Wh`;
}

export function formatSize(sizeIn: number | null | undefined): string {
  if (sizeIn === null || sizeIn === undefined) return "—";
  return `${sizeIn}"`;
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

export function plural(n: number, singular: string, pluralForm?: string): string {
  return n === 1 ? singular : (pluralForm ?? `${singular}s`);
}

/**
 * Join a CPU brand and model without repeating the brand.
 * Source data is inconsistent: cpuModel is sometimes "Intel N4500" and
 * sometimes "Core Ultra 7 258V", so a blind concatenation yields "Intel Intel N4500".
 */
export function formatCpu(brand: string | null | undefined, model: string | null | undefined): string {
  const b = (brand ?? "").trim();
  const m = (model ?? "").trim();
  if (!b) return m || "—";
  if (!m) return b;
  return m.toLowerCase().startsWith(b.toLowerCase()) ? m : `${b} ${m}`;
}
