const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
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
  specialty: { type: String },
  bio: String,
  phone: String,
  email: String
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
  reports: String,
  notes: String,
  time: String
});
const Message = mongoose.model('Message', messageSchema);

const bookingSchema = new mongoose.Schema({
  username: { type: String, required: true },
  doctorId: { type: String, default: null },
  service: { type: String, required: true },
  date: { type: String, required: true },
  time: { type: String, required: true },
  phone: { type: String },
  reason: { type: String },
  status: { type: String, default: 'Confirmed' }
});
const Booking = mongoose.model('Booking', bookingSchema);

const reviewSchema = new mongoose.Schema({
  name: String,
  initials: String,
  text: String
});
const Review = mongoose.model('Review', reviewSchema);

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

app.put('/api/users/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const updated = await User.findOneAndUpdate({ username }, req.body, { new: true });
    res.json(updated);
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

app.post('/api/bookings', async (req, res) => {
  try {
    const newBooking = new Booking(req.body);
    await newBooking.save();
    res.status(201).json(newBooking);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find();
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/bookings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Booking.findByIdAndUpdate(id, { status: req.body.status }, { new: true });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bookings/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const bookings = await Booking.find({
      $or: [{ username: username }, { doctorId: username }]
    });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/reviews', async (req, res) => {
  try {
    const newReview = new Review(req.body);
    await newReview.save();
    res.status(201).json(newReview);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reviews', async (req, res) => {
  try {
    const reviews = await Review.find();
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Socket.IO Real-Time Logic ---
const connectedUsers = {}; // username -> socket.id

io.on('connection', (socket) => {
  socket.on('join', (username) => {
    connectedUsers[username] = socket.id;
  });

  socket.on('sendMessage', async (data) => {
    try {
      const newMsg = new Message(data);
      await newMsg.save();
      
      const conv = await Conversation.findById(data.conversationId);
      if (conv) {
        const recipient = conv.participants.find(p => p !== data.from);
        if (recipient && connectedUsers[recipient]) {
          io.to(connectedUsers[recipient]).emit('newMessage', newMsg);
        }
        // Also emit back to sender to confirm it was sent (optional, but good for UI sync)
        if (connectedUsers[data.from]) {
          io.to(connectedUsers[data.from]).emit('newMessage', newMsg);
        }
      }
    } catch (e) {
      console.error('Socket send error:', e);
    }
  });

  socket.on('disconnect', () => {
    const user = Object.keys(connectedUsers).find(k => connectedUsers[k] === socket.id);
    if (user) delete connectedUsers[user];
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = server;
