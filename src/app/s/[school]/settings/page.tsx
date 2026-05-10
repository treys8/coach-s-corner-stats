"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { ArrowLeft } from "lucide-react";
import { useSchool } from "@/lib/contexts/school";
import { useAuth } from "@/contexts/auth";
import {
  ASSOCIATIONS,
  CLASSIFICATIONS,
  DIVISIONS,
} from "@/lib/school-classifications";

const supabase = createClient();

const DEFAULT_PRIMARY = "#0021A5";
const DEFAULT_SECONDARY = "#FF4A00";

export default function SchoolSettingsPage() {
  const { school, isAdmin } = useSchool();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [form, setForm] = useState({
    name: school.name,
    short_name: school.short_name ?? "",
    logo_url: school.logo_url ?? "",
    primary_color: school.primary_color ?? DEFAULT_PRIMARY,
    secondary_color: school.secondary_color ?? DEFAULT_SECONDARY,
    is_discoverable: school.is_discoverable,
    public_scores_enabled: school.public_scores_enabled,
    association: school.association ?? "",
    classification: school.classification ?? "",
    division: school.division ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [allowCoachContact, setAllowCoachContact] = useState<boolean | null>(null);
  const [contactBusy, setContactBusy] = useState(false);

  useEffect(() => {
    setForm({
      name: school.name,
      short_name: school.short_name ?? "",
      logo_url: school.logo_url ?? "",
      primary_color: school.primary_color ?? DEFAULT_PRIMARY,
      secondary_color: school.secondary_color ?? DEFAULT_SECONDARY,
      is_discoverable: school.is_discoverable,
      public_scores_enabled: school.public_scores_enabled,
      association: school.association ?? "",
      classification: school.classification ?? "",
      division: school.division ?? "",
    });
  }, [school]);

  // Load this admin's current contact-flag value.
  useEffect(() => {
    if (!isAdmin || !userId) {
      setAllowCoachContact(null);
      return;
    }
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("school_admins")
        .select("allow_coach_contact")
        .eq("school_id", school.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!active) return;
      const row = data as { allow_coach_contact: boolean } | null;
      setAllowCoachContact(row?.allow_coach_contact ?? false);
    })();
    return () => {
      active = false;
    };
  }, [isAdmin, userId, school.id]);

  const toggleCoachContact = async (next: boolean) => {
    if (!userId || contactBusy) return;
    setContactBusy(true);
    const prev = allowCoachContact;
    setAllowCoachContact(next); // optimistic
    const { error } = await supabase
      .from("school_admins")
      .update({ allow_coach_contact: next })
      .eq("school_id", school.id)
      .eq("user_id", userId);
    setContactBusy(false);
    if (error) {
      setAllowCoachContact(prev);
      toast.error(error.message);
      return;
    }
    toast.success(next ? "Contact info will be shown on disputes" : "Contact info hidden");
  };

  if (!isAdmin) {
    return (
      <div className="container mx-auto px-6 py-10 text-center">
        <p className="font-display text-3xl text-sa-blue-deep mb-2">Admins only</p>
        <p className="text-sm text-muted-foreground mb-6">
          Only school admins can change settings.
        </p>
        <Link href={`/s/${school.slug}`} className="text-sa-orange underline">
          Back to {school.name}
        </Link>
      </div>
    );
  }

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("School name is required");
      return;
    }
    if (
      form.public_scores_enabled &&
      (!form.association || !form.classification || !form.division)
    ) {
      toast.error("Set association, classification, and division before publishing scores");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("schools")
      .update({
        name: form.name.trim(),
        short_name: form.short_name.trim() || null,
        logo_url: form.logo_url.trim() || null,
        primary_color: form.primary_color || null,
        secondary_color: form.secondary_color || null,
        is_discoverable: form.is_discoverable,
        public_scores_enabled: form.public_scores_enabled,
        association: form.association || null,
        classification: form.classification || null,
        division: form.division || null,
      })
      .eq("id", school.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("School settings saved");
    // Force a reload so the layout picks up the new branding.
    window.location.reload();
  };

  return (
    <div className="container mx-auto px-6 py-10 max-w-3xl">
      <Link
        href={`/s/${school.slug}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-sa-orange mb-6"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to {school.name}
      </Link>

      <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">School Settings</p>
      <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep mb-2">{school.name}</h2>
      <p className="text-sm text-muted-foreground mb-8">
        Branding shows up across every page in your school&apos;s namespace.
      </p>

      <Card className="p-8 shadow-elevated space-y-5">
        <div>
          <Label htmlFor="school-name" className="mb-1.5 block">School name</Label>
          <Input
            id="school-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="short-name" className="mb-1.5 block">Short name (optional)</Label>
          <Input
            id="short-name"
            value={form.short_name}
            onChange={(e) => setForm({ ...form, short_name: e.target.value })}
            placeholder="MHS"
            maxLength={12}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Used in compact header labels. Defaults to the full name if empty.
          </p>
        </div>
        <div>
          <Label htmlFor="logo-url" className="mb-1.5 block">Logo URL (optional)</Label>
          <Input
            id="logo-url"
            type="url"
            value={form.logo_url}
            onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
            placeholder="https://yourschool.org/logo.png"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Direct URL to a logo image. Image upload coming later.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="primary-color" className="mb-1.5 block">Primary color</Label>
            <div className="flex items-center gap-3">
              <input
                id="primary-color"
                type="color"
                value={form.primary_color}
                onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                className="h-10 w-16 rounded border border-input cursor-pointer"
              />
              <Input
                value={form.primary_color}
                onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                placeholder={DEFAULT_PRIMARY}
                className="flex-1"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Header background and dominant brand color.
            </p>
          </div>
          <div>
            <Label htmlFor="secondary-color" className="mb-1.5 block">Secondary color</Label>
            <div className="flex items-center gap-3">
              <input
                id="secondary-color"
                type="color"
                value={form.secondary_color}
                onChange={(e) => setForm({ ...form, secondary_color: e.target.value })}
                className="h-10 w-16 rounded border border-input cursor-pointer"
              />
              <Input
                value={form.secondary_color}
                onChange={(e) => setForm({ ...form, secondary_color: e.target.value })}
                placeholder={DEFAULT_SECONDARY}
                className="flex-1"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Accent color used for buttons, active nav, and highlights.
            </p>
          </div>
        </div>

        <div className="border-t pt-5 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Public visibility</p>
            <p className="text-sm text-muted-foreground mt-1">
              Controls how your school appears outside its own login.
            </p>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="public-scores" className="text-sm font-semibold">
                Publish scores to the public Scores page
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                When off, none of your finalized or in-progress games appear on the public Scores page.
              </p>
            </div>
            <Switch
              id="public-scores"
              checked={form.public_scores_enabled}
              onCheckedChange={(v) => setForm({ ...form, public_scores_enabled: v })}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="discoverable" className="text-sm font-semibold">
                Discoverable in the opponent picker
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                When off, other coaches can&apos;t find your teams by typing your school name. Schools you&apos;ve already linked games with are unaffected.
              </p>
            </div>
            <Switch
              id="discoverable"
              checked={form.is_discoverable}
              onCheckedChange={(v) => setForm({ ...form, is_discoverable: v })}
            />
          </div>

          <div className="pt-2">
            <p className="text-sm font-semibold">Classification</p>
            <p className="text-xs text-muted-foreground mt-1 mb-3">
              Required when publishing scores. Lets visitors filter the public Scores page to find games in your association, class, and division.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="association" className="mb-1.5 block text-xs">Association</Label>
                <Select
                  value={form.association}
                  onValueChange={(v) => setForm({ ...form, association: v })}
                >
                  <SelectTrigger id="association">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSOCIATIONS.map((a) => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="classification" className="mb-1.5 block text-xs">Classification</Label>
                <Select
                  value={form.classification}
                  onValueChange={(v) => setForm({ ...form, classification: v })}
                >
                  <SelectTrigger id="classification">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {CLASSIFICATIONS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="division" className="mb-1.5 block text-xs">Division</Label>
                <Select
                  value={form.division}
                  onValueChange={(v) => setForm({ ...form, division: v })}
                >
                  <SelectTrigger id="division">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {DIVISIONS.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.public_scores_enabled &&
              (!form.association || !form.classification || !form.division) && (
                <p className="text-xs text-destructive mt-2">
                  All three are required while public scores are turned on.
                </p>
              )}
          </div>
        </div>

        {/* Live swatch preview */}
        <div
          className="rounded-md p-5 flex items-center gap-4"
          style={{
            background: `linear-gradient(135deg, ${form.primary_color} 0%, ${form.primary_color}dd 100%)`,
            color: "white",
          }}
        >
          <div className="leading-tight">
            <p
              className="text-xs uppercase tracking-[0.2em] font-semibold"
              style={{ color: form.secondary_color }}
            >
              {school.short_name || school.name}
            </p>
            <h3 className="font-display text-2xl">Preview</h3>
          </div>
          <div className="ml-auto">
            <span
              className="px-4 py-2 rounded-md text-sm font-semibold uppercase tracking-wider text-white inline-block"
              style={{ background: form.secondary_color }}
            >
              Sample
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Link href={`/s/${school.slug}`}>
            <Button variant="outline">Cancel</Button>
          </Link>
          <Button
            onClick={submit}
            disabled={busy}
            className="bg-sa-blue hover:bg-sa-blue-deep text-white"
          >
            {busy ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </Card>

      {allowCoachContact !== null && (
        <Card className="p-8 shadow-elevated mt-6">
          <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Your contact preferences</p>
          <h3 className="font-display text-2xl text-sa-blue-deep mt-1 mb-1">
            Contact info on disputes
          </h3>
          <p className="text-sm text-muted-foreground mb-5">
            When two schools record different final scores for the same game, both coaches see a private dispute banner. Turn this on to let the other coach see your name and email so they can reach out.
          </p>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="coach-contact" className="text-sm font-semibold">
                Show my contact info on score disputes
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Off by default. Only the opposing coach on a linked game can see it, and only when both sides have opted in.
              </p>
            </div>
            <Switch
              id="coach-contact"
              checked={allowCoachContact}
              disabled={contactBusy}
              onCheckedChange={toggleCoachContact}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
