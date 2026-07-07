import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "rounded-xl border border-white/[0.07] bg-card p-4",
      "shadow-[0_2px_24px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.05)]",
      className
    )}
    {...props}
  />
);
