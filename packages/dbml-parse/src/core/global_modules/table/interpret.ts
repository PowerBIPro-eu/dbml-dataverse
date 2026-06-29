import { last, partition } from 'lodash-es';
import Compiler from '@/compiler';
import { CompileError, CompileErrorCode } from '@/core/types/errors';
import { ElementKind, SettingName } from '@/core/types/keywords';
import { UNHANDLED } from '@/core/types/module';
import {
  BlockExpressionNode, ElementDeclarationNode,
  FunctionApplicationNode, FunctionExpressionNode, ListExpressionNode, PrefixExpressionNode,
  SyntaxNode,
} from '@/core/types/nodes';
import Report from '@/core/types/report';
import {
  Check, Column, Index, InlineRef, Ref,
  Table, TablePartialInjection,
} from '@/core/types/schemaJson';
import type { Filepath } from '@/core/types/filepath';
import { SymbolKind } from '@/core/types/symbol';
import { RefMetadata } from '@/core/types/symbol/metadata';
import type { ColumnSymbol, TableSymbol } from '@/core/types/symbol/symbols';
import { ProgramSymbol } from '@/core/types/symbol/symbols';
import {
  extractQuotedStringToken, extractVarNameFromPrimaryVariable,
  extractVariableFromExpression,
} from '@/core/utils/expression';
import { aggregateSettingList, isValidPartialInjection } from '@/core/utils/validate';
import {
  extractColor, extractElementName,
  getTokenPosition, normalizeNote,
  processColumnType,
} from '@/core/utils/interpret';

export class TableInterpreter {
  private declarationNode: ElementDeclarationNode;
  private compiler: Compiler;
  private symbol?: TableSymbol;
  private filepath: Filepath;
  private table: Partial<Table>;
  private pkColumns: Column[];

  constructor (compiler: Compiler, declarationNode: ElementDeclarationNode, symbol: TableSymbol, filepath: Filepath) {
    this.compiler = compiler;
    this.declarationNode = declarationNode;
    this.symbol = symbol;
    this.filepath = filepath;
    this.table = {
      name: undefined,
      schemaName: undefined,
      alias: null,
      fields: [],
      token: undefined,
      indexes: [],
      partials: [],
      checks: [],
    };
    this.pkColumns = [];
  }

  interpret (): Report<Table> {
    this.table.token = this.symbol?.token ?? getTokenPosition(this.declarationNode);

    const nameErrors: CompileError[] = [];
    if (this.symbol) {
      const {
        name, schema,
      } = this.symbol.interpretedName(this.compiler, this.filepath);
      this.table.name = name;
      this.table.schemaName = schema;
    } else {
      nameErrors.push(...this.interpretName(this.declarationNode.name!));
    }

    const errors = [
      ...nameErrors,
      ...this.interpretAlias(this.declarationNode.alias),
      ...this.interpretSettingList(this.declarationNode.attributeList),
      ...this.interpretBody(this.declarationNode.body as BlockExpressionNode),
    ];

    // Handle cases where there are multiple primary columns
    // all the pk field of the columns are reset to false
    // and a new pk composite index is added
    if (this.pkColumns.length >= 2) {
      this.table.indexes!.push({
        columns: this.pkColumns.map(({
          name, token,
        }) => ({
          value: name,
          type: 'column',
          token,
        })),
        token: {
          start: {
            offset: -1,
            line: -1,
            column: -1,
          }, // do not make sense to have a meaningful start (?)
          end: {
            offset: -1,
            line: -1,
            column: -1,
          }, // do not make sense to have a meaningful end (?)
          filepath: this.declarationNode.filepath,
        },
        pk: true,
      });
      this.pkColumns.forEach((column) => {
        column.pk = false;
      });
    }

    return Report.create(this.table as Table, errors);
  }

  private interpretName (nameNode: SyntaxNode): CompileError[] {
    const {
      name, schemaName,
    } = extractElementName(nameNode);

    if (schemaName.length > 1) {
      this.table.name = name;
      this.table.schemaName = schemaName.join('.');

      return [
        new CompileError(CompileErrorCode.UNSUPPORTED, 'Nested schema is not supported', nameNode),
      ];
    }

    this.table.name = name;
    this.table.schemaName = schemaName.length ? schemaName[0] : null;

    return [];
  }

