import Link from "next/link";
import { cn } from "@/lib/utils";

/** Default brand mark: two linked nodes (a referral) with an amber accent node. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path d="M11 20.5 21 11.5M11 20.5l11.6 2.6" stroke="white" strokeWidth="2.4" strokeLinecap="round" opacity="0.8" />
      <circle cx="11" cy="20.5" r="4.3" fill="white" />
      <circle cx="21" cy="11.5" r="4.3" fill="white" />
      <circle cx="23.2" cy="23.3" r="3" fill="#fbbf24" stroke="var(--primary)" strokeWidth="1.2" />
    </svg>
  );
}

export function Logo({
  siteName,
  logo,
  logoDark,
  href = "/",
  className,
}: {
  siteName: string;
  logo?: string;
  logoDark?: string;
  href?: string;
  className?: string;
}) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5", className)} aria-label={`${siteName} home`}>
      {logo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- admin-uploaded logo of unknown size */}
          <img src={logo} alt={siteName} className={cn("h-8 w-auto max-w-full object-contain object-left rtl:object-right", logoDark && "dark:hidden")} />
          {logoDark ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoDark} alt={siteName} className="hidden h-8 w-auto max-w-full object-contain object-left dark:block rtl:object-right" />
          ) : null}
        </>
      ) : (
        <>
          <BrandMark className="shrink-0" />
          <span className="truncate font-display text-xl font-bold tracking-tight text-ink">{siteName}</span>
        </>
      )}
    </Link>
  );
}
