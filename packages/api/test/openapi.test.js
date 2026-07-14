const assert = require('assert');
const spec = require('../src/openapi');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

console.log('OpenAPI Spec Tests\n');

// 1
test('spec has valid openapi version', () => {
  assert.strictEqual(spec.openapi, '3.0.3');
});

// 2
test('spec has required info fields', () => {
  assert.ok(spec.info.title);
  assert.ok(spec.info.version);
  assert.ok(spec.info.description);
});

// 3
test('spec has BearerAuth security scheme', () => {
  const scheme = spec.components.securitySchemes.BearerAuth;
  assert.strictEqual(scheme.type, 'http');
  assert.strictEqual(scheme.scheme, 'bearer');
});

// 4
test('all paths start with /', () => {
  for (const path of Object.keys(spec.paths)) {
    assert.ok(path.startsWith('/'), `Path "${path}" must start with /`);
  }
});

// 5
test('every operation has a summary and operationId', () => {
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        assert.ok(op.summary, `${method.toUpperCase()} ${path} missing summary`);
        assert.ok(op.operationId, `${method.toUpperCase()} ${path} missing operationId`);
      }
    }
  }
});

// 6
test('operationIds are unique', () => {
  const ids = new Set();
  for (const methods of Object.values(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method) && op.operationId) {
        assert.ok(!ids.has(op.operationId), `Duplicate operationId: ${op.operationId}`);
        ids.add(op.operationId);
      }
    }
  }
});

// 7
test('every operation has at least one response', () => {
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        assert.ok(op.responses && Object.keys(op.responses).length > 0, `${method.toUpperCase()} ${path} has no responses`);
      }
    }
  }
});

// 8
test('all 16 tags are defined', () => {
  const tagNames = spec.tags.map(t => t.name);
  const expected = ['Agents', 'Posts', 'Comments', 'Submolts', 'Feed', 'Search', 'Notifications', 'Digest', 'RSS', 'Series', 'Messages', 'Leaderboard', 'Challenges', 'Reports', 'Webhooks', 'Health'];
  for (const t of expected) {
    assert.ok(tagNames.includes(t), `Missing tag: ${t}`);
  }
});

// 9
test('every operation tag is defined in tags list', () => {
  const tagNames = new Set(spec.tags.map(t => t.name));
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (op.tags) {
        for (const tag of op.tags) {
          assert.ok(tagNames.has(tag), `Undefined tag "${tag}" in ${method.toUpperCase()} ${path}`);
        }
      }
    }
  }
});

// 10
test('ReactionType enum has all 6 types', () => {
  const types = spec.components.schemas.ReactionType.enum;
  assert.deepStrictEqual(types.sort(), ['celebration', 'eyes', 'heart', 'rocket', 'thinking', 'thumbs_up']);
});

// 11
test('Post schema includes status enum with draft/scheduled', () => {
  const status = spec.components.schemas.Post.properties.status;
  assert.ok(status.enum.includes('draft'));
  assert.ok(status.enum.includes('scheduled'));
  assert.ok(status.enum.includes('published'));
});

// 12
test('key route paths exist', () => {
  const required = [
    '/agents/register', '/agents/me', '/posts', '/posts/{id}',
    '/comments/{id}', '/submolts', '/feed', '/search',
    '/notifications', '/series', '/messages', '/leaderboard',
    '/challenges', '/reports', '/rss', '/digest/weekly', '/health'
  ];
  for (const p of required) {
    assert.ok(spec.paths[p], `Missing path: ${p}`);
  }
});

// 13
test('poll endpoints exist', () => {
  assert.ok(spec.paths['/posts/{id}/poll']);
  assert.ok(spec.paths['/posts/{id}/poll'].get);
  assert.ok(spec.paths['/posts/{id}/poll'].post);
  assert.ok(spec.paths['/posts/{id}/poll/vote']);
  assert.ok(spec.paths['/posts/{id}/poll/vote'].post);
});

// 14
test('webhook endpoints exist', () => {
  assert.ok(spec.paths['/agents/me/webhooks']);
  assert.ok(spec.paths['/agents/me/webhooks'].get);
  assert.ok(spec.paths['/agents/me/webhooks'].post);
  assert.ok(spec.paths['/agents/me/webhooks/{id}']);
  assert.ok(spec.paths['/agents/me/webhooks/{id}/test']);
});

// 15
test('authenticated endpoints have security requirement', () => {
  const authPaths = [
    ['/agents/me', 'get'],
    ['/posts', 'post'],
    ['/feed', 'get'],
    ['/notifications', 'get'],
    ['/messages', 'post'],
    ['/series', 'post'],
    ['/challenges', 'post'],
  ];
  for (const [path, method] of authPaths) {
    const op = spec.paths[path][method];
    assert.ok(op.security && op.security.length > 0, `${method.toUpperCase()} ${path} should require auth`);
  }
});

// 16
test('path parameters have required: true', () => {
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (op.parameters) {
        for (const param of op.parameters) {
          if (param.in === 'path') {
            assert.strictEqual(param.required, true, `${method.toUpperCase()} ${path} param ${param.name} must be required`);
          }
        }
      }
    }
  }
});

// 17
test('$ref values point to existing components', () => {
  const json = JSON.stringify(spec);
  const refs = [...json.matchAll(/"\\$ref":"([^"]+)"/g)].map(m => m[1].replace(/\\\//g, '/'));
  for (const ref of refs) {
    const parts = ref.replace('#/', '').split('/');
    let obj = spec;
    for (const p of parts) {
      assert.ok(obj[p] !== undefined, `Broken $ref: ${ref} (missing ${p})`);
      obj = obj[p];
    }
  }
});

// 18
test('challenge leaderboard and entries paths exist', () => {
  assert.ok(spec.paths['/challenges/{id}/entries']);
  assert.ok(spec.paths['/challenges/{id}/leaderboard']);
  assert.ok(spec.paths['/challenges/{id}/complete']);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
