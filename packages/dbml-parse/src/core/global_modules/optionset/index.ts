import type Compiler from '@/compiler';
import { ElementKind } from '@/core/types/keywords';
import { PASS_THROUGH, UNHANDLED, type PassThrough } from '@/core/types/module';
import { ElementDeclarationNode, FunctionApplicationNode, LiteralNode, ListExpressionNode, PrefixExpressionNode, PrimaryExpressionNode, type SyntaxNode } from '@/core/types/nodes';
import Report from '@/core/types/report';
import type {
  BitOptionSet, OptionSet, StateOptionSet, StatusOptionSet,
} from '@/core/types/schemaJson';
import type { NodeSymbol } from '@/core/types/symbol';
import { SymbolKind, OptionSetSymbol, StateOptionSetSymbol, StatusOptionSetSymbol, BitOptionSetSymbol } from '@/core/types/symbol';
import { isElementNode } from '@/core/utils/validate';
import { aggregateSettingList } from '@/core/utils/validate';
import { extractVariableFromExpression, extractQuotedStringToken } from '@/core/utils/expression';
import { getTokenPosition } from '@/core/utils/interpret';
import { extractNumber } from '@/core/utils/numbers';
import type { GlobalModule } from '../types';
import type { Filepath } from '@/core/types/filepath';
import { SettingName } from '@/core/types/keywords';

// ── Shared helpers ────────────────────────────────────────────────────────

function extractName (node: ElementDeclarationNode): string {
  if (!node.name) return '';
  return extractVariableFromExpression(node.name) ?? '';
}

function extractStrSetting (settingMap: Record<string, any[]>, key: string): string | undefined {
  const attr = settingMap[key]?.at(0);
  if (!attr) return undefined;
  const qs = extractQuotedStringToken(attr.value);
  return qs ?? extractVariableFromExpression(attr.value) ?? undefined;
}

function extractIntFromNode (node?: SyntaxNode): number | undefined {
  if (!node) return undefined;
  if (node instanceof PrimaryExpressionNode && node.expression instanceof LiteralNode) {
    const v = node.expression.literal?.value;
    if (v !== undefined) return parseInt(v, 10);
  }
  if (node instanceof PrefixExpressionNode) {
    return extractNumber(node);
  }
  return undefined;
}

function extractIntFromField (field: FunctionApplicationNode): number | undefined {
  return extractIntFromNode(field.callee);
}

// ── OptionSet global module ───────────────────────────────────────────────

export const optionSetGlobalModule: GlobalModule = {
  nodeSymbol (compiler: Compiler, node: SyntaxNode): Report<NodeSymbol> | Report<PassThrough> {
    if (!isElementNode(node, ElementKind.OptionSet)) return Report.create(PASS_THROUGH);
    return new Report(compiler.symbolFactory.create(OptionSetSymbol, {
      declaration: node,
      name: compiler.nodeFullname(node).getFiltered(UNHANDLED)?.at(-1),
    }, node.filepath));
  },

  symbolMembers (_compiler: Compiler, symbol: NodeSymbol): Report<NodeSymbol[]> | Report<PassThrough> {
    if (!symbol.isKind(SymbolKind.OptionSet)) return Report.create(PASS_THROUGH);
    return new Report([]);
  },

  interpretSymbol (_compiler: Compiler, symbol: NodeSymbol, filepath: Filepath): Report<OptionSet | undefined> | Report<PassThrough> {
    if (!(symbol instanceof OptionSetSymbol)) return Report.create(PASS_THROUGH);
    const node = symbol.declaration as ElementDeclarationNode;
    if (!node) return new Report(undefined);

    const result: OptionSet = {
      name: extractName(node),
      schemaName: null,
      token: getTokenPosition(node),
      values: [],
    };

    const topSettings = aggregateSettingList(node.attributeList).getValue();
    result.displayName = extractStrSetting(topSettings, SettingName.DisplayName);
    result.description = extractStrSetting(topSettings, SettingName.Description);
    result.sourceSolution = extractStrSetting(topSettings, SettingName.SourceSolution);

    const isGlobalAttr = topSettings[SettingName.IsGlobal]?.at(0);
    if (isGlobalAttr) {
      if (isGlobalAttr.value === undefined) {
        result.isGlobal = true;
      } else {
        const v = extractVariableFromExpression(isGlobalAttr.value);
        result.isGlobal = v?.toLowerCase() === 'true' ? true : v?.toLowerCase() === 'false' ? false : undefined;
      }
    }

    const body = node.body;
    if (body && 'body' in body) {
      for (const entry of (body as any).body as FunctionApplicationNode[]) {
        const intVal = extractIntFromField(entry);
        if (intVal === undefined) continue;
        const sm = aggregateSettingList(entry.args[0] instanceof ListExpressionNode ? entry.args[0] : undefined).getValue();
        result.values.push({
          value: intVal,
          token: getTokenPosition(entry),
          label: extractStrSetting(sm, SettingName.Label),
          color: extractStrSetting(sm, SettingName.Color),
        });
      }
    }

    return new Report(result);
  },
};

