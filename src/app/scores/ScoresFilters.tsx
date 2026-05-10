"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ASSOCIATIONS,
  CLASSIFICATIONS,
  DIVISIONS,
} from "@/lib/school-classifications";

const ALL = "__all__";

const SPORTS = [
  { value: "baseball", label: "Baseball" },
  { value: "softball", label: "Softball" },
] as const;

export function ScoresFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === ALL) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `/scores?${qs}` : "/scores");
    });
  };

  const sport = params.get("sport") ?? ALL;
  const association = params.get("association") ?? ALL;
  const classification = params.get("classification") ?? ALL;
  const division = params.get("division") ?? ALL;

  const anyFilterActive =
    sport !== ALL ||
    association !== ALL ||
    classification !== ALL ||
    division !== ALL ||
    params.has("school");

  const clear = () => {
    startTransition(() => router.push("/scores"));
  };

  return (
    <div className="mb-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <FilterSelect
          label="Sport"
          value={sport}
          onChange={(v) => set("sport", v)}
          options={SPORTS.map((s) => ({ value: s.value, label: s.label }))}
        />
        <FilterSelect
          label="Association"
          value={association}
          onChange={(v) => set("association", v)}
          options={ASSOCIATIONS.map((a) => ({ value: a, label: a }))}
        />
        <FilterSelect
          label="Class"
          value={classification}
          onChange={(v) => set("classification", v)}
          options={CLASSIFICATIONS.map((c) => ({ value: c, label: c }))}
        />
        <FilterSelect
          label="Division"
          value={division}
          onChange={(v) => set("division", v)}
          options={DIVISIONS.map((d) => ({ value: d, label: d }))}
        />
      </div>
      {anyFilterActive && (
        <button
          type="button"
          onClick={clear}
          className="mt-2 text-xs uppercase tracking-wider text-sa-orange hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
