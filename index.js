const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// Route Imports
const authRoutes = require('./authRoutes');
const gamesRoutes = require('./games');
const playersRoutes = require('./players');
const narrativesRoutes = require('./narratives');
const questionsRoutes = require('./questions');
const answersRoutes = require('./answers');
const roundsRoutes = require('./rounds');

const debugRoutes = require('./debug');
app.use('/debug', debugRoutes);


// Register Routes (only once each!)
app.use('/auth', authRoutes);
app.use('/games', gamesRoutes);
app.use('/players', playersRoutes);
app.use('/narratives', narrativesRoutes);
app.use('/questions', questionsRoutes);
app.use('/answers', answersRoutes);
app.use('/rounds', roundsRoutes);
// Test route
app.get('/', (req, res) => {
  res.send('API is running!');
});

// Optional: move or rename this if it causes conflict
app.get('/narratives/game/:gameId', (req, res) => {
  const { gameId } = req.params;
  res.json({
    narrative: `The murder mystery narrative for game ${gameId} goes here.`
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
