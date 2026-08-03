import * as p from "@clack/prompts";
import { createAdminUser, countUsers, getUserByEmail } from "../modules/auth/auth";

async function main() {
  console.clear();
  p.intro("SiGit - Create Admin");

  const existing = await countUsers();
  if (existing > 0) {
    p.cancel("An admin user already exists. Use `db:reset-password` to change password.");
    process.exit(1);
  }

  const email = (await p.text({
    message: "Admin email",
    validate: (v) => {
      if (!v || !v.includes("@")) return "Enter a valid email address";
    },
  })) as string;

  if (p.isCancel(email)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  const duplicate = await getUserByEmail(email);
  if (duplicate) {
    p.cancel("A user with this email already exists.");
    process.exit(1);
  }

  const password = (await p.password({
    message: "Password",
    validate: (v) => {
      if (!v || v.length < 8) return "Password must be at least 8 characters";
    },
  })) as string;

  if (p.isCancel(password)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  const confirm = (await p.password({
    message: "Confirm password",
    validate: (v) => {
      if (v !== password) return "Passwords do not match";
    },
  })) as string;

  if (p.isCancel(confirm)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  const spinner = p.spinner();
  spinner.start("Creating admin user...");
  try {
    await createAdminUser(email, password);
    spinner.stop("Admin user created");
    p.outro("Setup complete. You can now log in.");
  } catch (error) {
    spinner.stop("Failed");
    p.cancel(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
