import * as p from "@clack/prompts";
import { deleteAllSessions, getUserByEmail, updateUserPassword } from "../modules/auth/auth";

async function main() {
  console.clear();
  p.intro("SiGit - Reset Password");

  const email = (await p.text({
    message: "User email",
    validate: (v) => {
      if (!v || !v.includes("@")) return "Enter a valid email address";
    },
  })) as string;

  if (p.isCancel(email)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  const user = await getUserByEmail(email);
  if (!user) {
    p.cancel(`No user found with email: ${email}`);
    process.exit(1);
  }

  const password = (await p.password({
    message: "New password",
    validate: (v) => {
      if (!v || v.length < 8) return "Password must be at least 8 characters";
    },
  })) as string;

  if (p.isCancel(password)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  const confirm = (await p.password({
    message: "Confirm new password",
    validate: (v) => {
      if (v !== password) return "Passwords do not match";
    },
  })) as string;

  if (p.isCancel(confirm)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  const spinner = p.spinner();
  spinner.start("Updating password...");
  try {
    await updateUserPassword(user.id, password);
    await deleteAllSessions(user.id);
    spinner.stop("Password updated");
    p.outro("All existing sessions have been revoked. Please log in again.");
  } catch (error) {
    spinner.stop("Failed");
    p.cancel(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
