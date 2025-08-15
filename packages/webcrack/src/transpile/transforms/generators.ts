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
const generatorYieldMode = m.capture();
const generatorYieldValue = m.capture();
const generatorYield = m.returnStatement(
  m.arrayExpression([
    m.numericLiteral(generatorYieldMode),
    generatorYieldValue,
  ]),
);
const generatorReturnMode = m.capture();
const generatorReturnValue = m.capture();
const generatorReturn = m.returnStatement(
  m.arrayExpression([
    m.numericLiteral(generatorReturnMode),
    generatorReturnValue,
  ]),
);
const generatorBreakTo = m.capture();
const generatorBreakTest = m.capture();
const generatorBreak = m.returnStatement(
  m.arrayExpression([m.numericLiteral(3), m.numericLiteral(generatorBreakTo)]),
);
const generatorIfBreak = m.ifStatement(
  m.unaryExpression('!', generatorBreakTest),
  m.blockStatement([generatorBreak]),
  null,
);

function replace(node, matcher, replacer, once = false, ignore = () => false) {
  let replaced = 0;

  function visit(n) {
    if (ignore(n) || (once && replaced)) return n;
    if (matcher(n)) {
      replaced++;
      return replacer(n);
    }
    for (const key in n) {
      const child = n[key];
      if (Array.isArray(child)) {
        n[key] = child.map((c) => (t.isNode(c) ? visit(c) : c));
      } else if (t.isNode(child)) {
        n[key] = visit(child);
      }
    }
    return n;
  }
  visit(node); // NOTE: won't work if node is directly the node that needs to be replaced.
  return replaced;
}

type Edge = {
  /** Origin state machine label number */
  from: number;
  /** Target state machine label number */
  to: number;
  /** AST path containing the transition */
  node: t.Node;
  /** Position of the node inside it's body */
  location: number;
  /** True if transition is directly in case block, false if nested */
  isDirect: boolean;
};

function remove(array: any[], elem: any) {
  const i = array.indexOf(elem);
  if (i === -1) return false;
  // array.splice(i, 1); // [0].block.remove();
  delete array[i];
  return true;
}

/**
 * Represents a generator state machine block context.
 * Handles transformation of TypeScript/TSlib generator code into native generators.
 * Each context corresponds to a case block in the original state machine switch.
 */
class Context {
  label: number;
  body: t.Statement[];
  graph: Context[];
  children: Edge[] = [];
  parents: Edge[] = [];

