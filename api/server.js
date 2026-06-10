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
app.use(express.static(path.join(__dirname, '..')));

require('dotenv').config();

// Database connection initiated below model definitions

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
  email: String,
  gender: String
});
let User = mongoose.model('User', userSchema);

const conversationSchema = new mongoose.Schema({
  participants: [String]
});
let Conversation = mongoose.model('Conversation', conversationSchema);

const messageSchema = new mongoose.Schema({
  conversationId: String,
  from: String,
  text: String,
  time: String,
  type: String,
  fileName: String,
  fileData: String,
  fileSize: String,
  diagnosis: String,
  medicines: [String],
  diet: String
});
let Message = mongoose.model('Message', messageSchema);

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
let Booking = mongoose.model('Booking', bookingSchema);

const reviewSchema = new mongoose.Schema({
  name: String,
  initials: String,
  text: String
});
let Review = mongoose.model('Review', reviewSchema);

// --- In-Memory Mock Database Fallback (for local network resilience) ---
const inMemoryStore = {
  users: [],
  conversations: [],
  messages: [],
  bookings: [],
  reviews: []
};

class MockModel {
  constructor(data, storeKey) {
    this._data = { ...data };
    if (!this._data._id) {
      this._id = "mock_" + Math.floor(Math.random() * 1000000).toString();
      this._data._id = this._id;
    } else {
      this._id = this._data._id;
    }
    this._storeKey = storeKey;
    Object.assign(this, this._data);
  }
  
  async save() {
    const store = inMemoryStore[this._storeKey];
    const idx = store.findIndex(item => item._id === this._id);
    if (idx >= 0) {
      store[idx] = { ...store[idx], ...this._data, ...this };
    } else {
      store.push({ ...this._data, ...this });
    }
    return this;
  }

  static find(query = {}) {
    let results = inMemoryStore[this.storeKey] || [];
    if (Object.keys(query).length > 0) {
      results = results.filter(item => {
        return Object.keys(query).every(key => {
          const val = query[key];
          if (val && typeof val === 'object') {
            if (val.$ne !== undefined) return item[key] !== val.$ne;
            if (val.$all !== undefined) {
              return Array.isArray(item[key]) && val.$all.every(v => item[key].includes(v));
            }
            if (val.$size !== undefined) {
              return Array.isArray(item[key]) && item[key].length === val.$size;
            }
          }
          if (key === '$or' && Array.isArray(val)) {
            return val.some(q => {
              return Object.keys(q).every(k => item[k] === q[k]);
            });
          }
          if (Array.isArray(item[key])) {
            return item[key].includes(val);
          }
          return item[key] === val;
        });
      });
    }
    
    const wrapper = [...results];
    const queryObj = {
      sort: () => queryObj,
      lean: () => queryObj,
      then: (resolve) => resolve(wrapper),
      catch: (reject) => {}
    };
    return queryObj;
  }

  static findOne(query = {}) {
    const p = (async () => {
      const list = await this.find(query);
      return list[0] || null;
    })();
    const queryObj = {
      lean: () => queryObj,
      then: (resolve) => p.then(resolve),
      catch: (reject) => p.catch(reject)
    };
    return queryObj;
  }

  static findById(id) {
    return this.findOne({ _id: id });
  }

  static findOneAndUpdate(query, update, options = {}) {
    const p = (async () => {
      const item = await this.findOne(query);
      if (item) {
        Object.assign(item, update);
        return item;
      }
      return null;
    })();
    const queryObj = {
      lean: () => queryObj,
      then: (resolve) => p.then(resolve),
      catch: (reject) => p.catch(reject)
    };
    return queryObj;
  }

  static findByIdAndUpdate(id, update, options = {}) {
    return this.findOneAndUpdate({ _id: id }, update, options);
  }

  static async insertMany(arr) {
    const store = inMemoryStore[this.storeKey];
    arr.forEach(item => {
      const data = { ...item };
      if (!data._id) data._id = "mock_" + Math.floor(Math.random() * 1000000).toString();
      store.push(data);
    });
    return arr;
  }
}

class MockUser extends MockModel {
  constructor(data) { super(data, 'users'); }
  static get storeKey() { return 'users'; }
}
class MockConversation extends MockModel {
  constructor(data) { super(data, 'conversations'); }
  static get storeKey() { return 'conversations'; }
}
class MockMessage extends MockModel {
  constructor(data) { super(data, 'messages'); }
  static get storeKey() { return 'messages'; }
}
class MockBooking extends MockModel {
  constructor(data) { super(data, 'bookings'); }
  static get storeKey() { return 'bookings'; }
}
class MockReview extends MockModel {
  constructor(data) { super(data, 'reviews'); }
  static get storeKey() { return 'reviews'; }
}

// Seed HealthBot user if it doesn't exist
async function seedHealthBot() {
  try {
    const existing = await User.findOne({ username: 'healthbot' });
    if (!existing) {
      const bot = new User({
        username: 'healthbot',
        password: 'healthbot_secure_password_123',
        role: 'doctor',
        name: 'HealthBot (AI Doctor)',
        initials: 'HB',
        specialty: 'Primary Care AI',
        bio: 'Warm, calm, and professional AI-powered primary care assistant, available 24/7.',
        phone: '1-800-AI-HEALTH',
        email: 'healthbot@medicare.com'
      });
      await bot.save();
      console.log('HealthBot user seeded successfully.');
    }
  } catch (err) {
    console.error('Error seeding HealthBot:', err);
  }
}

mongoose.set('bufferCommands', false);

let dbConnectionPromise = null;

