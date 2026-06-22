/**
 * Mentions Utility Test Suite
 * 
 * Run: node test/mentions.test.js
 */

const { parseMentions } = require('../src/utils/mentions');

// Test framework (same pattern as api.test.js)
let passed = 0;
let failed = 0;
const tests = [];

function describe(name, fn) {
  tests.push({ type: 'describe', name });
  fn();
}

function test(name, fn) {
  tests.push({ type: 'test', name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function runTests() {
  console.log('\nMentions Utility Test Suite\n');
  console.log('='.repeat(50));

  for (const item of tests) {
    if (item.type === 'describe') {
      console.log(`\n[${item.name}]\n`);
    } else {
      try {
        await item.fn();
        console.log(`  + ${item.name}`);
        passed++;
      } catch (error) {
        console.log(`  - ${item.name}`);
        console.log(`    Error: ${error.message}`);
        failed++;
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// Tests

describe('parseMentions', () => {
  test('extracts simple mentions', () => {
    const result = parseMentions('Hello @kagura and @jianlin-agent!');
    assertEqual(result.sort(), ['jianlin-agent', 'kagura']);
  });

  test('extracts mention with underscores and numbers', () => {
    const result = parseMentions('cc @agent_99 @test123');
    assertEqual(result.sort(), ['agent_99', 'test123']);
  });

  test('ignores mentions inside inline code', () => {
    const result = parseMentions('Use `@kagura` to mention, but @luna is real');
    assertEqual(result, ['luna']);
  });

  test('ignores mentions inside fenced code blocks', () => {
    const result = parseMentions('Hey @real\n```\n@fake mention\n```\nand @another');
    assertEqual(result.sort(), ['another', 'real']);
  });

  test('ignores mentions inside multi-line fenced code blocks', () => {
    const result = parseMentions('```js\nconst x = "@notamention";\n@alsoignored\n```\n@valid');
    assertEqual(result, ['valid']);
  });

  test('deduplicates mentions', () => {
    const result = parseMentions('@kagura said hi to @kagura');
    assertEqual(result, ['kagura']);
  });

  test('handles empty string', () => {
    const result = parseMentions('');
    assertEqual(result, []);
  });

  test('handles null/undefined', () => {
    assertEqual(parseMentions(null), []);
    assertEqual(parseMentions(undefined), []);
  });

  test('handles text with no mentions', () => {
    const result = parseMentions('Just a regular post with no mentions');
    assertEqual(result, []);
  });

  test('handles @@ double-at', () => {
    const result = parseMentions('@@doubled is weird');
    // Should still extract the name after the second @
    assertEqual(result, ['doubled']);
  });

  test('does not match @ followed by non-alphanumeric', () => {
    const result = parseMentions('email: @! @# @');
    assertEqual(result, []);
  });

  test('handles @ at end of string', () => {
    const result = parseMentions('trailing @');
    assertEqual(result, []);
  });

  test('extracts mention at start of text', () => {
    const result = parseMentions('@first is here');
    assertEqual(result, ['first']);
  });

  test('handles mention with hyphen', () => {
    const result = parseMentions('hey @my-agent-name');
    assertEqual(result, ['my-agent-name']);
  });
});

// Run
runTests();
