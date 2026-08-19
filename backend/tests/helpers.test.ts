import { describe, expect, it, mock } from "bun:test";
import { MIN_PASSWORD_LENGTH } from "@/constants/limits";

// @clack/prompts wraps a TTY; the helpers are tested through a mocked module
// (bun:test mock.module) so no terminal interaction is needed. The validators
// are captured from the options object passed to p.text / p.password.
const prompts = await import("@clack/prompts");
const textMock = mock(async () => "test@example.com");
const passwordMock = mock(async () => "secret-123");
const spinnerMock = { start: mock(), stop: mock() };
mock.module("@clack/prompts", () => ({
  text: textMock,
  password: passwordMock,
  spinner: () => spinnerMock,
  isCancel: (v: unknown) => v === Symbol.for("clack:cancel"),
  cancel: mock(),
  outro: mock(),
}));
void prompts;

describe("cli helpers (prompt wrappers)", () => {
  it("promptEmail validates the address and returns it", async () => {
    const { promptEmail } = await import("@/cli/helpers");
    const email = await promptEmail("Email?");
    expect(email).toBe("test@example.com");
    expect(textMock).toHaveBeenCalledWith(expect.objectContaining({ message: "Email?" }));
    const validate = (textMock.mock.calls[0]?.[0] as { validate: (v: string) => string | undefined }).validate;
    expect(validate("nope")).toBe("Enter a valid email address");
    expect(validate("a@b.co")).toBeUndefined();
  });

  it("promptPassword enforces MIN_PASSWORD_LENGTH in the validator", async () => {
    const { promptPassword } = await import("@/cli/helpers");
    const value = await promptPassword("Password?");
    expect(value).toBe("secret-123");
    const validate = (passwordMock.mock.calls[0]?.[0] as { validate: (v: string) => string | undefined }).validate;
    expect(validate("short")).toBe(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    expect(validate("long-enough-password")).toBeUndefined();
  });

  it("promptConfirmPassword rejects a mismatch", async () => {
    const { promptConfirmPassword } = await import("@/cli/helpers");
    await promptConfirmPassword("abc", "Confirm");
    const validate = (passwordMock.mock.calls[1]?.[0] as { validate: (v: string) => string | undefined }).validate;
    expect(validate("different")).toBe("Passwords do not match");
    expect(validate("abc")).toBeUndefined();
  });

  it("runWithSpinner stops the spinner and prints the outro on success", async () => {
    const { runWithSpinner } = await import("@/cli/helpers");
    const result = await runWithSpinner("Working", async () => 42, "Done", "Bye");
    expect(result).toBe(42);
    expect(spinnerMock.stop).toHaveBeenCalledWith("Done");
  });
});
