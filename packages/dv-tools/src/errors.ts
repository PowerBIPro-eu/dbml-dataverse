/** Wrong flags or options file (unknown key, newer configVersion, missing solution folder, ...): exit code 2. */
export class UsageError extends Error {}

/** The model cannot be built from the input (e.g. unreadable Entity.xml): exit code 3. */
export class InputError extends Error {}
