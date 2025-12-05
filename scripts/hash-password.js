// scripts/hash-password.js
//
// Usage:
//   node scripts/hash-password.js "PlainTextPassword123"
//
// Prints a bcrypt hash you can paste into the users table.

const bcrypt = require("bcryptjs");

async function main() {
  const plain = process.argv[2];
  if (!plain) {
    console.error('Usage: node scripts/hash-password.js "PlainTextPassword123"');
    process.exit(1);
  }

  const rounds = 10; // good default
  const hash = await bcrypt.hash(plain, rounds);
  console.log("Password:", plain);
  console.log("Hash:", hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
