import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: { label: string; href: string };
  className?: string;
}) {
  return (
    <div className={`mb-5 flex items-end justify-between gap-4 ${className}`}>
      <div>
        {eyebrow ? <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-gold">{eyebrow}</p> : null}
        <h2 className="font-display text-[25px] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[29px]">{title}</h2>
        {description ? <p className="mt-1.5 max-w-xl text-sm leading-6 text-ink-muted">{description}</p> : null}
      </div>
      {action ? (
        <Link href={action.href} className="group hidden shrink-0 items-center gap-1.5 text-sm font-semibold text-sage transition hover:text-ink sm:flex">
          {action.label}
          <ArrowUpRight size={16} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
      ) : null}
    </div>
  );
}
