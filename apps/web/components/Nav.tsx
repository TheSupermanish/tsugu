"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./ConnectButton";

const LINKS = [
  { href: "/", label: "Pacts" },
  { href: "/create", label: "Start a pact" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-ink-800/80 bg-ink-950/75 backdrop-blur-md">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-md border border-gold-700/50 text-gold-400">繼</span>
            <span className="font-serif text-xl font-semibold tracking-tight text-porcelain">Tsugu</span>
          </Link>
          <div className="hidden gap-6 text-sm sm:flex">
            {LINKS.map((l) => {
              const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={active ? "text-porcelain" : "text-porcelain-dim transition-colors hover:text-porcelain-muted"}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>
        </div>
        <ConnectButton />
      </nav>
    </header>
  );
}