  private interpretAlias (aliasNode?: SyntaxNode): CompileError[] {
    if (!aliasNode) {
      return [];
    }

    const alias = extractVarNameFromPrimaryVariable(aliasNode as any);
    if (alias) {
      this.table.alias = alias;
    }

    return [];
  }

  private interpretSettingList (settings?: ListExpressionNode): CompileError[] {
    const settingMap = aggregateSettingList(settings).getValue();

    this.table.headerColor = settingMap[SettingName.HeaderColor]?.length
      ? extractColor(settingMap[SettingName.HeaderColor]?.at(0)?.value as any)
      : undefined;

    const [
      noteNode,
    ] = settingMap[SettingName.Note] || [];
    this.table.note = noteNode && {
      value: normalizeNote(extractQuotedStringToken(noteNode?.value)!),
      token: getTokenPosition(noteNode),
    };

    // Dataverse — extract table settings
    const extractStr = (key: string): string | undefined => {
      const attr = settingMap[key]?.at(0);
      if (!attr) return undefined;
      const qs = extractQuotedStringToken(attr.value);
      if (qs !== undefined) return qs;
      return extractVariableFromExpression(attr.value) ?? undefined;
    };
    const extractBool = (key: string): boolean | undefined => {
      const attr = settingMap[key]?.at(0);
      if (!attr) return undefined;
      if (attr.value === undefined) return true;
      const v = extractVariableFromExpression(attr.value);
      return v?.toLowerCase() === 'true' ? true : v?.toLowerCase() === 'false' ? false : undefined;
    };

    this.table.displayName = extractStr(SettingName.DisplayName);
    this.table.entitySetName = extractStr(SettingName.EntitySetName);
    this.table.description = extractStr(SettingName.Description);
    this.table.introducedVersion = extractStr(SettingName.IntroducedVersion);
    this.table.primaryImage = extractStr(SettingName.PrimaryImage);

    const ownershipAttr = settingMap[SettingName.Ownership]?.at(0);
    if (ownershipAttr) {
      this.table.ownership = extractVariableFromExpression(ownershipAttr.value) ?? undefined;
    }

    this.table.isActivity = extractBool(SettingName.IsActivity);
    this.table.isActivityParty = extractBool(SettingName.IsActivityParty);
    this.table.isAuditEnabled = extractBool(SettingName.IsAuditEnabled);
    this.table.changeTrackingEnabled = extractBool(SettingName.ChangeTrackingEnabled);
    this.table.isQuickCreateEnabled = extractBool(SettingName.IsQuickCreateEnabled);
    this.table.isValidForQueue = extractBool(SettingName.IsValidForQueue);
    this.table.isAvailableOffline = extractBool(SettingName.IsAvailableOffline);
    this.table.sourceSolution = extractStr(SettingName.SourceSolution);

    return [];
  }

  private interpretBody (body: BlockExpressionNode): CompileError[] {
    const [
      fields,
      subs,
    ] = partition(body.body, (e) => e instanceof FunctionApplicationNode);
    return [
      ...this.interpretFields(fields as FunctionApplicationNode[]),
      ...this.interpretSubElements(subs as ElementDeclarationNode[]),
    ];
  }

  private interpretSubElements (subs: ElementDeclarationNode[]): CompileError[] {
    return subs.flatMap((sub) => {
      switch (sub.getElementKind()) {
        case ElementKind.Note:
          this.table.note = {
            value: normalizeNote(extractQuotedStringToken(
              sub.body instanceof BlockExpressionNode
                ? (sub.body.body[0] as FunctionApplicationNode).callee
                : sub.body!.callee,
            )!),
            token: getTokenPosition(sub),
          };
          return [];

        case ElementKind.Indexes:
          return this.interpretIndexes(sub);

        case ElementKind.Checks:
          return this.interpretChecks(sub);

        case ElementKind.Records:
          // Nested records are interpreted in program module
          return [];

        default:
          return [];
      }
    });
  }

