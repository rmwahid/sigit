import * as p from "@clack/prompts";
import { createAdminUser, countUsers, getUserByEmail } from "@/modules/auth/auth";
import { promptEmail, promptPassword, promptConfirmPassword, runWithSpinner } from "./helpers";
import { MIN_PASSWORD_LENGTH } from "@/constants/limits";

// Non-interactive bootstrap for the container entrypoint: reads ADMIN_EMAIL and
// ADMIN_PASSWORD from the environment and validates them before touching the DB.
export function parseBootstrapEnv(input: {
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
}): { email: string; password: string } {
  const email = input.ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const password = input.ADMIN_PASSWORD ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("ADMIN_EMAIL must be a valid email address");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return { email, password };
}

async function bootstrap(): Promise<"created" | "exists" | "skipped"> {
  if ((await countUsers()) > 0) return "exists";
  if (!process.env.ADMIN_EMAIL && !process.env.ADMIN_PASSWORD) return "skipped";
  const { email, password } = parseBootstrapEnv(
    process.env as { ADMIN_EMAIL?: string; ADMIN_PASSWORD?: string }
  );
  const duplicate = await getUserByEmail(email);
  if (duplicate) return "exists";
  await createAdminUser(email, password);
  return "created";
}

async function main() {
  if (process.argv.includes("--non-interactive")) {
    try {
      const result = await bootstrap();
      if (result === "created") console.log("Admin user created");
      else if (result === "exists") console.log("An admin user already exists, skipping");
      else console.log("ADMIN_EMAIL and ADMIN_PASSWORD are not set, skipping admin bootstrap");
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    // The postgres pool keeps the event loop alive; exit explicitly so the
    // container entrypoint can proceed to the server.
    process.exit(0);
  }

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
  process.exit(0);
}

// Guarded entrypoint: importing this module (tests do) must not run main().
if (import.meta.main) main();
