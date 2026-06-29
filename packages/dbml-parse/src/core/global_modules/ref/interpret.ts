import {
  destructureComplexVariable, extractVariableFromExpression,
  getBody, extractQuotedStringToken,
} from '@/core/utils/expression';
import { aggregateSettingList } from '@/core/utils/validate';
import { extractStringFromIdentifierStream } from '@/core/utils/expression';
import { CompileError, CompileErrorCode } from '@/core/types/errors';
import {
  ElementDeclarationNode,
  FunctionApplicationNode,
  IdentifierStreamNode,
  type ListExpressionNode,
  AttributeNode,
  type SyntaxNode,
  PrimaryExpressionNode,
  LiteralNode,
  PrefixExpressionNode,
} from '@/core/types/nodes';
import type { Ref } from '@/core/types/schemaJson';
import {
  RefMetadata,
  type Filepath,
} from '@/core/types';
import type Compiler from '@/compiler';
import {
  extractColor,
  getTokenPosition,
} from '@/core/utils/interpret';
import { extractNumber } from '@/core/utils/numbers';
import Report from '@/core/types/report';
import { getMultiplicities } from '../utils';
import { zip } from 'lodash-es';

function extractQuotedStringFromAttr (value?: SyntaxNode): string | undefined {
  if (!value) return undefined;
  return extractQuotedStringToken(value);
}

function extractIntOrIdent (value?: SyntaxNode): string | number | undefined {
  if (!value) return undefined;
  if (value instanceof PrimaryExpressionNode && value.expression instanceof LiteralNode) {
    const v = value.expression.literal?.value;
    if (v !== undefined) return parseInt(v, 10);
  }
  if (value instanceof PrefixExpressionNode) {
    return extractNumber(value);
  }
  return extractVariableFromExpression(value) ?? undefined;
}

export class RefInterpreter {
  private compiler: Compiler;
  private metadata: RefMetadata;
  private declarationNode: ElementDeclarationNode | AttributeNode;
  private filepath: Filepath;
  private ref: Partial<Ref>;

  constructor (compiler: Compiler, metadata: RefMetadata, filepath: Filepath) {
    this.compiler = compiler;
    this.filepath = filepath;
    this.metadata = metadata;
    this.declarationNode = metadata.declaration;
    this.ref = {};
  }

  interpret (): Report<Ref> {
    this.ref.token = getTokenPosition(this.declarationNode);
    const errors = [
      ...this.interpretName(),
      ...this.interpretBody(),
    ];
    return Report.create(this.ref as Ref, errors);
  }

  private interpretName (): CompileError[] {
    // Inline refs do not have a name
    if (!(this.declarationNode instanceof ElementDeclarationNode)) return [];
    const errors: CompileError[] = [];

    const fragments = destructureComplexVariable(this.declarationNode.name!) ?? [];
    this.ref.name = fragments.pop() || null;
    if (fragments.length > 1) {
      errors.push(new CompileError(CompileErrorCode.UNSUPPORTED, 'Nested schema is not supported', this.declarationNode.name!));
    }
    this.ref.schemaName = fragments.join('.') || null;

    return errors;
  }

