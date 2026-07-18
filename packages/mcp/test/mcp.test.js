import { spawn } from 'child_process';
import { strict as assert } from 'assert';

const API_KEY = 'test_key_for_unit_tests';

function startServer() {
  const proc = spawn('node', ['src/index.js'], {
    env: { ...process.env, MOLTBOOK_API_KEY: API_KEY, MOLTBOOK_API_URL: 'http://localhost:9999' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return proc;
}

function sendRequest(proc, request) {
  return new Promise((resolve, reject) => {
    let data = '';
    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for response'));
    }, 5000);

    proc.stdout.on('data', (chunk) => {
      data += chunk.toString();
      try {
        const parsed = JSON.parse(data);
        clearTimeout(timeout);
        resolve(parsed);
      } catch {}
    });
    proc.stdin.write(JSON.stringify(request) + '\n');
  });
}

async function test_initialize() {
  const proc = startServer();
  try {
    const res = await sendRequest(proc, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } }
    });
    assert.equal(res.result.serverInfo.name, 'moltbook');
    assert.equal(res.result.serverInfo.version, '0.1.0');
    assert.deepEqual(res.result.capabilities, { tools: {} });
    console.log('✓ initialize returns server info');
  } finally {
    proc.kill();
  }
}

async function test_list_tools() {
  const proc = startServer();
  try {
    await sendRequest(proc, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } }
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    
    let data = '';
    const res = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
      proc.stdout.removeAllListeners('data');
      proc.stdout.on('data', (chunk) => {
        data += chunk.toString();
        try {
          const parsed = JSON.parse(data);
          clearTimeout(timeout);
          resolve(parsed);
        } catch {}
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
    });
    
    assert.equal(res.result.tools.length, 10);
    const toolNames = res.result.tools.map(t => t.name).sort();
    assert(toolNames.includes('create_post'));
    assert(toolNames.includes('list_posts'));
    assert(toolNames.includes('get_post'));
    assert(toolNames.includes('create_comment'));
    assert(toolNames.includes('search'));
    assert(toolNames.includes('get_notifications'));
    assert(toolNames.includes('get_feed'));
    assert(toolNames.includes('react'));
    assert(toolNames.includes('get_profile'));
    assert(toolNames.includes('follow_agent'));
    console.log('✓ tools/list returns all 10 tools');
  } finally {
    proc.kill();
  }
}

async function test_tool_schemas() {
  const proc = startServer();
  try {
    await sendRequest(proc, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } }
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    
    let data = '';
    const res = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
      proc.stdout.removeAllListeners('data');
      proc.stdout.on('data', (chunk) => {
        data += chunk.toString();
        try {
          const parsed = JSON.parse(data);
          clearTimeout(timeout);
          resolve(parsed);
        } catch {}
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
    });
    
    const createPost = res.result.tools.find(t => t.name === 'create_post');
    assert.deepEqual(createPost.inputSchema.required, ['title', 'content']);
    assert(createPost.inputSchema.properties.title);
    assert(createPost.inputSchema.properties.content);
    assert(createPost.inputSchema.properties.submolt);
    assert(createPost.inputSchema.properties.flair_name);
    
    const react = res.result.tools.find(t => t.name === 'react');
    assert.deepEqual(react.inputSchema.required, ['post_id', 'reaction_type']);
    assert.deepEqual(react.inputSchema.properties.reaction_type.enum, 
      ['thumbs_up', 'heart', 'celebration', 'thinking', 'eyes', 'rocket']);
    
    console.log('✓ tool schemas have correct required fields and enums');
  } finally {
    proc.kill();
  }
}

async function test_missing_api_key() {
  const proc = spawn('node', ['src/index.js'], {
    env: { ...process.env, MOLTBOOK_API_KEY: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  
  const code = await new Promise(resolve => proc.on('exit', resolve));
  assert.equal(code, 1);
  console.log('✓ exits with code 1 when MOLTBOOK_API_KEY is missing');
}

async function test_call_tool_error_handling() {
  const proc = startServer();
  try {
    await sendRequest(proc, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } }
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    
    let data = '';
    const res = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
      proc.stdout.removeAllListeners('data');
      proc.stdout.on('data', (chunk) => {
        data += chunk.toString();
        try {
          const parsed = JSON.parse(data);
          clearTimeout(timeout);
          resolve(parsed);
        } catch {}
      });
      proc.stdin.write(JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'get_profile', arguments: {} }
      }) + '\n');
    });
    
    assert.equal(res.result.isError, true);
    assert(res.result.content[0].text.startsWith('Error:'));
    console.log('✓ tools/call returns error when API is unreachable');
  } finally {
    proc.kill();
  }
}

// Run tests
console.log('Running MCP server tests...\n');
try {
  await test_missing_api_key();
  await test_initialize();
  await test_list_tools();
  await test_tool_schemas();
  await test_call_tool_error_handling();
  console.log('\n✅ All 5 tests passed');
} catch (err) {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
}
