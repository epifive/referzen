"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setProgramStatusAdmin } from "../actions/programs";

/** Pause / resume button of a program row (Admin → Programs). */
export function ProgramStatusButton({ id, name, status }: { id: number; name: string; status: "active" | "paused" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const paused = status === "paused";
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant={paused ? "outline" : "ghost"}
        disabled={pending}
        aria-label={`${paused ? "Resume" : "Pause"} ${name}`}
        onClick={() => {
          if (!paused && !confirm(`Pause "${name}"? Clicks, referrals and conversions are refused until it is resumed.`)) return;
          start(async () => {
            const result = await setProgramStatusAdmin(id, paused ? "active" : "paused");
            setError(result.error ?? "");
            router.refresh();
          });
        }}
      >
        {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
        {paused ? "Resume" : "Pause"}
      </Button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