  private interpretInjection (injection: PrefixExpressionNode, order: number) {
    const errors: CompileError[] = [];
    const partial: Partial<TablePartialInjection> = {
      order,
      token: getTokenPosition(injection),
    };
    partial.name = extractVariableFromExpression(injection.expression) || '';

    const partialSymbol = injection.expression ? this.compiler.nodeReferee(injection.expression).getFiltered(UNHANDLED) : undefined;
    const programNode = this.compiler.parseFile(this.filepath).getValue().ast;
    const programSymbol = this.compiler.nodeSymbol(programNode).getFiltered(UNHANDLED) as ProgramSymbol;

    // FIXME: Should support this in the future
    if (partialSymbol && !programSymbol.inNestedSchema(this.compiler, partialSymbol)) {
      const tableSymbol = this.compiler.nodeSymbol(this.declarationNode).getFiltered(UNHANDLED);
      const tableUseInThisFile = tableSymbol ? (this.compiler.symbolUses(tableSymbol).getFiltered(UNHANDLED) ?? []).find((u) => u.filepath.equals(this.filepath)) : undefined;
      errors.push(new CompileError(
        CompileErrorCode.UNSUPPORTED,
        `TablePartial ${partial.name} from '${partialSymbol.filepath}' should be imported. Currently, importing a table that uses a table partial requires that table partial to also be in scope.`,
        tableUseInThisFile?.useSpecifierDeclaration ?? injection,
      ));
    }

    this.table.partials!.push(partial as TablePartialInjection);
    return errors;
  }

  private interpretFields (fields: FunctionApplicationNode[]): CompileError[] {
    const tableSymbol = this.symbol ?? this.compiler.nodeSymbol(this.declarationNode).getFiltered(UNHANDLED);
    const symbolMembers = tableSymbol
      ? this.compiler.symbolMembers(tableSymbol).getFiltered(UNHANDLED) ?? []
      : [];
    const columnEntries = symbolMembers.filter((symbol) => {
      return symbol.isKind(SymbolKind.Column);
    });

    const columnCountErrors = columnEntries.length
      ? []
      : [
          new CompileError(CompileErrorCode.EMPTY_TABLE, 'A Table must have at least one column', this.declarationNode),
        ];

    const interpretFieldErrors = fields.flatMap((field, order) => {
      return isValidPartialInjection(field.callee)
        ? this.interpretInjection(field.callee, order)
        : this.interpretColumn(field);
    });

    return [
      ...columnCountErrors,
      ...interpretFieldErrors,
    ];
  }

