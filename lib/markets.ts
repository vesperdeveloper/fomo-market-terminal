import type { Window } from "./types";

/** How many accounts carry markets. The board is ranked, not exhaustive. */
export const ROSTER_SIZE = 10;

/** The two horizons every listed account is quoted over. */
export const WINDOWS: Window[] = ["24h", "7d"];

export const WINDOW_MS: Record<Window, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export const windowLabel = (w: Window) => (w === "24h" ? "1 day" : "7 days");
