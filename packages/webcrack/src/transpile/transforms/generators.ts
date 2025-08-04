import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import * as m from '@codemod/matchers';
import { type Transform } from '../../ast-utils';

const generatorCases = m.capture();
const generatorIdentifier = m.capture(); // NOTE: check if binding is tslib.__generator (but changes depending on ts version...)
const generatorContext = m.capture(m.identifier());
const generatorContextLabel = m.memberExpression(
  m.fromCapture(generatorContext),
  m.identifier('label'),
);
const generator = m.callExpression(generatorIdentifier, [
  m.thisExpression(),
  m.functionExpression(
    null,
    [generatorContext],
    m.blockStatement([
      m.switchStatement(generatorContextLabel, generatorCases),
    ]),
    false,
    false,
  ),
]);
const generatorJumpNext = m.capture();
const generatorJump = m.expressionStatement(
  m.assignmentExpression(
    '=',
    generatorContextLabel,
    m.numericLiteral(generatorJumpNext),
  ),
);
const generatorSent = m.callExpression(
  m.memberExpression(m.fromCapture(generatorContext), m.identifier('sent')),
  [],
);
// Generator.trys.push([TryScope, CatchScope, FinallyScope, NextScope])
const generatorTryJump = m.capture(
  // NOTE: also expected
  m.arrayExpression([
    m.or(m.numericLiteral(), null),
    m.or(m.numericLiteral(), null),
    m.or(m.numericLiteral(), null),
    m.or(m.numericLiteral(), null),
  ]),
);
const generatorTry = m.expressionStatement(
  m.callExpression(
    m.memberExpression(
      m.memberExpression(m.fromCapture(generatorContext), m.identifier('trys')),
      m.identifier('push'),
    ),
    [generatorTryJump],
  ),
);
const generatorTryCatchErrorIdentifier = m.capture();
const generatorTryCatchError = m.expressionStatement(
  m.assignmentExpression('=', generatorTryCatchErrorIdentifier, generatorSent),
);
const generatorSwitchTempDiscriminantIdentifier = m.capture(m.identifier());
const generatorSwitch = m.switchStatement(
  generatorSwitchTempDiscriminantIdentifier,
  m.arrayOf(
    m.switchCase(m.anyExpression(), [
      m.returnStatement(
        m.arrayExpression([m.numericLiteral(3), m.numericLiteral()]),
      ),
    ]),
  ),
);
const generatorSwitchDiscriminant = m.capture();
const generatorSwitchTempDiscriminant = m.expressionStatement(
  m.assignmentExpression(
    '=',
    m.fromCapture(generatorSwitchTempDiscriminantIdentifier),
    generatorSwitchDiscriminant,
  ),
);
const loopTestParam = m.ifStatement(
  m.unaryExpression('!', m.anything()),
  m.blockStatement([m.breakStatement()]),
);

type Next = NodePath<t.ReturnStatement | t.ExpressionStatement>;
type Edge = {
  /** Origin state machine label number */
  from: number;
  /** Target state machine label number */
  to: number;
  /** AST path containing the transition */
  path: Next;
  /** True if transition is directly in case block, false if nested */
  isDirect: boolean;
};

function remove(array: any[], elem: any) {
  const i = array.indexOf(elem);
  if (i === -1) return false;
  array.splice(i, 1)[0].block.remove();
  return true;
}

/**
 * Represents a generator state machine block context.
 * Handles transformation of TypeScript/TSlib generator code into native generators.
 * Each context corresponds to a case block in the original state machine switch.
 */
class Context {
  label: number;
  block: NodePath<t.SwitchCase>;
  graph: Context[];
  children: Edge[] = [];
  parents: Edge[] = [];
  yieldPath: Next | null = null;
  yieldReplacement: t.ExpressionStatement | null = null;
  type: string = 'Normal';
  parameters: { [key: string]: any } = {};

