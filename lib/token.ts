/**
 * The venue's own token.
 *
 * One constant, imported by the nav, the hero and the footer, so the address
 * on the page can never disagree with itself — three hand-typed copies is
 * exactly how a site ends up publishing one wrong one.
 */
export const TOKEN = {
  address: "0xcc8747B596DF1836da106956b475FdB1F4Af7e90",
  symbol: "FOMOMRKT",
  chain: "Robinhood Chain",
} as const;

/** Enough of the address to recognise, short enough for a nav bar. */
export const shortCA = () => `${TOKEN.address.slice(0, 6)}…${TOKEN.address.slice(-4)}`;