// ── StateOptionSet global module ─────────────────────────────────────────

export const stateOptionSetGlobalModule: GlobalModule = {
  nodeSymbol (compiler: Compiler, node: SyntaxNode): Report<NodeSymbol> | Report<PassThrough> {
    if (!isElementNode(node, ElementKind.StateOptionSet)) return Report.create(PASS_THROUGH);
    return new Report(compiler.symbolFactory.create(StateOptionSetSymbol, {
      declaration: node,
      name: compiler.nodeFullname(node).getFiltered(UNHANDLED)?.at(-1),
    }, node.filepath));
  },

  symbolMembers (_compiler: Compiler, symbol: NodeSymbol): Report<NodeSymbol[]> | Report<PassThrough> {
    if (!symbol.isKind(SymbolKind.StateOptionSet)) return Report.create(PASS_THROUGH);
    return new Report([]);
  },

  interpretSymbol (_compiler: Compiler, symbol: NodeSymbol, _filepath: Filepath): Report<StateOptionSet | undefined> | Report<PassThrough> {
    if (!(symbol instanceof StateOptionSetSymbol)) return Report.create(PASS_THROUGH);
    const node = symbol.declaration as ElementDeclarationNode;
    if (!node) return new Report(undefined);

    const result: StateOptionSet = {
      name: extractName(node),
      schemaName: null,
      token: getTokenPosition(node),
      values: [],
    };

    const body = node.body;
    if (body && 'body' in body) {
      for (const entry of (body as any).body as FunctionApplicationNode[]) {
        const intVal = extractIntFromField(entry);
        if (intVal === undefined) continue;
        const sm = aggregateSettingList(entry.args[0] instanceof ListExpressionNode ? entry.args[0] : undefined).getValue();
        const dsAttr = sm[SettingName.DefaultStatus]?.at(0);
        const defaultStatus = dsAttr?.value ? parseInt(extractVariableFromExpression(dsAttr.value) ?? '', 10) || undefined : undefined;
        result.values.push({
          value: intVal,
          token: getTokenPosition(entry),
          label: extractStrSetting(sm, SettingName.Label),
          invariantName: extractStrSetting(sm, SettingName.InvariantName),
          defaultStatus,
        });
      }
    }

    return new Report(result);
  },
};

// ── StatusOptionSet global module ─────────────────────────────────────────

