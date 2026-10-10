import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAllowed, parseRobots } from '../src/net/robots.ts';

function allowed(robotsText: string, path: string, agent = 'Regmark'): boolean {
  return isAllowed(parseRobots(robotsText), agent, path);
}

test('an empty file allows everything', () => {
  assert.equal(allowed('', '/'), true);
  assert.equal(allowed('', '/anything/at/all?x=1'), true);
});

test('Disallow: / blocks the whole site except robots.txt', () => {
  const txt = 'User-agent: *\nDisallow: /';
  assert.equal(allowed(txt, '/'), false);
  assert.equal(allowed(txt, '/a/b'), false);
  assert.equal(allowed(txt, '/robots.txt'), true);
});

test('an empty Disallow value allows everything', () => {
  assert.equal(allowed('User-agent: *\nDisallow:', '/x'), true);
});

test('empty pathAndQuery is treated as /', () => {
  assert.equal(allowed('User-agent: *\nDisallow: /', ''), false);
  assert.equal(allowed('User-agent: *\nDisallow: /a', ''), true);
});

test('longest match wins over a shorter opposing rule', () => {
  const txt = 'User-agent: *\nAllow: /p\nDisallow: /page';
  assert.equal(allowed(txt, '/page'), false);
  assert.equal(allowed(txt, '/p'), true);
  assert.equal(allowed(txt, '/pa'), true);
});

test('on a tie, allow wins', () => {
  const txt = 'User-agent: *\nAllow: /folder\nDisallow: /folder';
  assert.equal(allowed(txt, '/folder'), true);
  assert.equal(allowed(txt, '/folderx'), true);
});

test('a longer wildcard disallow beats a shorter allow', () => {
  const txt = 'User-agent: *\nAllow: /page\nDisallow: /*.htm';
  assert.equal(allowed(txt, '/page.htm'), false);
  assert.equal(allowed(txt, '/page'), true);
});

test('$ anchors the end of the path', () => {
  const txt = 'User-agent: *\nDisallow: /*.php$';
  assert.equal(allowed(txt, '/index.php'), false);
  assert.equal(allowed(txt, '/index.php?x=1'), true);
  assert.equal(allowed(txt, '/index.phpx'), true);
});

test('a trailing * behaves like no wildcard at all', () => {
  const txt = 'User-agent: *\nDisallow: /fish*';
  assert.equal(allowed(txt, '/fish'), false);
  assert.equal(allowed(txt, '/fishheads'), false);
  assert.equal(allowed(txt, '/fish.html'), false);
  assert.equal(allowed(txt, '/Fish.asp'), true);
  assert.equal(allowed(txt, '/catfish'), true);
});

test('a trailing slash limits the match to that directory', () => {
  const txt = 'User-agent: *\nDisallow: /fish/';
  assert.equal(allowed(txt, '/fish/'), false);
  assert.equal(allowed(txt, '/fish/salmon'), false);
  assert.equal(allowed(txt, '/fish'), true);
  assert.equal(allowed(txt, '/fish.html'), true);
});

test('a specific group replaces the wildcard group entirely', () => {
  const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: regmark\nAllow: /';
  assert.equal(allowed(txt, '/x'), true);
  assert.equal(allowed(txt, '/x', 'other'), false);
});

test('agent matching is case-insensitive and ignores version suffixes', () => {
  const txt = 'User-agent: Regmark/1.0\nDisallow: /x';
  assert.equal(allowed(txt, '/x', 'regmark'), false);
  assert.equal(allowed(txt, '/x', 'REGMARK'), false);
  assert.equal(allowed(txt, '/y', 'regmark'), true);
});

test('two groups naming the same agent are merged', () => {
  const txt = 'User-agent: regmark\nDisallow: /a\n\nUser-agent: regmark\nDisallow: /b';
  assert.equal(allowed(txt, '/a'), false);
  assert.equal(allowed(txt, '/b'), false);
  assert.equal(allowed(txt, '/c'), true);
});

test('consecutive User-agent lines share the rules that follow', () => {
  const txt = 'User-agent: alpha\nUser-agent: regmark\nDisallow: /x';
  assert.equal(allowed(txt, '/x', 'alpha'), false);
  assert.equal(allowed(txt, '/x', 'regmark'), false);
});

test('a User-agent line after rules starts a new group', () => {
  const txt = 'User-agent: *\nDisallow: /a\nUser-agent: regmark\nDisallow: /b';
  assert.equal(allowed(txt, '/a', 'regmark'), true);
  assert.equal(allowed(txt, '/b', 'regmark'), false);
  assert.equal(allowed(txt, '/a', 'other'), false);
});

test('an empty Disallow also ends the User-agent run', () => {
  const parsed = parseRobots('User-agent: a\nDisallow:\nUser-agent: b\nDisallow: /x');
  assert.deepEqual(parsed.groups, [
    { agents: ['a'], rules: [] },
    { agents: ['b'], rules: [{ allow: false, pattern: '/x' }] },
  ]);
});

