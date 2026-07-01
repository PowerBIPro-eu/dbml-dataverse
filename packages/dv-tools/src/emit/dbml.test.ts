import { describe, expect, it } from 'vitest';
import { emitRef } from './dbml.js';
import { buildModelJson } from '../model/json.js';
import type { ManyToManyRelationship } from '../types.js';

describe('emitRef', () => {
  it('emits valid DBML for many-to-many refs with multiple settings', () => {
    const rel: ManyToManyRelationship = {
      type: 'ManyToMany',
      name: 'account_contact',
      first: 'Account',
      second: 'Contact',
      intersect: 'accountcontact',
      sourceSolution: 'Core',
    };

    const ref = emitRef(rel, new Map([
      ['Account', 'accountid'],
      ['Contact', 'contactid'],
    ]));

    expect(ref).toContain("  intersect_entity: 'accountcontact',");
    expect(ref).toContain("  source_solution: 'Core'");

    const dbml = [
      'Table Account {',
      '  accountid int [pk]',
      '}',
      '',
      'Table Contact {',
      '  contactid int [pk]',
      '}',
      '',
      ref,
    ].join('\n');

    expect(() => buildModelJson(dbml)).not.toThrow();
  });
});
