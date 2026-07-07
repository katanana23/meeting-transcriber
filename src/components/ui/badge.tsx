import * as React from "react";
import { cn } from "@/lib/utils";

export const Badge = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn(
      "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold",
      className
    )}
    {...props}
  />
);
