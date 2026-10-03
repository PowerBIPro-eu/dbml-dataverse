import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { compareStrings, listDir, portableRelative } from '../util.js';
import { flag, guid, int, isGuid, logicalName, parseXmlFile, text } from './xml.js';

// Custom APIs: customapis/<unique name>/customapi.xml, with customapirequestparameters/<name>/
// customapirequestparameter.xml and customapiresponseproperties/<name>/customapiresponseproperty.xml.

export type CustomApiBindingType = 'global' | 'entity' | 'entityCollection';
export type CustomProcessingStepType = 'none' | 'asyncOnly' | 'syncAndAsync';
export type CustomApiFieldType =
  | 'boolean' | 'dateTime' | 'decimal' | 'entity' | 'entityCollection' | 'entityReference'
  | 'float' | 'integer' | 'money' | 'picklist' | 'string' | 'stringArray' | 'guid';

export interface CustomApiRequestParameterRecord {
  uniqueName: string;
  type: CustomApiFieldType | null;
  isOptional: boolean;
  entity: string | null;           // logical entity name (entity and entity reference types)
}

export interface CustomApiResponsePropertyRecord {
  uniqueName: string;
  type: CustomApiFieldType | null;
  entity: string | null;
}

export interface CustomApiRecord {
  uniqueName: string;
  displayName: string | null;
  description: string | null;
  bindingType: CustomApiBindingType | null;
  boundEntity: string | null;
  isFunction: boolean;
  isPrivate: boolean;
  allowedCustomProcessingStepType: CustomProcessingStepType | null;
  executePrivilegeName: string | null;
  pluginType: string | null;       // resolved from pluginTypeId when merging
  pluginTypeId: string | null;
  assembly: string | null;
  requestParameters: CustomApiRequestParameterRecord[];
  responseProperties: CustomApiResponsePropertyRecord[];
  file: string;
}

const BINDING_TYPES: Record<number, CustomApiBindingType> = { 0: 'global', 1: 'entity', 2: 'entityCollection' };
const STEP_TYPES: Record<number, CustomProcessingStepType> = { 0: 'none', 1: 'asyncOnly', 2: 'syncAndAsync' };
const FIELD_TYPES: CustomApiFieldType[] = [
  'boolean', 'dateTime', 'decimal', 'entity', 'entityCollection', 'entityReference',
  'float', 'integer', 'money', 'picklist', 'string', 'stringArray', 'guid',
];

/** A <displayname> or <description>: its English label, else its default. */
function label(el: any): string | null {
  const labels: any[] = Array.isArray(el?.label) ? el.label : [];
  return text(labels.find((l) => text(l?.['@_languagecode']) === '1033')?.['@_description']) ?? text(el?.['@_default']);
}

/**
 * `<plugintypeid><plugintypeid>…</plugintypeid></plugintypeid>`, or `<plugintypeexportkey>` in its
 * place: for a type of an assembly in the solution the export key is the type's id.
 */
function pluginTypeRef(ref: any): string | null {
  const id = guid(typeof ref === 'object' && ref !== null ? ref.plugintypeid ?? ref.plugintypeexportkey : ref);
  return id && isGuid(id) ? id : null;
}

const byUniqueName = (a: { uniqueName: string }, b: { uniqueName: string }) => compareStrings(a.uniqueName, b.uniqueName);

/** `<folder>/<sub>/<file>` for every sub-folder, in name order, with the folder name as fallback unique name. */
function eachDefinition<T>(dir: string, file: string, read: (path: string, folder: string) => T | null): T[] {
  if (!existsSync(dir)) return [];
  const out: T[] = [];
  for (const folder of listDir(dir, 'dirs')) {
    const path = join(dir, folder, file);
    const item = existsSync(path) ? read(path, folder) : null;
    if (item) out.push(item);
  }
  return out;
}

/** Custom APIs of one solution folder, each with its request parameters and response properties. */
export function readCustomApis(root: string, layerPath: string, warn: (message: string) => void): CustomApiRecord[] {
  return eachDefinition(join(root, 'customapis'), 'customapi.xml', (path, folder): CustomApiRecord | null => {
    const api = parseXmlFile(path, warn)?.customapi;
    if (!api) return null;
    const apiDir = join(root, 'customapis', folder);

    const requestParameters = eachDefinition(join(apiDir, 'customapirequestparameters'), 'customapirequestparameter.xml',
      (paramPath, name): CustomApiRequestParameterRecord | null => {
        const param = parseXmlFile(paramPath, warn)?.customapirequestparameter;
        return param ? {
          uniqueName: text(param['@_uniquename']) ?? name,
          type: FIELD_TYPES[int(param.type) ?? -1] ?? null,
          isOptional: flag(param.isoptional),
          entity: logicalName(param.logicalentityname),
        } : null;
      });
    const responseProperties = eachDefinition(join(apiDir, 'customapiresponseproperties'), 'customapiresponseproperty.xml',
      (propertyPath, name): CustomApiResponsePropertyRecord | null => {
        const property = parseXmlFile(propertyPath, warn)?.customapiresponseproperty;
        return property ? {
          uniqueName: text(property['@_uniquename']) ?? name,
          type: FIELD_TYPES[int(property.type) ?? -1] ?? null,
          entity: logicalName(property.logicalentityname),
        } : null;
      });

    return {
      uniqueName: text(api['@_uniquename']) ?? folder,
      displayName: label(api.displayname),
      description: label(api.description),
      bindingType: BINDING_TYPES[int(api.bindingtype) ?? -1] ?? null,
      boundEntity: logicalName(api.boundentitylogicalname),
      isFunction: flag(api.isfunction),
      isPrivate: flag(api.isprivate),
      allowedCustomProcessingStepType: STEP_TYPES[int(api.allowedcustomprocessingsteptype) ?? -1] ?? null,
      executePrivilegeName: text(api.executeprivilegename),
      pluginType: null,
      pluginTypeId: pluginTypeRef(api.plugintypeid),
      assembly: null,
      requestParameters: requestParameters.sort(byUniqueName),
      responseProperties: responseProperties.sort(byUniqueName),
      file: portableRelative(layerPath, path),
    };
  });
}
