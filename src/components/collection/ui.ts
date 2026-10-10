/**
 * Utility-only class strings for the collection pages.
 *
 * globals.css defines `.card .chip .btn .stem .figure-img` OUTSIDE any cascade
 * layer, so they beat Tailwind's layered utilities on the same property. Anywhere
 * we need a denser size or a different tone than the token classes provide, we drop
 * the token class and compose plain utilities instead.
 */

export const chipBase =
  "inline-flex max-w-[260px] items-center gap-1 truncate rounded-full border border-line px-2 py-0.5 text-[11px] leading-[1.6]";

export const chipMuted = `${chipBase} text-muted`;
export const chipBrand = `${chipBase} border-brand/50 bg-brand-soft text-brand`;
export const chipOk = `${chipBase} border-ok/50 bg-ok-soft text-ok`;
export const chipBad = `${chipBase} border-bad/50 bg-bad-soft text-bad`;

/** Small ghost-ish button used inside dense rows. */
export const btnSm =
  "inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink";

export const btnSmPrimary =
  "inline-flex shrink-0 items-center gap-1 rounded-lg border border-brand bg-brand px-2.5 py-1 text-xs text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";

export const btnSmDanger =
  "inline-flex shrink-0 items-center gap-1 rounded-lg border border-bad/60 bg-bad-soft px-2.5 py-1 text-xs text-bad transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";

export const fieldBase =
  "rounded-lg border border-line bg-panel px-2 py-1 text-xs text-ink outline-none transition-colors focus:border-brand";

export const sectionTitle = "text-sm font-medium text-ink";
export const subtle = "text-[11px] leading-relaxed text-muted";
