const { Redis } = require('@upstash/redis');

const redis = Redis.fromEnv();
const CACHE_KEY = 'm3u:channels';
const CACHE_TTL_SECONDS = 6 * 60 * 60;

let memCache = { data: null, ts: 0 };
const MEM_TTL_MS = 5 * 60 * 1000;

const PALETTE = ['1a1a2e', '2e1a3e', '1a2e2e', '3e2e1a', '2e1a1a', '1a2e3e'];

function hashToIndex(str, mod) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h % mod;
}

function posterFor(channel) {
  if (channel.logo) return channel.logo;
  const bg = PALETTE[hashToIndex(channel.name, PALETTE.length)];
  const text = encodeURIComponent(channel.name).slice(0, 80);
  return `https://placehold.co/400x400/${bg}/ffffff?font=roboto&text=${text}`;
}

function slugify(s) {
  return (s || '')
    .toString()
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const rawEntries = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('#EXTINF')) {
      const attrs = {};
      const attrRegex = /([a-zA-Z0-9-]+)="([^"]*)"/g;
      let m;
      while ((m = attrRegex.exec(line)) !== null) {
        attrs[m[1].toLowerCase()] = m[2];
      }
      const nameMatch = line.match(/,(.*)$/);
      const name = (nameMatch ? nameMatch[1].trim() : '') || attrs['tvg-name'] || 'Unknown Channel';

      current = {
        tvgId: attrs['tvg-id'] || '',
        tvgName: attrs['tvg-name'] || name,
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || 'General',
        name,
        userAgent: ''
      };
    } else if (line.startsWith('#EXTVLCOPT') && current) {
      const m = line.match(/http-user-agent\s*=\s*(.+)$/i);
      if (m) current.userAgent = m[1].trim();
    } else if (line && !line.startsWith('#') && current) {
      current.url = line;
      rawEntries.push(current);
      current = null;
    }
  }

  const groups = new Map();
  const order = [];
  for (const entry of rawEntries) {
    const key = entry.tvgId || slugify(entry.tvgName || entry.name);
    if (!groups.has(key)) {
      groups.set(key, {
        tvgId: entry.tvgId,
        tvgName: entry.tvgName,
        logo: entry.logo,
        group: entry.group,
        name: entry.name,
        sources: []
      });
      order.push(key);
    }
    const g = groups.get(key);
    if (!g.logo && entry.logo) g.logo = entry.logo;
    g.sources.push({ url: entry.url, userAgent: entry.userAgent });
  }

  const seenIds = new Set();
  const channels = [];
  for (const key of order) {
    const g = groups.get(key);
    const idBase = g.tvgId || g.tvgName || g.name;
    let id = 'iptv_' + slugify(idBase);
    let suffix = 2;
    let finalId = id;
    while (seenIds.has(finalId)) {
      finalId = `${id}_${suffix++}`;
    }
    seenIds.add(finalId);

    channels.push({
      id: finalId,
      tvgId: g.tvgId,
      tvgName: g.tvgName,
      logo: g.logo,
      group: g.group,
      name: g.name,
      sources: g.sources,
      url: g.sources[0].url,
      userAgent: g.sources[0].userAgent
    });
  }

  return channels;
}

async function fetchAndParse() {
  const url = process.env.M3U_URL;
  if (!url) {
    throw new Error('M3U_URL environment variable is not set');
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch M3U playlist: HTTP ${res.status}`);
  }
  const text = await res.text();
  return parseM3U(text);
}

async function isUrlAlive(url, userAgent, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = userAgent ? { 'User-Agent': userAgent } : {};
  try {
    const headRes = await fetch(url, { method: 'HEAD', signal: controller.signal, headers });
    if (headRes.ok) return true;
    if (headRes.status !== 405) return false;

    const getRes = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { ...headers, Range: 'bytes=0-1024' }
    });
    return getRes.ok || getRes.status === 206;
  } catch (err) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function pruneDeadChannels(channels, opts = {}) {
  const timeBudgetMs = opts.timeBudgetMs || 45000;
  const concurrency = opts.concurrency || 15;
  const perRequestTimeoutMs = opts.perRequestTimeoutMs || 4000;

  const tasks = [];
  channels.forEach((ch, ci) => {
    ch.sources.forEach((src, si) => tasks.push({ ci, si }));
  });

  const start = Date.now();
  const aliveFlags = new Array(tasks.length).fill(true);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      if (Date.now() - start > timeBudgetMs) break;
      const i = index++;
      const { ci, si } = tasks[i];
      const src = channels[ci].sources[si];
      aliveFlags[i] = await isUrlAlive(src.url, src.userAgent, perRequestTimeoutMs);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);

  const result = [];
  let taskIdx = 0;
  for (const ch of channels) {
    const keptSources = [];
    for (let si = 0; si < ch.sources.length; si++) {
      if (aliveFlags[taskIdx]) keptSources.push(ch.sources[si]);
      taskIdx++;
    }
    if (keptSources.length > 0) {
      result.push({ ...ch, sources: keptSources, url: keptSources[0].url, userAgent: keptSources[0].userAgent });
    }
  }
  return result;
}

async function getChannels() {
  const now = Date.now();
  if (memCache.data && now - memCache.ts < MEM_TTL_MS) {
    return memCache.data;
  }

  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached && cached.channels) {
      memCache = { data: cached.channels, ts: now };
      return cached.channels;
    }
  } catch (err) {
    // Redis unavailable — fall through to a direct fetch below
  }

  const channels = await fetchAndParse();
  memCache = { data: channels, ts: now };
  return channels;
}

async function refreshM3uCache(opts = {}) {
  const validate = opts.validate !== false;
  const channels = await fetchAndParse();

  const totalSources = channels.reduce((n, c) => n + c.sources.length, 0);
  const finalChannels = validate ? await pruneDeadChannels(channels) : channels;
  const keptSources = finalChannels.reduce((n, c) => n + c.sources.length, 0);

  await redis.set(CACHE_KEY, { channels: finalChannels, generatedAt: Date.now() }, { ex: CACHE_TTL_SECONDS });
  memCache = { data: finalChannels, ts: Date.now() };

  return {
    totalChannels: channels.length,
    keptChannels: finalChannels.length,
    removedChannels: channels.length - finalChannels.length,
    totalSources,
    keptSources,
    removedSources: totalSources - keptSources,
    validated: validate
  };
}

module.exports = { getChannels, refreshM3uCache, parseM3U, slugify, posterFor };
