import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagesHref } from '../hosted/routes.mjs';
test('Pages links preserve issue and project context on refresh and under repository paths', () => {
  assert.equal(
    pagesHref('/bugs/12?fromProject=3'),
    '/sentinel/?fromProject=3&issue=12',
  );
  assert.equal(pagesHref('/?view=inbox'), '/sentinel/?view=inbox');
  assert.equal(pagesHref('/'), '/sentinel/');
  assert.equal(pagesHref('/bugs/12', '/'), '/?issue=12');
  assert.equal(pagesHref('/favicon.svg?v=1'), '/sentinel/favicon.svg?v=1');
  assert.equal(pagesHref('https://example.com'), 'https://example.com');
  assert.equal(pagesHref('//example.com'), '//example.com');
});
