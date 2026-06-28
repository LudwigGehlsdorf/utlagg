"use client";

import { useEffect, useState } from "react";
import { IconSun, IconMoon, IconMonitor } from "./ui/icons";

type Theme = "system" | "light" | "dark";

// Add/remove the `dark` class on <html>. The same logic runs as an inline script
// in app/layout.tsx before paint to avoid a flash; this keeps it in sync on change.
function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Theme, string> = { system: "System", light: "Ljust", dark: "Mörkt" };

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    setTheme(((localStorage.getItem("theme") as Theme | null) ?? "system"));
    // Follow OS changes while on "system".
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (((localStorage.getItem("theme") as Theme | null) ?? "system") === "system") applyTheme("system"); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function cycle() {
    const next = NEXT[theme];
    setTheme(next);
    if (next === "system") localStorage.removeItem("theme"); else localStorage.setItem("theme", next);
    applyTheme(next);
  }

  const Icon = theme === "light" ? IconSun : theme === "dark" ? IconMoon : IconMonitor;
  return (
    <button
      onClick={cycle}
      title={`Tema: ${LABEL[theme]} (klicka för att byta)`}
      aria-label={`Tema: ${LABEL[theme]}`}
      className="flex size-9 items-center justify-center rounded-full border border-border bg-background text-muted transition-colors hover:bg-surface hover:text-foreground"
    >
      <Icon className="size-[18px]" />
    </button>
  );
}
