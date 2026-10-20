"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Manufacturer { id: string; name: string; series: { id: string; name: string; models: { id: string; name: string }[] }[] }

interface SkuFormProps { manufacturers: Manufacturer[] }

export function SkuForm({ manufacturers }: SkuFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState({
    manufacturerId: "", seriesId: "", modelId: "", skuCode: "",
    cpuBrand: "Intel", cpuModel: "", cpuCores: "", gpuModel: "",
    ramGb: "16", ramType: "DDR5", ramSoldered: false,
    storageGb: "512", storageType: "NVMe SSD", storageSlots: "1",
    displaySizeIn: "14.0", displayResolution: "2560x1600", displayType: "IPS", displayRefreshHz: "60", displayTouch: false, displayNits: "",
    weightKg: "1.4", batteryWh: "60", batteryLifeHours: "", npuTops: "",
    os: "Windows 11 Home", buildMaterial: "Aluminum", linuxCompat: "",
  });

  const selectedManufacturer = manufacturers.find((m) => m.id === formData.manufacturerId);
  const selectedSeries = selectedManufacturer?.series.find((s) => s.id === formData.seriesId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null); setSuccess(false);
    try {
      const response = await fetch("/api/admin/skus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...formData,
          cpuCores: formData.cpuCores ? parseInt(formData.cpuCores) : null,
          ramGb: parseInt(formData.ramGb),
          storageGb: parseInt(formData.storageGb),
          storageSlots: formData.storageSlots ? parseInt(formData.storageSlots) : null,
          displaySizeIn: parseFloat(formData.displaySizeIn),
          displayRefreshHz: parseInt(formData.displayRefreshHz),
          displayNits: formData.displayNits ? parseInt(formData.displayNits) : null,
          weightKg: parseFloat(formData.weightKg),
          batteryWh: parseFloat(formData.batteryWh),
          batteryLifeHours: formData.batteryLifeHours ? parseFloat(formData.batteryLifeHours) : null,
          npuTops: formData.npuTops ? parseFloat(formData.npuTops) : null,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const detail = Array.isArray(data?.details) ? data.details.join(", ") : data?.error;
        throw new Error(detail || "Failed to create SKU");
      }
      setSuccess(true);
      setFormData((f) => ({ ...f, skuCode: "", cpuModel: "", gpuModel: "" }));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === "checkbox" ? (e.target as HTMLInputElement).checked : value }));
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5" aria-label="Add a new SKU">
      {error && <div className="rounded-[5px] border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-[13px] text-[var(--danger)]" role="alert">{error}</div>}
      {success && <div className="rounded-[5px] border border-[var(--success)] bg-[var(--success-soft)] p-3 text-[13px] text-[var(--success)]" role="status">Configuration saved to the catalog.</div>}

      <fieldset className="space-y-2" aria-label="Model">
        <legend className="label">Model</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div><label className="label" htmlFor="f-manufacturer">Manufacturer</label>
            <select id="f-manufacturer" name="manufacturerId" className="field" value={formData.manufacturerId} onChange={handleChange} required>
              <option value="">Select…</option>{manufacturers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></div>
          <div><label className="label" htmlFor="f-series">Series</label>
            <select id="f-series" name="seriesId" className="field" value={formData.seriesId} onChange={handleChange} required disabled={!formData.manufacturerId}>
              <option value="">Select…</option>{selectedManufacturer?.series.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div><label className="label" htmlFor="f-model">Model</label>
            <select id="f-model" name="modelId" className="field" value={formData.modelId} onChange={handleChange} required disabled={!formData.seriesId}>
              <option value="">Select…</option>{selectedSeries?.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></div>
        </div>
        <div><label className="label" htmlFor="f-sku">SKU code</label><input id="f-sku" className="field" type="text" name="skuCode" placeholder="e.g. UX3407QA-QD123WS" value={formData.skuCode} onChange={handleChange} required /></div>
      </fieldset>

      <fieldset className="space-y-2" aria-label="Processor">
        <legend className="label">Processor</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div><label className="label" htmlFor="f-cpubrand">Brand</label><select id="f-cpubrand" className="field" name="cpuBrand" value={formData.cpuBrand} onChange={handleChange}><option value="Intel">Intel</option><option value="AMD">AMD</option><option value="Qualcomm">Qualcomm</option><option value="Apple">Apple</option></select></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="f-cpumodel">CPU model</label><input id="f-cpumodel" className="field" type="text" name="cpuModel" placeholder="e.g. Core Ultra 7 258V" value={formData.cpuModel} onChange={handleChange} required /></div>
          <div><label className="label" htmlFor="f-cores">Cores</label><input id="f-cores" className="field" type="number" name="cpuCores" placeholder="Optional" value={formData.cpuCores} onChange={handleChange} /></div>
        </div>
        <div><label className="label" htmlFor="f-gpu">GPU model</label><input id="f-gpu" className="field" type="text" name="gpuModel" placeholder="Optional" value={formData.gpuModel} onChange={handleChange} /></div>
      </fieldset>

      <fieldset className="space-y-2" aria-label="Memory & storage">
        <legend className="label">Memory & storage</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div><label className="label" htmlFor="f-ram">RAM (GB)</label><input id="f-ram" className="field" type="number" name="ramGb" min="1" max="256" value={formData.ramGb} onChange={handleChange} required /></div>
          <div><label className="label" htmlFor="f-ramtype">RAM type</label><select id="f-ramtype" className="field" name="ramType" value={formData.ramType} onChange={handleChange}><option value="DDR5">DDR5</option><option value="LPDDR5">LPDDR5</option><option value="LPDDR5X">LPDDR5X</option></select></div>
          <div><label className="label" htmlFor="f-storage">Storage (GB)</label><input id="f-storage" className="field" type="number" name="storageGb" min="8" max="8192" value={formData.storageGb} onChange={handleChange} required /></div>
          <div><label className="label" htmlFor="f-storagetype">Storage type</label><select id="f-storagetype" className="field" name="storageType" value={formData.storageType} onChange={handleChange}><option>NVMe SSD</option><option>SATA SSD</option><option>eMMC</option></select></div>
          <div><label className="label" htmlFor="f-slots">Drive slots</label><input id="f-slots" className="field" type="number" name="storageSlots" min="1" max="4" placeholder="1" value={formData.storageSlots} onChange={handleChange} /></div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px]"><input type="checkbox" name="ramSoldered" checked={formData.ramSoldered} onChange={handleChange} className="h-4 w-4 accent-[var(--accent)]" /> RAM is soldered (not upgradeable)</label>
      </fieldset>

      <fieldset className="space-y-2" aria-label="Display">
        <legend className="label">Display</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div><label className="label" htmlFor="f-size">Size (in)</label><input id="f-size" className="field" type="number" step="0.1" min="7" max="25" name="displaySizeIn" value={formData.displaySizeIn} onChange={handleChange} required /></div>
          <div><label className="label" htmlFor="f-dtype">Type</label><select id="f-dtype" className="field" name="displayType" value={formData.displayType} onChange={handleChange}><option>IPS</option><option>OLED</option><option>Mini-LED</option></select></div>
          <div><label className="label" htmlFor="f-refresh">Refresh (Hz)</label><input id="f-refresh" className="field" type="number" min="1" max="1000" name="displayRefreshHz" value={formData.displayRefreshHz} onChange={handleChange} required /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="f-res">Resolution</label><input id="f-res" className="field" type="text" name="displayResolution" placeholder="e.g. 2880x1800" value={formData.displayResolution} onChange={handleChange} /></div>
          <div><label className="label" htmlFor="f-nits">Brightness (nits)</label><input id="f-nits" className="field" type="number" name="displayNits" placeholder="Optional" value={formData.displayNits} onChange={handleChange} /></div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px]"><input type="checkbox" name="displayTouch" checked={formData.displayTouch} onChange={handleChange} className="h-4 w-4 accent-[var(--accent)]" /> Touch display</label>
      </fieldset>

      <fieldset className="space-y-2" aria-label="Physical">
        <legend className="label">Physical</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div><label className="label" htmlFor="f-weight">Weight (kg)</label><input id="f-weight" className="field" type="number" step="0.01" min="0.1" max="10" name="weightKg" value={formData.weightKg} onChange={handleChange} required /></div>
          <div><label className="label" htmlFor="f-battery">Battery (Wh)</label><input id="f-battery" className="field" type="number" step="0.1" min="5" max="500" name="batteryWh" value={formData.batteryWh} onChange={handleChange} required /></div>
          <div><label className="label" htmlFor="f-material">Build material</label><select id="f-material" className="field" name="buildMaterial" value={formData.buildMaterial} onChange={handleChange}><option>Aluminum</option><option>Magnesium</option><option>Plastic</option><option>Carbon Fiber</option></select></div>
        </div>
        <div><label className="label" htmlFor="f-os">Operating system</label><input id="f-os" className="field" type="text" name="os" placeholder="e.g. Windows 11 Home" value={formData.os} onChange={handleChange} required /></div>
      </fieldset>

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? "Saving…" : success ? "Saved" : "Save configuration"}
      </button>
      <p className="text-[11px] leading-5 text-[var(--quiet)]">Required fields are validated server-side; missing provenance records are never guessed.</p>
    </form>
  );
}