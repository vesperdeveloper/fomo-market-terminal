// Local EVM only — used by scripts/test-contract.mjs to exercise the
// contract before it is put on a chain that costs money.
module.exports = {
  solidity: "0.8.26",
  networks: { hardhat: { chainId: 31337, mining: { auto: true } } },
};
