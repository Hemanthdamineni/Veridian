interface Sku {
  id: string;
  skuCode: string;
  cpuModel: string;
  ramGb: number;
  weightKg: number;
  createdAt: Date;
  model: {
    name: string;
    series: {
      name: string;
      manufacturer: {
        name: string;
      };
    };
  };
  pricing: {
    region: string;
    currency: string;
    msrp: number;
  }[];
}

interface SkuListProps {
  skus: Sku[];
}

export function SkuList({ skus }: SkuListProps) {
  if (skus.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500">
        No SKUs yet. Create one using the form.
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[600px] overflow-y-auto">
      {skus.map((sku) => (
        <div
          key={sku.id}
          className="p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="font-medium text-zinc-900 dark:text-zinc-100 text-sm">
                {sku.model.name}
              </p>
              <p className="text-xs text-zinc-500 font-mono">{sku.skuCode}</p>
            </div>
            {sku.pricing[0] && (
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: sku.pricing[0].currency,
                  maximumFractionDigits: 0,
                }).format(sku.pricing[0].msrp)}
              </p>
            )}
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            {sku.model.series.manufacturer.name} • {sku.cpuModel} •{" "}
            {sku.ramGb} GB • {sku.weightKg} kg
          </p>
        </div>
      ))}
    </div>
  );
}