  constructor(block: NodePath<t.SwitchCase>, graph: Context[]) {
    this.label = block.node.test.value; // NOTE: assumption
    this.block = block;
    this.graph = graph;
  }
  setOutgoingEdges() {
    this.block.traverse({
      'Function|ExpressionStatement|Expression': (
        inner: NodePath<t.Function | t.ExpressionStatement | t.Expression>,
      ) => inner.skip(),
      ReturnStatement: (path: Next) => {
        const isDirect = path.parent === this.block.node;
        const [{ value: mode }, value = null] = path.node.argument.elements; // NOTE: assumption
        switch (mode) {
          case 0:
          case 1: // SENT
          case 6: // NORMAL
          case 7: // ENDFINALLY
            throw new Error(
              "Generator modes: 0, 1, 6, 7 aren't yet supported...",
            );
          case 2: // RETURN
            // NOTE: directly simplified
            path.node.argument = value; // NOTE: no clone, path.replaceWith
            break;
          case 3: // BREAK
            this.children.push({
              from: this.label,
              to: value.value,
              path,
              isDirect,
            });
            break;
          case 4: // YIELD
          case 5: // YIELD*
            /* NOTE: assumption
            if (
              mode == 4 ||
              t.isCallExpression(value) &&
              value.arguments.length == 1 &&
              isValuesHelper(value.callee)
            )
            */
            // NOTE: not sure if it's possible to have more than 1 yield per block?
            if (this.yieldPath)
              throw new Error('Generator: impossible multiple yields');
            this.yieldPath = path;
            this.yieldReplacement = t.expressionStatement(
              t.yieldExpression(
                mode == 4 ? value : value.arguments[0],
                mode == 5,
              ),
            );
            break;
        }
      },
    });
    for (const statement of this.block.get('consequent')) {
      // NOTE: could additionally check for "Generator.trys.push([...])"
      if (generatorJump.match(statement.node))
        // BREAK (more like a continue/jump but it's whatever)
        this.children.push({
          from: this.label,
          to: generatorJumpNext.current,
          path: statement,
          isDirect: true,
        });
    }
  }
  setIncomingEdges() {
    for (const edge of this.children)
      this.graph.find((c) => c.label == edge.to).parents.push(edge);
  }
  /**
   * Processes and flattens yield statements in the current context.
   * Merges the following block's statements into the current block
   * and updates control flow accordingly.
   */
  simplifyOutputs(index: number) {
    if (!this.yieldPath) return;
    const [{ block, children }] = this.graph.splice(index + 1, 1);
    /* NOTE: assumption
    if (parents.length)
      throw new Error('Yield block has parents');
    */
    block.traverse({
      // NOTE: This can be optimized
      // NOTE: assuming block isn't empty
      CallExpression: (sentPath: NodePath<t.CallExpression>) => {
        if (!generatorSent.match(sentPath.node)) return;
        sentPath.replaceWith(this.yieldReplacement);
        sentPath.stop();
      },
    });
    // Merge Contexts
    this.yieldPath.replaceWithMultiple(block.node.consequent);
    // path.container.splice(path.key, 1, ...block.node.consequent);
    for (const edge of children) {
      edge.from = this.label;
      this.children.push(edge);
    }
    block.remove();
  }
  static resolves: Function[] = [
    // NOTE: mb they need to run like this: for (const resolve of resolves) for (const context of graph) resolve(context)
    function LOOP(index: number, context: Context) {
      return false;
      /*
      case <label>:
        ...
      */
      // NOTE: could directly loop for the loop update (since it must have 1 child leading to the loop test) but it's probably inconsistent
      const foundLoop = context.parents.find(
        (parent) => parent.label > context.label,
      );
      if (!foundLoop) return false;
      const body = context.block.node.consequent;
      context.block.node.consequent = [
        t.whileStatement(t.booleanLiteral(true), t.blockStatement(body)),
      ];
      return true;
    },
    function IF(index: number, context: Context) {
      return;
      // FIXME: Freak IF == IFELSE its just that the break location is like idk how to say but shifted ig
      /*
      case <label>:
        ...
        if (!...) <BREAK>
        ...
        <BREAK>
      */
      if (context.children.length < 2) return false;
      // IF -> childs match -> [..., { label: X, isDirect: false }, { label: X, isDirect: true }];
      const next = context.children.pop(),
        branch = context.children.pop(); // NOTE: could destruct next and assume isDirect to be true
      const { node: ifParent, key } = branch.path.parentPath.parentPath;
      if (
        next.label != branch.label ||
        !t.isIfStatement(ifParent) ||
        !t.isUnaryExpression(ifParent.test, { operator: '!' }) ||
        !next.isDirect
      ) {
        context.children.push(branch, next);
        return false;
      }
      console.log('IF', index, context.graph);
      const { block, children } = context.graph.find(
        (c) => c.label == next.label,
      ); // NOTE: actually this should be the direct next Context aka graph[i + 1]
      /* NOTE: assumption
      if (!nextContext)
        throw new Error('Invalid Generator: missing next context');
      */
      // reverse
      const body = context.block.node.consequent;
      ifParent.consequent = t.blockStatement(
        body.splice(key + 1, body.length - key - 2),
      );
      ifParent.test = ifParent.test.argument;
      next.path.replaceWithMultiple(block.node.consequent);
      // merge
      context.children.push(...children);
      // NOTE: context is annoying... all that just to remove the next Context...
      let i = 0;
      for (const c of context.graph) {
        if (c.label == next.label) {
          context.graph.splice(i, 1);
          return true;
        }
        i++;
      }
    },
    function IFELSE(index: number, context: Context) {
      const graph = context.graph;
      if (index < 2 || context.parents.length < 2) return false;

      let lastLabel = null;
      let current: t.Statement | null = null;
      while (context.parents.length) {
        const edge = context.parents.pop();

        // NOTE: this should be the previous Context aka graph[i - 1]
        let parentIndex = 0;
        const parent = graph.find((c) => c.label == edge.from);

        if (current) {
          const edgeNext = parent.children.pop(),
            edgeBranch = parent.children.pop();
          const { node: ifParent } = edgeBranch.path.parentPath.parentPath;
          if (
            edgeNext.to == context.label &&
            (edgeBranch.to == lastLabel || !lastLabel) &&
            t.isIfStatement(ifParent) &&
            t.isUnaryExpression(ifParent.test, { operator: '!' }) &&
            edgeNext.isDirect
          ) {
            lastLabel = parent.label;
            const body = parent.block.node.consequent;
            body.pop();
            const key = body.indexOf(ifParent);
            ifParent.consequent = t.blockStatement(body.splice(key + 1));
            ifParent.test = ifParent.test.argument;
            ifParent.alternate = current;
            if (!parent.parents.length) {
              // this shit isn't updated in the current traversal so not consistent
              // merge current and context
              for (const edge of context.children) {
                edge.from = parent.label;
                parent.children.push(edge);
              }
              console.log(context);
              body.push(...context.block.node.consequent);
              remove(graph, context);
              return true;
            }
            current = ifParent;
          } else {
            // idk
          }
        } else {
          lastLabel = parent.label;
          const body = parent.block.node.consequent;
          body.pop();
          current = t.blockStatement(body);
        }
        remove(graph, parent);
      }
    },
  ];
  tryToResolve(index: number) {
    return;
    if (isDirect) {
      /*
      case <label>:
        <BREAK>
      */
    } else if (t.isSwitchCase(path.parent)) {
      /*
      case <label>:
        switch (...) {
          case ...: <BREAK>
          ...
        }
      */
    } else if (t.isIfStatement(path.parent)) {
      if (t.isSwitchCase(path.parentPath.parent)) {
        /*
        case <label>:
          if (...) <BREAK>
        */
      } else {
        /*
        case <label>:
          if (...) ... if (...) <BREAK>
        */
        /* NOTE: <BREAK> must be `break <label?>`
        
        This is a bit tricky to explain but basically nested `ifStatement` can only contain <RETURN>
          normally unless we are inside a loop then it can contain a <BREAK>
          but then it must be a `break <label?>`.
        If it was a <BREAK> to some other code,
          the nested `ifStatement` would have gotten flattened.
        Hence we can replace it by a `breakStatement(label?)`
          optionally labeled if the <BREAK> location isn't the direct Loop/Switch parent.
        */
        path.replaceWith(t.breakStatement(/* FIXME: labeled breaks */));
      }
    } else {
      throw new Error(`Invalid parent for BREAK ${this.label} -> ${label}`);
    }
  }
}

