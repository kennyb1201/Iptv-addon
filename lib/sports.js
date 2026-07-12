const { getChannels } = require('./m3u');

const LEAGUE_ESPN_PATHS = {
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  nhl: 'hockey/nhl',
  mlb: 'baseball/mlb',
  ncaaf: 'football/college-football',
  ncaab: 'basketball/mens-college-basketball',
  epl: 'soccer/eng.1',
  laliga: 'soccer/esp.1',
  seriea: 'soccer/ita.1',
  bundesliga: 'soccer/ger.1',
  ligue1: 'soccer/fra.1',
  mls: 'soccer/usa.1',
  ucl: 'soccer/uefa.champions',
  mma: 'mma/ufc',
  nascar: 'racing/nascar-premier',
  f1: 'racing/f1',
  golf: 'golf/pga'
};

const LEAGUE_LABELS = {
  nfl: 'NFL',
  nba: 'NBA',
  nhl: 'NHL',
  mlb: 'MLB',
  ncaaf: 'College Football',
  ncaab: 'College Basketball',
  epl: 'Premier League',
  laliga: 'La Liga',
  seriea: 'Serie A',
  bundesliga: 'Bundesliga',
  ligue1: 'Ligue 1',
  mls: 'MLS',
  ucl: 'Champions League',
  mma: 'UFC / MMA',
  nascar: 'NASCAR',
  f1: 'Formula 1',
  golf: 'Golf (PGA)',
  tennis: 'Tennis'
};

const LEAGUE_KEYWORDS = {
  nfl: ['nfl'],
  nba: ['nba'],
  nhl: ['nhl'],
  mlb: ['mlb'],
  ncaaf: ['ncaaf', 'college football', 'cfb'],
  ncaab: ['ncaab', 'college basketball', 'cbb'],
  epl: ['epl', 'premier league'],
  laliga: ['la liga', 'laliga'],
  seriea: ['serie a'],
  bundesliga: ['bundesliga'],
  ligue1: ['ligue 1'],
  mls: ['mls'],
  ucl: ['champions league', 'ucl'],
  mma: ['ufc', 'mma', 'boxing'],
  nascar: ['nascar'],
  f1: ['formula 1', 'f1 '],
  golf: ['golf', 'pga', 'lpga'],
  tennis: ['tennis', 'atp', 'wta']
};

const EVENT_MODE_LEAGUES = new Set(['nascar', 'f1', 'golf']);

let scheduleCache = { data: {}, ts: {} };
const SCHEDULE_TTL_MS = 60 * 1000;

function mapEspnEvents(json, league) {
  return (json.events || []).map((ev) => {
    const comp = ev.competitions && ev.competitions[0];
    const competitors = (comp && comp.competitors) || [];
    const home = competitors.find((c) => c.homeAway === 'home');
    const away = competitors.find((c) => c.homeAway === 'away');
    const statusType = comp && comp.status && comp.status.type;

    const nameFor = (c) => {
      if (!c) return null;
      if (c.team) return c.team.displayName;
      if (c.athlete) return c.athlete.displayName;
      return null;
    };
    const logoFor = (c) => {
      if (!c) return null;
      if (c.team) return c.team.logo;
      if (c.athlete) return c.athlete.headshot && c.athlete.headshot.href;
      return null;
    };

    return {
      id: ev.id,
      league,
      eventName: ev.name || '',
      eventShortName: ev.shortName || '',
      startTime: ev.date,
      status: statusType ? statusType.state : 'pre',
      statusDetail: statusType ? statusType.shortDetail : '',
      homeTeam: nameFor(home),
      homeScore: home ? home.score : null,
      homeLogo: logoFor(home),
      awayTeam: nameFor(away),
      awayScore: away ? away.score : null,
      awayLogo: logoFor(away)
    };
  });
}

