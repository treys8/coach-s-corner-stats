"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GLOSSARY } from "@/lib/glossary";

interface Props { abbr: string; className?: string }

export const StatLabel = ({ abbr, className }: Props) => {
  const def = GLOSSARY[abbr];
  if (!def) return <span className={className}>{abbr}</span>;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`underline decoration-dotted decoration-sa-grey underline-offset-4 cursor-help ${className ?? ""}`}>
            {abbr}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs bg-sa-blue-deep text-white border-sa-orange">
          <p className="text-xs"><span className="font-bold text-sa-orange">{abbr}</span> — {def}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
