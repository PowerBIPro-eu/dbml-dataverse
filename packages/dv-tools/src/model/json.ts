import { Compiler, DEFAULT_ENTRY, MemoryProjectLayout } from '@dbml/parse';

export interface DbmlDiagnostic {
  message: string;
  file?: string;   // .dv.dbml file the line belongs to (set by the converter)
  location: { start: { line: number; column: number } };
}

/** Thrown when the generated DBML does not compile; same shape as @dbml/core's CompilerError. */
export class DbmlCompileError extends Error {
  constructor(readonly diags: DbmlDiagnostic[]) {
    super(diags.map((d) => d.message).join('\n'));
  }
}

/**
 * Parse combined .dv.dbml text and return the raw Database JSON (schemaJson.ts shape).
 * Same result as @dbml/core's Parser.parseDBMLToJSONv2, without bundling its SQL parsers.
 */
export function buildModelJson(combinedDbml: string): object {
  const layout = new MemoryProjectLayout();
  layout.setSource(DEFAULT_ENTRY, combinedDbml);
  const compiler = new Compiler(layout);

  const errors = compiler.parse.errors(DEFAULT_ENTRY);
  if (errors.length > 0) {
    throw new DbmlCompileError(errors.map((e: any) => ({
      message: e.diagnostic,
      location: { start: { line: e.nodeOrToken.startPos.line + 1, column: e.nodeOrToken.startPos.column + 1 } },
    })));
  }
  const db = compiler.parse.rawDb(DEFAULT_ENTRY);
  if (!db) throw new DbmlCompileError([{ message: 'the DBML compiler returned no model', location: { start: { line: 1, column: 1 } } }]);
  return db;
}
