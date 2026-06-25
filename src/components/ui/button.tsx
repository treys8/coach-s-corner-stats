import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all [transition-duration:120ms] [transition-timing-function:var(--ease-spring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Scoring family — tactile gradient surfaces with lift + press feedback
        pitchBall: "text-white bg-gradient-primary-btn shadow-e2 hover:shadow-e3 hover:-translate-y-px active:translate-y-0 active:shadow-pressed",
        pitchStrike: "text-white bg-gradient-accent-btn shadow-e2 hover:shadow-e3 hover:-translate-y-px active:translate-y-0 active:shadow-pressed",
        pitchInPlay: "text-white bg-sa-blue-deep shadow-e2 hover:shadow-e3 hover:-translate-y-px active:translate-y-0 active:shadow-pressed",
        pitchNeutral: "text-foreground bg-gradient-neutral-btn border border-border shadow-e1 hover:shadow-e2 active:shadow-pressed",
        outcomeHit: "text-white bg-gradient-accent-btn shadow-e2 hover:shadow-e3 hover:-translate-y-px active:translate-y-0 active:shadow-pressed",
        outcomeOut: "text-foreground bg-gradient-neutral-btn border border-border shadow-e1 hover:shadow-e2 active:shadow-pressed",
        outcomeOther: "text-white bg-sa-blue-deep/90 shadow-e2 hover:shadow-e3 hover:-translate-y-px active:shadow-pressed",
        outcomeBase: "text-white bg-gradient-primary-btn shadow-e2 hover:shadow-e3 hover:-translate-y-px active:shadow-pressed",
        commit: "text-white bg-gradient-accent-btn glow-accent hover:shadow-e3 active:shadow-pressed",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
        // Scoring sizes — generous outdoor touch targets
        pitch: "h-14 rounded-lg text-base font-bold",
        pitchSm: "h-12 rounded-md text-sm font-bold px-1",
        outcome: "h-12 rounded-lg text-base font-bold",
        outcomeSm: "h-11 rounded-md text-sm font-bold",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
