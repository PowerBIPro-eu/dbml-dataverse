import Compiler from '@/compiler';
import { CompileError, CompileErrorCode } from '@/core/types/errors';
import { SettingName } from '@/core/types/keywords';
import {
  BlockExpressionNode, ElementDeclarationNode, FunctionApplicationNode, ListExpressionNode, SyntaxNode, WildcardNode,
} from '@/core/types/nodes';
import {
  aggregateSettingList, isExpressionAQuotedString, isExpressionASignedNumberExpression, isValidName,
} from '@/core/utils/validate';
import { extractVariableFromExpression } from '@/core/utils/expression';

function isNonNegativeIntegerNode (node?: SyntaxNode): boolean {
  if (!node) return false;
  return isExpressionASignedNumberExpression(node);
}

export default class StateOptionSetValidator {
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
      return [new CompileError(CompileErrorCode.INVALID_PROJECT_CONTEXT, 'A StateOptionSet can only appear top-level', this.declarationNode)];
    }
    return [];
  }

  private validateName (nameNode?: SyntaxNode): CompileError[] {
    if (!nameNode) {
      return [new CompileError(CompileErrorCode.NAME_NOT_FOUND, 'A StateOptionSet must have a name', this.declarationNode)];
    }
    if (nameNode instanceof WildcardNode) {
      return [new CompileError(CompileErrorCode.INVALID_NAME, 'Wildcard (*) is not allowed as a StateOptionSet name', nameNode)];
    }
    if (!isValidName(nameNode)) {
      return [new CompileError(CompileErrorCode.INVALID_NAME, 'A StateOptionSet name must be of the form <name> or <schema>.<name>', nameNode)];
    }
    return [];
  }

  private validateAlias (aliasNode?: SyntaxNode): CompileError[] {
    if (aliasNode) {
      return [new CompileError(CompileErrorCode.UNEXPECTED_ALIAS, 'A StateOptionSet shouldn\'t have an alias', aliasNode)];
    }
    return [];
  }

  private validateSettingList (settingList?: ListExpressionNode): CompileError[] {
    if (settingList) {
      return [new CompileError(CompileErrorCode.UNEXPECTED_SETTINGS, 'A StateOptionSet shouldn\'t have a top-level setting list', settingList)];
    }
    return [];
  }

  private validateBody (body?: FunctionApplicationNode | BlockExpressionNode): CompileError[] {
    if (!body) return [];
    if (body instanceof FunctionApplicationNode) {
      return [new CompileError(CompileErrorCode.UNEXPECTED_SIMPLE_BODY, 'A StateOptionSet\'s body must be a block', body)];
    }
    return (body.body as FunctionApplicationNode[]).flatMap((field) => this.validateValue(field));
  }

  private validateValue (field: FunctionApplicationNode): CompileError[] {
    const errors: CompileError[] = [];
    if (!field.callee) return errors;

    if (!field.callee || !isNonNegativeIntegerNode(field.callee)) {
      errors.push(new CompileError(CompileErrorCode.INVALID_COLUMN_NAME, 'A StateOptionSet value must be a non-negative integer', field.callee!));
    }

    const settingList = field.args[0] instanceof ListExpressionNode ? field.args[0] as ListExpressionNode : undefined;
    if (settingList) {
      const settingMap = aggregateSettingList(settingList).getValue();
      for (const [sName, attrs] of Object.entries(settingMap)) {
        switch (sName) {
          case SettingName.Label:
          case SettingName.InvariantName:
            attrs.forEach((attr) => {
              if (!isExpressionAQuotedString(attr.value)) {
                errors.push(new CompileError(CompileErrorCode.INVALID_COLUMN_SETTING_VALUE, `'${sName}' must be a string literal`, attr.value || attr.name!));
              }
            });
            break;
          case SettingName.DefaultStatus:
            // integer reference to a status value
            break;
          default:
            errors.push(...attrs.map((attr) => new CompileError(CompileErrorCode.UNKNOWN_COLUMN_SETTING, `Unknown StateOptionSet value setting '${sName}'`, attr)));
        }
      }
    }
    return errors;
  }
}
