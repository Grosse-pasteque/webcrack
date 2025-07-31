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
  /** Target state machine label number */
  label: number;
  /** AST path containing the transition */
  path: Next;
  /** True if transition is directly in case block, false if nested */
  isDirect: boolean;
};

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
  yields: { path: Next; replacement: t.ExpressionStatement }[] = [];
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
            this.children.push({ label: value.value, path, isDirect });
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
            this.yields.push({
              path,
              replacement: t.expressionStatement(
                t.yieldExpression(
                  mode == 4 ? value : value.arguments[0],
                  mode == 5,
                ),
              ),
            });
            break;
        }
      },
    });
    for (const statement of this.block.get('consequent')) {
      // NOTE: could additionally check for "Generator.trys.push([...])"
      if (generatorJump.match(statement.node))
        // BREAK (more like a continue/jump but it's whatever)
        this.children.push({
          label: generatorJumpNext.current,
          path: statement,
          isDirect: true,
        });
    }
  }
  setIncomingEdges() {
    for (const { label, path, isDirect } of this.children)
      this.graph
        .find((g) => g.label == label)
        .parents.push({ label: this.label, path, isDirect });
  }
  /**
   * Processes and flattens yield statements in the current context.
   * Merges the following block's statements into the current block
   * and updates control flow accordingly.
   */
  simplifyOutputs(index: number) {
    // NOTE: maybe simplify at the end to prevent errors?
    const next = index + 1;
    while (this.yields.length) {
      const { path, replacement } = this.yields.shift();
      const { block, yields, children } = this.graph[next];
      /* NOTE: assumption
      if (parents.length)
        throw new Error('Yield block has parents');
      */
      block.traverse({
        // NOTE: This can be optimized
        // NOTE: assuming consequent not empty
        CallExpression(sentPath: NodePath<t.CallExpression>) {
          if (!generatorSent.match(sentPath.node)) return;
          sentPath.replaceWith(replacement);
          sentPath.stop();
        },
      });
      // Merge Contexts
      path.replaceWithMultiple(block.node.consequent);
      this.yields.push(...yields);
      this.children.push(...children);
      this.graph.splice(next, 1); // NOTE: maybe delete graph[label] but that would require a more complex Graph like a class or idk?
    }
  }
  tryToResolve() {
    const parentCount = this.parents.length;
    const childCount = this.children.length;

    const foundLoop = this.parents.find((parent) => parent.label > this.label);
    if (foundLoop) {
      /*
      case <label>:
        ...
      */
      const body = this.block.node.consequent;
      this.block.node.consequent = [
        t.whileStatement(t.booleanLiteral(true), t.blockStatement(body)),
      ];
    } else if (
      childCount == 2 &&
      this.children[0].label == this.children[1].label
    ) {
      // IF
      /*
      case <label>:
        if (!...) <BREAK>
        ...
        <BREAK>
      */
      // TODO: reverse & merge
      /*
        function test() {
          return __generator(this, function (_b) {
            switch (_b.label) {
              case 0:
                if (!a) return [3, 2];
                return [4, 0];
              case 1:
                _b.sent();
                _b.label = 2;
              case 2: return [4, 1];
              case 3:
                _b.sent();
                return [4, 2];
              case 4:
                _b.sent();
                return [4, 3];
              case 5:
                _b.sent();
                return [2];
            }
          });
        }
      */
      const branch = this.children.shift(),
        next = this.children.shift(); // NOTE: could destruct next and assume isDirect to be true
      console.log(branch);
      const { block, children } = this.graph.find(
        (c) => c.label === next.label,
      ); // NOTE: actually this should be the direct next Context aka graph[i + 1]
      /* NOTE: assumption
      if (!nextContext)
        throw new Error('Invalid Generator: missing next context');
      */
      const ifParent = branch.path.parentPath.parent;
      if (
        t.isIfStatement(ifParent) &&
        t.isUnaryExpression(ifParent.test, { operator: '!' }) &&
        next.isDirect
      ) {
        // reverse
        const body = this.block.node.consequent;
        ifParent.consequent = t.blockStatement(body.splice(1, body.length - 2));
        ifParent.test = ifParent.test.argument;
        next.path.replaceWithMultiple(block.node.consequent);
        // merge
        this.children.push(...children);
        // NOTE: this is annoying... all that just to remove the next Context...
        let i = 0;
        for (const c of this.graph) {
          if (c.label == next.label) {
            this.graph.splice(i, 1);
            break;
          }
          i++;
        }
      }
      // ELSE ????
    } else if (parentCount >= 2) {
      // IFELSE
      // FIXIT: Not necessarily unique parents
      console.log(
        'IFELSE',
        this.label,
        this.parents.map((e) => this.graph.find((g) => g.label == e.label)),
      );
    }
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
          let i = 0;
          for (const context of graph) context.simplifyOutputs(i++);
          for (const context of graph) context.setIncomingEdges();
          for (const context of graph) context.tryToResolve();

          const entry = graph[0];
          entry.build(); // entry can never be empty
          console.log(graph.filter(Boolean));
          this.changes++;
        },
      },
    };
  },
} satisfies Transform;
