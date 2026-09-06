"use client";
import Link from "next/link";
import Chart, { type Point } from "./Chart";
import { Avatar } from "./TraderCard";
import { pct } from "@/lib/format";

export interface TickerItem {
  handle: string; name: string; avatar?: string;
  change: number; points: Point[];
}

/**
 * Continuous strip of listed accounts. The track holds two copies of the
 * list and slides exactly half its width, so the loop has no seam. It
 * pauses on hover, because a moving target is hard to click.
 */
export default function Marquee({ items }: { items: TickerItem[] }) {
  if (!items.length) return null;
  const doubled = [...items, ...items];

  return (
    <div className="marquee" style={{
      overflow: "hidden", padding: "var(--s-3) 0",
      borderBlock: "1px solid var(--rule)",
      background: "var(--surface-sunken)",
      maskImage: "linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)",
      WebkitMaskImage: "linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)",
    }}>
      <div className="marquee-track" style={{ display: "flex", gap: "var(--s-3)", width: "max-content" }}>
        {doubled.map((it, i) => {
          const up = it.change >= 0;
          return (
            <Link key={`${it.handle}-${i}`} href={`/t/${it.handle}`} style={{
              display: "flex", alignItems: "center", gap: "var(--s-3)",
              padding: "7px 14px 7px 7px", borderRadius: "var(--r-sm)",
              background: "var(--surface-raised)", border: "1px solid var(--rule)",
              flexShrink: 0,
            }}>
              <Avatar trader={it as any} size={28} />
              <span style={{ fontSize: ".875rem", fontWeight: 500, whiteSpace: "nowrap" }}>@{it.handle}</span>
              <span style={{ width: 62, height: 22 }}>
                <Chart points={it.points} w={62} h={22} showBaseline={false} strokeWidth={1.5} />
              </span>
              <span className="num" style={{
                fontSize: ".875rem", fontWeight: 600, whiteSpace: "nowrap",
                color: up ? "var(--up)" : "var(--down)",
              }}>{pct(it.change)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