test('rules before any User-agent line are ignored', () => {
  const txt = 'Disallow: /x\nUser-agent: *\nAllow: /';
  assert.equal(allowed(txt, '/x'), true);
});

test('comments and blank lines are ignored', () => {
  const txt = '# top comment\n\nUser-agent: * # everyone\n   \n  Disallow: /private # secret\n# end';
  assert.equal(allowed(txt, '/private/x'), false);
  assert.equal(allowed(txt, '/public'), true);
});

test('CRLF and bare CR line endings work', () => {
  assert.equal(allowed('User-agent: *\r\nDisallow: /a\r\n', '/a'), false);
  assert.equal(allowed('User-agent: *\rDisallow: /a\r', '/a'), false);
});

test('a leading UTF-8 BOM is tolerated', () => {
  assert.equal(allowed('﻿User-agent: *\nDisallow: /x', '/x'), false);
});

test('keys are case-insensitive', () => {
  assert.equal(allowed('USER-AGENT: *\nDISALLOW: /x', '/x'), false);
  assert.equal(allowed('User-Agent: *\nDisAllow: /x', '/x'), false);
});

test('lines without a colon and unknown keys are ignored', () => {
  const txt = 'User-agent: *\nthis is nonsense\nCrawl-delay: 10\nDisallow: /x';
  assert.equal(allowed(txt, '/x'), false);
});

test('an unknown key in the middle of a group does not split it', () => {
  const parsed = parseRobots('User-agent: *\nDisallow: /a\nCrawl-delay: 5\nDisallow: /b');
  assert.deepEqual(parsed.groups, [
    {
      agents: ['*'],
      rules: [
        { allow: false, pattern: '/a' },
        { allow: false, pattern: '/b' },
      ],
    },
  ]);
});

test('Sitemap lines are collected in full, wherever they appear', () => {
  const txt = [
    'User-agent: *',
    'Disallow: /cart',
    'Sitemap: https://shop.example/sitemap.xml',
    'Disallow: /admin',
    'sitemap:https://shop.example/other.xml',
    'Sitemap:',
  ].join('\n');
  const parsed = parseRobots(txt);
  assert.deepEqual(parsed.sitemaps, ['https://shop.example/sitemap.xml', 'https://shop.example/other.xml']);
  assert.equal(parsed.groups[0].rules.length, 2);
});

test('percent-encoded paths match after normalisation', () => {
  assert.equal(allowed('User-agent: *\nDisallow: /a%3cd', '/a%3Cd'), false);
  assert.equal(allowed('User-agent: *\nDisallow: /%7Euser', '/~user'), false);
  assert.equal(allowed('User-agent: *\nDisallow: /~user', '/%7euser'), false);
});

for (const [name, raw, encoded] of [
  ['Chinese', '/商品', '/%E5%95%86%E5%93%81'],
  ['accented', '/café', '/caf%C3%A9'],
  ['astral', '/🛒', '/%F0%9F%9B%92'],
]) {
  test(`${name} paths match raw and UTF-8 percent-encoded rules`, () => {
    const forms = [raw, encoded, encoded.toLowerCase()];
    for (const pattern of forms) {
      for (const path of forms) {
        assert.equal(allowed(`User-agent: *\nDisallow: ${pattern}`, path), false, `${pattern} matches ${path}`);
      }
    }
    // The fetcher passes URL.pathname, which percent-encodes raw Unicode.
    const url = new URL(raw, 'https://shop.example');
    assert.equal(allowed(`User-agent: *\nDisallow: ${raw}`, url.pathname), false);
    assert.equal(allowed(`User-agent: *\nDisallow: ${raw}`, '/other'), true);
    // Equivalent spellings must also have equal specificity, so allow wins.
    assert.equal(allowed(`User-agent: *\nAllow: ${raw}\nDisallow: ${encoded}`, encoded), true);
    assert.equal(allowed(`User-agent: *\nDisallow: ${raw}\nAllow: ${encoded}`, raw), true);
  });
}

test('Unicode normalisation preserves wildcards, anchors and query strings', () => {
  const txt = 'User-agent: *\nDisallow: /商品/*?name=café🛒$';
  const path = '/商品/item?name=café🛒';
  const url = new URL(path, 'https://shop.example');
  assert.equal(allowed(txt, path), false);
  assert.equal(allowed(txt, url.pathname + url.search), false);
  assert.equal(allowed(txt, '/%E5%95%86%E5%93%81/?name=caf%C3%A9%F0%9F%9B%92'), false);
  assert.equal(allowed(txt, url.pathname + url.search + '&extra=1'), true);
  assert.equal(allowed(txt, '/other/item?name=café🛒'), true);
});

