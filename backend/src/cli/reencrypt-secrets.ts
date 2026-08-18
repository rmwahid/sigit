import * as p from "@clack/prompts";
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { storageConnections } from "@/db/schema/storage";
import { decryptSecret, encryptSecret, currentKeyId } from "@/lib/secret-encryption";
import { env } from "@/config/env";

async function main() {
  console.clear();
  p.intro("SiGit - Re-encrypt Secrets");

  const availableKeys = Object.keys(env.ENCRYPTION_KEYS);
  const targetKeyId = (await p.select({
    message: "Target encryption key (re-encrypt all secrets to this key)",
    options: availableKeys.map((k) => ({ value: k, label: `${k}${k === currentKeyId() ? " (current)" : ""}` })),
  })) as string;

  if (p.isCancel(targetKeyId)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  const confirm = await p.confirm({
    message: `Re-encrypt ALL connection secrets to key "${targetKeyId}"?`,
    initialValue: false,
  });

  if (!confirm) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  const spinner = p.spinner();
  spinner.start("Reading connections...");
  try {
    const connections = await db.select().from(storageConnections);
    spinner.stop(`Found ${connections.length} connection(s)`);

    let updated = 0;
    for (const conn of connections) {
      const plaintext = decryptSecret({
        keyId: conn.encryptionKeyId,
        ciphertext: conn.secretEncrypted,
      });
      const encrypted = encryptSecret(plaintext, targetKeyId);
      await db
        .update(storageConnections)
        .set({
          secretEncrypted: encrypted.ciphertext,
          encryptionKeyId: encrypted.keyId,
          updatedAt: new Date(),
        })
        .where(eq(storageConnections.id, conn.id));
      updated++;
    }

    p.outro(`Done. Re-encrypted ${updated} connection(s) to key "${targetKeyId}".`);
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