  constructor(block: NodePath<t.SwitchCase>, graph: Context[]) {
    this.label = block.node.test.value; // NOTE: assumption
    this.body = block.node.consequent.map((n) => t.cloneNode(n));
    this.graph = graph;
  }
  /**
   * Merges yields and their context
   * Sets children
   */
  simplify() {
    /* FIXME: Can't really traverse anymore but it's not so bad, the cases we can't handle are:
    - loop breaks:      if (...) ... if (...) BREAK|CONTINUE
    - returns:          ... RETURN

    but they can be handled with a cleanup function (which also takes loops/switches locations)
    */
    let next = this.label + 1;
    const newBody = [];
    let location = 0;
    while (true) {
      const node = this.body.shift();
      if (!node) {
        this.body = newBody;
        break;
      }
      let isDirect = true;
      if (
        generatorBreak.match(node) ||
        ((isDirect = false), generatorIfBreak.match(node))
      ) {
        // BREAK
        this.children.push({
          from: this.label,
          to: generatorBreakTo.current,
          node,
          location, // NOTE: does this gets affected when we modify the body, it shouldn't tho
          isDirect,
        });
        location = newBody.push(node);
      } else if (!this.body.length) {
        if (generatorJump.match(node)) {
          // BREAK
          if (generatorJumpNext.current != next)
            throw new Error('Generator: impossible JUMP');
          this.children.push({
            from: this.label,
            to: generatorJumpNext.current,
            node,
            location: -1,
            isDirect: true,
          });
          location = newBody.push(node);
        } else if (
          // YIELD
          generatorYield.match(node) &&
          (generatorYieldMode.current == 4 || generatorYieldMode.current == 5)
        ) {
          /* FIXME: 
            Actually I think we can instant merge now
              which raises a problem actually,
              since we can't traverse,
              we can't find the `.send()` inside the next sibling expression statement
              which means we can't accuratly replace it.
            Maybe attach the replacement as metadata to the expression and replace it on cleanup?
            Yeh but what's the point since it's not a path ? Why not just push a yieldExpression
              then locate every yieldExpression inside the cleanup and replace?
            So let's implement our custom replace traverse.
          */
          const { body } = this.graph[next];
          delete this.graph[next++];
          const firstStatement = body.shift();
          const replacement = t.yieldExpression(
            generatorYieldMode.current == 4
              ? generatorYieldValue.current
              : generatorYieldValue.current.arguments[0],
            generatorYieldMode.current == 5,
          );
          if (
            !replace(
              firstStatement,
              (n) => generatorSent.match(n),
              () => replacement,
              true,
              (n) => t.isFunction(n),
              // (n) => t.isDeclaration(n) || t.isExpressionStatement(n),
            )
          )
            throw new Error('Generator: YIELD not found');
          location = newBody.push(firstStatement);
          this.body.push(...body);
          // } else if (generatorReturn.match(node)) {
          //  throw new Error("Generator modes: 0, 1 (SENT), 6 (NORMAL), 7 (ENDFINALLY) aren't yet supported...");
          continue;
        } else {
          // TODO: replace returns?
          location = newBody.push(node);
          // throw new Error('Generator: unknown last statement');
        }
        this.body = newBody;
        break;
      }
    }
  }
  setParents() {
    for (const edge of this.children) {
      this.graph.find((c) => c?.label == edge.to).parents.push(edge);
    }
  }
  static resolves: Function[] = [
    // NOTE: mb they need to run like this: for (const resolve of resolves) for (const context of graph) if (context) resolve(context)
    function SWITCH(context: Context) {
      if (context.children.length < 2) return false;
      /*
      case <label>:
        switch (...) {
          case ...: <BREAK>
          ...
        }
      */
      return false;
    },
    function IF(context: Context) {
      if (context.children.length < 2) return false;
      /*
      case <label>:
        ...
        if (!...) <BREAK>
        ...
        <BREAK>
      */
      // IF -> childs match -> [..., { label: X, isDirect: false }, { label: X, isDirect: true }];
      const next = context.children.pop(),
        branch = context.children.pop(); // NOTE: could destruct next and assume isDirect to be true
      if (next.to != branch.to || !next.isDirect || branch.isDirect || context.graph.find(c => c?.label == branch.to)?.parents?.length != 2) {
        context.children.push(branch, next);
        return false;
      }
      console.log('IF', context.label);
      const { body, children } = context.graph.find((c) => c?.label == next.to);
      /* NOTE: assumption
      if (!nextContext)
        throw new Error('Invalid Generator: missing next context');
      */
      // reverse
      context.body.pop(); // next.path.remove();
      const key = context.body.indexOf(branch.node);
      branch.node.consequent.body = context.body.splice(key + 1);
      branch.node.test = branch.node.test.argument;
      // merge
      context.body.push(...body); // next.path.replaceWithMultiple(block.node.consequent);
      context.children.push(...children);
      // NOTE: context is annoying... all that just to remove the next Context...
      let i = 0;
      for (const c of context.graph) {
        if (c?.label == next.to) {
          delete context.graph[i];
          return true;
        }
        i++;
      }
    },
    function IFELSE(context: Context) {
      if (context.parents.length < 2) return false;

      console.log('IFELSE', context.label);
      const graph = context.graph;
      let lastLabel = context.label;
      let current: t.Statement | null = null;
      while (context.parents.length) {
        const edge = context.parents.pop(); // FIXME: removing edges is not bidirectional (parents/children)

        // NOTE: this should be the previous Context aka graph[i - 1]
        const parent = graph.find((c) => c?.label == edge.from);

        if (current || parent.children.length == 2) {
          const next = parent.children.pop(),
            branch = parent.children.pop();
          if (
            next.to == context.label &&
            branch.to == lastLabel &&
            !branch.isDirect &&
            next.isDirect
          ) {
            lastLabel = parent.label;
            parent.body.pop();
            const key = parent.body.indexOf(branch.node);
            branch.node.consequent.body = parent.body.splice(key + 1);
            branch.node.test = branch.node.test.argument;
            if (current)
              branch.node.alternate = current;
            else if (context.parents.pop().from != edge.from) // Fixes case where not ELSE
              throw new Error('Generator: impossible IFELSE structure');
            if (!parent.parents.length) {
              // this shit isn't updated in the current traversal so not consistent
              // merge current and context
              for (const edge of context.children) {
                edge.from = parent.label;
                parent.children.push(edge);
              }
              parent.body.push(...context.body);
              remove(graph, context);
              return true;
            }
            current = branch.node;
          } else {
            // idk
          }
        } else {
          lastLabel = parent.label;
          parent.body.pop();
          current = t.blockStatement(parent.body);
        }
        remove(graph, parent);
      }
    },
    function TRY(context: Context) {
      const first = context.body.shift();
      if (!generatorTry.match(first)) {
        context.body.unshift(first);
        return false;
      }
      const [blockLabel, handlerLabel, finalizerLabel, nextLabel] =
        generatorTryJump.current.elements.map((n) => n?.value);
      if (blockLabel !== label)
        throw new Error(
          `Invalid TRY blockLabel: ${blockLabel} !== ${label}`,
        );
      if (!handlerLabel && !finalizerLabel)
        throw new Error('Invalid TRY: missing handler or finalizer');
      body.push(
        t.tryStatement(
          t.blockStatement(
            build(
              label,
              lines,
              blocks,
              breakableLocations,
              nextLabel,
              isBreakable,
              casesLabels,
              isDefault,
            ),
          ),
          handlerLabel
            ? t.catchClause(
                null,
                t.blockStatement(
                  build(
                    handlerLabel,
                    blocks[handlerLabel],
                    blocks,
                    breakableLocations,
                    nextLabel,
                    isBreakable,
                    casesLabels,
                    isDefault,
                  ),
                ),
              )
            : null,
          finalizerLabel
            ? t.blockStatement(
                build(
                  finalizerLabel,
                  blocks[finalizerLabel],
                  blocks,
                  breakableLocations,
                  nextLabel,
                  isBreakable,
                  casesLabels,
                  isDefault,
                ),
              )
            : null,
        ),
      );
      label = nextLabel;
      lines = blocks[nextLabel];
      return true;
    },
    function LOOP(context: Context) {
      /* FIXME: Need to run LOOP after everything not to mess up bodies.
                But then IF are ran first and they completly mess up control flow.
                So either:
                + a parent ref attr to edges and make edges synced with each others
                + something like a PRELOOP resolver that finds loops and replaces break/continue
                + run LOOP resolver first and implement the WhileStatement after everything throught a callback
                + I think a cleaner way would be something like DETECTLOOP first then last LOOP
          NOTE: I think it raises another issue tho,
                now it would be better to run IF IFELSE as phases like now and LOOP, SWITCH, TRY
                but like for (const context of graph) for (const resolve of [LOOP, SWITCH, TRY]) resolve(context);
      /*
      case <label>:
        ...
      */
      // NOTE: could directly loop for the loop update (since it must have 1 child leading to the loop test) but it's probably inconsistent
      const loopEdge = context.parents.find(
        e => e.from > context.label,
      );
      if (!loopEdge) return false;
      console.log('LOOP');
      const loop = context.graph.find(c => c?.label == loopEdge.from);
      context.body = [
        t.whileStatement(
          t.booleanLiteral(true),
          t.blockStatement(context.body),
        ),
      ];
      return true;
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
    } else if (t.isIfStatement(path.parent)) {
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
          console.log(graph);
          // NOTE: when only 1 Context left -> done
          for (const context of graph) context?.simplify();
          for (const context of graph) context?.setParents();
          for (const resolve of Context.resolves)
            for (const context of graph) if (context) resolve(context);

          // let i: number;
          // for (const resolve of Context.resolves) {
          //   i = 0;
          //   for (const context of graph) if (resolve(i, context)) break;
          // }

          // for (const resolve of Context.resolves) {
          //   let i = 0;
          //   while (true) {
          //     // NOTE: this is kind of a mess
          //     const context = graph[i];
          //     if (!context) break;
          //     let changed = resolve(i, context);
          //     i = graph.indexOf(context);
          //     if (!changed) i++;
          //   }
          // }

          path.replaceWithMultiple(graph[0].body);
          console.log(graph);
          // console.log(JSON.stringify(graph[0]));
          this.changes++;
        },
      },
    };
  },
} satisfies Transform;
