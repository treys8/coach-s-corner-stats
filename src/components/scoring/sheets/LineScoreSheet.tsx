"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ReplayState } from "@/lib/scoring/types";
import { LineScore } from "../LineScore";

interface LineScoreSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ReplayState;
}

export function LineScoreSheet({ open, onOpenChange, state }: LineScoreSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="top" className="max-h-[80dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Box score</SheetTitle>
          <SheetDescription>Runs, hits, and errors by inning.</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <LineScore state={state} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
