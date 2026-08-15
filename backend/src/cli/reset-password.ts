import * as p from "@clack/prompts";
import { deleteAllSessions, getUserByEmail, updateUserPassword } from "@/modules/auth/auth";
import { promptEmail, promptPassword, promptConfirmPassword, runWithSpinner } from "./helpers";

async function main() {
  console.clear();
  p.intro("SiGit - Reset Password");

  const email = await promptEmail("User email");

  const user = await getUserByEmail(email);
  if (!user) {
    p.cancel(`No user found with email: ${email}`);
    process.exit(1);
  }

  const password = await promptPassword("New password");
  await promptConfirmPassword(password, "Confirm new password");

  await runWithSpinner(
    "Updating password...",
    async () => {
      await updateUserPassword(user.id, password);
      await deleteAllSessions(user.id);
    },
    "Password updated",
    "All existing sessions have been revoked. Please log in again."
  );
}

main();
