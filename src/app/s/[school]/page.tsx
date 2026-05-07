"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Settings, Users } from "lucide-react";
import { useSchool } from "@/lib/contexts/school";
import type { Sport, TeamLevel } from "@/integrations/supabase/types";

interface TeamRow {
  id: string;
  slug: string;
  name: string;
  sport: Sport;
  level: TeamLevel;
}

const supabase = createClient();

const SPORT_LABEL: Record<Sport, string> = { baseball: "Baseball", softball: "Softball" };
const LEVEL_LABEL: Record<TeamLevel, string> = {
  varsity: "Varsity",
  jv: "JV",
  freshman: "Freshman",
  middle_school: "Middle School",
};

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export default function SchoolDashboard() {
  const { school, isAdmin } = useSchool();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "Varsity Baseball",
    slug: "",
    sport: "baseball" as Sport,
    level: "varsity" as TeamLevel,
  });

  const load = async () => {
    const { data, error } = await supabase
      .from("teams")
      .select("id, slug, name, sport, level")
      .eq("school_id", school.id)
      .order("name");
    if (error) {
      toast.error(`Couldn't load teams: ${error.message}`);
      setLoading(false);
      return;
    }
    setTeams((data ?? []) as TeamRow[]);
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [school.id]);

  const submit = async () => {
    const slug = (form.slug || slugify(form.name)).trim();
    if (!form.name.trim() || !slug) {
      toast.error("Name and slug are required");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("teams").insert({
      school_id: school.id,
      slug,
      name: form.name.trim(),
      sport: form.sport,
      level: form.level,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Team added");
    setOpen(false);
    setForm({ name: "Varsity Baseball", slug: "", sport: "baseball", level: "varsity" });
    load();
  };

  return (
    <div className="container mx-auto px-6 py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">School</p>
          <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep">{school.name}</h2>
          <p className="text-sm text-muted-foreground mt-2">/s/{school.slug}</p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Link href={`/s/${school.slug}/settings`}>
              <Button variant="outline" className="gap-1">
                <Settings className="w-4 h-4" /> Settings
              </Button>
            </Link>
            <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-sa-orange hover:bg-sa-orange-glow text-white shadow-orange">
                <Plus className="w-4 h-4 mr-1" /> Add Team
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">Add Team</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) =>
                      setForm({ ...form, name: e.target.value, slug: slugify(e.target.value) })
                    }
                    placeholder="Varsity Baseball"
                  />
                </div>
                <div>
                  <Label>URL slug</Label>
                  <Input
                    value={form.slug || slugify(form.name)}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    placeholder="varsity-baseball"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    /s/{school.slug}/<span className="text-sa-orange">{form.slug || slugify(form.name)}</span>
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Sport</Label>
                    <Select
                      value={form.sport}
                      onValueChange={(v) => setForm({ ...form, sport: v as Sport })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="baseball">Baseball</SelectItem>
                        <SelectItem value="softball">Softball</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Level</Label>
                    <Select
                      value={form.level}
                      onValueChange={(v) => setForm({ ...form, level: v as TeamLevel })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="varsity">Varsity</SelectItem>
                        <SelectItem value="jv">JV</SelectItem>
                        <SelectItem value="freshman">Freshman</SelectItem>
                        <SelectItem value="middle_school">Middle School</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={submit} disabled={submitting} className="bg-sa-blue hover:bg-sa-blue-deep">
                  {submitting ? "Saving…" : "Save Team"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        )}
      </div>

      {loading ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">Loading teams…</p>
        </Card>
      ) : teams.length === 0 ? (
        <Card className="p-12 text-center bg-sa-grey-soft border-dashed">
          <Users className="w-10 h-10 mx-auto mb-4 text-sa-blue" />
          <h3 className="font-display text-2xl text-sa-blue-deep mb-2">No teams yet</h3>
          <p className="text-muted-foreground">
            {isAdmin
              ? 'Click "Add Team" to create your first team.'
              : "Ask a school admin to add a team."}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map((t) => (
            <Link
              key={t.id}
              href={`/s/${school.slug}/${t.slug}`}
              className="group bg-card border border-border rounded-lg overflow-hidden shadow-card hover:shadow-elevated hover:-translate-y-0.5 transition-all"
            >
              <div className="bg-gradient-blue h-2" />
              <div className="p-5">
                <p className="text-xs uppercase tracking-wider text-sa-orange font-semibold">
                  {LEVEL_LABEL[t.level]} · {SPORT_LABEL[t.sport]}
                </p>
                <p className="font-display text-2xl text-sa-blue-deep group-hover:text-sa-orange transition-colors">
                  {t.name}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
