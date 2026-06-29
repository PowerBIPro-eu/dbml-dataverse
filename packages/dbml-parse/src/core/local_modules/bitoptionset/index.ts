import type Compiler from '@/compiler';
import { ElementKind } from '@/core/types/keywords';
import { PASS_THROUGH, type PassThrough } from '@/core/types/module';
import type { SyntaxNode } from '@/core/types/nodes';
import Report from '@/core/types/report';
import { isElementNode } from '@/core/utils/validate';
import { type LocalModule } from '../types';
import BitOptionSetValidator from './validate';

export const bitOptionSetModule: LocalModule = {
  validateNode (compiler: Compiler, node: SyntaxNode): Report<void> | Report<PassThrough> {
    if (isElementNode(node, ElementKind.BitOptionSet)) {
      return Report.create(undefined, new BitOptionSetValidator(compiler, node).validate());
    }
    return Report.create(PASS_THROUGH);
  },

  nodeFullname (_compiler: Compiler, node: SyntaxNode): Report<string[] | undefined> | Report<PassThrough> {
    if (isElementNode(node, ElementKind.BitOptionSet)) {
      return new Report(undefined);
    }
    return Report.create(PASS_THROUGH);
  },

  nodeAlias (_compiler: Compiler, node: SyntaxNode): Report<string | undefined> | Report<PassThrough> {
    if (isElementNode(node, ElementKind.BitOptionSet)) {
      return new Report(undefined);
    }
    return Report.create(PASS_THROUGH);
  },

  nodeSettings (_compiler: Compiler, node: SyntaxNode): Report<Record<string, any>> | Report<PassThrough> {
    if (isElementNode(node, ElementKind.BitOptionSet)) {
      return new Report({});
    }
    return Report.create(PASS_THROUGH);
  },
};
