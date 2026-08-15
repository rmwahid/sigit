import * as p from "@clack/prompts";
import { createAdminUser, countUsers, getUserByEmail } from "@/modules/auth/auth";
import { promptEmail, promptPassword, promptConfirmPassword, runWithSpinner } from "./helpers";

async function main() {
  console.clear();
  p.intro("SiGit - Create Admin");

  const existing = await countUsers();
  if (existing > 0) {
    p.cancel("An admin user already exists. Use `db:reset-password` to change password.");
    process.exit(1);
  }

  const email = await promptEmail("Admin email");

  const duplicate = await getUserByEmail(email);
  if (duplicate) {
    p.cancel("A user with this email already exists.");
    process.exit(1);
  }

  const password = await promptPassword("Password");
  await promptConfirmPassword(password);

  await runWithSpinner(
    "Creating admin user...",
    () => createAdminUser(email, password),
    "Admin user created",
    "Setup complete. You can now log in."
  );
}

main();
