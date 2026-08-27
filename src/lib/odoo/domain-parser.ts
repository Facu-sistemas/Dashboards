import { OdooError } from './types';
import type { OdooDomain } from './types';

/**
 * Parses the literal Python-repr string Odoo stores in `ir.filters.domain`
 * (e.g. `["&", ("date", ">=", "2026-06-01"), ("account_id", "in", [987])]`)
 * into the same OdooDomain shape this app already passes to the RPC client.
 *
 * Deliberately NOT `eval()` — this string is config data pulled live from
 * Odoo, and a hand-written tokenizer keeps that inert no matter what ends
 * up saved in a filter, instead of executing it as code.
 */
export function parseOdooDomainLiteral(raw: string): OdooDomain {
  const tokens = tokenize(raw);
  let pos = 0;

  function parseValue(): unknown {
    const t = tokens[pos++];
    if (!t) throw new OdooError('Unexpected end of Odoo domain literal');
    if (t.type === 'string' || t.type === 'number') return t.value;
    if (t.type === 'word') {
      if (t.value === 'True') return true;
      if (t.value === 'False') return false;
      if (t.value === 'None') return null;
      throw new OdooError(`Unexpected token "${t.value}" in Odoo domain literal`);
    }
    if (t.value === '[' || t.value === '(') {
      const close = t.value === '[' ? ']' : ')';
      const items: unknown[] = [];
      while (tokens[pos] && tokens[pos]!.value !== close) {
        items.push(parseValue());
        if (tokens[pos] && tokens[pos]!.value === ',') pos++;
      }
      const closeTok = tokens[pos++];
      if (!closeTok || closeTok.value !== close) {
        throw new OdooError('Unbalanced brackets in Odoo domain literal');
      }
      return items;
    }
    throw new OdooError(`Unexpected token in Odoo domain literal: "${t.value}"`);
  }

  const result = parseValue();
  if (!Array.isArray(result)) throw new OdooError('Odoo domain literal did not parse to a list');
  return result as OdooDomain;
}

type Token =
  | { type: 'punct'; value: string }
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'word'; value: string };

function tokenize(raw: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < raw.length) {
    const c = raw[i]!;
    if (c === ' ' || c === '\n' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '[' || c === ']' || c === '(' || c === ')' || c === ',') {
      tokens.push({ type: 'punct', value: c });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let value = '';
      while (j < raw.length && raw[j] !== quote) {
        if (raw[j] === '\\' && j + 1 < raw.length) {
          value += raw[j + 1];
          j += 2;
          continue;
        }
        value += raw[j];
        j++;
      }
      tokens.push({ type: 'string', value });
      i = j + 1;
      continue;
    }
    if (/[0-9-]/.test(c)) {
      let j = i + 1;
      while (j < raw.length && /[0-9.]/.test(raw[j]!)) j++;
      tokens.push({ type: 'number', value: Number(raw.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < raw.length && /[A-Za-z0-9_]/.test(raw[j]!)) j++;
      tokens.push({ type: 'word', value: raw.slice(i, j) });
      i = j;
      continue;
    }
    throw new OdooError(`Unexpected character "${c}" in Odoo domain literal`);
  }
  return tokens;
}
