// @ts-ignore — @dbml/core is a JS package
import { Parser } from '@dbml/core';

/**
 * Parse combined .dv.dbml text and return the raw Database JSON (schemaJson.ts shape).
 * Throws with detailed error messages if the DBML is invalid.
 */
export function buildModelJson(combinedDbml: string): object {
  return Parser.parseDBMLToJSONv2(combinedDbml);
}
