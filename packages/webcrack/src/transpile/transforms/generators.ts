import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import * as m from '@codemod/matchers';
import {
  getNextPathSibling,
  getPreviousPathSibling,
  type Transform,
} from '../../ast-utils';

export default {
  name: 'generators',
  tags: ['safe'],
  scope: true,
  visitor() {
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
    /*
        const generatorNextMode = m.capture();
        const generatorNextValue = m.capture();
        const generatorNextReturn = m.capture(m.or(m.arrayExpression([
            m.numericLiteral(generatorNextMode),
            generatorNextValue
        ]), m.arrayExpression([
            m.numericLiteral(generatorNextMode)
        ])));
        */
    const generatorNextReturn = m.capture(
      // NOTE: not mandatory -> this structure is expected if we are inside __generator
      m.or(
        m.arrayExpression([m.numericLiteral(), m.anyExpression()]),
        m.arrayExpression([m.numericLiteral()]),
      ),
    );
    const generatorNext = m.capture(m.returnStatement(generatorNextReturn));
    const generatorBranchTest = m.capture();
    const generatorBranch = m.ifStatement(
      generatorBranchTest,
      m.or(generatorNext, m.blockStatement([generatorNext])),
      null,
    );

    const generatorSent = m.callExpression(
      m.memberExpression(m.fromCapture(generatorContext), m.identifier('sent')),
      [],
    );
    // Generator.trys.push([TryScope, CatchScope, FinallyScope, NextScope])
    const generatorTryJump = m.capture(
      // NOTE: also expected
      m.arrayExpression([
        m.or(m.numericLiteral(), null as any),
        m.or(m.numericLiteral(), null as any),
        m.or(m.numericLiteral(), null as any),
        m.or(m.numericLiteral(), null as any),
      ]),
    );
    const generatorTry = m.expressionStatement(
      m.callExpression(
        m.memberExpression(
          m.memberExpression(
            m.fromCapture(generatorContext),
            m.identifier('trys'),
          ),
          m.identifier('push'),
        ),
        [generatorTryJump],
      ),
    );
    const generatorTryCatchErrorIdentifier = m.capture();
    const generatorTryCatchError = m.expressionStatement(
      m.assignmentExpression(
        '=',
        generatorTryCatchErrorIdentifier,
        generatorSent,
      ),
    );
    const loopTestParam = m.ifStatement(
      m.unaryExpression('!', m.anything()),
      m.blockStatement([m.breakStatement()]),
    );

    function resolveLoops(cases: any[][], breakableLocations: obejct) {
      for (let label = 0; label < cases.length; label++) {
        const body = [];
        const lines = cases[label];
        while (lines.length) {
          const line = lines.shift();
          let nextLabel;
          if (generatorNext.match(line)) {
            const [{ value: mode }, { value: nextLabel = null } = {}] =
              generatorNextReturn.current!.elements;
            if (mode === 3 && nextLabel < label) {
              const loop = (breakableLocations[label] = t.whileStatement(
                t.booleanLiteral(true),
                t.blockStatement([
                  ...build(
                    nextLabel,
                    cases[nextLabel],
                    cases,
                    breakableLocations,
                    label + 1, // breakOnLabel
                    true, // isBreakable
                  ),
                  ...build(
                    label,
                    body,
                    cases,
                    breakableLocations,
                    label + 1, // NOTE: doesnt really matter: breakOnLabel
                    true, // isBreakable
                  ),
                ]),
              ));
              cases[nextLabel] = [
                loop,
                t.returnStatement(
                  t.arrayExpression([
                    // resolved by build
                    t.numericLiteral(3),
                    t.numericLiteral(label + 1),
                  ]),
                ),
              ];
              continue;
            }
          }
          body.push(line);
        }
        cases[label] = body;
      }
    }
    // too messy to be able to figure out any issues
    function resolveSwitchs(cases: any[][], breakableLocations: object) {
      for (let label = cases.length - 1; label >= 0; label--) {
        // for (let label = 0; label < cases.length; label++) {
        const body = [];
        const lines = cases[label];
        while (lines.length) {
          const line = lines.shift();
          let nextLabel;
          if (t.isSwitchStatement(line)) {
            // NOTE: may cause issues cuz can't be sure that it's a switch statement with yields
            // can also chose a pattern since it's consistent
            let isDefault = { value: false };
            const supposedDefault = lines.shift();
            if (!generatorNext.match(supposedDefault))
              throw new Error('Invalid switch statement');
            const [{ value: mode }, { value: nextLabel = null } = {}] =
              generatorNextReturn.current!.elements;
            if (mode !== 3 || nextLabel < label)
              throw new Error('Invalid switch statement');
            const casesLabels: number[] = [];
            for (const c of line.cases) {
              if (
                c.consequent.length == 1 &&
                generatorNext.match(c.consequent[0])
              ) {
                const [{ value: mode }, { value: nextLabel = null } = {}] =
                  generatorNextReturn.current!.elements;
                if (mode !== 3 || nextLabel < label)
                  throw new Error('Invalid switch statement');
                casesLabels.push(nextLabel);
              }
            }
            if (casesLabels.length == line.cases.length) {
              casesLabels.forEach((label, i) => {
                line.cases[i].consequent = build(
                  label,
                  cases[label],
                  cases,
                  breakableLocations,
                  nextLabel,
                  false,
                  casesLabels, // need callback to know if jumped to default
                  isDefault,
                );
              });
              if (isDefault.value) {
                line.cases.push(
                  t.switchCase(
                    null,
                    build(
                      nextLabel,
                      cases[nextLabel],
                      cases,
                      breakableLocations,
                      isDefault.label,
                    ),
                  ),
                );
              }
              breakableLocations[label] = line;
              body.push(line);
              isDefault.label &&
                body.push(
                  t.returnStatement(
                    t.arrayExpression([
                      // resolved by build
                      t.numericLiteral(3),
                      t.numericLiteral(isDefault.label),
                    ]),
                  ),
                );
            }
          } else {
            body.push(line);
          }
        }
        cases[label] = body;
      }
    }
    // TODO: use a Context(label, lines, ..., type: LOOP | SWITCH | ..., parent: Context) ...
    function build(
      label: number,
      lines: any[],
      cases: any[][],
      breakableLocations: object, // { number: Node }
      breakOnLabel: number | null = null,
      isBreakable: boolean = false,
      casesLabels: number[] | null = null, // breaks on JUMP >= breakOnLabel && ignores
      isDefault = null,
    ): any[] {
      // lines = [...lines];
      if (!lines || !Array.isArray(lines)) throw new Error('Invalid input');
      let body = [];
      while (lines.length) {
        const line = lines.shift(); // NOTE: dumps all lines of each parsed cases!!
        // if (t.isWhileStatement(line))
        //     line = line.body;
        if (generatorJump.match(line)) {
          // CONTINUE
          // IGNORED
          if (generatorJumpNext.current !== label + 1)
            throw new Error(
              `Invalid CONTINUE jump: ${label + 1} !== ${generatorJumpNext.current}`,
            );
          if (lines.length)
            throw new Error(
              `Invalid CONTINUE jump: found ${lines.length} remaining lines after jump`,
            );
          label++;
          if (casesLabels) {
            if (casesLabels?.includes(label)) {
              /*
              case 0:
                a.label = X  <--- we are HERE
              case 1:
                return [3, X];
              */
              continue; // ignored
            } else if (label >= breakOnLabel) {
              if (label > breakOnLabel) {
                isDefault.value = true;
              }
              isDefault.label = isDefault.label
                ? Math.max(label, isDefault.label)
                : label;
              body.push(t.breakStatement());
              continue;
            }
          } else if (label === breakOnLabel) {
            if (isBreakable)
              // Loop breaks
              body.push(t.breakStatement());
            continue;
          }
          lines = cases[label]; // body.push(...build(label + 1, cases[label + 1], ...))
        } else if (generatorNext.match(line)) {
          const [{ value: mode }, value = null] =
            generatorNextReturn.current!.elements;
          switch (mode) {
            case 0:
            case 1: // SENT
            case 6: // NORMAL
              throw new Error(
                "Generator modes: 0, 1, 6 aren't yet supported...",
              );
            case 2: // RETURN
              // Let cleanup handle it
              body.push(t.cloneNode(line));
              // body.push(t.returnStatement(value)); // NOTE: no cloneNode
              break;
            case 3: // BREAK
              const nextLabel = value.value;
              const nextLines = cases[nextLabel];
              console.log(
                nextLabel,
                breakOnLabel,
                Object.fromEntries(
                  Object.entries(breakableLocations).map((x) => [
                    x[0],
                    x[1].type,
                  ]),
                ),
              );
              if (casesLabels && nextLabel >= breakOnLabel) {
                if (nextLabel > breakOnLabel) {
                  isDefault.value = true;
                }
                isDefault.label = isDefault.label
                  ? Math.max(nextLabel, isDefault.label)
                  : nextLabel;
                // else if (nextLabel === breakOnLabel) isDefault.value = false;
                body.push(t.breakStatement());
                continue;
              } else if (nextLabel === breakOnLabel) {
                // basically kills the loop
                if (isBreakable)
                  // Loop breaks
                  body.push(t.breakStatement());
              } else if (t.isNumericLiteral(value) && nextLines) {
                // TODO: if known nextLabel & nextLabel < label -> loop
                if (nextLabel < label && !nextLines.length) {
                  throw new Error('Unreasolved loop detected');
                } else {
                  body.push(
                    ...build(
                      nextLabel,
                      nextLines,
                      cases,
                      breakableLocations,
                      breakOnLabel,
                      isBreakable,
                      casesLabels,
                      isDefault,
                    ),
                  );
                }
              } else {
                throw new Error(
                  `Unknown BREAK location: ${nextLabel} ${nextLines}`,
                );
              }
              break;
            case 4: // YIELD
              body.push(
                t.expressionStatement(t.yieldExpression(t.cloneNode(value))),
                ...build(
                  label + 1,
                  cases[label + 1],
                  cases,
                  breakableLocations,
                  breakOnLabel,
                  isBreakable,
                  casesLabels,
                  isDefault,
                ),
              );
              break;
            case 5: // YIELD*
              if (
                t.isCallExpression(value) &&
                value.arguments.length == 1 /* &&
                        isValuesHelper(value.callee) */
              ) {
                body.push(
                  t.expressionStatement(
                    t.yieldExpression(t.cloneNode(value.arguments[0], true)),
                  ),
                  ...build(
                    label + 1,
                    cases[label + 1],
                    cases,
                    breakableLocations,
                    breakOnLabel,
                    isBreakable,
                    casesLabels,
                    isDefault,
                  ),
                );
              } else {
                throw new Error('Missing YIELD* helper __values');
              }
              break;
            case 7: // ENDFINALLY
              if (label + 1 !== breakOnLabel)
                throw new Error(
                  `Invalid ENDFINALLY jump: ${label + 1} !== ${breakOnLabel}`,
                );
              break;
          }
        } else if (generatorBranch.match(line)) {
          let test,
            inner,
            nextBreakOnLabel = breakOnLabel;
          const [{ value: mode }, value = null] =
            generatorNextReturn.current!.elements;
          if (
            !isBreakable &&
            t.isUnaryExpression(generatorBranchTest.current, {
              operator: '!',
            }) &&
            // NOTE: may cause problem later if we don't check
            mode === 3
          ) {
            test = generatorBranchTest.current.argument;
            inner = lines;
            lines = [generatorNext.current];
            nextBreakOnLabel = value.value;
          } else {
            inner = [generatorNext.current];
            test = generatorBranchTest.current;
            // body.push(t.breakStatement());
          }
          body.push(
            t.ifStatement(
              t.cloneNode(test),
              t.blockStatement(
                build(
                  label,
                  inner,
                  cases,
                  breakableLocations,
                  nextBreakOnLabel,
                  isBreakable,
                  casesLabels,
                  isDefault,
                ),
              ),
            ),
          );
        } else if (generatorTry.match(line)) {
          const [blockLabel, handlerLabel, finalizerLabel, nextLabel] =
            generatorTryJump.current!.elements.map((n) => n?.value);
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
                  cases,
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
                        cases[handlerLabel],
                        cases,
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
                      cases[finalizerLabel],
                      cases,
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
          lines = cases[nextLabel];
        } else {
          body.push(t.cloneNode(line));
        }
      }
      return body;
    }

    function cleanup(path: NodePath<t.BlockStatement>) {
      if (!t.isBlockStatement(path))
        // NOTE: Not mandatory
        throw new Error('Not block statement');
      const yieldsPaths: t.YieldExpression[] = [];
      path.traverse({
        YieldExpression(path) {
          if (!t.isExpressionStatement(path.parent))
            throw new Error('Not expression statement yield');
          yieldsPaths.push(path.parentPath);
        },
        'FunctionExpression|FunctionDeclaration|ArrowFunctionExpression'(
          inner,
        ) {
          inner.skip();
        },
        ClassMethod(inner) {
          inner.get('body').skip();
          inner.get('params').forEach((p) => p.skip());
        },
        ObjectMethod(inner) {
          inner.get('body').skip();
        },
        ClassProperty(inner) {
          inner.get('value').skip();
        },
      });
      path.traverse({
        'Function|ExpressionStatement|Expression'(inner) {
          inner.skip();
        },
        CatchClause({ node }) {
          if (
            node.param ||
            !t.isBlockStatement(node.body) ||
            !generatorTryCatchError.match(node.body.body[0])
          )
            return;
          node.param = generatorTryCatchErrorIdentifier.current;
          node.body.body.splice(0, 1);
        },
        WhileStatement(path) {
          const params = [null, null, null];
          const init = getPreviousPathSibling(path);
          if (
            t.isExpressionStatement(init.node) &&
            !t.isCallExpression(init.node.expression)
          ) {
            params[0] = init.node.expression;
            init.remove();
          }
          const block = path.node.body;
          const test = block.body[0];
          if (loopTestParam.match(test)) {
            // make while loop if this matches
            params[1] = test.test.argument;
            block.body.splice(0, 1);
          }
          const update = block.body[block.body.length - 1];
          if (
            t.isExpressionStatement(update) &&
            !t.isCallExpression(update.expression)
          ) {
            params[2] = update.expression;
            block.body.splice(-1, 1);
          }
          if (params.some(Boolean)) {
            path.replaceWith(t.forStatement(...params, block));
          }
        },
        ReturnStatement({ node }) {
          // if (node.argument.elements[0].value != 2) throw 'ERROR';
          node.argument = node.argument.elements[1] || null;
        },
        SwitchStatement({ node: { cases } }) {
          const caseBody = cases[cases.length - 1].consequent;
          if (
            caseBody.length &&
            t.isBreakStatement(caseBody[caseBody.length - 1], { label: null })
          )
            caseBody.splice(-1, 1);
        },
      });
      yieldsPaths.forEach((yieldPath) =>
        getNextPathSibling(yieldPath)?.traverse({
          CallExpression(sentPath) {
            if (!generatorSent.match(sentPath.node)) return;
            sentPath.replaceWith(t.cloneNode(yieldPath.node));
            yieldPath.remove();
            sentPath.stop();
          },
        }),
      );
      const body = path.node.body;
      if (t.isReturnStatement(body[body.length - 1], { argument: null }))
        body.splice(-1, 1);
    }

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
            // throw new Error('Generator isnt a function');
            return;
          }
          func.generator = true;

          const cases = generatorCases.current!.map((c) => c.consequent);
          const breakableLocations = {};
          resolveLoops(cases, breakableLocations);
          // console.log(cases);
          resolveSwitchs(cases, breakableLocations);
          path.replaceWithMultiple(
            build(0, cases[0], cases, breakableLocations),
          );
          cleanup(path.parentPath);
          this.changes++;
        },
      },
    };
  },
} satisfies Transform;
