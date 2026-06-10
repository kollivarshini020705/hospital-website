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

mongoose.connect(process.env.MONGODB_URI)
.then(() => {
  console.log("MongoDB Connected");
  seedHealthBot();
})
.catch(err => console.log(err));

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
  const models = ["llama-3.3-70b-versatile", "llama3-8b-8192"];
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

  try {
    // Construct LLM history
    const systemPrompt = `You are HealthBot, an advanced AI-powered primary care assistant on this healthcare platform. Your role is to act as every patient's first point of contact — like a knowledgeable, empathetic family doctor available 24/7.

ROLE & IDENTITY:
- You are the patient's primary AI doctor.
- You handle ALL health concerns first before escalating to human doctors.
- You are warm, calm, professional, and easy to understand. Take every concern seriously. Never dismiss a patient.
- Always communicate in the patient's preferred language if possible.

STEP-BY-STEP CONVERSATION OUTLINE:
1. Patient Intake & History (Step-by-step, do not overwhelm the patient):
   - Welcome the patient warmly, introduce yourself, and ask for their basic details: full name, age, and gender (if not already known).
   - Ask them to describe their main symptoms: what they are, when they started, severity (scale of 1 to 10), and what makes it better/worse.
   - Gather history: allergies, existing medical conditions (like diabetes, hypertension), current medications, or recent lab reports.
2. Differential Assessment & OTC Recommendations:
   - Once you have enough context, explain what their symptoms might mean in simple, plain language. Offer 2-3 likely differential diagnoses.
   - Suggest specific over-the-counter (OTC) medications (e.g. Paracetamol 500mg for fever, Cetirizine 10mg for cold) with dosage instructions.
   - ALWAYS include this exact disclaimer: "I am an AI, not a human doctor. Consult a professional before starting medications."
   - Suggest diet, fluid intake, and lifestyle adjustments.
3. Emergency Triage (Prioritize this if red flags are present):
   - If chest pain, breathing difficulty, stroke signs, sudden severe pain, loss of consciousness, or poisoning are detected, immediately tell them to call emergency services (108 / 112) or go to the nearest emergency room.
4. Specialist Booking & Referral:
   - Suggest booking an appointment with a specialist for a formal check-up.
   - If the patient agrees to book, or asks for a booking, recommend a specialty and say you will schedule it.
   - To schedule it, you MUST output the tag [BOOK: <Specialty>] at the very end of your message. Valid specialties are: Cardiology, Dermatology, Orthopedics, General Medicine.
     - Cardiology (for heart, blood pressure, or chest pain) -> [BOOK: Cardiology]
     - Dermatology (for skin, hair, or nail concerns) -> [BOOK: Dermatology]
     - Orthopedics (for joint, bone, or muscle issues) -> [BOOK: Orthopedics]
     - General Medicine (for other issues, checkups, cold, cough, stomach bugs, etc.) -> [BOOK: General Medicine]

STRUCTURED PRESCRIPTIONS:
When you provide a differential assessment and OTC recommendation, you should ALSO append a structured prescription block at the end of your response so the portal can render a beautiful Prescription Card:
[PRESCRIPTION:
Diagnosis: <Likely condition name>
Medicines: <Medication 1 with directions>, <Medication 2 with directions>
Diet: <Diet and lifestyle suggestions>
Notes: <Any additional advice or follow-up instructions>
]
For example, if suggesting paracetamol, format the medicines line as: "Medicines: Paracetamol 500mg (1 tablet every 6 hours as needed for fever)" etc. Multiple medicines should be separated by commas.

Keep your tone professional, empathetic, and warm.`;

    const groqMessages = [{ role: "system", content: systemPrompt }];
    messages.forEach(msg => {
      if (msg.from === 'healthbot') {
        // Strip out any raw prescription block or booking tags from prompt context to avoid confusion
        let cleanContent = msg.text.replace(/\[PRESCRIPTION:[\s\S]*?\]/gi, '').replace(/\[BOOK:\s*[^\]]+\]/gi, '').trim();
        groqMessages.push({ role: 'assistant', content: cleanContent });
      } else {
        groqMessages.push({ role: 'user', content: msg.text });
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
    const cleanMsg = userMessage.toLowerCase();
    
    // Emergency Red Flags
    if (cleanMsg.includes('chest pain') || cleanMsg.includes('difficulty breathing') || cleanMsg.includes('shortness of breath') || cleanMsg.includes('heart attack') || cleanMsg.includes('stroke') || cleanMsg.includes('loss of consciousness') || cleanMsg.includes('seizure') || cleanMsg.includes('poison')) {
      replyText = "This sounds like a medical emergency. Please call emergency services (108 / 112) immediately or go to your nearest emergency room. Do not wait.";
    } 
    // Appointment Booking Flow
    else if (cleanMsg.includes('book') || (cleanMsg.includes('yes') && botMessages.length > 0 && botMessages[botMessages.length - 1].text.includes('book'))) {
      const doctors = await User.find({ role: 'doctor', username: { $ne: 'healthbot' } });
      if (doctors.length > 0) {
        let referralDoc = doctors[0];
        if (cleanMsg.includes('heart') || cleanMsg.includes('cardio')) {
          referralDoc = doctors.find(d => d.specialty?.toLowerCase().includes('cardio')) || referralDoc;
        } else if (cleanMsg.includes('skin') || cleanMsg.includes('dermat')) {
          referralDoc = doctors.find(d => d.specialty?.toLowerCase().includes('derm')) || referralDoc;
        } else if (cleanMsg.includes('bone') || cleanMsg.includes('ortho') || cleanMsg.includes('joint')) {
          referralDoc = doctors.find(d => d.specialty?.toLowerCase().includes('ortho')) || referralDoc;
        }
        
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

        replyText = `Your appointment has been booked! ✓\n` +
                    `Doctor: ${referralDoc.name}, ${referralDoc.specialty || 'General Physician'}\n` +
                    `Date: ${newBooking.date}\n` +
                    `Time: 10:00 AM\n` +
                    `Mode: In-person / Video call\n` +
                    `Reference: #${bookingId}\n\n` +
                    `Please bring your recent reports and ID. Arrive 10 minutes early. Is there anything else you'd like help with today?`;
      } else {
        replyText = "No specialists are available right now. Please try booking manually from the Doctors directory. Is there anything else you'd like help with today?";
      }
    }
    // Conversation State Machine
    else if (userMessages.length <= 1) {
      replyText = "Hello! I am HealthBot, your primary care AI assistant. I'm here to help you. Before we begin, could you please share your full name, age, and gender?";
    } 
    else if (userMessages.length === 2) {
      replyText = "Thank you. To help me understand better, could you please describe your main symptom(s), how long they have been present, their severity (on a scale of 1 to 10), and if anything makes it better or worse?";
    } 
    else if (userMessages.length === 3) {
      replyText = "Understood. Do you have any known allergies, existing medical conditions (like diabetes or high blood pressure), or are you currently taking any medications? Also, if you have any recent lab reports, please share their key values here.";
    } 
    else {
      let diagnosis = "Mild viral illness or general fatigue";
      let otc = "Paracetamol 500mg - 1 tablet up to three times a day as needed for fever/pain";
      let lifestyle = "Stay well hydrated (drink 2-3 liters of water daily), rest, and eat a balanced diet of warm, easily digestible foods.";
      
      if (cleanMsg.includes('cough') || cleanMsg.includes('cold') || cleanMsg.includes('fever') || cleanMsg.includes('throat')) {
        diagnosis = "Upper Respiratory Tract Infection (Common Cold or Flu)";
        otc = "Paracetamol 500mg (1 tablet every 6 hours for fever/ache) and Cetirizine 10mg (1 tablet at night for congestion/running nose)";
        lifestyle = "Steam inhalation twice a day, warm salt-water gargles, drink warm fluids (like herbal tea or soup), and avoid cold drinks.";
      } else if (cleanMsg.includes('stomach') || (cleanMsg.includes('pain') && (cleanMsg.includes('diarrhea') || cleanMsg.includes('vomit') || cleanMsg.includes('nausea')))) {
        diagnosis = "Gastroenteritis (Stomach Flu) or Food Poisoning";
        otc = "ORS (Oral Rehydration Salts) to prevent dehydration, and Tab Paracetamol 500mg if fever/body ache is present.";
        lifestyle = "Follow a bland BRAT diet (Bananas, Rice, Applesauce, Toast). Avoid dairy, spicy, and fatty foods. Sip water or electrolyte drinks frequently.";
      } else if (cleanMsg.includes('headache') || cleanMsg.includes('migraine')) {
        diagnosis = "Tension Headache or Migraine";
        otc = "Ibuprofen 400mg or Paracetamol 500mg (1 tablet as needed)";
        lifestyle = "Rest in a quiet, dark room. Apply a cool compress to your forehead. Maintain a regular sleep schedule and reduce screen time.";
      }
      
      replyText = `**HealthBot Preliminary Assessment:**\n` +
                  `*   **Likely Condition:** ${diagnosis}\n` +
                  `*   **OTC Suggestion:** ${otc}\n` +
                  `*   **Diet & Lifestyle:** ${lifestyle}\n\n` +
                  `*Disclaimer: I am an AI health assistant. My guidance is informational and not a substitute for professional medical advice. Always consult a licensed doctor before starting, stopping, or changing any medication.*\n\n` +
                  `I recommend scheduling an appointment with a General Physician for a formal check-up. Would you like me to book an appointment for you?`;
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
