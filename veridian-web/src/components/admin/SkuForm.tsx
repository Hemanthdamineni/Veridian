"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Manufacturer {
  id: string;
  name: string;
  series: {
    id: string;
    name: string;
    models: {
      id: string;
      name: string;
    }[];
  }[];
}

interface SkuFormProps {
  manufacturers: Manufacturer[];
}

export function SkuForm({ manufacturers }: SkuFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState({
    manufacturerId: "",
    seriesId: "",
    modelId: "",
    skuCode: "",
    cpuBrand: "Intel",
    cpuModel: "",
    cpuCores: "",
    gpuModel: "",
    ramGb: "16",
    ramType: "DDR5",
    ramSoldered: false,
    storageGb: "512",
    storageType: "NVMe SSD",
    storageSlots: "1",
    displaySizeIn: "14.0",
    displayResolution: "2560x1600",
    displayType: "IPS",
    displayRefreshHz: "60",
    displayTouch: false,
    displayNits: "",
    weightKg: "1.4",
    batteryWh: "60",
    batteryLifeHours: "",
    npuTops: "",
    os: "Windows 11 Home",
    buildMaterial: "Aluminum",
    linuxCompat: "",
  });

  const selectedManufacturer = manufacturers.find(
    (m) => m.id === formData.manufacturerId
  );
  const selectedSeries = selectedManufacturer?.series.find(
    (s) => s.id === formData.seriesId
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      // Authentication is handled by middleware via cookies/session
      // Client does not need to send the token directly
      const response = await fetch("/api/admin/skus", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // Include cookies for session-based auth
        body: JSON.stringify({
          ...formData,
          cpuCores: formData.cpuCores ? parseInt(formData.cpuCores) : null,
          ramGb: parseInt(formData.ramGb),
          storageGb: parseInt(formData.storageGb),
          storageSlots: formData.storageSlots
            ? parseInt(formData.storageSlots)
            : null,
          displaySizeIn: parseFloat(formData.displaySizeIn),
          displayRefreshHz: parseInt(formData.displayRefreshHz),
          displayNits: formData.displayNits ? parseInt(formData.displayNits) : null,
          weightKg: parseFloat(formData.weightKg),
          batteryWh: parseFloat(formData.batteryWh),
          batteryLifeHours: formData.batteryLifeHours
            ? parseFloat(formData.batteryLifeHours)
            : null,
          npuTops: formData.npuTops ? parseFloat(formData.npuTops) : null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create SKU");
      }

      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        type === "checkbox" ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-lg text-sm">
          SKU created successfully!
        </div>
      )}

      {/* Hierarchy */}
      <div className="grid grid-cols-3 gap-2">
        <select
          name="manufacturerId"
          value={formData.manufacturerId}
          onChange={handleChange}
          required
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
        >
          <option value="">Manufacturer</option>
          {manufacturers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select
          name="seriesId"
          value={formData.seriesId}
          onChange={handleChange}
          required
          disabled={!formData.manufacturerId}
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm disabled:opacity-50"
        >
          <option value="">Series</option>
          {selectedManufacturer?.series.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          name="modelId"
          value={formData.modelId}
          onChange={handleChange}
          required
          disabled={!formData.seriesId}
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm disabled:opacity-50"
        >
          <option value="">Model</option>
          {selectedSeries?.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <input
        type="text"
        name="skuCode"
        placeholder="SKU Code (e.g., UX3407QA-QD123WS)"
        value={formData.skuCode}
        onChange={handleChange}
        required
        className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
      />

      {/* CPU */}
      <div className="grid grid-cols-3 gap-2">
        <select
          name="cpuBrand"
          value={formData.cpuBrand}
          onChange={handleChange}
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
        >
          <option value="Intel">Intel</option>
          <option value="AMD">AMD</option>
          <option value="Qualcomm">Qualcomm</option>
          <option value="Apple">Apple</option>
        </select>
        <input
          type="text"
          name="cpuModel"
          placeholder="CPU Model"
          value={formData.cpuModel}
          onChange={handleChange}
          required
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
        />
        <input
          type="number"
          name="cpuCores"
          placeholder="Cores"
          value={formData.cpuCores}
          onChange={handleChange}
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
        />
      </div>

      {/* RAM & Storage */}
      <div className="grid grid-cols-3 gap-2">
        <input
          type="number"
          name="ramGb"
          placeholder="RAM (GB)"
          value={formData.ramGb}
          onChange={handleChange}
          required
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
        />
        <select
          name="ramType"
          value={formData.ramType}
          onChange={handleChange}
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
        >
          <option value="DDR5">DDR5</option>
          <option value="LPDDR5">LPDDR5</option>
          <option value="LPDDR5X">LPDDR5X</option>
        </select>
        <input
          type="number"
          name="storageGb"
          placeholder="Storage (GB)"
          value={formData.storageGb}
          onChange={handleChange}
          required
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
        />
      </div>

      {/* Display */}
      <div className="grid grid-cols-3 gap-2">
        <input
          type="number"
          step="0.1"
          name="displaySizeIn"
          placeholder="Display (inches)"
          value={formData.displaySizeIn}
          onChange={handleChange}
          required
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
        />
        <select
          name="displayType"
          value={formData.displayType}
          onChange={handleChange}
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
        >
          <option value="IPS">IPS</option>
          <option value="OLED">OLED</option>
          <option value="Mini-LED">Mini-LED</option>
        </select>
        <input
          type="number"
          name="displayRefreshHz"
          placeholder="Refresh (Hz)"
          value={formData.displayRefreshHz}
          onChange={handleChange}
          required
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
        />
      </div>

      {/* Physical */}
      <div className="grid grid-cols-3 gap-2">
        <input
          type="number"
          step="0.01"
          name="weightKg"
          placeholder="Weight (kg)"
          value={formData.weightKg}
          onChange={handleChange}
          required
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
        />
        <input
          type="number"
          step="0.1"
          name="batteryWh"
          placeholder="Battery (Wh)"
          value={formData.batteryWh}
          onChange={handleChange}
          required
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
        />
        <select
          name="buildMaterial"
          value={formData.buildMaterial}
          onChange={handleChange}
          className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
        >
          <option value="Aluminum">Aluminum</option>
          <option value="Magnesium">Magnesium</option>
          <option value="Plastic">Plastic</option>
          <option value="Carbon Fiber">Carbon Fiber</option>
        </select>
      </div>

      <input
        type="text"
        name="os"
        placeholder="Operating System"
        value={formData.os}
        onChange={handleChange}
        required
        className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
      />

      <button
        type="submit"
        disabled={loading}
        className="w-full px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Creating..." : "Create SKU"}
      </button>
    </form>
  );
}
