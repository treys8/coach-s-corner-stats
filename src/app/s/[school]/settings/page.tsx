"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
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
import { ArrowLeft, Copy, Trash2, Upload, X } from "lucide-react";
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
  const [logoBusy, setLogoBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Logo must be under 5MB");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const extFromMime: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/svg+xml": "svg",
    };
    const ext = extFromMime[file.type];
    if (!ext) {
      toast.error("Use PNG, JPG, SVG, or WebP");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setLogoBusy(true);
    try {
      const path = `${school.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("school-logos")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (upErr) {
        toast.error(upErr.message);
        return;
      }
      const { data: pub } = supabase.storage.from("school-logos").getPublicUrl(path);
      const newUrl = pub.publicUrl;
      const oldUrl = form.logo_url;

      const { error: dbErr } = await supabase
        .from("schools")
        .update({ logo_url: newUrl })
        .eq("id", school.id);
      if (dbErr) {
        await supabase.storage.from("school-logos").remove([path]);
        toast.error(dbErr.message);
        return;
      }

      if (oldUrl && oldUrl.includes("/school-logos/")) {
        const oldPath = oldUrl.split("/school-logos/")[1];
        if (oldPath) await supabase.storage.from("school-logos").remove([oldPath]);
      }

      setForm((f) => ({ ...f, logo_url: newUrl }));
      toast.success("Logo updated");
    } finally {
      setLogoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleLogoRemove = async () => {
    if (!form.logo_url) return;
    if (!confirm("Remove the school logo?")) return;
    setLogoBusy(true);
    try {
      const oldUrl = form.logo_url;
      const { error } = await supabase
        .from("schools")
        .update({ logo_url: null })
        .eq("id", school.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      if (oldUrl.includes("/school-logos/")) {
        const oldPath = oldUrl.split("/school-logos/")[1];
        if (oldPath) await supabase.storage.from("school-logos").remove([oldPath]);
      }
      setForm((f) => ({ ...f, logo_url: "" }));
      toast.success("Logo removed");
    } finally {
      setLogoBusy(false);
    }
  };

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

  // ---- Admin invites / roster -----------------------------------------------

  interface AdminRow {
    user_id: string;
    email: string;
    display_name: string;
    role: string;
    created_at: string;
  }
  interface InviteRow {
    id: string;
    email: string;
    token: string;
    expires_at: string;
    created_at: string;
  }

  const [adminsList, setAdminsList] = useState<AdminRow[]>([]);
  const [pendingInvites, setPendingInvites] = useState<InviteRow[]>([]);
  const [adminsLoaded, setAdminsLoaded] = useState(false);
  const [adminsError, setAdminsError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [newInviteUrl, setNewInviteUrl] = useState<string | null>(null);

  const loadAdminsAndInvites = async () => {
    if (!isAdmin) return;
    const [admins, invites] = await Promise.all([
      supabase.rpc("list_school_admins", { p_school: school.id }),
      supabase
        .from("school_admin_invites")
        .select("id, email, token, expires_at, created_at")
        .eq("school_id", school.id)
        .is("accepted_at", null)
        .order("created_at", { ascending: false }),
    ]);
    if (admins.error) {
      setAdminsError(admins.error.message);
    } else {
      setAdminsList((admins.data ?? []) as AdminRow[]);
      setAdminsError(null);
    }
    if (!invites.error) setPendingInvites((invites.data ?? []) as InviteRow[]);
    setAdminsLoaded(true);
  };

  useEffect(() => {
    loadAdminsAndInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [school.id, isAdmin]);

  const createInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid email");
      return;
    }
    setInviteBusy(true);
    setNewInviteUrl(null);
    const { data, error } = await supabase
      .from("school_admin_invites")
      .insert({ school_id: school.id, email })
      .select("token")
      .single();
    setInviteBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const token = (data as { token: string }).token;
    setNewInviteUrl(`${window.location.origin}/invite/${token}`);
    setInviteEmail("");
    loadAdminsAndInvites();
    toast.success("Invite created — share the link");
  };

  const revokeInvite = async (id: string) => {
    if (!confirm("Revoke this invite?")) return;
    const { error } = await supabase.from("school_admin_invites").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Invite revoked");
    loadAdminsAndInvites();
  };

  const removeAdmin = async (targetUserId: string, targetEmail: string) => {
    if (!confirm(`Remove ${targetEmail} as an admin?`)) return;
    const { error } = await supabase
      .from("school_admins")
      .delete()
      .eq("school_id", school.id)
      .eq("user_id", targetUserId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Admin removed");
    loadAdminsAndInvites();
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error("Could not copy"),
    );
  };

  // ---- Coach contact preference ---------------------------------------------

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
          <Label className="mb-1.5 block">Logo</Label>
          <div className="flex items-start gap-4">
            {form.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.logo_url}
                alt="Current logo"
                className="h-20 w-20 object-contain bg-muted rounded border"
              />
            ) : (
              <div className="h-20 w-20 rounded border border-dashed flex items-center justify-center text-[10px] uppercase tracking-wider text-muted-foreground">
                No logo
              </div>
            )}
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={logoBusy}
                  className="gap-1"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {logoBusy ? "Uploading…" : form.logo_url ? "Replace" : "Upload"}
                </Button>
                {form.logo_url && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleLogoRemove}
                    disabled={logoBusy}
                    className="gap-1 text-destructive hover:text-destructive"
                  >
                    <X className="w-3.5 h-3.5" /> Remove
                  </Button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                PNG, JPG, SVG, or WebP. Saves immediately on upload. Max 5MB.
              </p>
            </div>
          </div>
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

      <Card className="p-8 shadow-elevated mt-6">
        <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Admins</p>
        <h3 className="font-display text-2xl text-sa-blue-deep mt-1 mb-1">
          School admin access
        </h3>
        <p className="text-sm text-muted-foreground mb-5">
          Admins can edit settings, manage teams, and invite other admins.
        </p>

        <div className="space-y-2 mb-6">
          <Label htmlFor="invite-email" className="text-sm font-semibold">
            Invite a new admin
          </Label>
          <div className="flex gap-2">
            <Input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="coach@example.com"
              disabled={inviteBusy}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  createInvite();
                }
              }}
            />
            <Button
              onClick={createInvite}
              disabled={inviteBusy || !inviteEmail.trim()}
              className="bg-sa-blue hover:bg-sa-blue-deep text-white"
            >
              {inviteBusy ? "Creating…" : "Create invite"}
            </Button>
          </div>
          {newInviteUrl && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 mt-2 text-xs">
              <p className="font-semibold mb-1">Invite link (share manually):</p>
              <div className="flex items-center gap-2">
                <code className="text-[11px] break-all flex-1">{newInviteUrl}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyLink(newInviteUrl)}
                  className="h-7"
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Expires in 14 days. Only the recipient&apos;s email can accept.
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            No email is sent — copy the link and share it with the new admin yourself.
          </p>
        </div>

        {pendingInvites.length > 0 && (
          <div className="mb-6">
            <p className="text-sm font-semibold mb-2">Pending invites</p>
            <div className="space-y-1">
              {pendingInvites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-2 py-1.5 px-2 border rounded text-sm"
                >
                  <span className="flex-1 truncate">{inv.email}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                    Exp {new Date(inv.expires_at).toLocaleDateString()}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      copyLink(`${window.location.origin}/invite/${inv.token}`)
                    }
                    title="Copy invite link"
                    className="h-7 w-7 p-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revokeInvite(inv.id)}
                    title="Revoke invite"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-sm font-semibold mb-2">Current admins</p>
          {!adminsLoaded ? (
            <p className="text-xs text-muted-foreground italic">Loading…</p>
          ) : adminsError ? (
            <p className="text-xs text-destructive">
              Couldn&apos;t load admins: {adminsError}
            </p>
          ) : adminsList.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No admins yet.</p>
          ) : (
            <div className="space-y-1">
              {adminsList.map((a) => {
                const isSelf = a.user_id === userId;
                return (
                  <div
                    key={a.user_id}
                    className="flex items-center gap-2 py-1.5 px-2 border rounded text-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{a.display_name}</p>
                      {a.display_name !== a.email && (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {a.email}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {a.role}
                    </span>
                    {isSelf ? (
                      <span className="text-[10px] uppercase tracking-wider text-sa-orange font-bold pr-1">
                        You
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeAdmin(a.user_id, a.email)}
                        title="Remove admin"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
