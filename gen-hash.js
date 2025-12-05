// gen-hash.js
// One-off helper to generate a bcrypt hash for a new user password.

const bcrypt = require("bcryptjs");

async function main() {
  const password = "Test123!"; // temporary password
  const hash = await bcrypt.hash(password, 10);
  console.log("Password:", password);
  console.log("Hash:", hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
