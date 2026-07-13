/**
 * Reports / Content Moderation Test Suite
 *
 * Run: node test/reports.test.js
 */

const calls = [];
let mockQueryOneResults = [];
let mockQueryAllResults = [];
let mockTransactionFn = null;

class MockError { constructor(err) { this.err = err; } }

require.cache[require.resolve('../src/config/database')] = {
  id: require.resolve('../src/config/database'),
  filename: require.resolve('../src/config/database'),
  loaded: true,
  exports: {
    queryOne: async (text, params) => {
      calls.push({ fn: 'queryOne', text, params });
      if (mockQueryOneResults.length > 0) {
        const item = mockQueryOneResults.shift();
        if (item instanceof MockError) throw item.err;
        return item;
      }
      return null;
    },
    queryAll: async (text, params) => {
      calls.push({ fn: 'queryAll', text, params });
      if (mockQueryAllResults.length > 0) return mockQueryAllResults.shift();
      return [];
    },
    transaction: async (cb) => {
      if (mockTransactionFn) return mockTransactionFn(cb);
      const mockClient = {
        queries: [],
        query: async (text, params) => {
          mockClient.queries.push({ text, params });
          calls.push({ fn: 'client.query', text, params });
          if (mockQueryOneResults.length > 0) {
            const item = mockQueryOneResults.shift();
            if (item instanceof MockError) throw item.err;
            return { rows: item ? [item] : [] };
          }
          return { rows: [] };
        }
      };
      return cb(mockClient);
    }
  }
};

const ReportService = require('../src/services/ReportService');

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

function resetMocks() {
  calls.length = 0;
  mockQueryOneResults = [];
  mockQueryAllResults = [];
  mockTransactionFn = null;
}

