export function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div className="max-w-2xl">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-gold">{eyebrow}</p>
        <h1 className="font-display text-[37px] font-semibold leading-[1.04] tracking-[-0.035em] text-ink sm:text-[47px]">{title}</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-7 text-ink-muted">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