test('Unicode normalisation preserves reserved and double-encoded escapes', () => {
  const txt = 'User-agent: *\nDisallow: /商品/a%2fb%2Ac%24$';
  assert.equal(allowed(txt, '/%E5%95%86%E5%93%81/a%2Fb%2ac%24'), false);
  assert.equal(allowed(txt, '/商品/a/b%2Ac%24'), true);
  assert.equal(allowed(txt, '/商品/a%2FbANYc%24'), true);
  assert.equal(allowed(txt, '/商品/a%2Fb%2Ac'), true);
  assert.equal(allowed('User-agent: *\nDisallow: /商品/%24', '/商品/%24tail'), false);
  assert.equal(allowed('User-agent: *\nDisallow: /café', '/caf%25C3%25A9'), true);
  assert.equal(allowed('User-agent: *\nDisallow: /caf%25C3%25A9', '/café'), true);
});

test('Unicode matching remains case-sensitive and does not fold distinct code points', () => {
  const txt = 'User-agent: *\nDisallow: /café';
  assert.equal(allowed(txt, '/caf%C3%89'), true);
  assert.equal(allowed(txt, '/cafe%CC%81'), true);
});

test('escapes of reserved characters are left alone', () => {
  // %2F is a slash in disguise and must not be decoded into one.
  assert.equal(allowed('User-agent: *\nDisallow: /a%2fb', '/a/b'), true);
  assert.equal(allowed('User-agent: *\nDisallow: /a%2fb', '/a%2Fb'), false);
});

test('a WordPress-style file', () => {
  const txt = 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php';
  assert.equal(allowed(txt, '/wp-admin/x'), false);
  assert.equal(allowed(txt, '/wp-admin/admin-ajax.php'), true);
  assert.equal(allowed(txt, '/wp-json/wc/store/v1/products'), true);
});

test('a pathological pattern returns quickly', () => {
  const txt = `User-agent: *\nDisallow: /${'*'.repeat(40)}x`;
  const start = performance.now();
  const result = allowed(txt, `/${'a'.repeat(100_000)}`);
  const elapsed = performance.now() - start;
  assert.equal(result, true);
  assert.ok(elapsed < 1000, `took ${elapsed} ms`);
});

test('a pathological anchored pattern returns quickly', () => {
  const txt = `User-agent: *\nDisallow: /${'*a'.repeat(200)}*b$`;
  const start = performance.now();
  const result = allowed(txt, `/${'a'.repeat(100_000)}`);
  const elapsed = performance.now() - start;
  assert.equal(result, true);
  assert.ok(elapsed < 1000, `took ${elapsed} ms`);
});

test('query strings are part of what is matched', () => {
  const txt = 'User-agent: *\nDisallow: /*?add-to-cart=';
  assert.equal(allowed(txt, '/shop/?add-to-cart=12'), false);
  assert.equal(allowed(txt, '/shop/'), true);
});

test('patterns are case-sensitive', () => {
  assert.equal(allowed('User-agent: *\nDisallow: /Admin', '/admin'), true);
});

test('rules past the 512 KiB cap are ignored', () => {
  const txt = `User-agent: *\n# ${'a'.repeat(600 * 1024)}\nDisallow: /secret\n`;
  assert.equal(allowed(txt, '/secret'), true);
});

test('rules within the 512 KiB cap are honoured, counting UTF-8 bytes', () => {
  const early = 'User-agent: *\nDisallow: /early\n';
  assert.equal(allowed(early + '#' + 'a'.repeat(1000), '/early'), false);

  // 200k three-byte characters is about 600 KB of UTF-8, so the rule after it is cut.
  const multibyte = `User-agent: *\n#${'€'.repeat(200_000)}\nDisallow: /late\n`;
  assert.equal(allowed(multibyte, '/late'), true);
});

test('parseRobots returns the expected structure for a small file', () => {
  const txt = [
    '# sample',
    'User-agent: Googlebot/2.1',
    'Disallow: /private',
    '',
    'User-agent: *',
    'Allow: /',
    'Disallow: /cart?x',
    'Sitemap: https://shop.example/sitemap.xml',
    '',
  ].join('\n');
  assert.deepEqual(parseRobots(txt), {
    groups: [
      { agents: ['googlebot'], rules: [{ allow: false, pattern: '/private' }] },
      {
        agents: ['*'],
        rules: [
          { allow: true, pattern: '/' },
          { allow: false, pattern: '/cart?x' },
        ],
      },
    ],
    sitemaps: ['https://shop.example/sitemap.xml'],
  });
});

test('agent tokens keep only the leading run of [a-z0-9_-]', () => {
  const parsed = parseRobots('User-agent: My_Bot-2.0 (+http://x)\nDisallow: /x\nUser-agent: @@@\nDisallow: /y');
  // The second group names no usable agent, so it is dropped entirely.
  assert.deepEqual(parsed.groups, [{ agents: ['my_bot-2'], rules: [{ allow: false, pattern: '/x' }] }]);
});

test('an agent with no matching group and no wildcard group is allowed', () => {
  assert.equal(allowed('User-agent: googlebot\nDisallow: /', '/x', 'Regmark'), true);
});

test('a specific group with no rules overrides the wildcard group', () => {
  const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: regmark\n';
  assert.equal(allowed(txt, '/x'), true);
});
