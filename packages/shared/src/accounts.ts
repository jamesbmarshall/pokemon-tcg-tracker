/** Account rules shared by the server (enforcement) and the web forms (instant feedback). */

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;
export const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/i;
export const USERNAME_HINT = 'Usernames are 2–32 letters, numbers, dots, dashes or underscores';

/**
 * Returns a user-facing reason the password is unacceptable, or undefined if it's fine.
 * Length-based rather than composition rules (no "must contain a digit"), in line with NIST
 * guidance: long passphrases are stronger and easier to remember than short complex passwords.
 */
export function passwordProblem(password: unknown, username = ''): string | undefined {
  if (typeof password !== 'string' || !password) return 'Password is required';
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return 'Password is too long';
  if (username && password.toLowerCase().includes(username.toLowerCase())) return "Password can't contain your username";
  if (/^(.)\1+$/.test(password)) return 'Password is too simple';
  return undefined;
}
