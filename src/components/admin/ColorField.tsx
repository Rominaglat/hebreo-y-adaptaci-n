import { memo } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ColorFieldProps = {
  id: string;
  label: string;
  value: string | null;
  onChange: (value: string) => void;
};

export const ColorField = memo(function ColorField({
  id,
  label,
  value,
  onChange,
}: ColorFieldProps) {
  const safeValue = value || "";

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>

      <div className="flex items-center gap-2">
        <div
          className="relative"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            type="color"
            id={id}
            value={safeValue || "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-10 flex-shrink-0 cursor-pointer appearance-none rounded border border-border bg-transparent"
            style={{ backgroundColor: safeValue || "#000000" }}
            aria-label={label}
          />
        </div>

        <Input
          value={safeValue}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 font-mono text-sm"
          placeholder="#000000"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </div>
  );
});
