const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Serve the frontend
app.use(express.static(path.join(__dirname)));

const DB_FILE = path.join(__dirname, 'db.json');

let db = {
  users: [],
  conversations: [],
  messages: [],
  bookings: [],
  reviews: []
};

// Load DB
if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch(e) { console.error('Error reading DB:', e); }
}

const saveDB = () => {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
};

function uuid() { return Math.random().toString(36).substring(2, 15); }

// API Routes
app.post('/api/signup', (req, res) => {
  try {
    const { username, password, role, name, specialty } = req.body;
    
    if (db.users.find(u => u.username === username)) {
      return res.status(400).json({ error: 'Username already exists.' });
    }

    const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const newUser = { username, password, role, name, initials: initials || 'U', specialty, _id: uuid() };
    db.users.push(newUser);

    const otherUsers = db.users.filter(u => u.role !== role);
    for (const other of otherUsers) {
      db.conversations.push({ _id: uuid(), participants: [username, other.username] });
    }

    saveDB();
    res.status(201).json({ message: 'User created successfully', user: newUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
    res.json({ message: 'Login successful', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users', (req, res) => {
  try {
    const usersObj = {};
    db.users.forEach(u => {
      const { password, ...safeUser } = u;
      safeUser.isOnline = !!connectedUsers[u.username];
      usersObj[u.username] = safeUser;
    });
    res.json(usersObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/users/:username', (req, res) => {
  try {
    const { username } = req.params;
    let idx = db.users.findIndex(u => u.username === username);
    if (idx !== -1) {
      db.users[idx] = { ...db.users[idx], ...req.body };
      saveDB();
      res.json(db.users[idx]);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/conversations/:username', (req, res) => {
  try {
    const { username } = req.params;
    const convs = db.conversations.filter(c => c.participants.includes(username));
    
    const convObj = {};
    for (let c of convs) {
      const messages = db.messages.filter(m => m.conversationId === c._id);
      convObj[c._id] = { _id: c._id, participants: c.participants, messages: messages };
    }
    res.json(convObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/conversations', (req, res) => {
  try {
    const { participants } = req.body;
    let existing = db.conversations.find(c => 
      c.participants.includes(participants[0]) && c.participants.includes(participants[1])
    );
    if (existing) {
      return res.json(existing);
    }
    const newConv = { _id: uuid(), participants };
    db.conversations.push(newConv);
    saveDB();
    res.status(201).json(newConv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/messages', (req, res) => {
  try {
    const newMsg = { ...req.body, _id: uuid() };
    db.messages.push(newMsg);
    saveDB();
    res.status(201).json(newMsg);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bookings', (req, res) => {
  try {
    const newBooking = { ...req.body, status: 'Confirmed', _id: uuid() };
    db.bookings.push(newBooking);
    saveDB();

    if (newBooking.doctorId && connectedUsers[newBooking.doctorId]) {
      io.to(connectedUsers[newBooking.doctorId]).emit('newBooking', newBooking);
    }

    res.status(201).json(newBooking);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/bookings', (req, res) => {
  res.json(db.bookings);
});

app.put('/api/admin/bookings/:id', (req, res) => {
  try {
    const { id } = req.params;
    const idx = db.bookings.findIndex(b => b._id === id);
    if (idx !== -1) {
      db.bookings[idx].status = req.body.status;
      saveDB();
      res.json(db.bookings[idx]);
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bookings/:username', (req, res) => {
  try {
    const { username } = req.params;
    const bookings = db.bookings.filter(b => b.username === username || b.doctorId === username);
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/reviews', (req, res) => {
  try {
    const newReview = { ...req.body, _id: uuid() };
    db.reviews.push(newReview);
    saveDB();
    res.status(201).json(newReview);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reviews', (req, res) => {
  res.json(db.reviews);
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

  socket.on('sendMessage', (data) => {
    try {
      const newMsg = { ...data, _id: uuid() };
      db.messages.push(newMsg);
      saveDB();
      
      const conv = db.conversations.find(c => c._id === data.conversationId);
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
