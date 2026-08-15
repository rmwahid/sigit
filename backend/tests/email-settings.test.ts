import { describe, expect, it } from "bun:test";
import { fromEmailSchema } from "@/routes/email-settings";

// The from-email field must accept both what the Resend API accepts and what
// the UI placeholder suggests (display format), not just a bare address.
describe("email settings from email schema", () => {
  it("accepts a bare address", () => {
    expect(fromEmailSchema.parse("onboarding@resend.dev")).toBe("onboarding@resend.dev");
  });

  it("accepts the display format used by the UI placeholder and default", () => {
    expect(fromEmailSchema.parse("SiGit <onboarding@resend.dev>")).toBe("SiGit <onboarding@resend.dev>");
    expect(fromEmailSchema.parse("SiGit <no-reply@example.com>")).toBe("SiGit <no-reply@example.com>");
  });

  it("trims surrounding whitespace", () => {
    expect(fromEmailSchema.parse("  a@b.co  ")).toBe("a@b.co");
  });

  it("rejects values without a valid address", () => {
    expect(() => fromEmailSchema.parse("not-an-email")).toThrow();
    expect(() => fromEmailSchema.parse("SiGit <not-an-email>")).toThrow();
    expect(() => fromEmailSchema.parse("")).toThrow();
  });
});
