const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Connect to MongoDB Atlas (Legacy URI to bypass local DNS SRV issues)
mongoose.connect("mongodb://kollivarshini020705_db_user:hospital123@ac-gxfbwbg-shard-00-00.rov2n3t.mongodb.net:27017,ac-gxfbwbg-shard-00-01.rov2n3t.mongodb.net:27017,ac-gxfbwbg-shard-00-02.rov2n3t.mongodb.net:27017/medicare?ssl=true&replicaSet=atlas-hif6bg-shard-0&authSource=admin&retryWrites=true&w=majority")
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch(err => console.error('MongoDB connection error:', err));

// Mongoose Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: String,
  name: String,
  initials: String,
  specialty: String,
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
  conversationId: String,
  from: String,
  text: String,
  time: String,
  type: String,
  diagnosis: String,
  medicines: [String],
  diet: String
});
const Message = mongoose.model('Message', messageSchema);

const bookingSchema = new mongoose.Schema({
  username: String,
  doctorId: String,
  service: String,
  date: String,
  time: String,
  phone: String,
  reason: String,
  status: { type: String, default: 'Confirmed' }
});
const Booking = mongoose.model('Booking', bookingSchema);

const reviewSchema = new mongoose.Schema({
  name: String,
  initials: String,
  text: String
});
const Review = mongoose.model('Review', reviewSchema);

// Store active socket connections
const connectedUsers = {}; // username -> socket.id

// API Routes
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password, role, name, specialty } = req.body;
    
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ error: 'Username already exists.' });

    const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'U';
    const newUser = new User({ username, password, role, name, initials, specialty });
    await newUser.save();

    const otherUsers = await User.find({ role: { $ne: role } });
    const convsToCreate = otherUsers.map(other => ({ participants: [username, other.username] }));
    if (convsToCreate.length > 0) {
      await Conversation.insertMany(convsToCreate);
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
    const users = await User.find().lean();
    const usersObj = {};
    users.forEach(u => {
      const { password, ...safeUser } = u;
      safeUser.isOnline = !!connectedUsers[u.username];
      usersObj[u.username] = safeUser;
    });
    res.json(usersObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/users/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOneAndUpdate({ username }, req.body, { new: true }).lean();
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/conversations/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const convs = await Conversation.find({ participants: username }).lean();
    
    const convObj = {};
    for (let c of convs) {
      const messages = await Message.find({ conversationId: c._id.toString() }).lean();
      convObj[c._id] = { _id: c._id, participants: c.participants, messages: messages };
    }
    res.json(convObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/conversations', async (req, res) => {
  try {
    const { participants } = req.body;
    let existing = await Conversation.findOne({ participants: { $all: participants, $size: participants.length } });
    if (existing) return res.json(existing);
    
    const newConv = new Conversation({ participants });
    await newConv.save();
    res.status(201).json(newConv);
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
    const newBooking = new Booking({ ...req.body, status: 'Confirmed' });
    await newBooking.save();

    if (newBooking.doctorId && connectedUsers[newBooking.doctorId]) {
      io.to(connectedUsers[newBooking.doctorId]).emit('newBooking', newBooking);
    }
    res.status(201).json(newBooking);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find().lean();
    res.json(bookings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/bookings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Booking.findByIdAndUpdate(id, { status: req.body.status }, { new: true });
    if (updated) res.json(updated);
    else res.status(404).json({ error: 'Not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bookings/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const bookings = await Booking.find({ $or: [{ username: username }, { doctorId: username }] }).lean();
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
    const reviews = await Review.find().lean();
    res.json(reviews);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Socket.IO Real-Time Logic ---
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
