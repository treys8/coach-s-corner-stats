"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GLOSSARY } from "@/lib/glossary";

interface Props { abbr: string; className?: string }

// Tap/click-toggle definition. A Radix Tooltip is suppressed on touch devices,
// so the dotted-underline help affordance was unreachable on phones/tablets —
// the primary surfaces. A Popover opens on click, which works on every device.
export const StatLabel = ({ abbr, className }: Props) => {
  const def = GLOSSARY[abbr];
  if (!def) return <span className={className}>{abbr}</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          // Keep the tap from bubbling to any parent hover/nav surface. Do NOT
          // call preventDefault here — Radix skips its own toggle handler when
          // the event is defaultPrevented.
          onClick={(e) => e.stopPropagation()}
          className={`underline decoration-dotted decoration-sa-grey underline-offset-4 cursor-help ${className ?? ""}`}
        >
          {abbr}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-xs p-2 bg-sa-blue-deep text-white border-sa-orange">
        <p className="text-xs"><span className="font-bold text-sa-orange">{abbr}</span> — {def}</p>
      </PopoverContent>
    </Popover>
  );
};
