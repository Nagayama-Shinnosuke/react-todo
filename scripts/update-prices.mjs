import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = async (path) => (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');

export function renderPrices(html, products) {
  // DOM全体の再出力を避け、価格テキストの範囲だけを差し替える。
  // コメント・スクリプト等に書かれたHTMLの例は対象にしない。
  const tokens = [...html.matchAll(/<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title)\b(?:"[^"]*"|'[^']*'|[^'">])*\>[\s\S]*?<\/\1\s*>|<\/?[a-zA-Z][\w:-]*\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)];
  const edits = [];
  const unsupported = new Set('area base br col embed hr img input link meta param source track wbr script style textarea title template'.split(' '));
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token[0].startsWith('<!--') || token[0].startsWith('</')) continue;
    const opening = token[0].match(/^<([\w:-]+)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/);
    if (!opening) continue;
    const [, tag, attrs] = opening;
    const attributes = [...attrs.matchAll(/([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)];
    const ids = attributes.filter(attr => attr[1].toLowerCase() === 'data-price-id');
    if (!ids.length) continue;
    const id = ids[0][2] ?? ids[0][3];
    if (ids.length !== 1 || !id || !/^[a-z0-9-]+$/.test(id)) {
      throw new Error('data-price-id の書式を確認してください（引用符で囲んだ有効なIDを1つ指定）。');
    }
    if (unsupported.has(tag.toLowerCase()) || /\/\s*>$/.test(opening[0])) {
      throw new Error(`${id}: ${tag} は価格の更新対象にできません。終了タグのある表示要素を使用してください。`);
    }
    const next = tokens[i + 1];
    const closingTag = next?.[0].match(/^<\/([\w:-]+)\s*>$/)?.[1];
    if (!closingTag || closingTag.toLowerCase() !== tag.toLowerCase()) {
      throw new Error(`${id}: 価格要素には明示的な終了タグが必要です。子タグ・コメントを含めず、価格だけの要素にIDを付けてください。`);
    }
    const start = token.index + opening[0].length;
    const content = html.slice(start, next.index);
    if (content.includes('<')) throw new Error(`${id}: 価格要素の中はテキストのみにしてください。`);
    const product = products.get(id);
    if (!product) throw new Error(`未登録の価格ID: ${id}`);
    const whitespace = content.match(/^(\s*)([\s\S]*?)(\s*)$/);
    edits.push({ start, end: next.index, text: whitespace[1] + product.price + whitespace[3] });
  }
  let output = html;
  for (const edit of edits.toReversed()) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  for (const p of output.matchAll(/<p\b[^>]*class="[^"]*\bpanel_price-price\b[^"]*"[^>]*>([\s\S]*?)<\/p>/g)) {
    if (/<span>\s*[¥￥]/.test(p[1])) throw new Error('商品パネルに data-price-id 未設定の価格があります。');
  }
  return { output, count: edits.length };
}

export function validateProducts(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('products は空でない配列にしてください。');
  const products = new Map();
  for (const row of rows) {
    if (!row || !/^[a-z0-9-]+$/.test(row.id) || typeof row.name !== 'string' || !row.name.trim()
      || typeof row.price !== 'string' || !/^¥(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?[～~]?$/.test(row.price)) {
      throw new Error(`商品データの形式が不正です: ${JSON.stringify(row)}`);
    }
    if (products.has(row.id)) throw new Error(`価格IDが重複しています: ${row.id}`);
    products.set(row.id, row);
  }
  return products;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check')) throw new Error('使い方: node scripts/update-prices.mjs [--check]');
  const check = args.includes('--check');
  const data = JSON.parse(await read(resolve(root, 'data/prices.json')));
  const products = validateProducts(data.products);
  const config = JSON.parse(await read(resolve(root, 'price-pages.json')));
  if (!Array.isArray(config.pages) || !config.pages.length) throw new Error('pages にHTMLを指定してください。');
  const changes = [];
  let total = 0;
  // 全ページを検証してから書き込む。入力エラー時は一切変更しない。
  for (const page of config.pages) {
    if (typeof page !== 'string' || !page.endsWith('.html')) throw new Error('対象は .html ファイルにしてください。');
    const path = resolve(root, page);
    const rel = relative(root, path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('対象はプロジェクト内に指定してください。');
    const original = await readFile(path, 'utf8');
    const { output, count } = renderPrices(original, products);
    if (!count) throw new Error(`${page}: 価格IDがありません。`);
    total += count;
    if (output !== original) changes.push({ path, page, output });
  }
  if (check && changes.length) {
    throw new Error(`価格が未反映です: ${changes.map(c => c.page).join(', ')}。更新コマンドを実行してください。`);
  }
  for (const change of changes) await writeFile(change.path, change.output, 'utf8');
  console.log(`${check ? '確認完了' : '更新完了'}: ${config.pages.length}ページ / ${total}か所 / 変更${changes.length}ファイル`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
