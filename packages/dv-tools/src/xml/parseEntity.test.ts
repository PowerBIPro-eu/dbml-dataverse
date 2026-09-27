import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isDefaultBitLabels, parseEntityXml } from './parseEntity.js';
import { emitEntityFile } from '../emit/dbml.js';
import { buildModelJson } from '../model/json.js';

const widgetXml = fileURLToPath(new URL('../../test/fixtures/bit-labels/Entities/ddsol_widget/Entity.xml', import.meta.url));

describe('isDefaultBitLabels', () => {
  it('treats Yes/No and True/False as platform defaults, ignoring case and spaces', () => {
    expect(isDefaultBitLabels('Yes', 'No')).toBe(true);
    expect(isDefaultBitLabels(' TRUE ', 'false')).toBe(true);
  });

  it('treats any other label as custom', () => {
    expect(isDefaultBitLabels('Approved', 'Rejected')).toBe(false);
    expect(isDefaultBitLabels('Yes', 'Rejected')).toBe(false);
    expect(isDefaultBitLabels('', '')).toBe(false);
  });
});

describe('parseEntityXml — Yes/No columns', () => {
  const entity = parseEntityXml(widgetXml)!;
  const column = (name: string) => entity.attributes.find((a) => a.name === name)!;

  it('keeps custom Yes/No labels as a local bit option set', () => {
    expect(column('ddsol_isapproved').optionSetName).toBe('ddsol_widget_ddsol_isapproved');
    expect(entity.localOptionSets.get('ddsol_widget_ddsol_isapproved')).toMatchObject({
      type: 'bit', trueLabel: 'Approved', falseLabel: 'Rejected',
    });
  });

  it('drops the option set of a default Yes/No column', () => {
    expect(column('ddsol_isurgent').optionSetName).toBeNull();
    expect(entity.localOptionSets.has('ddsol_widget_ddsol_isurgent')).toBe(false);
  });

  it('carries the custom labels into model.json', () => {
    const pkMap = new Map([[entity.name, 'ddsol_widgetid']]);
    const model = buildModelJson(emitEntityFile(entity, pkMap, undefined, [])) as any;
    expect(model.bitOptionSets).toHaveLength(1);
    expect(model.bitOptionSets[0]).toMatchObject({
      name: 'ddsol_widget_ddsol_isapproved', trueLabel: 'Approved', falseLabel: 'Rejected',
    });
  });
});
