import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';
const envPath = new URL('../.env.local', import.meta.url).pathname;
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath,'utf8') : '';
const found = env.match(/TREASURY_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/);
if (found) {
  console.log('EXISTING:', privateKeyToAccount(found[1]).address);
  process.exit(0);
}
const pk = generatePrivateKey();
const acct = privateKeyToAccount(pk);
env = env.replace(/\n*TREASURY_(ADDRESS|PRIVATE_KEY)=.*/g, '').trimEnd();
env += `\n\n# treasury — generated locally; the key is not printed anywhere\nTREASURY_ADDRESS=${acct.address}\nTREASURY_PRIVATE_KEY=${pk}\n`;
fs.writeFileSync(envPath, env, { mode: 0o600 });
console.log('GENERATED. Fund this address:', acct.address);