  private interpretBody (): CompileError[] {
    const op = this.metadata.op(this.compiler)!;

    const leftColumnSymbols = this.metadata.leftColumns(this.compiler);
    const leftTableSymbol = this.metadata.leftTable(this.compiler);

    const rightColumnSymbols = this.metadata.rightColumns(this.compiler);
    const rightTableSymbol = this.metadata.rightTable(this.compiler);

    if (zip(leftColumnSymbols, rightColumnSymbols).every(([
      left,
      right,
    ]) => left?.originalSymbol === right?.originalSymbol)) {
      return [
        new CompileError(CompileErrorCode.SAME_ENDPOINT, 'Two endpoints are the same', this.declarationNode),
      ];
    }

    const multiplicities = getMultiplicities(op)!;

    const leftTableName = leftTableSymbol?.interpretedName(this.compiler, this.filepath);
    const rightTableName = rightTableSymbol?.interpretedName(this.compiler, this.filepath);

    // Derive tokens for each endpoint via metadata
    const leftToken = getTokenPosition(this.metadata.leftToken());
    const rightToken = getTokenPosition(this.metadata.rightToken());

    // For inline refs: left = container (FK side), right = target (referenced side)
    // We need to swap endpoints to match the standalone FK convention
    this.ref.endpoints = !(this.declarationNode instanceof ElementDeclarationNode)
      ? [
          {
            schemaName: rightTableName?.schema ?? null,
            tableName: rightTableName?.name ?? '',
            fieldNames: rightColumnSymbols.map((c) => c.name ?? ''),
            relation: multiplicities[1],
            token: rightToken,
          },
          {
            schemaName: leftTableName?.schema ?? null,
            tableName: leftTableName?.name ?? '',
            fieldNames: leftColumnSymbols.map((c) => c.name ?? ''),
            relation: multiplicities[0],
            token: leftToken,
          },
        ]
      : [
          {
            schemaName: leftTableName?.schema ?? null,
            tableName: leftTableName?.name ?? '',
            fieldNames: leftColumnSymbols.map((c) => c.name ?? ''),
            relation: multiplicities[0],
            token: leftToken,
          },
          {
            schemaName: rightTableName?.schema ?? null,
            tableName: rightTableName?.name ?? '',
            fieldNames: rightColumnSymbols.map((c) => c.name ?? ''),
            relation: multiplicities[1],
            token: rightToken,
          },
        ];

    // Inline refs have no other settings
    if (!(this.declarationNode instanceof ElementDeclarationNode)) return [];

    const field = getBody(this.declarationNode)[0] as FunctionApplicationNode;

    // Merge element-level [settings] (Dataverse style) with inline field [settings] (standard style)
    const elementSettingMap = aggregateSettingList(
      (this.declarationNode as ElementDeclarationNode).attributeList as ListExpressionNode | undefined,
    ).getValue();
    const inlineSettingMap = field?.args?.[0]
      ? aggregateSettingList(field.args[0] as ListExpressionNode).getValue()
      : {};

    // Element-level settings take precedence; inline settings are fallback
    const settingMap: Record<string, any[]> = { ...inlineSettingMap, ...elementSettingMap };

    {
      const deleteSetting = settingMap.delete?.at(0)?.value;
      this.ref.onDelete = deleteSetting instanceof IdentifierStreamNode
        ? extractStringFromIdentifierStream(deleteSetting)
        : extractVariableFromExpression(deleteSetting) as string;

      const updateSetting = settingMap.update?.at(0)?.value;
      this.ref.onUpdate = updateSetting instanceof IdentifierStreamNode
        ? extractStringFromIdentifierStream(updateSetting)
        : extractVariableFromExpression(updateSetting) as string;

      this.ref.color = settingMap.color?.length ? extractColor(settingMap.color?.at(0)?.value as any) : undefined;

      this.ref.inactive = settingMap.inactive?.length ? true : undefined;

      // Dataverse — cascade and nav settings
      const extractDvStr = (key: string): string | undefined => {
        const attr = settingMap[key]?.at(0);
        if (!attr?.value) return undefined;
        const qs = extractQuotedStringFromAttr(attr.value);
        if (qs !== undefined) return qs;
        return extractVariableFromExpression(attr.value) ?? undefined;
      };

      this.ref.cascadeAssign = extractDvStr('cascade_assign');
      this.ref.cascadeArchive = extractDvStr('cascade_archive');
      this.ref.cascadeReparent = extractDvStr('cascade_reparent');
      this.ref.cascadeShare = extractDvStr('cascade_share');
      this.ref.cascadeUnshare = extractDvStr('cascade_unshare');
      this.ref.cascadeRollupView = extractDvStr('cascade_rollupview');

      const hierAttr = settingMap['is_hierarchical']?.at(0);
      if (hierAttr) {
        if (hierAttr.value === undefined) {
          this.ref.isHierarchical = true;
        } else {
          const v = extractVariableFromExpression(hierAttr.value);
          this.ref.isHierarchical = v?.toLowerCase() === 'true' ? true : v?.toLowerCase() === 'false' ? false : undefined;
        }
      }

      this.ref.navMany = extractDvStr('nav_many');
      this.ref.navOne = extractDvStr('nav_one');
      this.ref.navPaneDisplay = extractDvStr('nav_pane_display');
      this.ref.navPaneArea = extractDvStr('nav_pane_area');
      this.ref.intersectEntity = extractDvStr('intersect_entity');
      this.ref.navManyLeft = extractDvStr('nav_many_left');
      this.ref.navManyRight = extractDvStr('nav_many_right');
      this.ref.sourceSolution = extractDvStr('source_solution');

      const navPaneOrderAttr = settingMap['nav_pane_order']?.at(0);
      if (navPaneOrderAttr?.value) {
        const v = extractIntOrIdent(navPaneOrderAttr.value);
        if (typeof v === 'number') this.ref.navPaneOrder = v;
        else if (typeof v === 'string') this.ref.navPaneOrder = parseInt(v, 10) || undefined;
      }
    } // end merged settingMap block

    return [];
  }
}
