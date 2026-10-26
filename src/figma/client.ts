import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FNodesResponse } from './types.js';

export interface FigmaLink { fileKey: string; nodeId: string }

/** Accepts figma.com/design/<key>/..., /file/<key>/..., with ?node-id=1-23 or 1:23. */
export function parseFigmaLink(url: string): FigmaLink {
  const m = url.match(/figma\.com\/(?:design|file|proto)\/([A-Za-z0-9]+)/);
  if (!m) throw new Error('Not a Figma link. Copy it with right-click > Copy link to selection.');
  const node = new URL(url).searchParams.get('node-id');
  if (!node) throw new Error('The link has no node-id. Select a frame in Figma, then copy the link to the selection.');
  return { fileKey: m[1], nodeId: node.replace('-', ':') };
}

export interface ClientOptions {
  token: string;
  cacheDir?: string;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

/**
 * Figma REST client with an on-disk cache keyed by file version, and backoff on
 * HTTP 429 that honours Retry-After. Never retries 4xx other than 429.
 */
export class FigmaClient {
  private readonly base = 'https://api.figma.com/v1';
  constructor(private readonly o: ClientOptions) {}

  async nodes(link: FigmaLink): Promise<FNodesResponse> {
    const version = await this.version(link.fileKey);
    const key = hash(`${link.fileKey}|${link.nodeId}|${version}`);
    const cached = await this.readCache(key);
    if (cached) { this.o.log?.('Using cached design (file unchanged since last pull).'); return cached as FNodesResponse; }
    const res = await this.get<FNodesResponse>(`/files/${link.fileKey}/nodes?ids=${encodeURIComponent(link.nodeId)}`);
    await this.writeCache(key, res);
    return res;
  }

  /** Small request: returns the file version so unchanged files are served from cache. */
  async version(fileKey: string): Promise<string> {
    const meta = await this.get<{ version: string }>(`/files/${fileKey}?depth=1`);
    return meta.version;
  }

  /** Render node ids to image URLs (batched: Figma accepts many ids per call). */
  async renderImages(fileKey: string, ids: string[], format: 'svg' | 'png', scale = 1): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {};
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50).join(',');
      const r = await this.get<{ images: Record<string, string | null> }>(`/images/${fileKey}?ids=${encodeURIComponent(chunk)}&format=${format}&scale=${scale}`);
      Object.assign(out, r.images);
    }
    return out;
  }

  /** Download URLs for image fills (imageRef -> url). */
  async imageFills(fileKey: string): Promise<Record<string, string>> {
    const r = await this.get<{ meta: { images: Record<string, string> } }>(`/files/${fileKey}/images`);
    return r.meta.images;
  }

  async download(url: string): Promise<Buffer> {
    const f = this.o.fetchImpl ?? fetch;
    const res = await f(url);
    if (!res.ok) throw new Error(`Asset download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async get<T>(path: string): Promise<T> {
    const f = this.o.fetchImpl ?? fetch;
    const max = this.o.maxRetries ?? 5;
    for (let attempt = 0; ; attempt++) {
      const res = await f(`${this.base}${path}`, { headers: { 'X-Figma-Token': this.o.token } });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 429 && attempt < max) {
        const header = res.headers.get('retry-after');
        const retry = header !== null && !Number.isNaN(Number(header)) ? Number(header) : 2 ** attempt;
        this.o.log?.(`Figma rate limit hit; waiting ${retry}s (attempt ${attempt + 1}/${max}).`);
        await new Promise(r => setTimeout(r, retry * 1000));
        continue;
      }
      if (res.status === 403) throw new Error('Figma refused access (403). Check your token and that you can open this file.');
      if (res.status === 404) throw new Error('Figma file or node not found (404). Check the link.');
      throw new Error(`Figma API error ${res.status}: ${await res.text()}`);
    }
  }

  private async readCache(key: string): Promise<unknown | null> {
    if (!this.o.cacheDir) return null;
    try { return JSON.parse(await readFile(join(this.o.cacheDir, `${key}.json`), 'utf8')); } catch { return null; }
  }

  private async writeCache(key: string, data: unknown) {
    if (!this.o.cacheDir) return;
    await mkdir(this.o.cacheDir, { recursive: true });
    await writeFile(join(this.o.cacheDir, `${key}.json`), JSON.stringify(data));
  }
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
