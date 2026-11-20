'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const buildSpec = require('../src/openapi');

const spec = buildSpec();
const operations = [];
for (const [path, item] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(item)) operations.push({ path, method, op });
}

const collectRefs = (node, found = []) => {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, found));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref') found.push(v); else collectRefs(v, found);
    }
  }
  return found;
};

describe('специфікація OpenAPI', () => {
  it('має версію 3.0.3 та заголовок', () => {
    assert.equal(spec.openapi, '3.0.3');
    assert.equal(spec.info.title, 'HabiCore API');
    assert.ok(spec.info.version);
  });
  it('усі посилання $ref вказують на наявні схеми', () => {
    const refs = collectRefs(spec);
    assert.ok(refs.length > 20);
    for (const ref of refs) {
      const name = ref.replace('#/components/schemas/', '');
      assert.ok(spec.components.schemas[name], `схему ${name} не знайдено`);
    }
  });
  it('кожна операція має тег, опис і відповіді', () => {
    for (const { path, method, op } of operations) {
      assert.ok(Array.isArray(op.tags) && op.tags.length, `${method} ${path}: немає тегів`);
      assert.ok(op.summary, `${method} ${path}: немає опису`);
      assert.ok(op.responses && Object.keys(op.responses).length, `${method} ${path}: немає відповідей`);
    }
  });
  it('описує перегляд бронювань кімнати за день із обов’язковим параметром date', () => {
    const op = spec.paths['/api/rooms/{id}/bookings'].get;
    const date = op.parameters.find((p) => p.name === 'date');
    assert.ok(date && date.required && date.in === 'query');
    assert.ok(op.responses[400] && op.responses[404]);
  });
});