  private interpretColumn (field: FunctionApplicationNode): CompileError[] {
    const errors: CompileError[] = [];
    const column: Partial<Column> = {};
    const columnSymbol = this.compiler.nodeSymbol(field).getFiltered(UNHANDLED) as ColumnSymbol | undefined;

    column.name = extractVarNameFromPrimaryVariable(field.callee as any)!;
    column.token = getTokenPosition(field);

    const typeReport = processColumnType(this.compiler, field.args[0]);
    column.type = typeReport.getValue();
    errors.push(...typeReport.getErrors());

    column.pk = columnSymbol?.pk(this.compiler) || false;
    column.unique = columnSymbol?.unique(this.compiler) || false;
    column.increment = columnSymbol?.increment(this.compiler) || undefined;
    const nullable = columnSymbol?.nullable(this.compiler);
    column.not_null = nullable === undefined ? undefined : !nullable;
    column.dbdefault = columnSymbol?.default(this.compiler);
    column.note = columnSymbol?.note(this.compiler);

    const settingMap = this.compiler.nodeSettings(field).getFiltered(UNHANDLED) ?? {};

    const programNode = this.compiler.parseFile(this.filepath).getValue().ast;
    const programSymbol = this.compiler.nodeSymbol(programNode).getFiltered(UNHANDLED);

    const refs = settingMap[SettingName.Ref] || [];
    column.inline_refs = refs.flatMap((ref) => {
      const meta = this.compiler.nodeMetadata(ref).getFiltered(UNHANDLED);
      if (!meta) return [];

      const owners = meta.owners(this.compiler);
      if (programSymbol && owners.length > 0 && !owners.some((o) => o === programSymbol)) return [];

      const result = this.compiler.interpretMetadata(meta, this.filepath);
      if (result.hasValue(UNHANDLED)) return [];
      errors.push(...result.getErrors());

      const value = result.getValue() as Ref | undefined;
      if (!value?.endpoints?.[0]) return [];

      const ep = value.endpoints[0];
      const op = (meta as RefMetadata).op(this.compiler);
      if (!op) return [];

      const inlineRef: InlineRef = {
        schemaName: ep.schemaName,
        tableName: ep.tableName,
        fieldNames: ep.fieldNames,
        relation: op,
        token: ep.token,
      };
      return inlineRef;
    });

    const checkNodes = settingMap[SettingName.Check] || [];
    column.checks = checkNodes.map((checkNode) => {
      const token = getTokenPosition(checkNode);
      const expression = (checkNode.value as FunctionExpressionNode).value!.value!;
      return {
        token,
        expression,
      };
    });

    // Dataverse — extract column settings
    const extractColStr = (key: string): string | undefined => {
      const attr = settingMap[key]?.at(0);
      if (!attr) return undefined;
      const qs = extractQuotedStringToken(attr.value);
      if (qs !== undefined) return qs;
      return extractVariableFromExpression(attr.value) ?? undefined;
    };
    const extractColBool = (key: string): boolean | undefined => {
      const attr = settingMap[key]?.at(0);
      if (!attr) return undefined;
      if (attr.value === undefined) return true;
      const v = extractVariableFromExpression(attr.value);
      return v?.toLowerCase() === 'true' ? true : v?.toLowerCase() === 'false' ? false : undefined;
    };

    column.displayName = extractColStr(SettingName.DisplayName);
    column.description = extractColStr(SettingName.Description);
    column.format = extractColStr(SettingName.Format);
    column.autoNumber = extractColStr(SettingName.AutoNumber);
    column.formulaFile = extractColStr(SettingName.FormulaFile);
    column.targets = extractColStr(SettingName.Targets);
    column.optionSetName = extractColStr(SettingName.OptionSetName);
    column.sourceSolution = extractColStr(SettingName.SourceSolution);

    const requiredAttr = settingMap[SettingName.Required]?.at(0);
    if (requiredAttr) {
      column.required = extractVariableFromExpression(requiredAttr.value) ?? undefined;
    }
    const sourceTypeAttr = settingMap[SettingName.SourceType]?.at(0);
    if (sourceTypeAttr) {
      column.sourceType = extractVariableFromExpression(sourceTypeAttr.value) ?? undefined;
    }

    column.isPrimaryName = extractColBool(SettingName.IsPrimaryName);
    column.readonlyInUI = extractColBool(SettingName.ReadonlyInUI);
    column.isLocalizable = extractColBool(SettingName.IsLocalizable);

    const minValAttr = settingMap[SettingName.MinValue]?.at(0);
    if (minValAttr?.value) {
      const qs = extractQuotedStringToken(minValAttr.value);
      column.minValue = qs ?? extractVariableFromExpression(minValAttr.value) ?? undefined;
    }
    const maxValAttr = settingMap[SettingName.MaxValue]?.at(0);
    if (maxValAttr?.value) {
      const qs = extractQuotedStringToken(maxValAttr.value);
      column.maxValue = qs ?? extractVariableFromExpression(maxValAttr.value) ?? undefined;
    }
    const precisionAttr = settingMap[SettingName.Precision]?.at(0);
    if (precisionAttr?.value) {
      const v = extractVariableFromExpression(precisionAttr.value);
      if (v !== undefined) column.precision = parseInt(v, 10) || undefined;
    }

    this.table.fields!.push(column as Column);
    if (column.pk) {
      this.pkColumns.push(column as Column);
    }

    return errors;
  }

  private interpretIndexes (indexes: ElementDeclarationNode): CompileError[] {
    const meta = this.compiler.nodeMetadata(indexes).getFiltered(UNHANDLED);
    if (!meta) return [];
    const result = this.compiler.interpretMetadata(meta, this.filepath);
    if (result.hasValue(UNHANDLED)) return [];
    const value = result.getValue();
    if (Array.isArray(value)) this.table.indexes!.push(...value as Index[]);
    else if (value) this.table.indexes!.push(value as Index);
    return result.getErrors();
  }

  private interpretChecks (checks: ElementDeclarationNode): CompileError[] {
    const meta = this.compiler.nodeMetadata(checks).getFiltered(UNHANDLED);
    if (!meta) return [];
    const result = this.compiler.interpretMetadata(meta, this.filepath);
    if (result.hasValue(UNHANDLED)) return [];
    const value = result.getValue();
    if (Array.isArray(value)) this.table.checks!.push(...value as Check[]);
    else if (value) this.table.checks!.push(value as Check);
    return result.getErrors();
  }
}
