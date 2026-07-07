import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all duration-100 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 active:scale-[0.97]",
  {
    variants: {
      variant: {
        default:     "bg-white text-black hover:bg-white/90",
        destructive: "bg-[#f03a2e] text-white hover:bg-[#d42e24]",
        outline:     "border border-white/[0.1] bg-white/[0.04] text-foreground hover:bg-white/[0.08]",
        ghost:       "text-foreground hover:bg-white/[0.06]",
      },
      size: {
        default: "h-10 px-5 py-2",
        lg:      "h-12 px-8 text-base",
        icon:    "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";
