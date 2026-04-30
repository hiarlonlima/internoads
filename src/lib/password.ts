import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/** Validação básica de senha. Mínimo 8 chars. */
export function validatePassword(password: string): {
  valid: boolean;
  reason?: string;
} {
  if (password.length < 8) {
    return { valid: false, reason: "Senha deve ter no mínimo 8 caracteres" };
  }
  if (password.length > 100) {
    return { valid: false, reason: "Senha muito longa (máx 100 caracteres)" };
  }
  return { valid: true };
}
