"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  RightRailContent,
  type RightRailContentProps,
} from "./RightRailContent";

interface SidebarSheetProps extends RightRailContentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Phone/portrait substitute for the inline right rail. Triggered from the
 * User icon in `GameStatusBar` (lg:hidden), it shows the same banners +
 * opposing-batter panel + spray chart that the inline aside renders on
 * lg+ — sourced from the shared `RightRailContent`.
 */
export function SidebarSheet({
  open,
  onOpenChange,
  ...rightRailProps
}: SidebarSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Game detail</SheetTitle>
          <SheetDescription>
            Banners, opposing batter, and spray chart.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <RightRailContent {...rightRailProps} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
