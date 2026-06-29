import Compiler from '@/compiler';
import { CompileError, CompileErrorCode } from '@/core/types/errors';
import { SettingName } from '@/core/types/keywords';
import {
  BlockExpressionNode, ElementDeclarationNode, FunctionApplicationNode, ListExpressionNode, PrefixExpressionNode, PrimaryExpressionNode, SyntaxNode, WildcardNode,
} from '@/core/types/nodes';
import {
  aggregateSettingList, isExpressionAQuotedString, isExpressionAVariableNode, isExpressionASignedNumberExpression, isValidName,
} from '@/core/utils/validate';
import { extractVariableFromExpression } from '@/core/utils/expression';
import { isValidBooleanLiteral } from '../table/validate';

function isIntegerNode (node?: SyntaxNode): boolean {
  if (!node) return false;
  return isExpressionASignedNumberExpression(node);
}

export default class OptionSetValidator {
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
      return [new CompileError(CompileErrorCode.INVALID_PROJECT_CONTEXT, 'An OptionSet can only appear top-level', this.declarationNode)];
    }
    return [];
  }

  private validateName (nameNode?: SyntaxNode): CompileError[] {
    if (!nameNode) {
      return [new CompileError(CompileErrorCode.NAME_NOT_FOUND, 'An OptionSet must have a name', this.declarationNode)];
    }
    if (nameNode instanceof WildcardNode) {
      return [new CompileError(CompileErrorCode.INVALID_NAME, 'Wildcard (*) is not allowed as an OptionSet name', nameNode)];
    }
    if (!isValidName(nameNode)) {
      return [new CompileError(CompileErrorCode.INVALID_NAME, 'An OptionSet name must be of the form <name> or <schema>.<name>', nameNode)];
    }
    return [];
  }

  private validateAlias (aliasNode?: SyntaxNode): CompileError[] {
    if (aliasNode) {
      return [new CompileError(CompileErrorCode.UNEXPECTED_ALIAS, 'An OptionSet shouldn\'t have an alias', aliasNode)];
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
        case SettingName.Description:
        case SettingName.SourceSolution:
          if (attrs.length > 1) {
            errors.push(...attrs.map((attr) => new CompileError(CompileErrorCode.DUPLICATE_TABLE_SETTING, `'${name}' can only appear once`, attr)));
          }
          attrs.forEach((attr) => {
            if (!isExpressionAQuotedString(attr.value)) {
              errors.push(new CompileError(CompileErrorCode.INVALID_TABLE_SETTING_VALUE, `'${name}' must be a string literal`, attr.value || attr.name!));
            }
          });
          break;
        case SettingName.IsGlobal:
          if (attrs.length > 1) {
            errors.push(...attrs.map((attr) => new CompileError(CompileErrorCode.DUPLICATE_TABLE_SETTING, '\'is_global\' can only appear once', attr)));
          }
          attrs.forEach((attr) => {
            if (attr.value !== undefined && !isValidBooleanLiteral(attr.value)) {
              errors.push(new CompileError(CompileErrorCode.INVALID_TABLE_SETTING_VALUE, '\'is_global\' must be true or false', attr.value || attr.name!));
            }
          });
          break;
        default:
          errors.push(...attrs.map((attr) => new CompileError(CompileErrorCode.UNKNOWN_TABLE_SETTING, `Unknown OptionSet setting '${name}'`, attr)));
      }
    }
    return errors;
  }

  private validateBody (body?: FunctionApplicationNode | BlockExpressionNode): CompileError[] {
    if (!body) return [];
    if (body instanceof FunctionApplicationNode) {
      return [new CompileError(CompileErrorCode.UNEXPECTED_SIMPLE_BODY, 'An OptionSet\'s body must be a block', body)];
    }
    return (body.body as FunctionApplicationNode[]).flatMap((field) => this.validateValue(field));
  }

  private validateValue (field: FunctionApplicationNode): CompileError[] {
    const errors: CompileError[] = [];
    if (!field.callee) return errors;

    // callee must be a number (integer)
    if (!field.callee || !isIntegerNode(field.callee)) {
      errors.push(new CompileError(CompileErrorCode.INVALID_COLUMN_NAME, 'An OptionSet value must be an integer', field.callee!));
    }

    // optional setting list: [label: '...', color: '#...']
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
          case SettingName.Color:
            attrs.forEach((attr) => {
              if (!isExpressionAVariableNode(attr.value) && !isExpressionAQuotedString(attr.value)) {
                errors.push(new CompileError(CompileErrorCode.INVALID_COLUMN_SETTING_VALUE, '\'color\' must be a color or string', attr.value || attr.name!));
              }
            });
            break;
          default:
            errors.push(...attrs.map((attr) => new CompileError(CompileErrorCode.UNKNOWN_COLUMN_SETTING, `Unknown OptionSet value setting '${sName}'`, attr)));
        }
      }
    }
    return errors;
  }
}
