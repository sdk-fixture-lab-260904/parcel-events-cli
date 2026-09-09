/**
 * CLI pager (Phase 0 C4a). Stop rules match skill `recipe-pagination.ts`
 * and the TS `AbstractPage` subclasses: empty page; null/'' cursor; cursor_url
 * replaces URL and clears query; offset += items; page_number += 1; totals;
 * item_cursor uses last item field + has_more === true. `--max-items` bounds
 * the accumulated ITEM list, not the page count.
 */
import type { CliPaginationBinding } from './model.js';
import {
  itemsAt,
  readPointer,
  readRoleValue,
  toFiniteNumber,
  withRoleValue,
  type PageQuery,
} from './pagination-locators.js';

function role(
  binding: CliPaginationBinding,
  name: string,
): { readonly location: string; readonly wireName: string } | undefined {
  const found = binding.request.find((entry) => entry.role === name);
  return found === undefined ? undefined : { location: found.location, wireName: found.wireName };
}

function pointer(binding: CliPaginationBinding, name: string): readonly string[] {
  return binding.response.find((entry) => entry.role === name)?.pointer ?? [];
}

export interface NextPage {
  readonly query: PageQuery;
  readonly done: boolean;
}

/** Items of THIS page + whether/how to fetch the next one. */
export function advancePage(binding: CliPaginationBinding, body: unknown, current: PageQuery): {
  readonly items: readonly unknown[];
  readonly next: PageQuery | null;
} {
  const items = itemsAt(body, pointer(binding, 'items'));
  switch (binding.type) {
    case 'single_page':
      return { items, next: null };
    case 'cursor':
      return { items, next: nextCursor({ binding, body, current, requestRole: 'cursor', responseRole: 'next_cursor' }) };
    case 'token':
      return { items, next: nextCursor({ binding, body, current, requestRole: 'page_token', responseRole: 'next_page_token' }) };
    case 'cursor_url':
      return { items, next: nextCursorUrl(binding, body, current, items.length) };
    case 'offset':
      return { items, next: nextOffset(binding, body, current, items.length) };
    case 'page_number':
      return { items, next: nextPageNumber(binding, body, current, items.length) };
    case 'item_cursor':
      return { items, next: nextItemCursor(binding, body, current, items) };
  }
}

function nextCursor(input: {
  readonly binding: CliPaginationBinding;
  readonly body: unknown;
  readonly current: PageQuery;
  readonly requestRole: string;
  readonly responseRole: string;
}): PageQuery | null {
  const { binding, body, current, requestRole, responseRole } = input;
  if (itemsAt(body, pointer(binding, 'items')).length === 0) return null;
  const cursor = role(binding, requestRole);
  if (cursor === undefined) return null;
  const next = readPointer(body, pointer(binding, responseRole));
  if (next === null || next === undefined || next === '') return null;
  if (typeof next !== 'string' && typeof next !== 'number') return null;
  return withRoleValue(current, cursor.location, cursor.wireName, next);
}

function nextCursorUrl(
  binding: CliPaginationBinding,
  body: unknown,
  current: PageQuery,
  count: number,
): PageQuery | null {
  if (count === 0) return null;
  const nextUrl = readPointer(body, pointer(binding, 'next_url'));
  if (typeof nextUrl !== 'string' || nextUrl === '') return null;
  return { url: nextUrl, query: {}, headers: current.headers };
}

function nextOffset(
  binding: CliPaginationBinding,
  body: unknown,
  current: PageQuery,
  count: number,
): PageQuery | null {
  if (count === 0) return null;
  const offset = role(binding, 'offset');
  if (offset === undefined) return null;
  const currentOffset = toFiniteNumber(readRoleValue(current, offset.location, offset.wireName)) ?? 0;
  const advanced = currentOffset + count;
  const total = toFiniteNumber(readPointer(body, pointer(binding, 'total')));
  if (total !== undefined && advanced >= total) return null;
  return withRoleValue(current, offset.location, offset.wireName, advanced);
}

function nextPageNumber(
  binding: CliPaginationBinding,
  body: unknown,
  current: PageQuery,
  count: number,
): PageQuery | null {
  if (count === 0) return null;
  const page = role(binding, 'page');
  if (page === undefined) return null;
  const currentPage = toFiniteNumber(readRoleValue(current, page.location, page.wireName)) ?? 1;
  const nextPage = currentPage + 1;
  const totalPages = toFiniteNumber(readPointer(body, pointer(binding, 'total_pages')));
  if (totalPages !== undefined && nextPage > totalPages) return null;
  return withRoleValue(current, page.location, page.wireName, nextPage);
}

function nextItemCursor(
  binding: CliPaginationBinding,
  body: unknown,
  current: PageQuery,
  items: readonly unknown[],
): PageQuery | null {
  if (items.length === 0) return null;
  const cursor = role(binding, 'cursor');
  if (cursor === undefined) return null;
  if (readPointer(body, pointer(binding, 'has_more')) !== true) return null;
  const last = items[items.length - 1];
  if (last === null || typeof last !== 'object') return null;
  const field = binding.itemCursorField ?? 'id';
  const value = (last as Record<string, unknown>)[field];
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  return withRoleValue(current, cursor.location, cursor.wireName, value);
}

/** Take the first `maxItems` items from a growing list. */
export function takeItems(items: readonly unknown[], maxItems: number): readonly unknown[] {
  return items.length <= maxItems ? items : items.slice(0, maxItems);
}

/** Split a bound URL into the pager's query/url/headers triple. */
export function pageQueryFromUrl(url: string, headers: Readonly<Record<string, string>>): PageQuery {
  const parsed = new URL(url);
  const query: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return { url: `${parsed.origin}${parsed.pathname}`, query, headers: { ...headers } };
}

/** Rebuild the request URL from a pager state (cursor_url may already include `?`). */
export function urlFromPageQuery(page: PageQuery): string {
  const encoded = Object.entries(page.query).map(
    ([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
  );
  if (encoded.length === 0) return page.url;
  const join = page.url.includes('?') ? '&' : '?';
  return `${page.url}${join}${encoded.join('&')}`;
}
