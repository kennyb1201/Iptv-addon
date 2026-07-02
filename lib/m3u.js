let cache = { data: null, ts: 0 };
const TTL_MS = 30 * 60 * 1000;

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
  const channels = [];
  const seenIds = new Set();
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
        name
      };
    } else if (line && !line.startsWith('#') && current) {
      current.url = line;

      const idBase = current.tvgId || current.tvgName || current.name;
      let id = 'iptv_' + slugify(idBase);
      let suffix = 2;
      let finalId = id;
      while (seenIds.has(finalId)) {
        finalId = `${id}_${suffix++}`;
      }
      seenIds.add(finalId);
      current.id = finalId;

      channels.push(current);
      current = null;
    }
  }
  return channels;
}

async function getChannels() {
  const now = Date.now();
  if (cache.data && now - cache.ts < TTL_MS) {
    return cache.data;
  }

  const url = process.env.M3U_URL;
  if (!url) {
    throw new Error('M3U_URL environment variable is not set');
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch M3U playlist: HTTP ${res.status}`);
  }
  const text = await res.text();
  const channels = parseM3U(text);

  cache = { data: channels, ts: now };
  return channels;
}

module.exports = { getChannels, parseM3U, slugify, posterFor };
