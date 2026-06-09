import type { ReactNode } from "react";

type Tone = "soft" | "accent" | "ink" | "no" | "outline";

const TONES: Record<Tone, string> = {
  soft: "bg-line2 text-ink2",
  accent: "bg-accent-soft text-accent-deep",
  ink: "bg-ink text-surface",
  no: "bg-no-soft text-no-deep",
  outline: "bg-transparent text-ink2 border border-line",
};

export default function Pill({
  children,
  tone = "soft",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium leading-tight px-2.5 py-1 rounded-full ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
