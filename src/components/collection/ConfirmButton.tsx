"use client";

import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { btnSm, btnSmDanger, btnSmPrimary } from "./ui";

interface ConfirmButtonProps {
  label: ReactNode;
  /** Text shown in the armed state; defaults to "确认？". */
  confirmLabel?: ReactNode;
  onConfirm: () => void | Promise<unknown>;
  tone?: "default" | "danger" | "primary";
  disabled?: boolean;
  title?: string;
  /** Armed state falls back to idle after this many ms. */
  resetAfterMs?: number;
  className?: string;
}

const TONE_CLASS = {
  default: btnSm,
  danger: btnSmDanger,
  primary: btnSmPrimary,
} as const;

/**
 * Two-step inline confirm — no window dialog, so the row never jumps and the
 * action stays reversible until the second click.
 */
export default function ConfirmButton({
  label,
  confirmLabel = "确认？",
  onConfirm,
  tone = "default",
  disabled = false,
  title,
  resetAfterMs = 6000,
  className,
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const arm = () => {
    if (disabled || busy) return;
    setArmed(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (mounted.current) setArmed(false);
    }, resetAfterMs);
  };

  const disarm = () => {
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
  };

  const run = async () => {
    if (timer.current) clearTimeout(timer.current);
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      if (mounted.current) {
        setBusy(false);
        setArmed(false);
      }
    }
  };

  if (!armed) {
    return (
      <button
        type="button"
        className={clsx(TONE_CLASS[tone], className)}
        onClick={arm}
        disabled={disabled || busy}
        title={title}
      >
        {busy ? "处理中…" : label}
      </button>
    );
  }

  return (
    <span className={clsx("inline-flex items-center gap-1", className)}>
      <button
        type="button"
        className={clsx(btnSmDanger, tone === "primary" && btnSmPrimary)}
        onClick={() => void run()}
        disabled={busy}
        title={title}
      >
        {busy ? "处理中…" : confirmLabel}
      </button>
      <button type="button" className={btnSm} onClick={disarm} disabled={busy}>
        取消
      </button>
    </span>
  );
}
