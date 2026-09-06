# fomo market — terminal build

The same product as [fomo-market](https://fomo-market.vercel.app), the same
contract and the same reader: up or down on a fomo account's cumulative PnL,
staked into one parimutuel contract on Robinhood Chain.

What differs is the design language. Where the other build borrows the fomo
app's own shell — round corners, Aeonik-ish type, the cosmic hero — this one
is its own: a colder slate ground, Space Grotesk over Inter with IBM Plex
Mono on every figure, near-square corners, hairline rules instead of cards,
and a live readout where an illustration would be. Same family, not a copy.

    npm run dev                   # localhost:3082
    node scripts/compile.mjs      # contracts -> lib/artifacts.ts
    node scripts/deploy-contract.mjs
    node scripts/brand.mjs        # marks + link-preview card

Not affiliated with, or endorsed by, fomo.
