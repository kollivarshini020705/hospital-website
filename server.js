const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Serve the frontend
app.use(express.static(path.join(__dirname)));

// Default MongoDB URI. User can change this to their Atlas URI later.
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/medicare';

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, required: true },
  name: { type: String, required: true },
  initials: { type: String },
  specialty: { type: String }
});
const User = mongoose.model('User', userSchema);

const conversationSchema = new mongoose.Schema({
  participants: [String]
});
const Conversation = mongoose.model('Conversation', conversationSchema);

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  from: { type: String, required: true },
  type: { type: String, required: true },
  text: String,
  diagnosis: String,
  medicines: [String],
  diet: String,
  notes: String,
  time: String
});
const Message = mongoose.model('Message', messageSchema);

// API Routes
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password, role, name, specialty } = req.body;
    
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: 'Username already exists.' });

    const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const newUser = new User({ username, password, role, name, initials: initials || 'U', specialty });
    await newUser.save();

    const otherUsers = await User.find({ role: { $ne: role } });
    for (const other of otherUsers) {
      const newConv = new Conversation({ participants: [username, other.username] });
      await newConv.save();
    }

    res.status(201).json({ message: 'User created successfully', user: newUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
    res.json({ message: 'Login successful', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, '-password');
    const usersObj = {};
    users.forEach(u => usersObj[u.username] = u);
    res.json(usersObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/conversations/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const convs = await Conversation.find({ participants: username });
    
    const convObj = {};
    for (let c of convs) {
      const messages = await Message.find({ conversationId: c._id });
      convObj[c._id] = { _id: c._id, participants: c.participants, messages: messages };
    }
    res.json(convObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
    const newMsg = new Message(req.body);
    await newMsg.save();
    res.status(201).json(newMsg);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Export the Express API for Vercel
module.exports = app;
