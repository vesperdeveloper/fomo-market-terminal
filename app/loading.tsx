/**
 * Shown while a page is being rendered on the server.
 *
 * Without one, a click on a link does nothing visible until the whole page
 * comes back — which reads as the site ignoring you. This is deliberately
 * quiet: a pulse of the brand rather than a spinner.
 */
export default function Loading() {
  return (
    <div className="wrap" style={{ paddingTop: "var(--s-16)", paddingBottom: "var(--s-24)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--fg-faint)" }}>
        <i className="live-dot" style={{ width: 7, height: 7, borderRadius: 9, background: "var(--accent)" }} />
        <span className="eyebrow">Reading the record…</span>
      </div>
      <div style={{ display: "grid", gap: "var(--s-3)", marginTop: "var(--s-8)" }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="panel"
            style={{ height: 64, opacity: 1 - i * 0.16, background: "var(--surface-raised)" }}
          />
        ))}
      </div>
    </div>
  );
}
