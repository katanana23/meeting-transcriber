import React, { createContext, useContext, useState } from "react";
import { cn } from "@/lib/utils";

type Ctx = { open: boolean; toggle: () => void };
const DisclosureCtx = createContext<Ctx>({ open: false, toggle: () => {} });

export function Disclosure({
  children, className, defaultOpen = false,
}: { children: React.ReactNode; className?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <DisclosureCtx.Provider value={{ open, toggle: () => setOpen((o) => !o) }}>
      <div className={cn(className)}>{children}</div>
    </DisclosureCtx.Provider>
  );
}

export function DisclosureTrigger({
  children, className,
}: { children: React.ReactNode; className?: string }) {
  const { toggle } = useContext(DisclosureCtx);
  return (
    <div className={cn("cursor-pointer select-none", className)} onClick={toggle}>
      {children}
    </div>
  );
}

export function DisclosureContent({
  children, className,
}: { children: React.ReactNode; className?: string }) {
  const { open } = useContext(DisclosureCtx);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: open ? "1fr" : "0fr",
        transition: "grid-template-rows 320ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
      className={cn(className)}
    >
      <div style={{ overflow: "hidden" }}>{children}</div>
    </div>
  );
}

// Controlled variant — open state managed externally
export function DisclosureAnimated({
  open, children, className,
}: { open: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: open ? "1fr" : "0fr",
        transition: "grid-template-rows 320ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
      className={cn(className)}
    >
      <div style={{ overflow: "hidden" }}>{children}</div>
    </div>
  );
}
