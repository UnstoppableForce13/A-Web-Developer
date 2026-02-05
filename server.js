// server.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

const SECRET = "SUPER_SECRET_KEY";

// ----- DATABASE -----
const db = new sqlite3.Database('./platform.db');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user'
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER,
    title TEXT,
    description TEXT,
    price REAL,
    delivery_time TEXT,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY(owner_id) REFERENCES users(id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER,
    sender TEXT,
    content TEXT,
    FOREIGN KEY(request_id) REFERENCES requests(id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER,
    amount REAL,
    method TEXT,
    status TEXT DEFAULT 'pending'
  )`);
});

// ----- AUTH MIDDLEWARE -----
function auth(req,res,next){
  const token = req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({message:'No token'});
  try{
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  }catch(e){ res.status(403).json({message:'Invalid token'}); }
}

// ----- ROLE CHECK -----
function permit(...roles){
  return (req,res,next)=>{
    if(!roles.includes(req.user.role)) return res.status(403).json({message:'Forbidden'});
    next();
  }
}

// ----- AUTH ROUTES -----
app.post('/api/register', async (req,res)=>{
  const {name,email,password} = req.body;
  const hashed = await bcrypt.hash(password,10);
  db.run(`INSERT INTO users (name,email,password) VALUES (?,?,?)`,
    [name,email,hashed],
    function(err){
      if(err) return res.status(400).json({error: err.message});
      res.json({id:this.lastID,name,email,role:'user'});
    }
  );
});

app.post('/api/login', (req,res)=>{
  const {email,password} = req.body;
  db.get(`SELECT * FROM users WHERE email=?`, [email], async (err,user)=>{
    if(err) return res.status(500).json({error:err.message});
    if(!user) return res.status(400).json({message:'User not found'});
    const valid = await bcrypt.compare(password,user.password);
    if(!valid) return res.status(400).json({message:'Invalid password'});
    const token = jwt.sign({id:user.id,role:user.role,name:user.name},SECRET,{expiresIn:'7d'});
    res.json({token,role:user.role,name:user.name});
  });
});

// ----- REQUESTS -----
app.post('/api/requests', auth, (req,res)=>{
  const {title,description} = req.body;
  db.run(`INSERT INTO requests (owner_id,title,description) VALUES (?,?,?)`,
    [req.user.id,title,description],
    function(err){
      if(err) return res.status(500).json({error:err.message});
      res.json({id:this.lastID,title,description,status:'pending'});
    }
  );
});

app.get('/api/requests', auth, (req,res)=>{
  if(req.user.role==='admin'){
    db.all(`SELECT * FROM requests`, [], (err,rows)=> res.json(rows));
  }else{
    db.all(`SELECT * FROM requests WHERE owner_id=?`, [req.user.id], (err,rows)=> res.json(rows));
  }
});

app.put('/api/requests/:id', auth, (req,res)=>{
  const {title,description,price,delivery_time,status} = req.body;
  db.get(`SELECT * FROM requests WHERE id=?`, [req.params.id], (err,row)=>{
    if(!row) return res.status(404).json({message:'Request not found'});
    if(req.user.role!=='admin' && row.owner_id!==req.user.id) return res.status(403).json({message:'Forbidden'});
    const newStatus = status || row.status;
    db.run(`UPDATE requests SET title=?,description=?,price=?,delivery_time=?,status=? WHERE id=?`,
      [title||row.title, description||row.description, price||row.price, delivery_time||row.delivery_time, newStatus, req.params.id],
      function(err){ if(err) return res.status(500).json({error:err.message}); res.json({success:true}); }
    );
  });
});

app.delete('/api/requests/:id', auth, (req,res)=>{
  db.get(`SELECT * FROM requests WHERE id=?`, [req.params.id], (err,row)=>{
    if(!row) return res.status(404).json({message:'Request not found'});
    if(req.user.role!=='admin' && row.owner_id!==req.user.id) return res.status(403).json({message:'Forbidden'});
    db.run(`DELETE FROM requests WHERE id=?`, [req.params.id], function(err){ if(err) return res.status(500).json({error:err.message}); res.json({success:true}); });
  });
});

// ----- PAYMENTS -----
app.post('/api/payments', auth, (req,res)=>{
  const {request_id,amount,method} = req.body;
  db.run(`INSERT INTO payments (request_id,amount,method) VALUES (?,?,?)`, [request_id,amount,method], function(err){ if(err) return res.status(500).json({error:err.message}); res.json({success:true}); });
});

app.put('/api/payments/:id/confirm', auth, permit('admin'), (req,res)=>{
  db.run(`UPDATE payments SET status='confirmed' WHERE id=?`, [req.params.id], function(err){ if(err) return res.status(500).json({error:err.message}); res.json({success:true}); });
});

// ----- CHAT SOCKET -----
io.on('connection', socket=>{
  socket.on('join', room=>socket.join(room));
  socket.on('send', ({room,sender,content})=>{
    db.run(`INSERT INTO messages (request_id,sender,content) VALUES (?,?,?)`, [room,sender,content]);
    io.to(room).emit('receive',{sender,content});
  });
});

app.get('/api/messages/:requestId', auth, (req,res)=>{
  db.all(`SELECT * FROM messages WHERE request_id=? ORDER BY id ASC`, [req.params.requestId], (err,rows)=> res.json(rows));
});

// ----- SERVER -----
const PORT = 5000;
server.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));

