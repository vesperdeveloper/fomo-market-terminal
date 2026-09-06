import PortfolioClient from "@/components/PortfolioClient";

export const dynamic = "force-dynamic";

export default function Portfolio() {
  return (
    <div className="wrap" style={{ paddingTop: "var(--s-12)", paddingBottom: "var(--section-y)" }}>
      <div className="eyebrow">Portfolio</div>
      <h1 style={{ fontSize: "var(--step-4)", marginTop: "var(--s-3)" }}>Your positions</h1>
      <p style={{ color: "var(--fg-muted)", maxWidth: "56ch", marginTop: "var(--s-3)", lineHeight: 1.6 }}>
        Open positions are marked at the current book price. Settled and voided
        markets sit here until you collect.
      </p>
      <PortfolioClient />
    </div>
  );
}
