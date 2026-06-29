import type Compiler from '@/compiler';
import { ElementKind } from '@/core/types/keywords';
import { PASS_THROUGH, type PassThrough } from '@/core/types/module';
import type { SyntaxNode } from '@/core/types/nodes';
import Report from '@/core/types/report';
import { isElementNode } from '@/core/utils/validate';
import { type LocalModule } from '../types';
import OptionSetValidator from './validate';

export const optionSetModule: LocalModule = {
  validateNode (compiler: Compiler, node: SyntaxNode): Report<void> | Report<PassThrough> {
    if (isElementNode(node, ElementKind.OptionSet)) {
      return Report.create(undefined, new OptionSetValidator(compiler, node).validate());
    }
    return Report.create(PASS_THROUGH);
  },

  nodeFullname (_compiler: Compiler, node: SyntaxNode): Report<string[] | undefined> | Report<PassThrough> {
    if (isElementNode(node, ElementKind.OptionSet)) {
      return new Report(undefined);
    }
    return Report.create(PASS_THROUGH);
  },

  nodeAlias (_compiler: Compiler, node: SyntaxNode): Report<string | undefined> | Report<PassThrough> {
    if (isElementNode(node, ElementKind.OptionSet)) {
      return new Report(undefined);
    }
    return Report.create(PASS_THROUGH);
  },

  nodeSettings (_compiler: Compiler, node: SyntaxNode): Report<Record<string, any>> | Report<PassThrough> {
    if (isElementNode(node, ElementKind.OptionSet)) {
      return new Report({});
    }
    return Report.create(PASS_THROUGH);
  },
};
