"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigationItems = [
  { href: "/setup", label: "New interview" },
  { href: "/reports", label: "History" },
  { href: "/settings", label: "API settings" },
];

export default function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="topbar" aria-label="Main navigation">
      <Link className="brand-link" href="/">
        AI Interview Simulator
      </Link>
      <div className="topbar-links">
        {navigationItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href === "/reports" && pathname.startsWith("/reports/"));
          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              className={isActive ? "topbar-link-active" : undefined}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