export default {
  name: 'generators',
  tags: ['safe'],
  scope: true,
  visitor() {
    return {
      ReturnStatement: {
        exit(path) {
          if (
            !generator.match(path.node.argument) ||
            !generatorCases.current!.every((c, value) =>
              t.isNumericLiteral(c.test, { value }),
            )
          )
            return;

          const func = path.parentPath.parent;
          if (!t.isFunctionExpression(func) && !t.isFunctionDeclaration(func)) {
            // throw new Error('Generator isn't a function');
            return;
          }
          func.generator = true;

          const blocks = path.get('argument.arguments.1.body.body.0.cases');
          const graph: Context[] = [];
          for (const block of blocks) graph.push(new Context(block, graph));
          for (const context of graph) context.setOutgoingEdges();

          /* Reverse loop prevents errors like these from happening:

          case 0:                             case 0:
            return [4, 5];                      yield 5;
          case 1:                ----->         return [4, 6];
            _a.sent();                        case 1:
            return [4, 6];                      yield 5;
                                                yield 6;
          */
          for (let i = graph.length - 1; i >= 0; i--)
            graph[i].simplifyOutputs(i);

          for (const context of graph) context.setIncomingEdges();

          let i = 0;
          while (true) {
            // NOTE: this is kind of a mess
            const context = graph[i];
            if (context) {
              for (const resolve of Context.resolves)
                if (resolve(i, context)) break;
            } else break;
            i = graph.indexOf(context) + 1;
          }

          // path.replaceWithMultiple(graph[0].block.node.consequent);
          console.log(graph);
          this.changes++;
        },
      },
    };
  },
} satisfies Transform;
