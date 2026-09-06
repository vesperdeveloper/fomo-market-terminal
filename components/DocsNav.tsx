"use client";
import { useEffect, useState } from "react";

/** Sticky contents with scroll-spy on the section headings. */
export default function DocsNav({ sections }: { sections: [string, string][] }) {
  const [active, setActive] = useState(sections[0]?.[0]);

  useEffect(() => {
    const els = sections.map(([id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [sections]);

  return (
    <nav style={{ alignSelf: "start", position: "sticky", top: "calc(var(--nav-h) + 24px)" }}>
      <div className="eyebrow">Contents</div>
      <ol style={{ listStyle: "none", margin: "var(--s-4) 0 0", padding: 0, display: "grid", gap: 1 }}>
        {sections.map(([id, label], i) => {
          const on = id === active;
          return (
            <li key={id}>
              <a href={`#${id}`} style={{
                display: "flex", gap: 10, alignItems: "baseline",
                padding: "7px 10px", borderRadius: "var(--r-sm)",
                fontSize: ".875rem", lineHeight: 1.35,
                background: on ? "var(--accent-quiet)" : "transparent",
                color: on ? "var(--accent)" : "var(--fg-muted)",
                fontWeight: on ? 600 : 400,
                transition: "background var(--dur-micro) var(--ease-ui), color var(--dur-micro) var(--ease-ui)",
              }}>
                <span className="num" style={{ opacity: .55, fontSize: ".75rem" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                {label}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
