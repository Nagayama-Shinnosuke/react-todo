import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPrices, validateProducts } from './update-prices.mjs';

const row = { id: 'pen-100', name: 'ペン100本', price: '¥1,234.5～' };
test('同一IDの複数掲載を更新し、周囲のHTMLを保持する', () => {
  const html = '<p>税込<span data-price-id="pen-100">¥100</span></p>';
  const result = renderPrices(html + html, validateProducts([row]));
  assert.equal(result.count, 2);
  assert.equal(result.output, (html.replace('¥100', row.price)).repeat(2));
  assert.equal(renderPrices(result.output, validateProducts([row])).output, result.output);
});
test('未知のID・未設定パネル・不正なマーカーを検出する', () => {
  const products = validateProducts([row]);
  assert.throws(() => renderPrices('<span data-price-id="missing">¥100</span>', products));
  assert.throws(() => renderPrices('<p class="panel_price-price"><span>¥100</span></p>', products));
  assert.throws(() => renderPrices('<span data-price-id=pen-100>¥100</span>', products));
});

test('テーブル・見出し・段落・任意の表示タグと単一引用符に対応する', () => {
  const html = `<table><tr><td class="price" data-price-id='pen-100'>\n  ¥100\n</td></tr></table>
<div data-price-id="pen-100">¥100</div><strong data-price-id="pen-100">¥100</strong>
<p data-price-id="pen-100">¥100</p><h3 data-price-id="pen-100">¥100</h3>
<TD title="a > b" DATA-PRICE-ID="pen-100">¥100</TD>`;
  const result = renderPrices(html, validateProducts([row]));
  assert.equal(result.count, 6);
  assert.equal(result.output, html.replaceAll('¥100', row.price));
});

test('説明や入れ子の装飾を誤って消さない', () => {
  const products = validateProducts([row]);
  for (const html of [
    '<td data-price-id="pen-100"><strong>¥100</strong>税込</td>',
    '<td data-price-id="pen-100">¥100<td>別のセル</td>',
    '<img data-price-id="pen-100">',
    '<script data-price-id="pen-100">¥100</script>',
    '<div data-price-id="pen-100" data-price-id="pen-100">¥100</div>',
  ]) assert.throws(() => renderPrices(html, products));
  const html = '<td><strong data-price-id="pen-100">¥100</strong>（税込）</td>';
  assert.equal(renderPrices(html, products).output, html.replace('¥100', row.price));
});

test('コメント・スクリプト・属性内のマーカー例は更新しない', () => {
  const html = `<!-- <td data-price-id="missing">¥100</td> -->
<script>const example = '<td data-price-id="missing">¥100</td>';</script>
<style>/* <b data-price-id="missing">¥100</b> */</style>
<textarea><b data-price-id="missing">¥100</b></textarea>
<div title='data-price-id="missing"'>¥100</div>
<td other-data-price-id="missing">¥100</td>`;
  assert.deepEqual(renderPrices(html, validateProducts([row])), { output: html, count: 0 });
});
test('重複ID・負数・HTML・不正な桁区切りを拒否する', () => {
  assert.throws(() => validateProducts([row, row]));
  for (const price of ['¥-1', '<script>', '¥1,23', '', 100]) {
    assert.throws(() => validateProducts([{ ...row, price }]));
  }
});
