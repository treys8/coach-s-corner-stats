"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSchool } from "@/lib/contexts/school";
import { createClient } from "@/lib/supabase/client";
import { currentSeasonYear } from "@/lib/season";
import {
  NFHS_DEFAULTS,
  mergeWithDefaults,
  type LeagueRules,
  type LeagueRulesRow,
  type PitchCountRestTier,
} from "@/lib/scoring/league-defaults";

const supabase = createClient();

// "Year IS NULL" stands in for the school default row in the year picker.
const DEFAULT_KEY = "__default__";

interface FormState extends LeagueRules {
  seasonYear: number | null;
}

const yearOptions = (() => {
  const cur = currentSeasonYear();
  return [cur + 1, cur, cur - 1, cur - 2];
})();

function emptyForm(seasonYear: number | null): FormState {
  return { ...NFHS_DEFAULTS, seasonYear };
}

export default function LeagueRulesPage() {
  const { school, isAdmin } = useSchool();
  const [yearKey, setYearKey] = useState<string>(String(currentSeasonYear()));
  const [form, setForm] = useState<FormState>(emptyForm(currentSeasonYear()));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);

  // Load the selected year's row (if any) and hydrate the form.
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const seasonYear = yearKey === DEFAULT_KEY ? null : Number(yearKey);
      const query = supabase
        .from("league_rules")
        .select("*")
        .eq("school_id", school.id);
      const { data, error } = seasonYear == null
        ? await query.is("season_year", null).maybeSingle()
        : await query.eq("season_year", seasonYear).maybeSingle();
      if (!active) return;
      if (error && error.code !== "PGRST116") {
        toast.error(error.message);
      }
      const row = (data as LeagueRulesRow | null) ?? null;
      const rules = mergeWithDefaults(row);
      setExistingId(row?.id ?? null);
      setForm({ ...rules, seasonYear });
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [school.id, yearKey]);

  if (!isAdmin) {
    return (
      <div className="container mx-auto px-6 py-10 text-center">
        <p className="font-display text-3xl text-sa-blue-deep mb-2">Admins only</p>
        <p className="text-sm text-muted-foreground mb-6">
          Only school admins can change league rules.
        </p>
        <Link href={`/s/${school.slug}/settings`} className="text-sa-orange underline">
          Back to settings
        </Link>
      </div>
    );
  }

  const updateForm = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const addRestTier = () =>
    updateForm("pitch_count_rest_tiers", [
      ...form.pitch_count_rest_tiers,
      { pitches: 0, rest_days: 0 },
    ]);
  const updateRestTier = (i: number, patch: Partial<PitchCountRestTier>) => {
    const next = form.pitch_count_rest_tiers.map((t, j) =>
      i === j ? { ...t, ...patch } : t,
    );
    updateForm("pitch_count_rest_tiers", next);
  };
  const removeRestTier = (i: number) =>
    updateForm(
      "pitch_count_rest_tiers",
      form.pitch_count_rest_tiers.filter((_, j) => j !== i),
    );

  const save = async () => {
    setBusy(true);
    const payload = {
      school_id: school.id,
      season_year: form.seasonYear,
      mercy_threshold_runs: form.mercy_threshold_runs,
      mercy_threshold_inning: form.mercy_threshold_inning,
      mercy_threshold_runs_alt: form.mercy_threshold_runs_alt,
      mercy_threshold_inning_alt: form.mercy_threshold_inning_alt,
      pitch_count_max: form.pitch_count_max,
      pitch_count_rest_tiers: form.pitch_count_rest_tiers,
      mid_batter_finish: form.mid_batter_finish,
      courtesy_runner_allowed: form.courtesy_runner_allowed,
      reentry_starters_only: form.reentry_starters_only,
      reentry_once_per_starter: form.reentry_once_per_starter,
      double_first_base: form.double_first_base,
      extras: form.extras,
    };
    const { data, error } = existingId
      ? await supabase
          .from("league_rules")
          .update(payload)
          .eq("id", existingId)
          .select("id")
          .single()
      : await supabase
          .from("league_rules")
          .insert(payload)
          .select("id")
          .single();
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setExistingId((data as { id: string }).id);
    toast.success("League rules saved");
  };

  const resetToDefaults = () => {
    setForm({ ...NFHS_DEFAULTS, seasonYear: form.seasonYear });
  };

  const deleteRow = async () => {
    if (!existingId) return;
    if (!confirm("Delete this league-rules row? Falls back to NFHS defaults.")) return;
    setBusy(true);
    const { error } = await supabase.from("league_rules").delete().eq("id", existingId);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setExistingId(null);
    setForm({ ...NFHS_DEFAULTS, seasonYear: form.seasonYear });
    toast.success("Row removed");
  };

  return (
    <div className="container mx-auto px-6 py-10 max-w-3xl">
      <Link
        href={`/s/${school.slug}/settings`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-sa-orange mb-6"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to settings
      </Link>

      <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">League Rules</p>
      <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep mb-2">
        Game rule configuration
      </h2>
      <p className="text-sm text-muted-foreground mb-8">
        Per-(school, season) overrides on top of NFHS defaults. Game-time lookup
        falls through season-specific → school default → NFHS baseline, so you
        only set what differs.
      </p>

      <Card className="p-6 mb-6 shadow-elevated">
        <Label htmlFor="year-picker" className="mb-1.5 block">Season</Label>
        <Select value={yearKey} onValueChange={setYearKey}>
          <SelectTrigger id="year-picker" className="w-full sm:w-[260px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_KEY}>School default (any year)</SelectItem>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={String(y)}>{y} season</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-2">
          Season-specific rows override the school default for that year. The
          school default applies whenever no season-specific row exists.
        </p>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card className="p-8 shadow-elevated space-y-6">
          <section className="space-y-3">
            <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Mercy rule</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mercy-runs" className="mb-1.5 block text-xs">Runs</Label>
                <Input
                  id="mercy-runs"
                  type="number"
                  min={1}
                  value={form.mercy_threshold_runs}
                  onChange={(e) => updateForm("mercy_threshold_runs", Number(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="mercy-inning" className="mb-1.5 block text-xs">After inning</Label>
                <Input
                  id="mercy-inning"
                  type="number"
                  min={1}
                  value={form.mercy_threshold_inning}
                  onChange={(e) => updateForm("mercy_threshold_inning", Number(e.target.value))}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Primary threshold (NFHS baseline: 10 runs after inning 5).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mercy-runs-alt" className="mb-1.5 block text-xs">Alt runs (optional)</Label>
                <Input
                  id="mercy-runs-alt"
                  type="number"
                  min={1}
                  value={form.mercy_threshold_runs_alt ?? ""}
                  onChange={(e) =>
                    updateForm(
                      "mercy_threshold_runs_alt",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </div>
              <div>
                <Label htmlFor="mercy-inning-alt" className="mb-1.5 block text-xs">After inning</Label>
                <Input
                  id="mercy-inning-alt"
                  type="number"
                  min={1}
                  value={form.mercy_threshold_inning_alt ?? ""}
                  onChange={(e) =>
                    updateForm(
                      "mercy_threshold_inning_alt",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Earlier "blowout" threshold (e.g., 15 after 3). Leave blank to disable.
            </p>
          </section>

          <section className="space-y-3 border-t pt-5">
            <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Pitch counts</p>
            <div>
              <Label htmlFor="pc-max" className="mb-1.5 block text-xs">Max pitches per day</Label>
              <Input
                id="pc-max"
                type="number"
                min={1}
                className="w-32"
                value={form.pitch_count_max}
                onChange={(e) => updateForm("pitch_count_max", Number(e.target.value))}
              />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="mid-batter" className="text-sm font-semibold">
                  Allow finishing the current batter
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  When the max is hit mid-PA, the pitcher may stay in to face the current batter.
                </p>
              </div>
              <Switch
                id="mid-batter"
                checked={form.mid_batter_finish}
                onCheckedChange={(v) => updateForm("mid_batter_finish", v)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Rest-day tiers</Label>
              {form.pitch_count_rest_tiers.length === 0 && (
                <p className="text-xs text-muted-foreground italic">
                  No tiers configured. Defaults apply.
                </p>
              )}
              {form.pitch_count_rest_tiers.map((tier, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label className="mb-1 block text-[10px] uppercase">Pitches ≥</Label>
                    <Input
                      type="number"
                      min={0}
                      value={tier.pitches}
                      onChange={(e) => updateRestTier(i, { pitches: Number(e.target.value) })}
                    />
                  </div>
                  <div className="flex-1">
                    <Label className="mb-1 block text-[10px] uppercase">Days rest</Label>
                    <Input
                      type="number"
                      min={0}
                      value={tier.rest_days}
                      onChange={(e) => updateRestTier(i, { rest_days: Number(e.target.value) })}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeRestTier(i)}
                    className="h-9 w-9 p-0 text-destructive hover:text-destructive"
                    title="Remove tier"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" onClick={addRestTier} className="gap-1">
                <Plus className="w-3.5 h-3.5" /> Add tier
              </Button>
            </div>
          </section>

          <section className="space-y-3 border-t pt-5">
            <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Substitutions</p>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label className="text-sm font-semibold">Courtesy runner allowed</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  State-adopted NFHS option for a courtesy runner for the pitcher / catcher of record.
                </p>
              </div>
              <Switch
                checked={form.courtesy_runner_allowed}
                onCheckedChange={(v) => updateForm("courtesy_runner_allowed", v)}
              />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label className="text-sm font-semibold">Re-entry: starters only</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Only starters may re-enter after being subbed out (NFHS 3-1-3).
                </p>
              </div>
              <Switch
                checked={form.reentry_starters_only}
                onCheckedChange={(v) => updateForm("reentry_starters_only", v)}
              />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label className="text-sm font-semibold">Re-entry: once per starter</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  A starter can re-enter at most once per game.
                </p>
              </div>
              <Switch
                checked={form.reentry_once_per_starter}
                onCheckedChange={(v) => updateForm("reentry_once_per_starter", v)}
              />
            </div>
          </section>

          <section className="space-y-3 border-t pt-5">
            <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Field</p>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label className="text-sm font-semibold">Double first base</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  NFHS mandates the orange safety bag by 2027. Toggle on for fields that have it.
                </p>
              </div>
              <Switch
                checked={form.double_first_base}
                onCheckedChange={(v) => updateForm("double_first_base", v)}
              />
            </div>
          </section>

          <div className="flex justify-between items-center pt-2 border-t">
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={resetToDefaults} disabled={busy}>
                Reset to NFHS defaults
              </Button>
              {existingId && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={deleteRow}
                  disabled={busy}
                  className="text-destructive hover:text-destructive"
                >
                  Delete row
                </Button>
              )}
            </div>
            <Button
              onClick={save}
              disabled={busy}
              className="bg-sa-blue hover:bg-sa-blue-deep text-white"
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
