const { getSportsChannels } = require('../../../lib/sports');

let ImageResponsePromise;
function getImageResponse() {
  if (!ImageResponsePromise) {
    ImageResponsePromise = import('@vercel/og').then((mod) => mod.ImageResponse);
  }
  return ImageResponsePromise;
}

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

async function renderTextPoster(text) {
  const ImageResponse = await getImageResponse();
  const image = new ImageResponse(
    {
      type: 'div',
      props: {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '0 30px',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          color: '#e5e7eb',
          fontFamily: 'sans-serif',
          fontSize: 32,
          fontWeight: 'bold'
        },
        children: text
      }
    },
    { width: 400, height: 400 }
  );
  return Buffer.from(await image.arrayBuffer());
}

module.exports = async (req, res) => {
  const id = (req.query.id || '').replace(/\.png$/, '');

  try {
    const channels = await getSportsChannels();
    const ch = channels.find((c) => c.id === id);

    if (!ch) {
      const buf = await renderTextPoster('Unknown Channel');
      res.setHeader('Content-Type', 'image/png');
      res.status(200).send(buf);
      return;
    }

    if (!ch.game) {
      const buf = await renderTextPoster(ch.name);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      res.status(200).send(buf);
      return;
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

    const ImageResponse = await getImageResponse();
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
    try {
      const buf = await renderTextPoster('Live Sports');
      res.setHeader('Content-Type', 'image/png');
      res.status(200).send(buf);
    } catch (err2) {
      res.status(500).end();
    }
  }
};