export const statusOptionSetGlobalModule: GlobalModule = {
  nodeSymbol (compiler: Compiler, node: SyntaxNode): Report<NodeSymbol> | Report<PassThrough> {
    if (!isElementNode(node, ElementKind.StatusOptionSet)) return Report.create(PASS_THROUGH);
    return new Report(compiler.symbolFactory.create(StatusOptionSetSymbol, {
      declaration: node,
      name: compiler.nodeFullname(node).getFiltered(UNHANDLED)?.at(-1),
    }, node.filepath));
  },

  symbolMembers (_compiler: Compiler, symbol: NodeSymbol): Report<NodeSymbol[]> | Report<PassThrough> {
    if (!symbol.isKind(SymbolKind.StatusOptionSet)) return Report.create(PASS_THROUGH);
    return new Report([]);
  },

  interpretSymbol (_compiler: Compiler, symbol: NodeSymbol, _filepath: Filepath): Report<StatusOptionSet | undefined> | Report<PassThrough> {
    if (!(symbol instanceof StatusOptionSetSymbol)) return Report.create(PASS_THROUGH);
    const node = symbol.declaration as ElementDeclarationNode;
    if (!node) return new Report(undefined);

    const result: StatusOptionSet = {
      name: extractName(node),
      schemaName: null,
      token: getTokenPosition(node),
      values: [],
    };

    const body = node.body;
    if (body && 'body' in body) {
      for (const entry of (body as any).body as FunctionApplicationNode[]) {
        const intVal = extractIntFromField(entry);
        if (intVal === undefined) continue;
        const sm = aggregateSettingList(entry.args[0] instanceof ListExpressionNode ? entry.args[0] : undefined).getValue();
        const stateAttr = sm[SettingName.State]?.at(0);
        const state = stateAttr?.value ? parseInt(extractVariableFromExpression(stateAttr.value) ?? '', 10) || undefined : undefined;
        result.values.push({
          value: intVal,
          token: getTokenPosition(entry),
          label: extractStrSetting(sm, SettingName.Label),
          state,
          color: extractStrSetting(sm, SettingName.Color),
        });
      }
    }

    return new Report(result);
  },
};

// ── BitOptionSet global module ────────────────────────────────────────────

export const bitOptionSetGlobalModule: GlobalModule = {
  nodeSymbol (compiler: Compiler, node: SyntaxNode): Report<NodeSymbol> | Report<PassThrough> {
    if (!isElementNode(node, ElementKind.BitOptionSet)) return Report.create(PASS_THROUGH);
    return new Report(compiler.symbolFactory.create(BitOptionSetSymbol, {
      declaration: node,
      name: compiler.nodeFullname(node).getFiltered(UNHANDLED)?.at(-1),
    }, node.filepath));
  },

  symbolMembers (_compiler: Compiler, symbol: NodeSymbol): Report<NodeSymbol[]> | Report<PassThrough> {
    if (!symbol.isKind(SymbolKind.BitOptionSet)) return Report.create(PASS_THROUGH);
    return new Report([]);
  },

  interpretSymbol (_compiler: Compiler, symbol: NodeSymbol, _filepath: Filepath): Report<BitOptionSet | undefined> | Report<PassThrough> {
    if (!(symbol instanceof BitOptionSetSymbol)) return Report.create(PASS_THROUGH);
    const node = symbol.declaration as ElementDeclarationNode;
    if (!node) return new Report(undefined);

    const result: BitOptionSet = {
      name: extractName(node),
      schemaName: null,
      token: getTokenPosition(node),
    };

    const topSettings = aggregateSettingList(node.attributeList).getValue();
    result.displayName = extractStrSetting(topSettings, SettingName.DisplayName);

    const body = node.body;
    if (body && 'body' in body) {
      for (const entry of (body as any).body as FunctionApplicationNode[]) {
        const intVal = extractIntFromField(entry);
        const sm = aggregateSettingList(entry.args[0] instanceof ListExpressionNode ? entry.args[0] : undefined).getValue();
        const label = extractStrSetting(sm, SettingName.Label);
        if (intVal === 1) result.trueLabel = label;
        else if (intVal === 0) result.falseLabel = label;
      }
    }

    return new Report(result);
  },
};
