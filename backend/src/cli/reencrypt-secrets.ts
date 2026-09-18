import * as p from "@clack/prompts";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { storageConnections } from "@/db/schema/storage";
import { projects } from "@/db/schema/projects";
import { emailSettings } from "@/db/schema/auth";
import { decryptSecret, encryptSecret, currentKeyId, type EncryptedSecret } from "@/lib/secret-encryption";
import { env } from "@/config/env";

// Every column that holds a value produced by encryptSecret() must be re-wrapped
// here. A column left out of this list keeps referencing the old key version, so
// retiring that version makes it undecryptable: for a project that means losing
// the only copy of the key protecting its LFS objects and backup bundle. When a
// new wrap site is added to the codebase, add it to this list in the same change.
type WrapSite = {
  store: string;
  rows: () => Promise<{ id: string; keyId: string; ciphertext: string | null }[]>;
  save: (id: string, encrypted: EncryptedSecret) => Promise<void>;
};

const wrapSites: WrapSite[] = [
  {
    store: "storage_connections (S3 secret)",
    rows: async () =>
      (await db.select().from(storageConnections)).map((row) => ({
        id: row.id,
        keyId: row.encryptionKeyId,
        ciphertext: row.secretEncrypted,
      })),
    save: async (id, encrypted) => {
      await db
        .update(storageConnections)
        .set({ secretEncrypted: encrypted.ciphertext, encryptionKeyId: encrypted.keyId, updatedAt: new Date() })
        .where(eq(storageConnections.id, id));
    },
  },
  {
    store: "projects (at-rest data key)",
    rows: async () =>
      (await db.select().from(projects)).map((row) => ({
        id: row.id,
        keyId: row.encryptionKeyId,
        ciphertext: row.encryptionKeyEncrypted,
      })),
    save: async (id, encrypted) => {
      await db
        .update(projects)
        .set({ encryptionKeyEncrypted: encrypted.ciphertext, encryptionKeyId: encrypted.keyId, updatedAt: new Date() })
        .where(eq(projects.id, id));
    },
  },
  {
    store: "email_settings (Resend API key)",
    rows: async () =>
      (await db.select().from(emailSettings)).map((row) => ({
        id: row.id,
        keyId: row.encryptionKeyId,
        ciphertext: row.resendApiKeyEncrypted,
      })),
    save: async (id, encrypted) => {
      await db
        .update(emailSettings)
        .set({ resendApiKeyEncrypted: encrypted.ciphertext, encryptionKeyId: encrypted.keyId, updatedAt: new Date() })
        .where(eq(emailSettings.id, id));
    },
  },
];

async function rewrapAll(targetKeyId: string): Promise<{ lines: string[]; total: number }> {
  const lines: string[] = [];
  let total = 0;
  for (const site of wrapSites) {
    let count = 0;
    for (const row of await site.rows()) {
      if (!row.ciphertext) continue;
      const plaintext = decryptSecret({ keyId: row.keyId, ciphertext: row.ciphertext });
      await site.save(row.id, encryptSecret(plaintext, targetKeyId));
      count++;
    }
    lines.push(`${site.store}: ${count} re-wrapped`);
    total += count;
  }
  return { lines, total };
}

// Rows that still reference another key version after the migration. While any
// remain, the old key must stay configured, so the operator has to be told
// instead of receiving a success message.
async function residualCounts(targetKeyId: string): Promise<string[]> {
  const residual: string[] = [];
  for (const site of wrapSites) {
    const left = (await site.rows()).filter((row) => row.ciphertext && row.keyId !== targetKeyId);
    if (left.length > 0) residual.push(`${site.store}: ${left.length}`);
  }
  return residual;
}

async function main() {
  console.clear();
  p.intro("SiGit - Re-encrypt Secrets");

  const availableKeys = Object.keys(env.ENCRYPTION_KEYS);
  const targetKeyId = (await p.select({
    message: "Target encryption key (re-encrypt every wrapped secret to this key)",
    options: availableKeys.map((k) => ({ value: k, label: `${k}${k === currentKeyId() ? " (current)" : ""}` })),
  })) as string;

  if (p.isCancel(targetKeyId)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  const confirm = await p.confirm({
    message: `Re-encrypt EVERY wrapped secret to key "${targetKeyId}"?`,
    initialValue: false,
  });

  if (!confirm) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  const spinner = p.spinner();
  spinner.start("Reading wrapped secrets...");
  try {
    const { lines: perStore, total: updated } = await rewrapAll(targetKeyId);
    spinner.stop(`Re-encrypted ${updated} secret(s)`);

    const residual = await residualCounts(targetKeyId);
    if (residual.length > 0) {
      p.note(residual.join("\n"), "Still on another key version");
      p.cancel(`Incomplete. Do NOT retire any other key version until this list is empty.`);
      process.exit(1);
    }

    p.note(perStore.join("\n"), "Per store");
    p.outro(`Done. Every wrapped secret now uses key "${targetKeyId}".`);
    if (targetKeyId !== currentKeyId()) {
      p.note(`"${targetKeyId}" is not the current key. New writes still use "${currentKeyId()}".`);
    }
    process.exit(0);
  } catch (error) {
    spinner.stop("Failed");
    p.cancel(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
