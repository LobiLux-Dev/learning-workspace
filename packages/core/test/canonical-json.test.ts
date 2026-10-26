import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_CANONICAL_JSON_DEPTH, ValidationError, canonicalizeJson } from '../dist/index.js';

const expectCode = (code: string, run: () => unknown): void => {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ValidationError, String(error));
    assert.equal(error.code, code);
    return true;
  });
};

test('RFC 8785 Appendix B number vectors', () => {
  assert.equal(canonicalizeJson(0), '0');
  assert.equal(canonicalizeJson(-0), '0'); // minus zero serializes as 0 (RFC 8785 Appendix B)
  assert.equal(canonicalizeJson(5e-324), '5e-324');
  assert.equal(canonicalizeJson(-5e-324), '-5e-324');
  assert.equal(canonicalizeJson(1.7976931348623157e308), '1.7976931348623157e+308');
  assert.equal(canonicalizeJson(-1.7976931348623157e308), '-1.7976931348623157e+308');
  assert.equal(canonicalizeJson(9007199254740992), '9007199254740992');
  assert.equal(canonicalizeJson(-9007199254740992), '-9007199254740992');
  assert.equal(canonicalizeJson(1e23), '1e+23');
  assert.equal(canonicalizeJson(1e21), '1e+21');
  assert.equal(canonicalizeJson(0.000001), '0.000001');
  assert.equal(canonicalizeJson(333333333.33333329), '333333333.3333333');
});

test('keys are sorted by UTF-16 code units with no whitespace', () => {
  assert.equal(canonicalizeJson({ b: 1, a: 2, A: 3 }), '{"A":3,"a":2,"b":1}');
  assert.equal(canonicalizeJson({ b: 1, a: [3, 2, 1], z: 'é', s: '€' }), '{"a":[3,2,1],"b":1,"s":"€","z":"é"}');
  assert.equal(canonicalizeJson({ é: 1, z: 2 }), '{"z":2,"é":1}');
  assert.equal(canonicalizeJson([]), '[]');
  assert.equal(canonicalizeJson({}), '{}');
  assert.equal(canonicalizeJson(null), 'null');
  assert.equal(canonicalizeJson([[[1]]]), '[[[1]]]');
});

