import * as p from "@clack/prompts";

export async function promptEmail(message: string): Promise<string> {
  const value = (await p.text({
    message,
    validate: (v) => {
      if (!v || !v.includes("@")) return "Enter a valid email address";
    },
  })) as string;
  if (p.isCancel(value)) {
    p.cancel("Cancelled");
    process.exit(0);
  }
  return value;
}

export async function promptPassword(message: string): Promise<string> {
  const value = (await p.password({
    message,
    validate: (v) => {
      if (!v || v.length < 8) return "Password must be at least 8 characters";
    },
  })) as string;
  if (p.isCancel(value)) {
    p.cancel("Cancelled");
    process.exit(0);
  }
  return value;
}

export async function promptConfirmPassword(password: string, message = "Confirm password"): Promise<string> {
  const value = (await p.password({
    message,
    validate: (v) => {
      if (v !== password) return "Passwords do not match";
    },
  })) as string;
  if (p.isCancel(value)) {
    p.cancel("Cancelled");
    process.exit(0);
  }
  return value;
}

export async function runWithSpinner<T>(
  label: string,
  fn: () => Promise<T>,
  successMessage: string,
  outro: string
): Promise<T> {
  const spinner = p.spinner();
  spinner.start(label);
  try {
    const result = await fn();
    spinner.stop(successMessage);
    p.outro(outro);
    return result;
  } catch (error) {
    spinner.stop("Failed");
    p.cancel(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