async function ensureDbConnected() {
  if (mongoose.connection.readyState === 1) return;
  if (User === MockUser) return;
  if (dbConnectionPromise) return dbConnectionPromise;

  dbConnectionPromise = (async () => {
    try {
      console.log("Connecting to MongoDB...");
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
      console.log("MongoDB Connected");
      await seedHealthBot();
    } catch (err) {
      console.log("Failed to connect to MongoDB cluster (network/DNS block). Switching to local in-memory fallback database.", err);
      enableInMemoryDb();
    } finally {
      dbConnectionPromise = null;
    }
  })();
  return dbConnectionPromise;
}

// Trigger connection in background at startup
ensureDbConnected().catch(err => {
  console.error("Initial DB connection failed:", err);
});

// Database Connection Middleware for API requests
app.use(async (req, res, next) => {
  try {
    await ensureDbConnected();
    next();
  } catch (err) {
    console.error("Database connection middleware error:", err);
    next();
  }
});

function enableInMemoryDb() {
  User = MockUser;
  Conversation = MockConversation;
  Message = MockMessage;
  Booking = MockBooking;
  Review = MockReview;
  seedHealthBot();
}


// Store active socket connections
const connectedUsers = {}; // username -> socket.id

// API Routes
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password, role, name, specialty, gender } = req.body;
    
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ error: 'Username already exists.' });

    const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'U';
    const newUser = new User({ username, password, role, name, initials, specialty, gender });
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

