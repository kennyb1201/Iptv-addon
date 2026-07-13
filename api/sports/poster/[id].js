const { ImageResponse } = require('@vercel/og');
const { getSportsChannels } = require('../../../lib/sports');
const { posterFor } = require('../../../lib/m3u');

function formatTime(iso) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function logoBox(url) {
  return url
    ? { type: 'img', props: { src: url, width: 140, height: 140, style: { objectFit: 'contain' } } }
    : { type: 'div', props: { style: { width: 140, height: 140 }, children: [] } };
}

module.exports = async (req, res) => {
  try {
    const id = (req.query.id || '').replace(/\.png$/, '');
    const channels = await getSportsChannels();
    const ch = channels.find((c) => c.id === id);

    if (!ch || !ch.game) {
      const fallback = ch ? posterFor(ch) : 'https://placehold.co/400x400';
      res.writeHead(302, { Location: fallback });
      return res.end();
    }

    const g = ch.game;
    const isLive = g.status === 'in';
    const isPre = g.status === 'pre';
    const isEventMode = !g.homeTeam || !g.awayTeam;

    const scoreLine = isEventMode
      ? isPre
        ? formatTime(g.startTime)
        : g.statusDetail || (isLive ? 'Live' : '')
      : isLive
      ? `${g.awayScore} - ${g.homeScore}`
      : isPre
      ? formatTime(g.startTime)
      : g.statusDetail || '';

    const topSection = isEventMode
      ? {
          type: 'div',
          props: {
            style: {
              fontSize: 30,
              color: '#e5e7eb',
              fontWeight: 'bold',
              textAlign: 'center',
              padding: '0 24px',
              display: 'flex'
            },
            children: g.eventShortName || g.eventName || ''
          }
        }
      : {
          type: 'div',
          props: {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 40 },
            children: [logoBox(g.awayLogo), { type: 'div', props: { style: { fontSize: 32, color: '#888' }, children: '@' } }, logoBox(g.homeLogo)]
          }
        };

    const image = new ImageResponse(
      {
        type: 'div',
        props: {
          style: {
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
            fontFamily: 'sans-serif'
          },
          children: [
            topSection,
            {
              type: 'div',
              props: {
                style: {
                  marginTop: 30,
                  fontSize: !isEventMode && isLive ? 56 : 24,
                  color: isLive ? '#22c55e' : '#e5e7eb',
                  fontWeight: 'bold'
                },
                children: scoreLine
              }
            },
            !isEventMode && isLive
              ? {
                  type: 'div',
                  props: {
                    style: { marginTop: 8, fontSize: 20, color: '#9ca3af' },
                    children: g.statusDetail || ''
                  }
                }
              : null
          ].filter(Boolean)
        }
      },
      { width: 400, height: 400 }
    );

    const buf = Buffer.from(await image.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    res.status(200).send(buf);
  } catch (err) {
    res.writeHead(302, { Location: 'https://placehold.co/400x400?text=Error' });
    res.end();
  }
};
