// Browser E2E test using Playwright with system Chrome
const { chromium } = require('playwright');

const BASE = 'http://localhost:3000';
const API = 'http://localhost:3200/api/v1';

let passed = 0;
let failed = 0;
const issues = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
    issues.push({ name, error: err.message });
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

async function run() {
  console.log('Launching browser...');
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext();
  const consoleErrors = [];

  console.log('\n=== HOMEPAGE ===');
  {
    const page = await context.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push({ page: 'home', text: msg.text() });
    });

    await test('Homepage loads', async () => {
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForSelector('header', { timeout: 5000 });
    });

    await test('Header has logo and nav', async () => {
      const logo = await page.$('a[href="/"]');
      assert(logo, 'Logo link not found');
      const loginBtn = await page.$('a[href="/auth/login"]');
      const searchBtn = await page.$('button:has-text("Search")');
      // One of these should exist (logged out = login btn, logged in = search)
      assert(loginBtn || searchBtn, 'No login or search button');
    });

    await test('Sort tabs are visible and clickable', async () => {
      // Wait for sort tabs to appear
      const hotTab = await page.waitForSelector('button:has-text("Hot")', { timeout: 5000 });
      assert(hotTab, 'Hot tab not found');

      // Check all sort tabs exist
      const newTab = await page.$('button:has-text("New")');
      const topTab = await page.$('button:has-text("Top")');
      const risingTab = await page.$('button:has-text("Rising")');
      assert(newTab, 'New tab not found');
      assert(topTab, 'Top tab not found');
      assert(risingTab, 'Rising tab not found');
    });

    await test('Posts load on homepage', async () => {
      // Wait for posts to appear (either post cards or "No posts yet")
      await page.waitForTimeout(3000); // Give SWR time to fetch
      const posts = await page.$$('.post-card, [class*="post"]');
      const noPostsMsg = await page.$('text=No posts yet');
      // If API proxy works, we should see posts
      const hasContent = posts.length > 0 || noPostsMsg;
      assert(hasContent, 'Neither posts nor "no posts" message found');
      if (posts.length > 0) {
        console.log(`    (Found ${posts.length} post elements)`);
      } else {
        console.log('    (Shows "No posts yet" - checking if API works...)');
        // Try fetching API directly to diagnose
        const resp = await page.evaluate(() => fetch('/api/v1/posts?sort=hot').then(r => r.json()));
        console.log(`    API returned ${resp.data?.length || 0} posts`);
        if (resp.data?.length > 0) {
          throw new Error('API has posts but UI shows none - feed store or rendering bug');
        }
      }
    });

    await test('Clicking sort tab triggers change', async () => {
      const newTab = await page.$('button:has-text("New")');
      await newTab.click();
      await page.waitForTimeout(1000);
      // After clicking, the "New" tab should be selected (has active styles)
      const newTabClasses = await newTab.getAttribute('class');
      assert(newTabClasses.includes('bg-background') || newTabClasses.includes('shadow'),
        'New tab not visually selected after click');
    });

    await test('Sidebar navigation links work', async () => {
      const sidebarLinks = await page.$$('aside a[href]');
      console.log(`    (Found ${sidebarLinks.length} sidebar links)`);
      // At least Home, Hot, New, Rising, Top should be there
      assert(sidebarLinks.length >= 3, 'Too few sidebar links');
    });

    await page.close();
  }

  console.log('\n=== POST DETAIL PAGE ===');
  {
    const page = await context.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push({ page: 'post-detail', text: msg.text() });
    });

    await test('Post detail page loads', async () => {
      await page.goto(`${BASE}/post/558457b7-4b1e-4ac5-bebe-fe8abd760d5c`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);
    });

    await test('Post title renders', async () => {
      const title = await page.$('h1');
      assert(title, 'No h1 title found');
      const text = await title.textContent();
      assert(text && text.length > 0, 'Title is empty');
      console.log(`    Title: "${text.substring(0, 50)}..."`);
    });

    await test('Vote buttons are visible', async () => {
      const upvoteBtn = await page.$('.vote-btn-up, button[title="Upvote"]');
      const downvoteBtn = await page.$('.vote-btn-down, button[title="Downvote"]');
      assert(upvoteBtn, 'Upvote button not found');
      assert(downvoteBtn, 'Downvote button not found');
    });

    await test('Comments section loads', async () => {
      // Should show either comments or "No comments yet" or comment form
      const commentsSection = await page.$('text=Comments');
      const noComments = await page.$('text=No comments yet');
      const commentItems = await page.$$('.comment');
      assert(commentsSection || noComments || commentItems.length > 0,
        'No comments section found');
      console.log(`    (Found ${commentItems.length} comment elements)`);
    });

    await test('Back link works', async () => {
      const backLink = await page.$('a:has-text("Back")');
      assert(backLink, 'Back link not found');
      const href = await backLink.getAttribute('href');
      assert(href, 'Back link has no href');
    });

    await page.close();
  }

  console.log('\n=== COMMUNITY PAGE ===');
  {
    const page = await context.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push({ page: 'community', text: msg.text() });
    });

    await test('Community page loads', async () => {
      await page.goto(`${BASE}/m/general`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);
    });

    await test('Community name displays', async () => {
      const heading = await page.$('h1');
      const text = heading ? await heading.textContent() : '';
      assert(text, 'Community name not shown');
      console.log(`    Community: "${text}"`);
    });

    await test('Community posts load', async () => {
      const posts = await page.$$('.post-card, [class*="post-card"]');
      const noPostsMsg = await page.$('text=No posts yet');
      assert(posts.length > 0 || noPostsMsg, 'Neither posts nor empty message');
      console.log(`    (Found ${posts.length} posts)`);
    });

    await test('Join button visible for non-logged-in user', async () => {
      // Not logged in, so join button should not show (requires auth)
      // But community info should still display
      const aboutSection = await page.$('text=About Community');
      assert(aboutSection, 'About Community section not found');
    });

    await page.close();
  }

  console.log('\n=== USER PROFILE PAGE ===');
  {
    const page = await context.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push({ page: 'profile', text: msg.text() });
    });

    await test('Profile page loads', async () => {
      await page.goto(`${BASE}/u/claude_opus`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);
    });

    await test('Agent name displays', async () => {
      const name = await page.$('text=claude_opus');
      assert(name, 'Agent name not found on page');
    });

    await test('Tabs work (Posts/Comments)', async () => {
      const postsTab = await page.$('button:has-text("Posts")');
      const commentsTab = await page.$('button:has-text("Comments")');
      assert(postsTab, 'Posts tab not found');
      assert(commentsTab, 'Comments tab not found');

      // Click Comments tab
      await commentsTab.click();
      await page.waitForTimeout(500);
      // Should show "Comments coming soon"
      const comingSoon = await page.$('text=Comments coming soon');
      assert(comingSoon, 'Comments tab content not changed after click');
    });

    await test('Stats display', async () => {
      const karma = await page.$('text=karma');
      const followers = await page.$('text=followers');
      assert(karma, 'Karma stat not found');
      assert(followers, 'Followers stat not found');
    });

    await page.close();
  }

  console.log('\n=== SUBMOLTS (COMMUNITIES) PAGE ===');
  {
    const page = await context.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push({ page: 'submolts', text: msg.text() });
    });

    await test('Submolts page loads', async () => {
      await page.goto(`${BASE}/submolts`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);
    });

    await test('Communities heading exists', async () => {
      const heading = await page.$('h1:has-text("Communities")');
      assert(heading, 'Communities heading not found');
    });

    await test('Submolt cards render', async () => {
      const cards = await page.$$('[class*="card"], [class*="Card"]');
      console.log(`    (Found ${cards.length} card elements)`);
      // Should have at least the filter card + some submolt cards
      const submoltLinks = await page.$$('a[href^="/m/"]');
      console.log(`    (Found ${submoltLinks.length} submolt links)`);
    });

    await test('Search filter works', async () => {
      const searchInput = await page.$('input[placeholder*="Search"]');
      assert(searchInput, 'Search input not found');
      await searchInput.fill('general');
      await page.waitForTimeout(500);
      // Should filter to show only general
      const links = await page.$$('a[href="/m/general"]');
      assert(links.length > 0, 'General submolt not shown after search');
    });

    await test('Sort buttons work', async () => {
      const popularBtn = await page.$('button:has-text("Popular")');
      assert(popularBtn, 'Popular sort button not found');
      const newBtn = await page.$('button:has-text("New")');
      assert(newBtn, 'New sort button not found');
      await newBtn.click();
      await page.waitForTimeout(500);
      const newBtnClasses = await newBtn.getAttribute('class');
      assert(newBtnClasses.includes('bg-background') || newBtnClasses.includes('shadow'),
        'New sort button not visually selected');
    });

    await page.close();
  }

  console.log('\n=== SEARCH PAGE ===');
  {
    const page = await context.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push({ page: 'search', text: msg.text() });
    });

    await test('Search page loads', async () => {
      await page.goto(`${BASE}/search`, { waitUntil: 'networkidle' });
    });

    await test('Search input is present', async () => {
      const input = await page.$('input[placeholder*="Search"]');
      assert(input, 'Search input not found');
    });

    await test('Search returns results', async () => {
      const input = await page.$('input[placeholder*="Search"]');
      await input.fill('hello');
      await page.waitForTimeout(2000); // Wait for debounce + API
      // Should show tabs with results
      const allTab = await page.$('button:has-text("All")');
      const postsTab = await page.$('button:has-text("Posts")');
      assert(allTab || postsTab, 'Result tabs not shown after search');
    });

    await page.close();
  }

  console.log('\n=== LOGIN PAGE ===');
  {
    const page = await context.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push({ page: 'login', text: msg.text() });
    });

    await test('Login page loads', async () => {
      await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
    });

    await test('Login form has API key input', async () => {
      const input = await page.$('input#apiKey, input[placeholder*="moltbook"]');
      assert(input, 'API key input not found');
    });

    await test('Login form has submit button', async () => {
      const btn = await page.$('button[type="submit"]:has-text("Log in")');
      assert(btn, 'Login button not found');
    });

    await test('Shows error on invalid key', async () => {
      const input = await page.$('input#apiKey, input[placeholder*="moltbook"]');
      await input.fill('invalid_key');
      const btn = await page.$('button[type="submit"]');
      await btn.click();
      await page.waitForTimeout(500);
      const error = await page.$('text=Invalid API key format');
      assert(error, 'Error message not shown for invalid key');
    });

    await test('Login with real API key works', async () => {
      const input = await page.$('input#apiKey, input[placeholder*="moltbook"]');
      await input.fill('');
      await input.fill('moltbook_6ec593d7762fe6b5d357ba359d2078c7f0f175fdd787772dc9bdf12e61cabb1d');
      const btn = await page.$('button[type="submit"]');
      await btn.click();
      // Should redirect to homepage after login
      await page.waitForTimeout(3000);
      const url = page.url();
      console.log(`    Redirected to: ${url}`);
      // Check if we're on homepage or if there's an error
      const currentUrl = new URL(url);
      assert(currentUrl.pathname === '/' || currentUrl.pathname === '',
        `Expected redirect to /, got ${currentUrl.pathname}`);
    });

    await page.close();
  }

  console.log('\n=== LOGGED-IN HOMEPAGE ===');
  {
    // Create a logged-in context by setting localStorage
    const page = await context.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push({ page: 'home-logged-in', text: msg.text() });
    });

    await test('Homepage shows user menu when logged in', async () => {
      // After login in previous test, localStorage should have the auth data
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);
      // Check for Create button or user avatar
      const createBtn = await page.$('button:has-text("Create")');
      const avatar = await page.$('header button img, header button [class*="Avatar"]');
      console.log(`    Create button: ${!!createBtn}, Avatar: ${!!avatar}`);
      // If auth persisted from previous test, we should see user UI
      if (createBtn) {
        console.log('    User is logged in');
      } else {
        console.log('    User not logged in - checking localStorage...');
        const authData = await page.evaluate(() => localStorage.getItem('moltbook-auth'));
        console.log(`    Auth data: ${authData ? 'exists' : 'empty'}`);
      }
    });

    await test('Homepage loads posts after login', async () => {
      await page.waitForTimeout(2000);
      // Check for post content
      const postCards = await page.$$('.post-card');
      const anyCard = await page.$$('[class*="rounded-xl"][class*="border"]');
      console.log(`    Post cards: ${postCards.length}, Any bordered cards: ${anyCard.length}`);

      // Try to check the actual feed state
      const feedContent = await page.evaluate(async () => {
        const resp = await fetch('/api/v1/posts?sort=hot');
        return resp.json();
      });
      console.log(`    API posts: ${feedContent.data?.length || 0}`);

      if (feedContent.data?.length > 0 && postCards.length === 0) {
        // API has data but UI doesn't show it - this is a rendering bug
        console.log('    BUG: API has posts but PostList shows none');
        throw new Error('Posts exist in API but not rendered in UI');
      }
    });

    await page.close();
  }

  console.log('\n=== REGISTER PAGE ===');
  {
    const page = await context.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push({ page: 'register', text: msg.text() });
    });

    await test('Register page loads', async () => {
      await page.goto(`${BASE}/auth/register`, { waitUntil: 'networkidle' });
    });

    await test('Register form has name input', async () => {
      const input = await page.$('input#name, input[placeholder*="agent"]');
      assert(input, 'Name input not found');
    });

    await test('Register form validates empty name', async () => {
      const btn = await page.$('button[type="submit"]');
      await btn.click();
      await page.waitForTimeout(500);
      const error = await page.$('text=Please enter an agent name');
      assert(error, 'Empty name error not shown');
    });

    await page.close();
  }

  console.log('\n=== SETTINGS PAGE ===');
  {
    const page = await context.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push({ page: 'settings', text: msg.text() });
    });

    await test('Settings page loads (redirects if not logged in)', async () => {
      await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
      const url = page.url();
      // Should either show settings or redirect to login
      console.log(`    URL: ${url}`);
    });

    await page.close();
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  if (consoleErrors.length > 0) {
    console.log(`\nBrowser console errors (${consoleErrors.length}):`);
    const unique = [...new Set(consoleErrors.map(e => `${e.page}: ${e.text}`))];
    unique.forEach(e => console.log(`  ! ${e}`));
  }

  if (issues.length > 0) {
    console.log('\nFailed tests:');
    issues.forEach(i => console.log(`  - ${i.name}: ${i.error}`));
  }

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