app.post("/api/users", async (req, res) => {
  try {
    const user = new User(req.body);
    await user.save();
    res.json({
      message: "User saved successfully"
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
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
    
    const conv = await Conversation.findById(req.body.conversationId);
    if (conv) {
      // We still emit for local dev, but Vercel clients rely on polling
      const recipient = conv.participants.find(p => p !== req.body.from);
      if (recipient && connectedUsers[recipient]) {
        io.to(connectedUsers[recipient]).emit('newMessage', newMsg);
      }
      if (connectedUsers[req.body.from]) {
        io.to(connectedUsers[req.body.from]).emit('newMessage', newMsg);
      }

      // Trigger HealthBot response if recipient is the bot
      if (recipient === 'healthbot') {
        setTimeout(() => handleHealthBotResponse(conv._id.toString(), req.body.from, req.body.text), 1000);
      }
    }
    
    res.status(201).json(newMsg);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const newBooking = new Booking({ ...req.body, status: 'Confirmed' });
    await newBooking.save();

    // Broadcast the new booking globally for real-time dashboard sync
    io.emit('newBooking', newBooking);

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

app.delete('/api/users/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    // Support database-free deletion for in-memory fallback
    if (User === MockUser) {
      const convs = inMemoryStore.conversations.filter(c => c.participants.includes(username));
      const convIds = convs.map(c => c._id);
      
      inMemoryStore.conversations = inMemoryStore.conversations.filter(c => !c.participants.includes(username));
      inMemoryStore.messages = inMemoryStore.messages.filter(m => !convIds.includes(m.conversationId));
      inMemoryStore.bookings = inMemoryStore.bookings.filter(b => b.username !== username && b.doctorId !== username);
      inMemoryStore.users = inMemoryStore.users.filter(u => u.username !== username);
      
      console.log(`Deleted user ${username} and associated data from In-Memory fallback DB.`);
      return res.json({ message: 'User profile and associated data deleted successfully (In-Memory).' });
    }

    // MongoDB Mongoose implementation
    const convs = await Conversation.find({ participants: username }).lean();
    const convIds = convs.map(c => c._id.toString());

    if (convIds.length > 0) {
      await Message.deleteMany({ conversationId: { $in: convIds } });
      await Conversation.deleteMany({ _id: { $in: convIds } });
    }

    await Booking.deleteMany({ $or: [{ username: username }, { doctorId: username }] });
    const result = await User.deleteOne({ username });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    console.log(`Deleted user ${username} and associated data from MongoDB.`);
    res.json({ message: 'User profile and associated data deleted successfully.' });
  } catch (error) {
    console.error('Error deleting user profile:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Support database-free deletion for in-memory fallback
    if (Conversation === MockConversation) {
      inMemoryStore.conversations = inMemoryStore.conversations.filter(c => c._id !== id);
      inMemoryStore.messages = inMemoryStore.messages.filter(m => m.conversationId !== id);
      
      console.log(`Deleted conversation ${id} from In-Memory fallback DB.`);
      return res.json({ message: 'Conversation and messages deleted successfully (In-Memory).' });
    }

    // MongoDB Mongoose implementation
    await Message.deleteMany({ conversationId: id });
    const result = await Conversation.deleteOne({ _id: id });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    console.log(`Deleted conversation ${id} from MongoDB.`);
    res.json({ message: 'Conversation and messages deleted successfully.' });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
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

        // Trigger HealthBot response if recipient is the bot
        if (recipient === 'healthbot') {
          setTimeout(() => handleHealthBotResponse(conv._id.toString(), data.from, data.text), 1000);
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

// --- HealthBot Groq API Call ---
async function callGroqChatCompletions(groqMessages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY not configured in environment.");
  }

  // List of models to try in order of preference
  const models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
  let lastError = null;

  for (const model of models) {
    try {
      console.log(`Attempting Groq completion using model: ${model}`);
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: model,
          messages: groqMessages,
          temperature: 0.7,
          max_tokens: 1024
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Groq API returned ${res.status}: ${errText}`);
      }

      const data = await res.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content;
      } else {
        throw new Error("Malformed Groq API response structure");
      }
    } catch (err) {
      console.error(`Error with model ${model}:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error("Failed to get response from all tried Groq models.");
}

// --- HealthBot AI Response Engine ---
// --- Medical Report Simulator Helper ---
function simulateReportText(fileName, userText) {
  const fileLower = (fileName || '').toLowerCase();
  const textLower = (userText || '').toLowerCase();

  // Blood sugar / Diabetes
  if (fileLower.includes('sugar') || fileLower.includes('diabet') || fileLower.includes('glucose') || 
      textLower.includes('sugar') || textLower.includes('glucose') || textLower.includes('fasting')) {
    return `LABORATORY REPORT - BLOOD GLUCOSE TEST
Patient Name: Patient
Test Name: Fasting Blood Sugar (FBS) & HbA1c
---------------------------------------------
1. Fasting Plasma Glucose: 185 mg/dL  [HIGH]  (Reference Range: 70-100 mg/dL)
2. HbA1c (Glycated Hemoglobin): 8.2 %  [HIGH]  (Reference Range: < 5.7% Normal, 5.7-6.4% Prediabetes, >= 6.5% Diabetes)
---------------------------------------------
Clinical Interpretation: Fasting blood glucose and HbA1c are significantly elevated, indicating poorly controlled or newly onset Diabetes Mellitus. Requires clinical review by a General Physician.`;
  }

  // Lipid Profile / Cholesterol / Heart
  if (fileLower.includes('lipid') || fileLower.includes('cholesterol') || fileLower.includes('ldl') || 
      fileLower.includes('heart') || textLower.includes('lipid') || textLower.includes('cholesterol') || textLower.includes('cardio')) {
    return `LABORATORY REPORT - LIPID PANEL
Patient Name: Patient
Test Name: Serum Cholesterol & Lipids
---------------------------------------------
1. Total Cholesterol: 265 mg/dL  [HIGH]  (Reference Range: < 200 mg/dL)
2. LDL Cholesterol (Bad): 178 mg/dL  [HIGH]  (Reference Range: < 100 mg/dL)
3. HDL Cholesterol (Good): 34 mg/dL   [LOW]   (Reference Range: > 40 mg/dL)
4. Triglycerides: 210 mg/dL        [HIGH]  (Reference Range: < 150 mg/dL)
---------------------------------------------
Clinical Interpretation: Elevated LDL and total cholesterol combined with low HDL, indicating Mixed Dyslipidemia. High risk for coronary/cardiovascular issues. Requires review by a Cardiologist.`;
  }

  // Scan reports / X-Ray / MRI / Bones
  if (fileLower.includes('scan') || fileLower.includes('xray') || fileLower.includes('x-ray') || 
      fileLower.includes('mri') || fileLower.includes('ultrasound') || fileLower.includes('ct') || fileLower.includes('bone') || fileLower.includes('joint') || fileLower.includes('ortho') ||
      textLower.includes('scan') || textLower.includes('xray') || textLower.includes('mri') || textLower.includes('bone') || textLower.includes('joint')) {
    const isBone = fileLower.includes('bone') || fileLower.includes('joint') || fileLower.includes('ortho') || textLower.includes('bone') || textLower.includes('joint');
    if (isBone) {
      return `RADIOLOGY DEPT - JOINT/BONE SCAN REPORT
Scan Type: X-Ray / MRI Joint Scan
---------------------------------------------
Findings:
- Right knee joint space is moderately narrowed.
- Subchondral sclerosis and osteophyte formation are observed at the joint margins.
- No acute fracture or dislocation is detected.
- Surrounding soft tissues show mild swelling.
---------------------------------------------
Clinical Impression: Moderate osteoarthritic changes and mild joint effusion. Requires clinical evaluation by an Orthopedic specialist.`;
    }
    return `RADIOLOGY DEPT - SCAN REPORT
Scan Type: Chest X-Ray / CT / MRI Scan
---------------------------------------------
Findings:
- Thoracic cage and soft tissues are normal.
- Heart size is mildly enlarged (Mild Cardiomegaly).
- Lungs show bilateral lower lobe bronchial thickening with mild peribronchial congestion.
- No active consolidation, effusion or pneumothorax is seen.
---------------------------------------------
Clinical Impression: Mild cardiomegaly and bilateral lower lobe bronchial congestion. Suggests bronchitis or cardiorespiratory congestion. Specialist consultation recommended.`;
  }

  // Skin / Dermatology reports
  if (fileLower.includes('skin') || fileLower.includes('rash') || fileLower.includes('dermat') || fileLower.includes('acne') || fileLower.includes('allergy') ||
      textLower.includes('skin') || textLower.includes('rash') || textLower.includes('dermat') || textLower.includes('acne') || textLower.includes('allergy')) {
    return `DERMATOLOGY ASSESSMENT REPORT
Patient Name: Patient
Test Name: Skin Lesion / Rash Swab & Analysis
---------------------------------------------
1. Microbial Culture: Moderate growth of Staphylococcus aureus
2. Inflammation Markers: Elevated localized dermal response
3. Allergy swab: Negative for contact latex allergens
---------------------------------------------
Clinical Impression: Localized bacterial skin infection with active dermal inflammation. Requires clinical review by a Dermatologist for topical/oral antibiotic therapy.`;
  }

  // Brain / Neurological reports
  if (fileLower.includes('brain') || fileLower.includes('nerv') || fileLower.includes('neuro') || fileLower.includes('seizure') || fileLower.includes('stroke') ||
      textLower.includes('brain') || textLower.includes('nerv') || textLower.includes('neuro') || textLower.includes('seizure') || textLower.includes('stroke')) {
    return `NEUROLOGICAL EEG & MRI REPORT
Patient Name: Patient
Test Name: Brain MRI & Electroencephalogram
---------------------------------------------
1. EEG Tracing: Intermittent spike-and-wave discharges in temporal lobes  [ABNORMAL]
2. Brain MRI: No focal mass effect, hemorrhage, or acute infarct.
3. Nerve Conduction: Normal motor and sensory nerve velocities.
---------------------------------------------
Clinical Impression: Temporal lobe epileptiform activity (elevated seizure risk). Requires immediate clinical review by a Neurologist.`;
  }

  // Prescriptions / Medical documents
  if (fileLower.includes('prescription') || fileLower.includes('rx') || fileLower.includes('med') || 
      textLower.includes('prescription') || textLower.includes('rx') || textLower.includes('medication')) {
    return `PREVIOUS MEDICAL PRESCRIPTION
Issued by: City General Health Center
Date: 3 months ago
---------------------------------------------
Prescribed Medications:
1. Metformin 500mg - 1 tablet twice daily with meals (for Blood Sugar)
2. Atorvastatin 10mg - 1 tablet daily at bedtime (for Cholesterol)
3. Lisinopril 10mg - 1 tablet daily in the morning (for Blood Pressure)
---------------------------------------------
Clinical Note: Patient was advised to monitor blood pressure weekly and check HbA1c in 3 months.`;
  }

  // Lab reports / Blood count (CBC)
  if (fileLower.includes('cbc') || fileLower.includes('blood') || fileLower.includes('count') || 
      fileLower.includes('lab') || fileLower.includes('report') || textLower.includes('cbc')) {
    return `LABORATORY REPORT - COMPLETE BLOOD COUNT (CBC)
Patient Name: Patient
Test Name: Hematology Profile
---------------------------------------------
1. Hemoglobin (Hb): 10.2 g/dL       [LOW]   (Reference Range: 12.0 - 16.0 g/dL)
2. White Blood Cell (WBC): 13,800   [HIGH]  (Reference Range: 4,000 - 11,000 /mcL)
3. Platelet Count: 250,000                  (Reference Range: 150,000 - 450,000 /mcL)
4. Red Blood Cell (RBC): 3.8                (Reference Range: 4.0 - 5.2 million/mcL)
---------------------------------------------
Clinical Impression: Mild microcytic anemia (low hemoglobin) and leukocytosis (elevated WBC). Elevated WBC indicates a probable active immune response to an infection or acute inflammation. Requires review by a General Physician.`;
  }

  // Default fallback if we cannot match any categories
  return `GENERAL MEDICAL CLINICAL REPORT
File Name: ${fileName}
---------------------------------------------
Primary Findings:
All major physiological biomarkers and structural elements checked are within acceptable normal margins. No acute distress or significant abnormalities detected in this log.
---------------------------------------------
Note: Please consult a physician for a comprehensive multi-system clinical assessment.`;
}

// --- HealthBot AI Response Engine ---
async function handleHealthBotResponse(conversationId, patientUsername, userMessage) {
  let messages;
  try {
    messages = await Message.find({ conversationId }).sort({ _id: 1 });
  } catch (err) {
    console.error("Failed to load message history:", err);
    return;
  }

  const userMessages = messages.filter(m => m.from === patientUsername);
  const botMessages = messages.filter(m => m.from === 'healthbot');
  let replyText = "";
  let messageType = "text";
  let prescriptionFields = {};

  // Check real-time doctor availability from MongoDB & sockets map
  let doctorsListStr = "";
  try {
    const doctors = await User.find({ role: 'doctor', username: { $ne: 'healthbot' } }).lean();
    doctorsListStr = doctors.map(d => {
      const isOnline = !!connectedUsers[d.username];
      return `- ${d.name} (Specialty: ${d.specialty || 'General Medicine'}, Username: ${d.username}) - Status: ${isOnline ? 'Online' : 'Offline'}`;
    }).join('\n');
  } catch (dbErr) {
    console.error("Failed to load doctor availability:", dbErr);
  }

  try {
    // Construct LLM history
    const systemPrompt = `You are HealthBot, an advanced AI-powered primary care physician and healthcare assistant on this hospital platform. Your role is to act as every patient's first point of contact — behaving exactly like a dynamic, knowledgeable, and empathetic human doctor available 24/7.

ROLE & IDENTITY:
- You are the patient's primary human-like AI doctor. You handle all queries and guide the patient through their concerns.
- Always communicate in a warm, calm, reassuring, and professional clinical tone. Do not give robotic, dry, or repetitive replies.
- Communicate in the patient's preferred language.

CLINICAL WORKFLOW & GUIDELINES:
1. Patient Interaction & Symptom Collection (Ask One Question at a Time):
   - Professional and empathetic greeting.
   - You must collect the following 20 pieces of medical information step-by-step (ask only 1 or 2 related questions at a time in a natural conversational flow, never dump a list of questions):
     1. Patient name
     2. Age
     3. Gender
     4. Symptoms (primary complaint)
     5. Pain level (on a scale of 1 to 10)
     6. Duration of illness (how long has it been happening)
     7. Existing diseases (e.g. chronic conditions like hypertension, asthma, etc.)
     8. Allergies (especially drug allergies)
     9. Current medications
     10. Medical history (past diagnoses, surgeries)
     11. Lifestyle habits (smoking, alcohol, exercise)
     12. Sleep pattern (average hours, quality)
     13. Food habits / diet (vegetarian, fast food, regular meals)
     14. Fever details (if fever is present, ask temperature, pattern, chills)
     15. Breathing issues (if any respiratory symptoms, ask about chest tightness, shortness of breath)
     16. Blood pressure history
     17. Diabetes history
     18. Mental stress / anxiety levels
     19. Previous surgeries / hospitalizations
     20. Family medical history (chronic or hereditary illnesses in family)
   - Ask detailed and dynamic follow-up questions based on previous answers, like an experienced clinical doctor during examination, to carefully note every small detail before giving suggestions.

2. Medical Report & Test Analysis:
   - Ask the patient to upload reports (such as Blood test reports, Scan reports, Prescriptions, Medical documents, Lab reports).
   - If a report is uploaded (represented in the chat log as '[Patient Uploaded Report: ...]'), analyze the report findings, extract important health information (such as glucose levels, cholesterol, WBC, hemoglobin, radiology findings), and explain them in clear, simple language.

3. Diagnosis & Action for Mild Conditions:
   - If the illness appears mild or manageable:
     - Provide:
       - General medicine suggestions (safe OTC medicines only)
       - Diet recommendations
       - Hydration advice
       - Lifestyle improvements
       - Recovery precautions
       - Sleep recommendations
     - You MUST append a structured prescription block at the end of your response:
       [PRESCRIPTION:
       Diagnosis: <Likely condition name>
       Medicines: <Medication 1 with directions>, <Medication 2 with directions>
       Diet: <Diet and lifestyle suggestions>
       Notes: <Any additional advice or follow-up instructions>
       ]
     - You MUST include this disclaimer in the text: "This is not a replacement for professional medical advice."

4. Emergency & Serious Conditions - Doctor Consultation Routing:
   - If the symptoms (e.g., chest pain, breathing difficulty, severe bleeding, stroke signs, high fever) or report findings indicate a serious condition:
     - IMMEDIATELY stop giving normal treatment suggestions or OTC recommendations.
     - Inform the patient that doctor consultation is required.
     - Identify the correct doctor specialization based on the illness:
       * Heart issues / chest pain / high blood pressure → Cardiologist
       * Skin problems / rashes / lesions → Dermatologist
       * Bone / joint / muscle problems → Orthopedic
       * Brain / nervous system issues → Neurologist
       * General illness / infections / other serious issues → General Physician
     - Check the availability of the specialists in the directory below.
     - If a doctor of the identified specialty is Online:
       - Connect the patient to that doctor chat immediately by appending this tag at the very end of your response: [TRANSFER: <doctor_username> | <doctor_name>].
     - If the doctor of that specialty is Offline:
       - Show their next available timings (e.g., "Dr. [Name] is currently unavailable. Their next available timing is tomorrow at 10:00 AM.").
       - Tell the patient you are automatically booking an appointment for them, and append this tag at the end of your response to book the appointment: [BOOK: <Specialty>].

REAL-TIME HOSPITAL DOCTORS DIRECTORY:
${doctorsListStr || 'No doctors registered.'}

Always maintain memory of the conversation and refer to previous answers. Keep the tone warm, caring, and professional.`;

    const groqMessages = [{ role: "system", content: systemPrompt }];
    messages.forEach(msg => {
      if (msg.from === 'healthbot') {
        let cleanContent = msg.text.replace(/\[PRESCRIPTION:[\s\S]*?\]/gi, '').replace(/\[BOOK:\s*[^\]]+\]/gi, '').replace(/\[TRANSFER:\s*[^\]]+\]/gi, '').trim();
        groqMessages.push({ role: 'assistant', content: cleanContent });
      } else {
        if (msg.type === 'report') {
          // Process report text preview using helper if it was binary file placeholder
          let reportContent = msg.text;
          if (!reportContent || reportContent.startsWith('[FILE_UPLOAD:')) {
            reportContent = simulateReportText(msg.fileName, msg.text);
          }
          groqMessages.push({ role: 'user', content: `[Patient Uploaded Report: File Name = ${msg.fileName || 'report.pdf'}, Size = ${msg.fileSize || 'Unknown'}, Content Preview = ${reportContent}]` });
        } else {
          groqMessages.push({ role: 'user', content: msg.text });
        }
      }
    });

    // Call Groq API
    replyText = await callGroqChatCompletions(groqMessages);

    // 1. Process Prescription Block
    const rxRegex = /\[PRESCRIPTION:([\s\S]*?)\]/i;
    const rxMatch = replyText.match(rxRegex);
    if (rxMatch) {
      messageType = "prescription";
      const rxContent = rxMatch[1];
      const lines = rxContent.split('\n');
      let currentKey = null;
      let sections = { diagnosis: "", medicines: "", diet: "", notes: "" };

      for (let line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.toLowerCase().startsWith("diagnosis:")) {
          currentKey = "diagnosis";
          sections.diagnosis = trimmed.substring("diagnosis:".length).trim();
        } else if (trimmed.toLowerCase().startsWith("medicines:")) {
          currentKey = "medicines";
          sections.medicines = trimmed.substring("medicines:".length).trim();
        } else if (trimmed.toLowerCase().startsWith("diet:")) {
          currentKey = "diet";
          sections.diet = trimmed.substring("diet:".length).trim();
        } else if (trimmed.toLowerCase().startsWith("notes:")) {
          currentKey = "notes";
          sections.notes = trimmed.substring("notes:".length).trim();
        } else if (currentKey) {
          sections[currentKey] += " " + trimmed;
        }
      }

      prescriptionFields.diagnosis = sections.diagnosis.trim() || "General Assessment";
      prescriptionFields.medicines = sections.medicines.split(',').map(m => m.trim()).filter(Boolean);
      prescriptionFields.diet = sections.diet.trim();
      prescriptionFields.notes = sections.notes.trim();

      // Remove the block from the response
      replyText = replyText.replace(rxRegex, '').trim();
    }

    // 2. Process Booking Tag
    const bookRegex = /\[BOOK:\s*([^\]]+)\]/i;
    const bookMatch = replyText.match(bookRegex);
    if (bookMatch) {
      const specialty = bookMatch[1].trim();
      const doctors = await User.find({ role: 'doctor', username: { $ne: 'healthbot' } });
      if (doctors.length > 0) {
        const specialtyMatch = specialty.toLowerCase();
        let referralDoc = doctors.find(d => d.specialty && d.specialty.toLowerCase().includes(specialtyMatch)) || 
                          doctors.find(d => d.specialty && specialtyMatch.includes(d.specialty.toLowerCase())) || 
                          doctors[0];
                          
        const bookingId = "BK" + Math.floor(1000 + Math.random() * 9000);
        const newBooking = new Booking({
          username: patientUsername,
          doctorId: referralDoc.username,
          service: `Appointment with ${referralDoc.name}`,
          date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          time: "10:00 AM",
          phone: "Not Provided",
          reason: "Referral from HealthBot AI",
          status: 'Confirmed'
        });
        await newBooking.save();
        io.emit('newBooking', newBooking);

        const bookingConfirmation = `\n\nYour appointment has been booked! ✓\n` +
                                    `Doctor: ${referralDoc.name}, ${referralDoc.specialty || 'General Physician'}\n` +
                                    `Date: ${newBooking.date}\n` +
                                    `Time: 10:00 AM\n` +
                                    `Mode: In-person / Video call\n` +
                                    `Reference: #${bookingId}\n\n` +
                                    `Please bring your recent reports and ID. Arrive 10 minutes early.`;

        replyText = replyText.replace(bookRegex, '').trim() + bookingConfirmation;
      } else {
        replyText = replyText.replace(bookRegex, '').trim() + `\n\n[System Note: We tried to book an appointment with a ${specialty} specialist, but no doctors are registered in this department at the moment. Please consult our directory to book manually.]`;
      }
    }

  } catch (err) {
    console.error("HealthBot Groq API failure, using rule-based fallback:", err);
    
    // Find all doctors and partition them by specialty and availability
    const doctors = await User.find({ role: 'doctor', username: { $ne: 'healthbot' } }).lean();
    const isDoctorOnline = (username) => !!connectedUsers[username];
    const getDoctorBySpecialty = (spec) => {
      const specLower = spec.toLowerCase();
      // Try online first
      let matched = doctors.find(d => d.specialty?.toLowerCase().includes(specLower) && isDoctorOnline(d.username));
      if (matched) return { doctor: matched, online: true };
      // Try offline
      matched = doctors.find(d => d.specialty?.toLowerCase().includes(specLower));
      if (matched) return { doctor: matched, online: false };
      // Fallback to first doctor
      return doctors.length > 0 ? { doctor: doctors[0], online: isDoctorOnline(doctors[0].username) } : null;
    };

    const cleanMsg = userMessage.toLowerCase();
    
    // Check if the user message is a report upload
    const lastMsg = messages[messages.length - 1];
    let parsedReportAnalysis = "";
    let isReportUploaded = false;

    if (lastMsg && lastMsg.type === 'report') {
      isReportUploaded = true;
      const fileName = lastMsg.fileName || 'report.pdf';
      const textPreview = lastMsg.text || '';
      parsedReportAnalysis = simulateReportText(fileName, textPreview);
    }

    // Emergency Triage check
    const hasEmergencyKeyword = cleanMsg.includes('chest pain') || cleanMsg.includes('difficulty breathing') || cleanMsg.includes('shortness of breath') || cleanMsg.includes('heart attack') || cleanMsg.includes('stroke') || cleanMsg.includes('loss of consciousness') || cleanMsg.includes('seizure') || cleanMsg.includes('poison') || cleanMsg.includes('bleeding');

    if (hasEmergencyKeyword) {
      replyText = "This sounds like a serious medical emergency. Casual treatment advice is stopped, and immediate clinical intervention is required. Please call emergency services (108 / 112) immediately.";
      const match = getDoctorBySpecialty('Cardiology');
      if (match) {
        const docName = match.doctor.name.startsWith("Dr.") ? match.doctor.name : `Dr. ${match.doctor.name}`;
        if (match.online) {
          replyText += `\n\n${docName} (Cardiology/Primary Care) is currently online. I am transferring you directly to their chat room for an instant live consultation. [TRANSFER: ${match.doctor.username} | ${docName}]`;
        } else {
          const bookingId = "BK" + Math.floor(1000 + Math.random() * 9000);
          const newBooking = new Booking({
            username: patientUsername,
            doctorId: match.doctor.username,
            service: `Priority Appointment with ${match.doctor.name}`,
            date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            time: "10:00 AM",
            phone: "Not Provided",
            reason: "Emergency referral from HealthBot AI",
            status: 'Confirmed'
          });
          await newBooking.save();
          io.emit('newBooking', newBooking);
          replyText += `\n\nOur specialist ${docName} is currently offline. Their next available timing is tomorrow at 10:00 AM. I have automatically scheduled this priority appointment for you:\nDate: ${newBooking.date}\nTime: 10:00 AM\nReference: #${bookingId}. [BOOK: Cardiology]`;
        }
      }
    } else if (isReportUploaded) {
      // Analyze reports and route if serious
      replyText = parsedReportAnalysis + "\n\nThis is not a replacement for professional medical advice.";
      const isSeriousReport = parsedReportAnalysis.includes('[HIGH]') || parsedReportAnalysis.includes('[LOW]') || parsedReportAnalysis.includes('ABNORMAL');
      if (isSeriousReport) {
        let spec = 'General Medicine';
        if (parsedReportAnalysis.includes('Cardiology')) spec = 'Cardiology';
        else if (parsedReportAnalysis.includes('Dermatologist')) spec = 'Dermatology';
        else if (parsedReportAnalysis.includes('Orthopedic')) spec = 'Orthopedics';
        else if (parsedReportAnalysis.includes('Neurologist')) spec = 'Neurology';

        const match = getDoctorBySpecialty(spec);
        if (match) {
          const docName = match.doctor.name.startsWith("Dr.") ? match.doctor.name : `Dr. ${match.doctor.name}`;
          if (match.online) {
            replyText += `\n\nAn online specialist, ${docName}, is available. I recommend transferring to them immediately for live consultation. [TRANSFER: ${match.doctor.username} | ${docName}]`;
          } else {
            const bookingId = "BK" + Math.floor(1000 + Math.random() * 9000);
            const newBooking = new Booking({
              username: patientUsername,
              doctorId: match.doctor.username,
              service: `Follow-up Appointment with ${match.doctor.name}`,
              date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              time: "10:00 AM",
              phone: "Not Provided",
              reason: "Abnormal report referral from HealthBot AI",
              status: 'Confirmed'
            });
            await newBooking.save();
            io.emit('newBooking', newBooking);
            replyText += `\n\nSince ${docName} is currently offline, I have automatically booked a follow-up appointment for you:\nDoctor: ${docName}\nDate: ${newBooking.date}\nTime: 10:00 AM\nReference: #${bookingId}. [BOOK: ${spec}]`;
          }
        }
      } else {
        replyText += "\n\nDo you have any details of symptoms or active illness related to this? Please tell me how you are feeling.";
      }
    } else {
      // Step-by-step sequential questions based on userMessages count (collecting all 20 details)
      const turns = userMessages.length;
      
      if (turns <= 1) {
        replyText = "Hello! I am HealthBot, your primary care AI doctor assistant. I'm here to support you step-by-step. May I start by asking for your full name?";
      } else if (turns === 2) {
        replyText = "Thank you! To customize my assessment, could you please share your age and gender?";
      } else if (turns === 3) {
        replyText = "Got it. What symptoms, illness, or health issues are you experiencing today? Please include how long you've had them (duration) and, if there's pain, its severity on a scale from 1 to 10.";
      } else if (turns === 4) {
        replyText = "Thank you. To understand this better, do you have any fever (if so, please share temperature details) or breathing issues? Also, do you have a history of high/low blood pressure or diabetes?";
      } else if (turns === 5) {
        replyText = "I see. If you have any recent blood test reports, scan reports, prescriptions, lab reports, or other medical documents, please drag and drop them here. Otherwise, please let me know if you don't have any.";
      } else if (turns === 6) {
        replyText = "Thank you. Do you have any known drug allergies, existing diseases/conditions, or are you currently taking any medications?";
      } else if (turns === 7) {
        replyText = "Understood. Have you had any previous surgeries or major hospitalizations in the past? Also, is there any notable family medical history of chronic conditions (like heart disease or cancer)?";
      } else if (turns === 8) {
        replyText = "Almost done. Could you tell me a bit about your lifestyle habits, daily sleep patterns, food habits (diet), and if you're experiencing any significant mental stress or anxiety?";
      } else {
        // Complete the assessment & prescribe if minor, or transfer/book if serious
        const fullChatHistoryText = userMessages.map(u => u.text.toLowerCase()).join(" ");
        
        let specialty = "General Medicine";
        let isSerious = false;
        
        const hasHeart = fullChatHistoryText.includes('heart') || fullChatHistoryText.includes('chest') || fullChatHistoryText.includes('cardio') || fullChatHistoryText.includes('lipid') || fullChatHistoryText.includes('cholesterol');
        const hasSkin = fullChatHistoryText.includes('skin') || fullChatHistoryText.includes('rash') || fullChatHistoryText.includes('dermat') || fullChatHistoryText.includes('acne') || fullChatHistoryText.includes('itch');
        const hasBone = fullChatHistoryText.includes('bone') || fullChatHistoryText.includes('joint') || fullChatHistoryText.includes('fracture') || fullChatHistoryText.includes('ortho') || fullChatHistoryText.includes('muscle') || fullChatHistoryText.includes('sprain');
        const hasBrain = fullChatHistoryText.includes('brain') || fullChatHistoryText.includes('nerv') || fullChatHistoryText.includes('neuro') || fullChatHistoryText.includes('seizure') || fullChatHistoryText.includes('stroke') || fullChatHistoryText.includes('paraly');
        const hasGeneralSerious = fullChatHistoryText.includes('breathing') || fullChatHistoryText.includes('shortness of breath') || fullChatHistoryText.includes('high fever') || fullChatHistoryText.includes('bleeding') || fullChatHistoryText.includes('unconscious') || fullChatHistoryText.includes('poison');

        if (hasHeart) {
          specialty = "Cardiology";
          isSerious = true;
        } else if (hasSkin) {
          specialty = "Dermatology";
          if (fullChatHistoryText.includes('severe') || fullChatHistoryText.includes('infection')) {
            isSerious = true;
          }
        } else if (hasBone) {
          specialty = "Orthopedics";
          if (fullChatHistoryText.includes('severe') || fullChatHistoryText.includes('fracture') || fullChatHistoryText.includes('break')) {
            isSerious = true;
          }
        } else if (hasBrain) {
          specialty = "Neurology";
          isSerious = true;
        } else if (hasGeneralSerious) {
          specialty = "General Medicine";
          isSerious = true;
        }

        if (isSerious) {
          const match = getDoctorBySpecialty(specialty);
          replyText = "Based on the details collected, your condition requires professional evaluation. Casual treatment suggestions are stopped.";
          if (match) {
            const docName = match.doctor.name.startsWith("Dr.") ? match.doctor.name : `Dr. ${match.doctor.name}`;
            if (match.online) {
              replyText += `\n\n${docName} (${specialty}) is currently online. I am transferring you directly to their chat room. [TRANSFER: ${match.doctor.username} | ${docName}]`;
            } else {
              const bookingId = "BK" + Math.floor(1000 + Math.random() * 9000);
              const newBooking = new Booking({
                username: patientUsername,
                doctorId: match.doctor.username,
                service: `Priority Appointment with ${match.doctor.name}`,
                date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                time: "10:00 AM",
                phone: "Not Provided",
                reason: "HealthBot AI referral for serious symptoms",
                status: 'Confirmed'
              });
              await newBooking.save();
              io.emit('newBooking', newBooking);
              replyText += `\n\nOur specialist ${docName} (${specialty}) is currently offline. Their next available timing is tomorrow at 10:00 AM. I have automatically scheduled this priority appointment for you:\nDate: ${newBooking.date}\nTime: 10:00 AM\nReference: #${bookingId}. [BOOK: ${specialty}]`;
            }
          } else {
            replyText += `\n\nPlease book an appointment with our ${specialty} department at your earliest convenience.`;
          }
        } else {
          // Mild condition suggestions
          let diagnosis = "Mild General Discomfort";
          let medicines = ["Paracetamol 500mg (1 tablet every 6 hours as needed for discomfort)"];
          let diet = "Increase intake of warm fluids, fresh fruits, vegetables, and maintain a balanced diet.";
          let hydration = "Drink at least 2.5 to 3 liters of water daily.";
          let lifestyle = "Engage in light walking, avoid excessive screen time, and manage stress.";
          let precautions = "Monitor your temperature and symptoms. Avoid self-medicating beyond standard OTC.";
          let sleep = "Get at least 8 hours of restful sleep daily.";

          if (fullChatHistoryText.includes('cough') || fullChatHistoryText.includes('fever') || fullChatHistoryText.includes('cold') || fullChatHistoryText.includes('flu')) {
            diagnosis = "Acute Upper Respiratory Tract Infection (Common Cold)";
            medicines = ["Paracetamol 500mg (1 tablet every 6 hours as needed for fever/body aches)", "Cetirizine 10mg (1 tablet at bedtime for running nose)"];
            diet = "Warm vegetable broths, herbal teas with honey, soft warm foods.";
            hydration = "Warm water, warm lemon water, and herbal infusions to stay hydrated.";
            lifestyle = "Steam inhalation twice a day. Rest in a well-ventilated, comfortable room.";
            precautions = "Avoid exposure to cold draft, dust, and smoking. Stay isolated to prevent spread.";
            sleep = "Get 8-9 hours of sleep with head slightly elevated to relieve congestion.";
          } else if (fullChatHistoryText.includes('stomach') || fullChatHistoryText.includes('diarrhea') || fullChatHistoryText.includes('vomit') || fullChatHistoryText.includes('gas')) {
            diagnosis = "Mild Gastroenteritis or Dyspepsia";
            medicines = ["ORS (Oral Rehydration Salts) - Sip 200ml after each loose stool", "Tab Paracetamol 500mg if fever or abdominal ache is present (up to 3 times a day)"];
            diet = "Follow the BRAT diet (Bananas, Rice, Applesauce, Toast). Avoid dairy, spicy, fatty foods.";
            hydration = "Sip coconut water, electrolyte solutions, and clear broths continuously.";
            lifestyle = "Avoid heavy physical exertion. Keep abdominal area warm.";
            precautions = "Watch for signs of dehydration (extreme thirst, dry mouth, dark urine).";
            sleep = "Rest quietly in bed, avoiding sleeping immediately after eating.";
          } else if (fullChatHistoryText.includes('headache') || fullChatHistoryText.includes('migraine')) {
            diagnosis = "Mild Tension Headache";
            medicines = ["Ibuprofen 400mg or Paracetamol 500mg (1 tablet as needed for headache, max 3 daily)"];
            diet = "Regular meals, avoid skipping breakfast. Avoid processed foods, caffeine, and aged cheese.";
            hydration = "Drink water immediately at onset of headache, as dehydration is a common trigger.";
            lifestyle = "Reduce screen time, practice gentle neck stretches, and use cold compress on forehead.";
            precautions = "Avoid loud noises and bright lights. Do not overuse pain relief medications.";
            sleep = "Maintain a consistent sleep-wake schedule and sleep in a dark, quiet room.";
          }

          messageType = "prescription";
          prescriptionFields.diagnosis = diagnosis;
          prescriptionFields.medicines = medicines;
          prescriptionFields.diet = `${diet} Hydration: ${hydration}`;
          prescriptionFields.notes = `Lifestyle: ${lifestyle}\nPrecautions: ${precautions}\nSleep: ${sleep}\n\nDisclaimer: This is not a replacement for professional medical advice.`;

          replyText = `Based on the collected information, your illness appears mild and manageable. I have generated a general health guidance card above.\n\n` +
                      `- **General Medicine Suggestions:** Standard OTC options have been noted in the prescription card.\n` +
                      `- **Diet Recommendations:** ${diet}\n` +
                      `- **Hydration Advice:** ${hydration}\n` +
                      `- **Lifestyle Improvements:** ${lifestyle}\n` +
                      `- **Recovery Precautions:** ${precautions}\n` +
                      `- **Sleep Recommendations:** ${sleep}\n\n` +
                      `*Disclaimer: This is not a replacement for professional medical advice.*`;
        }
      }
    }
  }

  try {
    const now = new Date();
    const botMsg = new Message({
      conversationId,
      from: 'healthbot',
      type: messageType,
      text: replyText,
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      ...prescriptionFields
    });
    
    await botMsg.save();
    
    const conv = await Conversation.findById(conversationId);
    if (conv) {
      if (connectedUsers[patientUsername]) {
        io.to(connectedUsers[patientUsername]).emit('newMessage', botMsg);
      }
    }
  } catch (dbErr) {
    console.error("Failed to save or broadcast HealthBot response:", dbErr);
  }
}

module.exports = app;

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
