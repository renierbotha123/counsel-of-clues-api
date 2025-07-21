const express = require('express');
const router = express.Router();
const pool = require('./db');
const axios = require('axios');

const OLLAMA_URL = 'http://192.168.0.240:11434/api/generate';

const SYSTEM_PROMPT = `
You are an AI narrator for a murder mystery party game.

Your task is to continue telling the story in a compelling, mysterious way, using all the clues and player answers up to this point.

Include:
- A story-driven narrative paragraph (around 100-200 words)
- A single new clue that pushes the mystery forward

🧠 Use the players’ answers to steer character development and foreshadow twists.
🎯 Remember: only you know who the murderer is. Hide or reveal hints intentionally.
🎭 Build suspense and keep the players guessing.

✅ FORMAT: Return a JSON object like this:
{
  "narrative": "Story text here...",
  "clue": "One new clue related to the murder"
}
`;

router.post('/generate/:gameId/round/:round', async (req, res) => {
  const { gameId, round } = req.params;

  try {
    const [gameRes, answersRes, storyRes, cluesRes] = await Promise.all([
      pool.query('SELECT theme FROM games WHERE id = $1', [gameId]),
      pool.query(`
        SELECT gp.player_name, a.answer 
        FROM answers a
        JOIN game_players gp ON a.player_id = gp.id
        WHERE a.game_id = $1 AND a.round = $2
      `, [gameId, round]),
      pool.query('SELECT narrative FROM narratives WHERE game_id = $1 ORDER BY round', [gameId]),
      pool.query('SELECT clue FROM narratives WHERE game_id = $1 ORDER BY round', [gameId])
    ]);

    const theme = gameRes.rows[0]?.theme || 'mystery';
    const storySoFar = storyRes.rows.map(row => row.narrative).join('\n');
    const clues = cluesRes.rows.map(row => `- ${row.clue}`).join('\n');
    const answerSummary = answersRes.rows.map(r => `${r.player_name}: ${r.answer}`).join('\n');

    const fullPrompt = `
${SYSTEM_PROMPT}

🎭 Theme: ${theme}
📖 Story so far:
${storySoFar || 'None yet'}

🔎 All clues:
${clues || 'None yet'}

🗣️ This round's player answers:
${answerSummary || 'None yet'}
`;

    const ollamaRes = await axios.post(OLLAMA_URL, {
      model: 'mistral',
      prompt: fullPrompt,
      stream: false
    });

    const raw = ollamaRes.data.response.trim();
    const jsonStart = raw.indexOf('{');

    if (jsonStart === -1) throw new Error('No JSON object found in AI response');

    const jsonText = raw.slice(jsonStart);

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      console.error('❌ Failed to parse narrative JSON:\n', jsonText);
      return res.status(500).json({
        error: 'Invalid JSON from AI',
        raw: jsonText
      });
    }

    const { narrative, clue } = parsed;

    await pool.query(
      'INSERT INTO narratives (game_id, round, narrative, clue) VALUES ($1, $2, $3, $4)',
      [gameId, round, narrative, clue]
    );

    res.json({ narrative, clue });
  } catch (err) {
    console.error('❌ Error generating narrative:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
