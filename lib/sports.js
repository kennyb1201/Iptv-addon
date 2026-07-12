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
  mma: 'mma/ufc'
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
  mma: 'UFC / MMA'
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
  mma: ['ufc', 'mma', 'boxing']
};

let scheduleCache = { data: {}, ts: {} };
const SCHEDULE_TTL_MS = 60 * 1000;

async function fetchLeagueSchedule(league) {
  const now = Date.now();
  if (scheduleCache.data[league] && now - (scheduleCache.ts[league] || 0) < SCHEDULE_TTL_MS) {
    return scheduleCache.data[league];
  }
  const path = LEAGUE_ESPN_PATHS[league];
  if (!path) return [];

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();

    const events = (json.events || []).map((ev) => {
      const comp = ev.competitions && ev.competitions[0];
      const competitors = (comp && comp.competitors) || [];
      const home = competitors.find((c) => c.homeAway === 'home');
      const away = competitors.find((c) => c.homeAway === 'away');
      const statusType = comp && comp.status && comp.status.type;

      return {
        id: ev.id,
        league,
        startTime: ev.date,
        status: statusType ? statusType.state : 'pre',
        statusDetail: statusType ? statusType.shortDetail : '',
        homeTeam: home && home.team ? home.team.displayName : null,
        homeScore: home ? home.score : null,
        homeLogo: home && home.team ? home.team.logo : null,
        awayTeam: away && away.team ? away.team.displayName : null,
        awayScore: away ? away.score : null,
        awayLogo: away && away.team ? away.team.logo : null
      };
    });

    scheduleCache.data[league] = events;
    scheduleCache.ts[league] = now;
    return events;
  } catch (err) {
    return scheduleCache.data[league] || [];
  }
}

function detectLeague(text) {
  const lower = text.toLowerCase();
  for (const [league, keywords] of Object.entries(LEAGUE_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) return league;
  }
  return null;
}

function normalizeTeamText(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function extractTeams(name) {
  const cleaned = name.replace(/\[[^\]]*\]/g, '').trim();
  const m = cleaned.match(/([A-Za-z .'-]+?)\s+(?:vs\.?|v\.?|@|at)\s+([A-Za-z .'-]+)/i);
  if (!m) return null;
  return { a: m[1].trim(), b: m[2].trim() };
}

function wordOverlapScore(teamText, candidateName) {
  const t = normalizeTeamText(teamText);
  const c = normalizeTeamText(candidateName);
  if (!t || !c) return 0;
  const tWords = t.split(' ').filter((w) => w.length > 2);
  let hits = 0;
  for (const w of tWords) {
    if (c.includes(w)) hits++;
  }
  return hits;
}

async function matchChannelToGame(channel) {
  const league = detectLeague(channel.group + ' ' + channel.name);
  if (!league) return { league: null, game: null };

  const teams = extractTeams(channel.name);
  const games = await fetchLeagueSchedule(league);
  if (!teams || games.length === 0) return { league, game: null };

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
  return { league, game: bestScore >= 2 ? best : null };
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
    name.includes('offline')
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
