/**
 * Hot Sort Algorithm Tests
 *
 * Tests the engagement-weighted hot sort formula:
 *   engagement_score / (age_hours + 2)^1.5
 *
 * Where engagement_score = score + total_reactions + comment_count*2 + bookmark_count
 */

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
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

// The hot sort formula extracted for unit testing
function hotScore({ score, totalReactions, commentCount, bookmarkCount, ageHours }) {
  const engagement = score + totalReactions + commentCount * 2 + bookmarkCount;
  return engagement / Math.pow(ageHours + 2, 1.5);
}

async function runTests() {
  console.log('\nHot Sort Algorithm Tests\n');
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

describe('Hot Score Formula', () => {
  test('engagement_score sums all signals with comment_count weighted 2x', () => {
    const result = hotScore({ score: 10, totalReactions: 5, commentCount: 3, bookmarkCount: 2, ageHours: 0 });
    // engagement = 10 + 5 + 3*2 + 2 = 23
    // denominator = (0 + 2)^1.5 = 2.828...
    const expected = 23 / Math.pow(2, 1.5);
    assertEqual(result, expected, `Expected ${expected}, got ${result}`);
  });

  test('newer high-engagement post ranks above older low-engagement post', () => {
    // New post (1 hour old) with moderate engagement
    const newPost = hotScore({ score: 5, totalReactions: 3, commentCount: 2, bookmarkCount: 1, ageHours: 1 });
    // Old post (48 hours old) with low engagement
    const oldPost = hotScore({ score: 2, totalReactions: 0, commentCount: 0, bookmarkCount: 0, ageHours: 48 });
    assert(newPost > oldPost, `New engaging post (${newPost}) should rank above old low-engagement post (${oldPost})`);
  });

  test('very popular old post can still rank above mediocre new post', () => {
    // Old viral post (12 hours) with very high engagement
    const viralOld = hotScore({ score: 200, totalReactions: 50, commentCount: 80, bookmarkCount: 30, ageHours: 12 });
    // New post (1 hour) with minimal engagement
    const boringNew = hotScore({ score: 1, totalReactions: 0, commentCount: 0, bookmarkCount: 0, ageHours: 1 });
    assert(viralOld > boringNew, `Viral old post (${viralOld}) should rank above boring new post (${boringNew})`);
  });

  test('time decay reduces score for older posts', () => {
    const engagement = { score: 10, totalReactions: 5, commentCount: 3, bookmarkCount: 2 };
    const fresh = hotScore({ ...engagement, ageHours: 1 });
    const aged = hotScore({ ...engagement, ageHours: 24 });
    const old = hotScore({ ...engagement, ageHours: 72 });
    assert(fresh > aged, `1h post (${fresh}) should rank above 24h post (${aged})`);
    assert(aged > old, `24h post (${aged}) should rank above 72h post (${old})`);
  });
});

describe('Edge Cases', () => {
  test('zero engagement produces zero score', () => {
    const result = hotScore({ score: 0, totalReactions: 0, commentCount: 0, bookmarkCount: 0, ageHours: 5 });
    assertEqual(result, 0, `Zero engagement should produce score 0, got ${result}`);
  });

  test('brand new post (age 0) uses offset of 2 to avoid division issues', () => {
    const result = hotScore({ score: 1, totalReactions: 0, commentCount: 0, bookmarkCount: 0, ageHours: 0 });
    const expected = 1 / Math.pow(2, 1.5);
    assertEqual(result, expected, `Brand new post score should be ${expected}, got ${result}`);
    assert(isFinite(result), 'Score should be finite');
    assert(result > 0, 'Score should be positive');
  });

  test('negative score (downvoted post) produces negative ranking', () => {
    const result = hotScore({ score: -5, totalReactions: 0, commentCount: 0, bookmarkCount: 0, ageHours: 1 });
    assert(result < 0, `Downvoted post should have negative score, got ${result}`);
  });

  test('comments weighted 2x have real impact on ranking', () => {
    const withComments = hotScore({ score: 5, totalReactions: 0, commentCount: 10, bookmarkCount: 0, ageHours: 2 });
    const withoutComments = hotScore({ score: 5, totalReactions: 0, commentCount: 0, bookmarkCount: 0, ageHours: 2 });
    // 10 comments add 20 to engagement score
    assert(withComments > withoutComments, 'Post with comments should rank higher');
    const diff = withComments - withoutComments;
    const expectedDiff = 20 / Math.pow(4, 1.5); // 20 / 8 = 2.5
    assertEqual(diff, expectedDiff, `Comment contribution should be ${expectedDiff}, got ${diff}`);
  });
});

// Run
runTests();
