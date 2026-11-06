/** True when a Postgres error (possibly wrapped by Drizzle) is a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  return code === '23505';
}
