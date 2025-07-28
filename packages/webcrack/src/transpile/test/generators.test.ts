import { describe, test } from 'vitest';
import { testTransform } from '../../../test';
import { generators } from '../transforms';

const expectJS = testTransform(generators);

describe('TS', () => {
  test('simple 1', () =>
    expectJS(`
      function test(i) {
        return tslib_1.__generator(this, function (_a) {
          switch (_a.label) {
            case 0:
              return [4 /*yield*/, i];
            case 1:
              _a.sent();
              if (!(i > 0)) return [3 /*break*/, 3];
              return [5 /*yield**/, tslib_1.__values(test(i - 1))];
            case 2:
              _a.sent();
              _a.label = 3;
            case 3:
              return [2 /*return*/];
          }
        });
      }
    `).toMatchInlineSnapshot(`
      function* test(i) {
        yield i;
        if (i > 0) {
          yield test(i - 1);
        }
      }
    `));
  test('simple 2', () =>
    expectJS(`
      function test(i) {
        return tslib_1.__generator(this, function (_a) {
          switch (_a.label) {
            case 0:
              return [4 /*yield*/, i];
            case 1:
              _a.sent();
              if (!(i > 0)) return [3 /*break*/, 10];
              return [4 /*yield*/, 666];
            case 2:
              _a.sent();
              if (!(i % 3 == 1)) return [3 /*break*/, 8];
              return [4 /*yield*/, 777];
            case 3:
              _a.sent();
              if (!(i == 65)) return [3 /*break*/, 5];
              return [4 /*yield*/, i + 65];
            case 4:
              _a.sent();
              _a.label = 5;
            case 5:
              return [4 /*yield*/, i + 111];
            case 6:
              _a.sent();
              return [4 /*yield*/, test(i + 1)];
            case 7:
              _a.sent();
              _a.label = 8;
            case 8:
              if (1 + 1) return [2 /*return*/, i];
              return [5 /*yield**/, tslib_1.__values(test(i - 2))];
            case 9:
              _a.sent();
              _a.label = 10;
            case 10:
              return [2 /*return*/];
          }
        });
      }
    `).toMatchInlineSnapshot(`
      function* test(i) {
        yield i;
        if (i > 0) {
          yield 666;
          if (i % 3 == 1) {
            yield 777;
            if (i == 65) {
              yield i + 65;
            }
            yield i + 111;
            yield test(i + 1);
          }
          if (1 + 1) {
            return i;
          }
          yield test(i - 2);
        }
      }
    `));
  test('simple 3', () =>
    expectJS(`
      function test() {
        var i;
        return tslib_1.__generator(this, function (_a) {
          switch (_a.label) {
            case 0:
              if (1) {
                if (a) try {
                  return [2 /*return*/, 0];
                } catch (_b) {
                  for (i = 0; i < 3; i++) if (i) return [2 /*return*/, i];
                }
              }
              return [4 /*yield*/, 1];
            case 1:
              _a.sent();
              return [2 /*return*/];
          }
        });
      }
    `).toMatchInlineSnapshot(`
      function* test() {
        var i;
        if (1) {
          if (a) try {
            return 0;
          } catch (_b) {
            for (i = 0; i < 3; i++) if (i) return i;
          }
        }
        yield 1;
      }
    `));
  test('simple 4', () =>
    expectJS(`
      function test() {
        return __generator(this, function (_a) {
          switch (_a.label) {
            case 0:
              if (!a) {
                return [3 /*break*/, 2];
              }
              return [4 /*yield*/, 1];
            case 1:
              _a.sent();
              return [3 /*break*/, 8];
            case 2:
              if (!b) {
                return [3 /*break*/, 4];
              }
              return [4 /*yield*/, 2];
            case 3:
              _a.sent();
              return [3 /*break*/, 8];
            case 4:
              if (!c) {
                return [3 /*break*/, 6];
              }
              return [4 /*yield*/, 3];
            case 5:
              _a.sent();
              return [3 /*break*/, 8];
            case 6:
              if (!d) {
                return [3 /*break*/, 8];
              }
              return [4 /*yield*/, 4];
            case 7:
              _a.sent();
              _a.label = 8;
            case 8:
              return [2 /*return*/];
          }
        });
      }
    `).toMatchInlineSnapshot(`
      function* test() {
        if (a) {
          yield 1;
        } else if (b) {
          yield 2;
        } else if (c) {
          yield 3;
        } else if (d) {
          yield 4;
        }
      }
    `));
  test('for loop', () =>
    expectJS(`
      function test(i) {
        var k;
        return tslib_1.__generator(this, function (_a) {
          switch (_a.label) {
            case 0:
              return [4 /*yield*/, "start"];
            case 1:
              _a.sent();
              k = 3;
              _a.label = 2;
            case 2:
              if (!(k > 0)) return [3 /*break*/, 5];
              return [4 /*yield*/, i];
            case 3:
              _a.sent();
              _a.label = 4;
            case 4:
              k--;
              return [3 /*break*/, 2];
            case 5:
              return [4 /*yield*/, "end"];
            case 6:
              _a.sent();
              return [2 /*return*/];
          }
        });
      }
    `).toMatchInlineSnapshot(`
      function* test(i) {
        var k;
        yield "start";
        for (k = 3; k > 0; k--) {
          yield i;
        }
        yield "end";
      }
    `));
  test('for of loop', () =>
    expectJS(`
      function test(i) {
        var _i, _a, p;
        return tslib_1.__generator(this, function (_b) {
          switch (_b.label) {
            case 0:
              return [4 /*yield*/, "start"];
            case 1:
              _b.sent();
              _i = 0, _a = [1, 2, 3];
              _b.label = 2;
            case 2:
              if (!(_i < _a.length)) return [3 /*break*/, 5];
              p = _a[_i];
              return [4 /*yield*/, i];
            case 3:
              _b.sent();
              _b.label = 4;
            case 4:
              _i++;
              return [3 /*break*/, 2];
            case 5:
              return [4 /*yield*/, "end"];
            case 6:
              _b.sent();
              return [2 /*return*/];
          }
        });
      }
    `).toMatchInlineSnapshot(`
      function* test(i) {
        var _i, _a, p;
        yield "start";
        for (_i = 0, _a = [1, 2, 3]; _i < _a.length; _i++) {
          p = _a[_i];
          yield i;
        }
        yield "end";
      }
    `));
  test('nested for loop', () =>
    expectJS(`
      function test(i) {
        var k, j;
        return tslib_1.__generator(this, function (_a) {
          switch (_a.label) {
            case 0:
              return [4 /*yield*/, "start"];
            case 1:
              _a.sent();
              k = 3;
              _a.label = 2;
            case 2:
              if (!(k > 0)) return [3 /*break*/, 7];
              j = 0;
              _a.label = 3;
            case 3:
              if (!(j < 10)) return [3 /*break*/, 6];
              return [4 /*yield*/, i];
            case 4:
              _a.sent();
              _a.label = 5;
            case 5:
              j += 2;
              return [3 /*break*/, 3];
            case 6:
              k--;
              return [3 /*break*/, 2];
            case 7:
              return [4 /*yield*/, "end"];
            case 8:
              _a.sent();
              return [2 /*return*/];
          }
        });
      }
    `).toMatchInlineSnapshot(`
      function* test(i) {
        var k, j;
        yield "start";
        for (k = 3; k > 0; k--) {
          for (j = 0; j < 10; j += 2) {
            yield i;
          }
        }
        yield "end";
      }
    `));
  test('try statement', () =>
    expectJS(`
      function test() {
        var e_2;
        return tslib_1.__generator(this, function (_a) {
          switch (_a.label) {
            case 0:
              _a.trys.push([0, 2, 7, 9]);
              return [4 /*yield*/, 1];
            case 1:
              _a.sent();
              return [3 /*break*/, 9];
            case 2:
              e_2 = _a.sent();
              return [4 /*yield*/, 2];
            case 3:
              _a.sent();
              console.log(e_2);
              return [4 /*yield*/, e_2];
            case 4:
              _a.sent();
              if (!(e_2.name == "ABC")) return [3 /*break*/, 6];
              return [4 /*yield*/, "error"];
            case 5:
              _a.sent();
              throw e_2;
            case 6:
              return [3 /*break*/, 9];
            case 7:
              return [4 /*yield*/, 3];
            case 8:
              _a.sent();
              return [7 /*endfinally*/];
            case 9:
              return [2 /*return*/];
          }
        });
      }
    `).toMatchInlineSnapshot(`
      function* test() {
        var e_2;
        try {
          yield 1;
        } catch (e_2) {
          yield 2;
          console.log(e_2);
          yield e_2;
          if (e_2.name == "ABC") {
            yield "error";
            throw e_2;
          }
        } finally {
          yield 3;
        }
      }
    `));
  test('labeled break', () =>
    expectJS(`
      function test() {
        var k;
        var i;
        var _a;
        return __generator(this, function (_b) {
          switch (_b.label) {
            case 0:
              return [4 /*yield*/, 0];
            case 1:
              _b.sent();
              k = 0;
              _b.label = 2;
            case 2:
              if (!(k < 10)) {
                return [3 /*break*/, 27];
              }
              if (a) {
                if (b) {
                  return [3 /*break*/, 27];
                }
              }
              if (!c) {
                return [3 /*break*/, 4];
              }
              return [4 /*yield*/, 1];
            case 3:
              _b.sent();
              _b.label = 4;
            case 4:
              i = 0;
              _b.label = 5;
            case 5:
              if (!(i < 100)) {
                return [3 /*break*/, 22];
              }
              return [4 /*yield*/, 2];
            case 6:
              _b.sent();
              _b.label = 7;
            case 7:
              if (!d) {
                return [3 /*break*/, 19];
              }
              if (!e) {
                return [3 /*break*/, 9];
              }
              return [4 /*yield*/, 3];
            case 8:
              _b.sent();
              return [3 /*break*/, 17];
            case 9:
              if (!f) {
                return [3 /*break*/, 17];
              }
              return [4 /*yield*/, 4];
            case 10:
              _b.sent();
              _a = g;
              switch (_a) {
                case h:
                  return [3 /*break*/, 11];
                case j:
                  return [3 /*break*/, 13];
              }
              return [3 /*break*/, 14];
            case 11:
              return [4 /*yield*/, 5];
            case 12:
              _b.sent();
              return [3 /*break*/, 16];
            case 13:
              return [3 /*break*/, 27];
            case 14:
              return [4 /*yield*/, 6];
            case 15:
              _b.sent();
              return [3 /*break*/, 19];
            case 16:
              return [3 /*break*/, 22];
            case 17:
              return [4 /*yield*/, 7];
            case 18:
              _b.sent();
              return [3 /*break*/, 7];
            case 19:
              return [4 /*yield*/, 8];
            case 20:
              _b.sent();
              if (l) {
                return [3 /*break*/, 22];
              }
              _b.label = 21;
            case 21:
              i++;
              return [3 /*break*/, 5];
            case 22:
              if (!m) {
                return [3 /*break*/, 24];
              }
              return [4 /*yield*/, 9];
            case 23:
              _b.sent();
              _b.label = 24;
            case 24:
              return [4 /*yield*/, 10];
            case 25:
              _b.sent();
              _b.label = 26;
            case 26:
              k++;
              return [3 /*break*/, 2];
            case 27:
              return [4 /*yield*/, 11];
            case 28:
              _b.sent();
              return [2 /*return*/];
          }
        });
      }
    `).toMatchInlineSnapshot(`
      function* test() {
        yield 0;
        label_a: for (let k = 0; k < 10; k++) {
          if (a) {
            if (b) {
              break;
            }
          }
          if (c) {
            yield 1;
          }
          label_b: for (let i = 0; i < 100; i++) {
            yield 2;
            label_c: while (d) {
              if (e) {
                yield 3;
              } else {
                if (f) {
                  yield 4;
                  switch (g) {
                    case h:
                      yield 5;
                      break;
                    case j:
                      break label_a;
                    default:
                      yield 6;
                      break label_c;
                  }
                  break label_b;
                }
              }
              yield 7;
            }
            yield 8;
            if (l) {
              break;
            } 
          }
          if (m) {
            yield 9;
          }
          yield 10;
        }
        yield 11;
      }
    `));
  test('switch statement', () =>
    expectJS(`
      function test(i) {
        var _a;
        return tslib_1.__generator(this, function (_b) {
          switch (_b.label) {
            case 0:
              return [4 /*yield*/, "start"];
            case 1:
              _b.sent();
              _a = i;
              switch (_a) {
                case 0:
                  return [3 /*break*/, 2];
                case 1:
                  return [3 /*break*/, 3];
                case 2:
                  return [3 /*break*/, 5];
                case 3:
                  return [3 /*break*/, 7];
              }
              return [3 /*break*/, 9];
            case 2:
              return [2 /*return*/, 0];
            case 3:
              return [4 /*yield*/, 1];
            case 4:
              _b.sent();
              i = 3;
              _b.label = 5;
            case 5:
              return [4 /*yield*/, 2];
            case 6:
              _b.sent();
              return [3 /*break*/, 11];
            case 7:
              return [4 /*yield*/, 3];
            case 8:
              _b.sent();
              return [3 /*break*/, 11];
            case 9:
              return [4 /*yield*/, -1];
            case 10:
              _b.sent();
              _b.label = 11;
            case 11:
              return [4 /*yield*/, "end"];
            case 12:
              _b.sent();
              return [2 /*return*/];
          }
        });
      }
    `).toMatchInlineSnapshot(`
      function* test(i) {
        var _a;
        yield "start";
        _a = i;
        switch (_a) {
          case 0:
            return 0;
          case 1:
            yield 1;
            i = 3;
          case 2:
            yield 2;
            break;
          case 3:
            yield 3;
            break;
          default:
            yield -1;
        }
        yield "end";
      }
    `));
  test('nested switch statement', () =>
    expectJS(`
      function test(i) {
        var _a;
        var _b;
        return __generator(this, function (_c) {
          switch (_c.label) {
            case 0:
              return [4 /*yield*/, "start"];
            case 1:
              _c.sent();
              _a = i;
              switch (_a) {
                case 0:
                  return [3 /*break*/, 2];
                case 1:
                  return [3 /*break*/, 3];
                case 2:
                  return [3 /*break*/, 5];
                case 3:
                  return [3 /*break*/, 7];
              }
              return [3 /*break*/, 17];
            case 2:
              return [2 /*return*/, 0];
            case 3:
              return [4 /*yield*/, 1];
            case 4:
              _c.sent();
              i = 3;
              _c.label = 5;
            case 5:
              return [4 /*yield*/, 2];
            case 6:
              _c.sent();
              return [3 /*break*/, 19];
            case 7:
              return [4 /*yield*/, 3];
            case 8:
              _c.sent();
              _b = i;
              switch (_b) {
                case "a":
                  return [3 /*break*/, 9];
                case "b":
                  return [3 /*break*/, 11];
                case "c":
                  return [3 /*break*/, 13];
              }
              return [3 /*break*/, 15];
            case 9:
              return [4 /*yield*/, 4];
            case 10:
              _c.sent();
              _c.label = 11;
            case 11:
              return [4 /*yield*/, 5];
            case 12:
              _c.sent();
              _c.label = 13;
            case 13:
              return [4 /*yield*/, 6];
            case 14:
              _c.sent();
              _c.label = 15;
            case 15:
              return [4 /*yield*/, 7];
            case 16:
              _c.sent();
              return [3 /*break*/, 19];
            case 17:
              return [4 /*yield*/, 8];
            case 18:
              _c.sent();
              _c.label = 19;
            case 19:
              return [4 /*yield*/, "end"];
            case 20:
              _c.sent();
              return [2 /*return*/];
          }
        });
      }
    `).toMatchInlineSnapshot(`
      function* test(i) {
        var _a;
        var _b;
        yield "start";
        _a = i;
        switch (_a) {
          case 0:
            return 0;
          case 1:
            yield 1;
            i = 3;
          case 2:
            yield 2;
            break;
          case 3:
            yield 3;
            _b = i;
            switch (_b) {
              case "a":
                yield 4;
              case "b":
                yield 5;
              case "c":
                yield 6;
            }
            yield 7;
            break;
          default:
            yield 8;
        }
        yield "end";
      }
    `));
});
// describe('Babel', () => { /* None for now ... */ });
