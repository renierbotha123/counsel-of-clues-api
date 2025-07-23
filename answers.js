const express = require('express');
const router = express.Router();
const pool = require('./db');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));


// 🧪 DEV MODE: Simulate answers
async function simulateFakeAnswers(gameId, round) {
  const res = await pool.query(
    `SELECT id FROM game_players WHERE game_id = $1 AND id NOT IN (
      SELECT player_id FROM answers WHERE game_id = $1 AND round = $2
    )`,
    [gameId, round]
  );

  for (const row of res.rows) {
    const fakeQ = `Auto-question for player ${row.id}`;
    const fakeA = `Fake answer from ${row.id}`;
    await pool.query(
      `INSERT INTO answers (game_id, player_id, round, question, answer, type)
       VALUES ($1, $2, $3, $4, $5, 'text')`,
      [gameId, row.id, round, fakeQ, fakeA]
    );
  }
}

// ✅ POST answer + AI narrative logic
router.post('/:gameId/:playerId/:round', async (req, res) => {
  const { gameId, playerId, round } = req.params;
  const { question, answer, type, selected_option } = req.body;

  try {
    // Store player answer
    await pool.query(`
      INSERT INTO answers (game_id, player_id, round, question, answer, type, selected_option)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (game_id, player_id, round)
      DO UPDATE SET question=EXCLUDED.question, answer=EXCLUDED.answer, type=EXCLUDED.type, selected_option=EXCLUDED.selected_option
    `, [gameId, playerId, round, question, answer, type, selected_option]);

    const totalPlayers = parseInt((await pool.query(
      'SELECT COUNT(*) FROM game_players WHERE game_id = $1', [gameId]
    )).rows[0].count, 10);

    const answeredCount = parseInt((await pool.query(
      'SELECT COUNT(DISTINCT player_id) FROM answers WHERE game_id = $1 AND round = $2',
      [gameId, round]
    )).rows[0].count, 10);

    if (answeredCount < totalPlayers - 1) {
      console.log('🛠️ Simulating fake answers...');
      await simulateFakeAnswers(gameId, round);
    }

    const { rows: gameRows } = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
    const { theme, murderer_id } = gameRows[0];

    let murdererId = murderer_id;
    if (!murdererId) {
      const players = await pool.query('SELECT id FROM game_players WHERE game_id = $1', [gameId]);
      murdererId = players.rows[Math.floor(Math.random() * players.rows.length)].id;
      await pool.query('UPDATE games SET murderer_id = $1 WHERE id = $2', [murdererId, gameId]);
    }

    const murdererName = (await pool.query('SELECT player_name FROM game_players WHERE id = $1', [murdererId])).rows[0].player_name;

    const previousNarratives = await pool.query(
      'SELECT narrative FROM narratives WHERE game_id = $1 AND round < $2 ORDER BY round ASC',
      [gameId, round]
    );
    const summary = previousNarratives.rows.map(r => r.narrative).join('\n\n');

    const answerRes = await pool.query(`
      SELECT a.*, p.player_name
      FROM answers a
      JOIN game_players p ON a.player_id = p.id
      WHERE a.game_id = $1 AND a.round = $2
    `, [gameId, round]);
    const answerData = answerRes.rows;

    // 🧠 Prompt AI using streaming
    let fullNarrative = '';
    let clueMap = {};

    try {
      const aiRes = await fetch('http://192.168.0.240:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mistral',
          stream: true,
          prompt: `You are an AI murder mystery narrator. Maintain a coherent mystery based on a theme and murderer. Use player names, not IDs.

Theme: ${theme}
Murderer: ${murdererName}

Story so far:
${summary || 'This is the first round. Introduce the setting, characters, and the initial murder.'}

This round's answers:
${JSON.stringify(answerData, null, 2)}

Output ONLY this JSON object:
{
  "narrative": "Story continuation with names and mystery...",
  "clues": [
    { "player_id": 101, "clue": "A private hint to uncover the murderer..." },
    ...
  ]
}`
        })
      });

      const decoder = new TextDecoder();
      const reader = aiRes.body.getReader();
      let fullResponse = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true }).trim();
        const lines = chunk.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.response) {
              fullResponse += parsed.response;
            }
          } catch (e) {
            console.warn('⚠️ Failed to parse streamed line:', line);
          }
        }
      }

      console.log('🧠 Full AI response:', fullResponse);

      try {
        const parsed = JSON.parse(fullResponse);
        if (parsed.narrative && parsed.clues) {
          fullNarrative = parsed.narrative;
          for (const clue of parsed.clues) {
            clueMap[clue.player_id] = clue.clue;
          }
          console.log('✅ Parsed final narrative');
        } else {
          console.warn('⚠️ AI returned malformed JSON:', fullResponse);
        }
      } catch (e) {
        console.error('❌ JSON parse error:', e.message);
      }

    } catch (e) {
      console.error('❌ AI fetch failed:', e.message);
    }

    if (fullNarrative) {
      await pool.query(
        'INSERT INTO narratives (game_id, round, narrative, clue) VALUES ($1, $2, $3, $4)',
        [gameId, round, fullNarrative, 'summary']
      );
    }

    for (const row of answerData) {
      const clue = clueMap[row.player_id] || '';
      await pool.query(
        'UPDATE answers SET clue = $1 WHERE game_id = $2 AND round = $3 AND player_id = $4',
        [clue, gameId, round, row.player_id]
      );
    }

    res.json({ status: 'complete' });

  } catch (err) {
    console.error('❌ Error in POST /answers:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ✅ GET personal clue + narrative
router.get('/:gameId/:playerId/:round', async (req, res) => {
  const { gameId, playerId, round } = req.params;

  try {
    const clueRes = await pool.query(
      'SELECT clue FROM answers WHERE game_id = $1 AND player_id = $2 AND round = $3',
      [gameId, playerId, round]
    );
    const clue = clueRes.rows[0]?.clue || '';

    const storyRes = await pool.query(
      'SELECT narrative FROM narratives WHERE game_id = $1 AND round = $2',
      [gameId, round]
    );
    const narrative = storyRes.rows[0]?.narrative || '';

    console.log('📤 Returning to frontend:', { clue, narrative });
    res.json({ clue, narrative });

  } catch (err) {
    console.error('❌ Error in GET /answers:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
