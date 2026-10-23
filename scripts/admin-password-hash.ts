// Prints an ADMIN_PASSWORD_HASH value for the admin dashboard.
// Usage: npx tsx scripts/admin-password-hash.ts '<password>'
//    or: npx tsx scripts/admin-password-hash.ts          (prompts without echo; keeps it out of shell history)
// Put the output in /etc/hollowmere/admin.json as "ADMIN_PASSWORD_HASH"; never commit it or the password.
import { createInterface } from "node:readline";
import { hashPassword } from "../server/admin/auth";

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    const out = rl as unknown as { _writeToOutput?: (s: string) => void };
    if (process.stdin.isTTY) out._writeToOutput = (s: string) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); if (process.stdin.isTTY) process.stdout.write("\n"); resolve(answer); });
  });
}

async function main() {
  const password = process.argv[2] ?? await prompt("Admin password: ");
  if (!password) {
    console.error("Usage: npx tsx scripts/admin-password-hash.ts '<password>'");
    process.exit(1);
  }
  if (password.length < 12) console.error("Warning: use at least 12 characters for the admin password.");
  console.log(await hashPassword(password));
}

void main();