test('string escaping follows RFC 8785 §3.2.2.2', () => {
  assert.equal(canonicalizeJson('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(canonicalizeJson('\n\t\b\f\r'), '"\\n\\t\\b\\f\\r"');
  assert.equal(canonicalizeJson('\u0007\u001f'), '"\\u0007\\u001f"');
  assert.equal(canonicalizeJson('€'), '"€"');
});

test('canonicalization is idempotent and parse-stable', () => {
  const canonical = canonicalizeJson({ nested: { list: [1, 'a', null, true], done: false } });
  assert.equal(canonicalizeJson(JSON.parse(canonical)), canonical);
  assert.equal(canonical.includes(' '), false);
});

test('rejects non-finite, non-JSON and prototype-polluting values', () => {
  expectCode('JSON_NON_FINITE', () => canonicalizeJson(Number.NaN));
  expectCode('JSON_NON_FINITE', () => canonicalizeJson(Infinity));
  expectCode('JSON_NON_FINITE', () => canonicalizeJson(-Infinity));
  expectCode('JSON_UNDEFINED', () => canonicalizeJson(undefined));
  expectCode('JSON_UNDEFINED', () => canonicalizeJson({ a: undefined }));
  expectCode('JSON_UNDEFINED', () => canonicalizeJson([1, undefined]));
  expectCode('JSON_FUNCTION', () => canonicalizeJson({ run: () => 0 }));
  expectCode('JSON_FUNCTION', () => canonicalizeJson(() => 0));
  expectCode('JSON_BIGINT', () => canonicalizeJson(1n));
  expectCode('JSON_SYMBOL', () => canonicalizeJson(Symbol('x')));
  expectCode('JSON_NOT_PLAIN', () => canonicalizeJson(new Date()));
  expectCode('JSON_NOT_PLAIN', () => canonicalizeJson(new Map()));
  expectCode('JSON_NOT_PLAIN', () => canonicalizeJson({ inner: new Date() }));
  expectCode('JSON_LONE_SURROGATE', () => canonicalizeJson('a\uD800b'));
  expectCode('JSON_PROTO_KEY', () => canonicalizeJson(JSON.parse('{"__proto__": 1}')));
  expectCode('JSON_PROTO_KEY', () => canonicalizeJson({ constructor: 1 }));
  expectCode('JSON_PROTO_KEY', () => canonicalizeJson({ prototype: 1 }));
  expectCode('JSON_PROTO_KEY', () => canonicalizeJson(JSON.parse('{"nested": {"__proto__": 1}}')));
});

test('rejects cycles but accepts shared references', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  expectCode('JSON_CYCLE', () => canonicalizeJson(cyclic));

  const array: unknown[] = [];
  array.push(array);
  expectCode('JSON_CYCLE', () => canonicalizeJson(array));

  const shared = { v: 1 };
  assert.equal(canonicalizeJson({ a: shared, b: shared }), '{"a":{"v":1},"b":{"v":1}}');
});

test('rejects values nested deeper than the documented limit', () => {
  let deep: unknown = 0;
  for (let index = 0; index <= MAX_CANONICAL_JSON_DEPTH + 1; index += 1) deep = [deep];
  expectCode('JSON_TOO_DEEP', () => canonicalizeJson(deep));
});

test('validates object keys exactly like values', () => {
  // JSON.parse creates an own (enumerable) "__ud800"-style key holding a lone surrogate
  expectCode('JSON_LONE_SURROGATE', () => canonicalizeJson(JSON.parse('{"\\ud800":1}')));
  expectCode('JSON_LONE_SURROGATE', () => canonicalizeJson(JSON.parse('{"a\\udfff":1}')));
  // ordinary keys are fine
  assert.equal(canonicalizeJson(JSON.parse('{"ok":1}')), '{"ok":1}');
});

test('rejects symbol keys, non-enumerable properties and accessors without running getters', () => {
  const withSymbol: Record<PropertyKey, unknown> = { a: 1 };
  withSymbol[Symbol('dropped')] = 2;
  expectCode('JSON_SYMBOL_KEY', () => canonicalizeJson(withSymbol));

  const withHidden: { a: number } = { a: 1 };
  Object.defineProperty(withHidden, 'hidden', { value: 2, enumerable: false });
  expectCode('JSON_NON_ENUMERABLE', () => canonicalizeJson(withHidden));

  let getterRan = false;
  const withAccessor: Record<string, unknown> = {};
  Object.defineProperty(withAccessor, 'boom', {
    enumerable: true,
    get() {
      getterRan = true;
      return 1;
    },
  });
  expectCode('JSON_ACCESSOR', () => canonicalizeJson(withAccessor));
  assert.equal(getterRan, false, 'getters must never execute during canonicalization');
});

test('rejects arrays with holes, extra own properties and non-standard prototypes', () => {
  expectCode('JSON_ARRAY_HOLE', () => canonicalizeJson(new Array<number>(3)));
  expectCode('JSON_ARRAY_HOLE', () => canonicalizeJson([1, , 3]));

  const withExtra = Object.assign([1, 2], { extra: true });
  expectCode('JSON_ARRAY_EXTRA_KEY', () => canonicalizeJson(withExtra));

  const withSymbol = Object.assign([1, 2], { [Symbol('dropped')]: 3 });
  expectCode('JSON_SYMBOL_KEY', () => canonicalizeJson(withSymbol));

  class ExtendedList extends Array {}
  expectCode('JSON_ARRAY_PROTOTYPE', () => canonicalizeJson(ExtendedList.from([1, 2])));

  // a plain array still works
  assert.equal(canonicalizeJson([1, 'a', null, true]), '[1,"a",null,true]');
});

test('accepts null-prototype objects and JSON.parse output', () => {
  const nullProto: { a: number } = Object.assign(Object.create(null), { a: 1 });
  assert.equal(canonicalizeJson(nullProto), '{"a":1}');
  assert.equal(canonicalizeJson(JSON.parse('{"b":[1,2],"a":null}')), '{"a":null,"b":[1,2]}');
});