async function fetchEspnScoreboard(path) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`;
    const res = await fetch(url);
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    return null;
  }
}

async function fetchLeagueSchedule(league) {
  const now = Date.now();
  if (scheduleCache.data[league] && now - (scheduleCache.ts[league] || 0) < SCHEDULE_TTL_MS) {
    return scheduleCache.data[league];
  }

  let events = [];

  if (league === 'tennis') {
    const [atpJson, wtaJson] = await Promise.all([
      fetchEspnScoreboard('tennis/atp'),
      fetchEspnScoreboard('tennis/wta')
    ]);
    const atpEvents = atpJson ? mapEspnEvents(atpJson, 'tennis') : [];
    const wtaEvents = wtaJson ? mapEspnEvents(wtaJson, 'tennis') : [];
    events = [...atpEvents, ...wtaEvents];
  } else {
    const path = LEAGUE_ESPN_PATHS[league];
    if (!path) return [];
    const json = await fetchEspnScoreboard(path);
    events = json ? mapEspnEvents(json, league) : scheduleCache.data[league] || [];
  }

  scheduleCache.data[league] = events;
  scheduleCache.ts[league] = now;
  return events;
}

function detectLeague(text) {
  const lower = text.toLowerCase();
  for (const [league, keywords] of Object.entries(LEAGUE_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) return league;
  }
  return null;
}

function normalizeText(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function stripNoise(text) {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(8K|4K|FHD|HD|SD|EXCLUSIVE|PPV|LIVE|STREAMING|FEED|ON AIR)\b/gi, ' ')
    .replace(/\b(UK|US|USA|CA|CAN|CANADA|EAST|WEST)\s*[:|]/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractTeams(name) {
  const cleaned = name.trim();
  const m = cleaned.match(/([A-Za-z .'-]+?)\s+(?:vs\.?|v\.?|@|at)\s+([A-Za-z .'-]+)/i);
  if (!m) return null;
  return { a: m[1].trim(), b: m[2].trim() };
}

function wordOverlapScore(textA, textB) {
  const a = normalizeText(textA);
  const b = normalizeText(textB);
  if (!a || !b) return 0;
  const aWords = a.split(' ').filter((w) => w.length > 2);
  let hits = 0;
  for (const w of aWords) {
    if (b.includes(w)) hits++;
  }
  return hits;
}

function matchVersusChannel(channel, games) {
  const teams = extractTeams(stripNoise(channel.name));
  if (!teams) return null;

  let best = null;
  let bestScore = 0;
  for (const g of games) {
    const scoreDirect = wordOverlapScore(teams.a, g.homeTeam) + wordOverlapScore(teams.b, g.awayTeam);
    const scoreSwapped = wordOverlapScore(teams.a, g.awayTeam) + wordOverlapScore(teams.b, g.homeTeam);
    const score = Math.max(scoreDirect, scoreSwapped);
    if (score > bestScore) {
      bestScore = score;
      best = g;
    }
  }
  return bestScore >= 2 ? best : null;
}

function matchEventChannel(channel, games) {
  const cleaned = stripNoise(channel.name);
  let best = null;
  let bestScore = 0;
  for (const g of games) {
    const score = Math.max(
      wordOverlapScore(cleaned, g.eventName),
      wordOverlapScore(cleaned, g.eventShortName)
    );
    if (score > bestScore) {
      bestScore = score;
      best = g;
    }
  }
  return bestScore >= 2 ? best : null;
}

async function matchChannelToGame(channel) {
  const league = detectLeague(channel.group + ' ' + channel.name);
  if (!league) return { league: null, game: null };

  const games = await fetchLeagueSchedule(league);
  if (games.length === 0) return { league, game: null };

  const game = EVENT_MODE_LEAGUES.has(league)
    ? matchEventChannel(channel, games)
    : matchVersusChannel(channel, games);

  return { league, game };
}

function isSportsChannel(channel) {
  const configured = (process.env.SPORTS_GROUPS || '')
    .split(',')
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean);

  const group = channel.group.toLowerCase();
  if (configured.length > 0) {
    return configured.includes(group);
  }
  return group.includes('sport') || group.includes('ppv');
}

function isPlaceholderChannel(channel) {
  const name = channel.name.toLowerCase();
  return (
    name.includes('no event') ||
    name.includes('no stream') ||
    name.includes('coming soon') ||
    name.includes('event tbd') ||
    name.includes('offline') ||
    /^-?\s*live event\s*\d+/i.test(channel.name)
  );
}

async function getSportsChannels() {
  const channels = await getChannels();
  const sportsChannels = channels.filter((ch) => isSportsChannel(ch) && !isPlaceholderChannel(ch));

  const enriched = await Promise.all(
    sportsChannels.map(async (ch) => {
      const { league, game } = await matchChannelToGame(ch);
      return { ...ch, league, game };
    })
  );

  return enriched;
}

module.exports = { getSportsChannels, fetchLeagueSchedule, LEAGUE_ESPN_PATHS, LEAGUE_LABELS };
