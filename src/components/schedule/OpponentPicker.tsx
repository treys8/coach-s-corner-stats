"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Sport, TeamLevel } from "@/integrations/supabase/types";

export interface OpponentPickerValue {
  opponent: string;
  opponent_team_id: string | null;
}

interface TeamCandidate {
  id: string;
  name: string;
  level: TeamLevel;
  school: { id: string; name: string; short_name: string | null };
}

interface OpponentPickerProps {
  value: OpponentPickerValue;
  onChange: (next: OpponentPickerValue) => void;
  sport: Sport;
  excludeTeamId: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}

const supabase = createClient();

const levelLabel: Record<TeamLevel, string> = {
  varsity: "Varsity",
  jv: "JV",
  freshman: "Freshman",
  middle_school: "Middle School",
};

const formatTeamLabel = (t: TeamCandidate): string => {
  const school = t.school.short_name ?? t.school.name;
  return `${school} ${levelLabel[t.level]}`;
};

export function OpponentPicker({
  value,
  onChange,
  sport,
  excludeTeamId,
  placeholder = "Magnolia Heights",
  maxLength = 100,
  disabled,
}: OpponentPickerProps) {
  const listboxId = useId();
  const [query, setQuery] = useState(value.opponent_team_id ? "" : value.opponent);
  const [results, setResults] = useState<TeamCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLinked = value.opponent_team_id !== null;

  // Reset local query if parent value drops the FK (e.g., form reset).
  useEffect(() => {
    if (!value.opponent_team_id) {
      setQuery(value.opponent);
    }
  }, [value.opponent, value.opponent_team_id]);

  // Debounced server search.
  useEffect(() => {
    if (isLinked) {
      setResults([]);
      return;
    }
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const pattern = `%${q}%`;
        const baseSelect = "id, name, level, school:schools!inner(id, name, short_name)";
        const [byTeam, bySchool] = await Promise.all([
          supabase
            .from("teams")
            .select(baseSelect)
            .eq("sport", sport)
            .neq("id", excludeTeamId)
            .eq("schools.is_discoverable", true)
            .ilike("name", pattern)
            .limit(8),
          supabase
            .from("teams")
            .select(baseSelect)
            .eq("sport", sport)
            .neq("id", excludeTeamId)
            .eq("schools.is_discoverable", true)
            .ilike("schools.name", pattern)
            .limit(8),
        ]);
        if (cancelled) return;
        const merged = new Map<string, TeamCandidate>();
        for (const row of [...(byTeam.data ?? []), ...(bySchool.data ?? [])]) {
          // Supabase typing widens `school` to array-or-object depending on the
          // generated relationship metadata; coerce to the single-row shape.
          const r = row as unknown as TeamCandidate;
          if (r.school) merged.set(r.id, r);
        }
        setResults(Array.from(merged.values()).slice(0, 10));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, sport, excludeTeamId, isLinked]);

  const showResults = open && !isLinked && query.trim().length >= 2;
  const items = useMemo(() => results, [results]);

  const pickTeam = (t: TeamCandidate) => {
    onChange({ opponent: formatTeamLabel(t), opponent_team_id: t.id });
    setQuery("");
    setResults([]);
    setOpen(false);
    setActiveIdx(-1);
  };

  const applyFreeText = (text: string) => {
    onChange({ opponent: text, opponent_team_id: null });
    setOpen(false);
    setActiveIdx(-1);
  };

  const clearLink = () => {
    onChange({ opponent: "", opponent_team_id: null });
    setQuery("");
    setOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showResults) return;
    const total = items.length + (query.trim() ? 1 : 0); // +1 for free-text row
    if (total === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % total);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + total) % total);
    } else if (e.key === "Enter") {
      if (activeIdx < 0) return;
      e.preventDefault();
      if (activeIdx < items.length) {
        pickTeam(items[activeIdx]);
      } else {
        applyFreeText(query.trim());
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  if (isLinked) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-input rounded-md bg-muted/30">
          <Link2 className="w-3.5 h-3.5 text-sa-blue shrink-0" aria-hidden />
          <span className="text-sm truncate">{value.opponent}</span>
          <Badge variant="secondary" className="ml-auto text-[10px] uppercase tracking-wider">
            Linked
          </Badge>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={clearLink}
          disabled={disabled}
          aria-label="Unlink opponent"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          // Mirror text into the controlled value so submit captures it
          // even when no team is picked (free-text path).
          onChange({ opponent: e.target.value, opponent_team_id: null });
          setOpen(true);
          setActiveIdx(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay close so a click on a result fires before the popover hides.
          blurTimerRef.current = setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={showResults}
        aria-controls={listboxId}
        aria-autocomplete="list"
      />
      {showResults && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-md text-popover-foreground"
          // Cancel the blur-close while interacting with the list.
          onMouseDown={(e) => {
            e.preventDefault();
            if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
          }}
        >
          {loading && items.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>
          )}
          {!loading && items.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">No matching teams.</li>
          )}
          {items.map((t, i) => (
            <li
              key={t.id}
              role="option"
              aria-selected={activeIdx === i}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => pickTeam(t)}
              className={`px-3 py-2 text-sm cursor-pointer flex items-center gap-2 ${
                activeIdx === i ? "bg-accent text-accent-foreground" : ""
              }`}
            >
              <Link2 className="w-3.5 h-3.5 text-sa-blue shrink-0" aria-hidden />
              <div className="min-w-0">
                <div className="truncate font-medium">{t.school.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {t.name} · {levelLabel[t.level]}
                </div>
              </div>
            </li>
          ))}
          {query.trim() && (
            <li
              role="option"
              aria-selected={activeIdx === items.length}
              onMouseEnter={() => setActiveIdx(items.length)}
              onClick={() => applyFreeText(query.trim())}
              className={`px-3 py-2 text-sm cursor-pointer border-t border-border ${
                activeIdx === items.length ? "bg-accent text-accent-foreground" : ""
              }`}
            >
              Use <span className="font-medium">&quot;{query.trim()}&quot;</span>{" "}
              <span className="text-muted-foreground">as opponent (not in Statly)</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
