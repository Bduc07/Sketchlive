"use client";

import { useState } from "react";

// Owner-only controls for turning collaborative access on/off and grabbing
// the link to send someone - the sketch's own URL doubles as the share link
// since its id is an unguessable cuid, so there's nothing else to generate.
export default function ShareControls({
  sketchId,
  initialIsShared,
}: {
  sketchId: string;
  initialIsShared: boolean;
}) {
  const [isShared, setIsShared] = useState(initialIsShared);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);

  async function toggleShared() {
    const next = !isShared;
    setPending(true);
    try {
      const res = await fetch(`/api/sketches/${sketchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isShared: next }),
      });
      if (res.ok) setIsShared(next);
    } finally {
      setPending(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/draw/${sketchId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={toggleShared}
        disabled={pending}
        className="rounded-full border border-black/[.12] px-4 py-1 font-medium disabled:opacity-50 dark:border-white/[.145]"
      >
        {isShared ? "Sharing on" : "Share"}
      </button>
      {isShared && (
        <button
          type="button"
          onClick={copyLink}
          className="rounded-full border border-black/[.12] px-4 py-1 font-medium dark:border-white/[.145]"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
      )}
    </div>
  );
}
