"use client";
import { useEffect, useRef } from "react";

/** Adds the entrance class when a block first scrolls into view. */
export default function Reveal({
  children, delay = 0, as: Tag = "div", ...rest
}: { children: React.ReactNode; delay?: number; as?: any; [k: string]: any }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        setTimeout(() => el.classList.add("in"), delay);
        io.disconnect();
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return <Tag ref={ref} className="reveal" {...rest}>{children}</Tag>;
}
