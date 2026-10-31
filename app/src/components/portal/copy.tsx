"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Plain-HTTP origins have no Clipboard API: fall back to a hidden textarea.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export function PortalCopyButton({ text, label, className, variant = "outline", size = "sm" }: { text: string; label?: string; className?: string; variant?: "outline" | "primary" | "secondary"; size?: "sm" | "md" }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      data-copy={text}
      onClick={async () => {
        if (await writeClipboard(text)) {
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1800);
        }
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span aria-live="polite">{copied ? t("ui.copied") : (label ?? t("ui.copy"))}</span>
    </Button>
  );
}

/** Read-only value (link, code, snippet) with a copy button. */
export function PortalCopyField({ value, label, multiline = false, className, id }: { value: string; label: string; multiline?: boolean; className?: string; id?: string }) {
  if (multiline) {
    return (
      <div className={cn("relative", className)}>
        <textarea
          id={id}
          readOnly
          aria-label={label}
          value={value}
          dir="auto"
          rows={Math.min(8, Math.max(3, Math.ceil(value.length / 70) + value.split("\n").length - 1))}
          onFocus={(e) => e.currentTarget.select()}
          className="block w-full resize-none rounded-lg border border-line bg-paper px-3 pt-3 pb-12 text-[13px] leading-relaxed text-ink focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
        />
        <PortalCopyButton text={value} className="absolute end-2 bottom-2" />
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center", className)}>
      <input
        id={id}
        readOnly
        aria-label={label}
        value={value}
        dir="ltr"
        onFocus={(e) => e.currentTarget.select()}
        className="h-10 w-full min-w-0 sm:flex-1 rounded-lg border border-line bg-paper px-3 font-mono text-[13px] text-ink focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
      />
      <PortalCopyButton text={value} size="md" className="shrink-0" />
    </div>
  );
}
