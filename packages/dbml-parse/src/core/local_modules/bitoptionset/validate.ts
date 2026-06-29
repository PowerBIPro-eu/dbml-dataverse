import Compiler from '@/compiler';
import { CompileError, CompileErrorCode } from '@/core/types/errors';
import { SettingName } from '@/core/types/keywords';
import {
  BlockExpressionNode, ElementDeclarationNode, FunctionApplicationNode, ListExpressionNode, PrimaryExpressionNode, LiteralNode, SyntaxNode, WildcardNode,
} from '@/core/types/nodes';
import {
  aggregateSettingList, isExpressionAQuotedString, isExpressionASignedNumberExpression, isValidName,
} from '@/core/utils/validate';
import { extractVariableFromExpression } from '@/core/utils/expression';
import { SyntaxTokenKind } from '@/core/types/tokens';

function isBitValueNode (node?: SyntaxNode): node is PrimaryExpressionNode {
  if (!node || !(node instanceof PrimaryExpressionNode)) return false;
  if (!(node.expression instanceof LiteralNode)) return false;
  const v = node.expression.literal?.value;
  return v === '0' || v === '1';
}

export default class BitOptionSetValidator {
  private compiler: Compiler;
  private declarationNode: ElementDeclarationNode;

  constructor (compiler: Compiler, declarationNode: ElementDeclarationNode) {
    this.compiler = compiler;
    this.declarationNode = declarationNode;
  }

  validate (): CompileError[] {
    return [
      ...this.validateContext(),
      ...this.validateName(this.declarationNode.name),
      ...this.validateAlias(this.declarationNode.alias),
      ...this.validateSettingList(this.declarationNode.attributeList),
      ...this.validateBody(this.declarationNode.body),
    ];
  }

  private validateContext (): CompileError[] {
    if (this.declarationNode.parent instanceof ElementDeclarationNode) {
      return [new CompileError(CompileErrorCode.INVALID_PROJECT_CONTEXT, 'A BitOptionSet can only appear top-level', this.declarationNode)];
    }
    return [];
  }

  private validateName (nameNode?: SyntaxNode): CompileError[] {
    if (!nameNode) {
      return [new CompileError(CompileErrorCode.NAME_NOT_FOUND, 'A BitOptionSet must have a name', this.declarationNode)];
    }
    if (nameNode instanceof WildcardNode) {
      return [new CompileError(CompileErrorCode.INVALID_NAME, 'Wildcard (*) is not allowed as a BitOptionSet name', nameNode)];
    }
    if (!isValidName(nameNode)) {
      return [new CompileError(CompileErrorCode.INVALID_NAME, 'A BitOptionSet name must be of the form <name> or <schema>.<name>', nameNode)];
    }
    return [];
  }

  private validateAlias (aliasNode?: SyntaxNode): CompileError[] {
    if (aliasNode) {
      return [new CompileError(CompileErrorCode.UNEXPECTED_ALIAS, 'A BitOptionSet shouldn\'t have an alias', aliasNode)];
    }
    return [];
  }

  private validateSettingList (settingList?: ListExpressionNode): CompileError[] {
    if (!settingList) return [];
    const aggReport = aggregateSettingList(settingList);
    const errors = aggReport.getErrors();
    const settingMap = aggReport.getValue();
    for (const [name, attrs] of Object.entries(settingMap)) {
      switch (name) {
        case SettingName.DisplayName:
          if (attrs.length > 1) {
            errors.push(...attrs.map((attr) => new CompileError(CompileErrorCode.DUPLICATE_TABLE_SETTING, '\'display_name\' can only appear once', attr)));
          }
          attrs.forEach((attr) => {
            if (!isExpressionAQuotedString(attr.value)) {
              errors.push(new CompileError(CompileErrorCode.INVALID_TABLE_SETTING_VALUE, '\'display_name\' must be a string literal', attr.value || attr.name!));
            }
          });
          break;
        default:
          errors.push(...attrs.map((attr) => new CompileError(CompileErrorCode.UNKNOWN_TABLE_SETTING, `Unknown BitOptionSet setting '${name}'`, attr)));
      }
    }
    return errors;
  }

  private validateBody (body?: FunctionApplicationNode | BlockExpressionNode): CompileError[] {
    if (!body) return [];
    if (body instanceof FunctionApplicationNode) {
      return [new CompileError(CompileErrorCode.UNEXPECTED_SIMPLE_BODY, 'A BitOptionSet\'s body must be a block', body)];
    }

    const entries = body.body as FunctionApplicationNode[];
    // BitOptionSet must only have 0 and 1 as values
    return entries.flatMap((field) => this.validateValue(field));
  }

  private validateValue (field: FunctionApplicationNode): CompileError[] {
    const errors: CompileError[] = [];
    if (!field.callee) return errors;

    if (!field.callee || !isBitValueNode(field.callee)) {
      errors.push(new CompileError(CompileErrorCode.INVALID_COLUMN_NAME, 'A BitOptionSet value must be 0 (false) or 1 (true)', field.callee!));
    }

    const settingList = field.args[0] instanceof ListExpressionNode ? field.args[0] as ListExpressionNode : undefined;
    if (settingList) {
      const settingMap = aggregateSettingList(settingList).getValue();
      for (const [sName, attrs] of Object.entries(settingMap)) {
        switch (sName) {
          case SettingName.Label:
            attrs.forEach((attr) => {
              if (!isExpressionAQuotedString(attr.value)) {
                errors.push(new CompileError(CompileErrorCode.INVALID_COLUMN_SETTING_VALUE, '\'label\' must be a string literal', attr.value || attr.name!));
              }
            });
            break;
          default:
            errors.push(...attrs.map((attr) => new CompileError(CompileErrorCode.UNKNOWN_COLUMN_SETTING, `Unknown BitOptionSet value setting '${sName}'`, attr)));
        }
      }
    }
    return errors;
  }
}
