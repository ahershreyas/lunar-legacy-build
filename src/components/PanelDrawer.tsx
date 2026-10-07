import { useState, type ReactNode } from "react";
export function PanelDrawer({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-md border border-white/15 bg-card/75 backdrop-blur">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-left font-mono text-[10px] uppercase tracking-widest text-telemetry"
      >
        {title}
        <span>{open ? "− Collapse" : "+ Expand"}</span>
      </button>
      <div hidden={!open}>{children}</div>
    </section>
  );
}
