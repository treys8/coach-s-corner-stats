"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Users, BarChart3, CalendarDays, ArrowRight } from "lucide-react";
import { useSchool } from "@/lib/contexts/school";
import { useTeam } from "@/lib/contexts/team";

export default function UploadHubPage() {
  const { school } = useSchool();
  const { team } = useTeam();
  const base = `/s/${school.slug}/${team.slug}/upload`;

  const tiles = [
    {
      href: `${base}/roster`,
      label: "Roster",
      blurb: "Player names, jersey numbers, positions, grad years.",
      icon: Users,
      accept: "CSV or Excel",
    },
    {
      href: `${base}/stats`,
      label: "Stats Workbook",
      blurb: "Cumulative season-to-date workbook (Hitting, Pitching, Fielding).",
      icon: BarChart3,
      accept: "Excel (.xlsx)",
    },
    {
      href: `${base}/schedule`,
      label: "Schedule",
      blurb: "Upcoming games — opponents, dates, times, locations.",
      icon: CalendarDays,
      accept: "CSV or Excel",
    },
  ];

  return (
    <div className="container mx-auto px-6 py-10 max-w-4xl">
      <p className="text-xs uppercase tracking-[0.2em] text-sa-orange font-bold">Coach Tools</p>
      <h2 className="font-display text-5xl md:text-6xl text-sa-blue-deep mb-2">Upload</h2>
      <p className="text-sm text-muted-foreground mb-8">
        Pick what you'd like to upload for <strong>{team.name}</strong>.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="group">
            <Card className="p-6 h-full shadow-card group-hover:shadow-elevated group-hover:border-sa-orange/40 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-md bg-sa-blue/10 flex items-center justify-center">
                  <t.icon className="w-5 h-5 text-sa-blue" />
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-sa-orange transition-colors" />
              </div>
              <h3 className="font-display text-2xl text-sa-blue-deep mb-1">{t.label}</h3>
              <p className="text-sm text-muted-foreground mb-3">{t.blurb}</p>
              <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                {t.accept}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
