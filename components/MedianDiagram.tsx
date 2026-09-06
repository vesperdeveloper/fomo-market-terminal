/**
 * Shows why each end of a market is a median of three readings: the outlier
 * is drawn, and the value the market actually uses ignores it.
 */
export default function MedianDiagram() {
  const reads = [
    { x: 60,  y: 60, label: "12:55" },
    { x: 160, y: 54, label: "13:00" },
    { x: 260, y: 22, label: "13:05", outlier: true },
  ];
  const medianY = 57;

  return (
    <div style={{
      marginTop: "var(--s-5)", padding: "var(--s-5)", borderRadius: "var(--r-lg)",
      background: "var(--surface-sunken)", border: "1px solid var(--border-subtle)",
    }}>
      <svg viewBox="0 0 420 110" width="100%" height="130" style={{ overflow: "visible" }}>
        <line x1="20" y1={medianY} x2="400" y2={medianY}
          stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 4" />
        <text x="404" y={medianY + 4} fontSize="10" fill="var(--accent)" fontWeight="600">median</text>

        {reads.map((r) => (
          <g key={r.label}>
            <line x1={r.x} y1={r.y} x2={r.x} y2="88" stroke="var(--border-strong)" strokeWidth="1" />
            <circle cx={r.x} cy={r.y} r="6"
              fill={r.outlier ? "var(--down-quiet)" : "var(--accent-quiet)"}
              stroke={r.outlier ? "var(--down)" : "var(--accent)"} strokeWidth="2" />
            <text x={r.x} y="102" fontSize="10" textAnchor="middle" fill="var(--fg-faint)">{r.label}</text>
          </g>
        ))}

        <text x={260} y="14" fontSize="10" textAnchor="middle" fill="var(--down)" fontWeight="600">
          spike
        </text>
      </svg>
      <p style={{ margin: "var(--s-3) 0 0", fontSize: ".8125rem", color: "var(--fg-muted)", lineHeight: 1.6 }}>
        Three readings, one of them wrong. The median lands on the middle value,
        so the spike changes nothing — which is the point: no single reading,
        however well timed, decides anybody&apos;s position.
      </p>
    </div>
  );
}
