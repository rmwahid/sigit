// Single source of truth untuk konfigurasi token git di UI.
// Semua tampilan scope/expiry (Settings, project page) memakai konstanta dan
// helper di sini - jangan menulis string "read"/"write", label "read+write",
// atau angka expiry manual. Backend punya padanan TOKEN_MAX_EXPIRY_DAYS di
// modules/auth/tokens.ts (dua package terpisah, tidak bisa share import).
import type { TokenScope } from "./api/tokens";

// Scope default saat user mencentang project baru di form token.
export const DEFAULT_TOKEN_SCOPE: TokenScope = "read";

// Masa berlaku default & maksimal (hari), sinkron dengan backend (1-30).
export const DEFAULT_TOKEN_EXPIRY_DAYS = 30;
export const TOKEN_MAX_EXPIRY_DAYS = 30;

// "write" otomatis termasuk "read" (push = clone/pull) - label UI-nya read+write.
export function scopeLabel(scope: TokenScope): string {
  return scope === "write" ? "read+write" : "read";
}

// Opsi scope untuk select: value = nilai API, label = tampilan user.
export const TOKEN_SCOPE_OPTIONS: { value: TokenScope; label: string }[] = (
  ["read", "write"] as TokenScope[]
).map((value) => ({ value, label: scopeLabel(value) }));
