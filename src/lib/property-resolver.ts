import { db } from './db';
import { properties } from './schema';
import { eq } from 'drizzle-orm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

/** Validates that the input is a UUID. */
export function isValidPropertyId(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Resolves a property from a UUID.
 * UUID-only mode — propertyKey fallback has been removed.
 */
export async function resolveProperty(
  input: string
): Promise<{ id: string; propertyKey: string } | null> {
  if (!input || !isUuid(input)) return null;

  const [row] = await db
    .select({ id: properties.id, propertyKey: properties.propertyKey })
    .from(properties)
    .where(eq(properties.id, input))
    .limit(1);

  return row ?? null;
}

/**
 * Resolves a propertyKey to a UUID. Used by redirect middleware.
 */
export async function resolvePropertyKeyToUuid(
  propertyKey: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.propertyKey, propertyKey))
    .limit(1);

  return row?.id ?? null;
}