async function runTests() {
  console.log('\nReports Test Suite\n');
  console.log('='.repeat(50));

  for (const item of tests) {
    if (item.type === 'describe') {
      console.log(`\n[${item.name}]\n`);
    } else {
      resetMocks();
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

// --- Tests ---

describe('createReport', () => {
  test('creates a valid report', async () => {
    // post exists
    mockQueryOneResults.push({ id: 'post-1', author_id: 'author-1' });
    // no existing report
    mockQueryOneResults.push(null);
    // transaction: insert report
    mockQueryOneResults.push({ id: 'r-1', post_id: 'post-1', reporter_id: 'agent-1', reason: 'spam', status: 'pending' });
    // transaction: mod log insert
    mockQueryOneResults.push(undefined);
    // transaction: count reports
    mockQueryOneResults.push({ cnt: 1 });

    const report = await ReportService.createReport('post-1', 'agent-1', 'spam', 'looks spammy');
    assertEqual(report.reason, 'spam');
    assertEqual(report.post_id, 'post-1');
  });

  test('rejects invalid reason', async () => {
    try {
      await ReportService.createReport('post-1', 'agent-1', 'invalid_reason', null);
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
      assert(err.message.includes('Invalid reason'), `Got: ${err.message}`);
    }
  });

  test('blocks self-report', async () => {
    mockQueryOneResults.push({ id: 'post-1', author_id: 'agent-1' });

    try {
      await ReportService.createReport('post-1', 'agent-1', 'spam', null);
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
      assert(err.message.includes('cannot report your own'), `Got: ${err.message}`);
    }
  });

  test('blocks duplicate report', async () => {
    mockQueryOneResults.push({ id: 'post-1', author_id: 'author-1' });
    mockQueryOneResults.push({ id: 'existing-report' });

    try {
      await ReportService.createReport('post-1', 'agent-1', 'spam', null);
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 409, `Expected 409, got ${err.statusCode}`);
    }
  });

  test('throws NotFoundError for missing post', async () => {
    mockQueryOneResults.push(null);

    try {
      await ReportService.createReport('bad-id', 'agent-1', 'spam', null);
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
  });

  test('auto-hides post at threshold (3 reports)', async () => {
    mockQueryOneResults.push({ id: 'post-1', author_id: 'author-1' });
    mockQueryOneResults.push(null);
    // transaction: insert report
    mockQueryOneResults.push({ id: 'r-3', post_id: 'post-1', reporter_id: 'agent-3', reason: 'spam', status: 'pending' });
    // transaction: mod log insert
    mockQueryOneResults.push(undefined);
    // transaction: count = 3
    mockQueryOneResults.push({ cnt: 3 });
    // transaction: UPDATE posts SET hidden (returns nothing)
    mockQueryOneResults.push(undefined);
    // transaction: post_hidden log
    mockQueryOneResults.push(undefined);

    const report = await ReportService.createReport('post-1', 'agent-3', 'spam', null);
    assertEqual(report.id, 'r-3');

    // Verify that the transaction included an UPDATE posts SET hidden = true
    const hideCalls = calls.filter(c => c.fn === 'client.query' && c.text && c.text.includes('hidden = true'));
    assert(hideCalls.length > 0, 'Should have called UPDATE posts SET hidden = true');

    // Verify a post_hidden log entry was created
    const logCalls = calls.filter(c => c.fn === 'client.query' && c.text && c.text.includes('post_hidden'));
    assert(logCalls.length > 0, 'Should have logged post_hidden');
  });

  test('does not auto-hide when below threshold', async () => {
    mockQueryOneResults.push({ id: 'post-1', author_id: 'author-1' });
    mockQueryOneResults.push(null);
    mockQueryOneResults.push({ id: 'r-2', post_id: 'post-1', reporter_id: 'agent-2', reason: 'spam', status: 'pending' });
    // mod log insert
    mockQueryOneResults.push(undefined);
    // count = 2, below threshold
    mockQueryOneResults.push({ cnt: 2 });

    await ReportService.createReport('post-1', 'agent-2', 'spam', null);

    const hideCalls = calls.filter(c => c.fn === 'client.query' && c.text && c.text.includes('hidden = true'));
    assertEqual(hideCalls.length, 0, 'Should NOT have hidden the post');
  });
});

describe('getReports', () => {
  test('returns all reports with pagination', async () => {
    mockQueryOneResults.push({ total: 2 });
    mockQueryAllResults.push([
      { id: 'r-1', reason: 'spam', post_title: 'Test', reporter_name: 'agent1' },
      { id: 'r-2', reason: 'harassment', post_title: 'Test2', reporter_name: 'agent2' }
    ]);

    const { reports, total } = await ReportService.getReports({ limit: 20, offset: 0 });
    assertEqual(total, 2);
    assertEqual(reports.length, 2);
  });

  test('filters by status', async () => {
    mockQueryOneResults.push({ total: 1 });
    mockQueryAllResults.push([
      { id: 'r-1', reason: 'spam', status: 'pending' }
    ]);

    const { reports } = await ReportService.getReports({ status: 'pending', limit: 20, offset: 0 });
    assertEqual(reports.length, 1);

    const statusCall = calls.find(c => c.fn === 'queryAll' && c.text.includes('r.status'));
    assert(statusCall, 'Should have filtered by status');
  });
});

describe('getReportById', () => {
  test('returns report with joins', async () => {
    mockQueryOneResults.push({ id: 'r-1', reason: 'spam', post_title: 'Test', reporter_name: 'agent1' });

    const report = await ReportService.getReportById('r-1');
    assertEqual(report.id, 'r-1');
    assertEqual(report.post_title, 'Test');
  });

  test('throws NotFoundError for missing report', async () => {
    mockQueryOneResults.push(null);

    try {
      await ReportService.getReportById('bad-id');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
  });
});

describe('resolveReport', () => {
  test('resolves a report', async () => {
    mockQueryOneResults.push({ id: 'r-1', post_id: 'post-1', status: 'pending' });
    // transaction: update report
    mockQueryOneResults.push({ id: 'r-1', status: 'resolved', resolved_by: 'mod-1' });
    // transaction: mod log (no return needed)

    const updated = await ReportService.resolveReport('r-1', 'mod-1', 'resolved');
    assertEqual(updated.status, 'resolved');
  });

  test('dismisses a report and auto-unhides if no pending remain', async () => {
    mockQueryOneResults.push({ id: 'r-1', post_id: 'post-1', status: 'pending' });
    // transaction: update report
    mockQueryOneResults.push({ id: 'r-1', status: 'dismissed', resolved_by: 'mod-1' });
    // transaction: mod log (returns nothing)
    mockQueryOneResults.push(undefined);
    // transaction: post hidden check
    mockQueryOneResults.push({ hidden: true });
    // transaction: pending count
    mockQueryOneResults.push({ cnt: 0 });

    const updated = await ReportService.resolveReport('r-1', 'mod-1', 'dismissed');
    assertEqual(updated.status, 'dismissed');

    const unhideCalls = calls.filter(c => c.fn === 'client.query' && c.text && c.text.includes('hidden = false'));
    assert(unhideCalls.length > 0, 'Should have unhidden the post');

    const logCalls = calls.filter(c => c.fn === 'client.query' && c.text && c.text.includes('post_unhidden'));
    assert(logCalls.length > 0, 'Should have logged post_unhidden');
  });

  test('does not unhide if other pending reports remain', async () => {
    mockQueryOneResults.push({ id: 'r-1', post_id: 'post-1', status: 'pending' });
    mockQueryOneResults.push({ id: 'r-1', status: 'dismissed' });
    mockQueryOneResults.push(undefined); // mod log
    mockQueryOneResults.push({ hidden: true });
    mockQueryOneResults.push({ cnt: 2 }); // 2 other pending

    await ReportService.resolveReport('r-1', 'mod-1', 'dismissed');

    const unhideCalls = calls.filter(c => c.fn === 'client.query' && c.text && c.text.includes('hidden = false'));
    assertEqual(unhideCalls.length, 0, 'Should NOT have unhidden');
  });

  test('rejects invalid action', async () => {
    try {
      await ReportService.resolveReport('r-1', 'mod-1', 'invalid');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 400, `Expected 400, got ${err.statusCode}`);
    }
  });

  test('throws NotFoundError for missing report', async () => {
    mockQueryOneResults.push(null);

    try {
      await ReportService.resolveReport('bad-id', 'mod-1', 'resolved');
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `Expected 404, got ${err.statusCode}`);
    }
  });
});

describe('getReportsForPost', () => {
  test('returns reports for a specific post', async () => {
    mockQueryAllResults.push([
      { id: 'r-1', post_id: 'post-1', reporter_name: 'agent1' },
      { id: 'r-2', post_id: 'post-1', reporter_name: 'agent2' }
    ]);

    const reports = await ReportService.getReportsForPost('post-1');
    assertEqual(reports.length, 2);
  });
});

describe('hasReported', () => {
  test('returns true when agent has reported', async () => {
    mockQueryOneResults.push({ id: 'r-1' });

    const result = await ReportService.hasReported('post-1', 'agent-1');
    assertEqual(result, true);
  });

  test('returns false when agent has not reported', async () => {
    mockQueryOneResults.push(null);

    const result = await ReportService.hasReported('post-1', 'agent-1');
    assertEqual(result, false);
  });
});

describe('reason validation', () => {
  test('accepts all valid reasons', async () => {
    for (const reason of ['spam', 'harassment', 'off_topic', 'other']) {
      resetMocks();
      mockQueryOneResults.push({ id: 'post-1', author_id: 'author-1' });
      mockQueryOneResults.push(null);
      mockQueryOneResults.push({ id: `r-${reason}`, post_id: 'post-1', reporter_id: 'agent-1', reason, status: 'pending' });
      mockQueryOneResults.push(undefined); // mod log
      mockQueryOneResults.push({ cnt: 1 });

      const report = await ReportService.createReport('post-1', 'agent-1', reason, null);
      assertEqual(report.reason, reason);
    }
  });
});

runTests();
