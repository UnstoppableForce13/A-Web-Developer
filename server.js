<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Custom Website Platform</title>
<style>
body{font-family:sans-serif;margin:20px;}
.hidden{display:none;}
.box{border:1px solid #ccc;padding:10px;margin:10px 0;}
button{margin:2px;}
textarea{width:100%;height:50px;}
</style>
</head>
<body>

<h1>Custom Website Platform</h1>

<div id="loginBox">
<h2>Login / Register</h2>
<input id="name" placeholder="Name"/><br/>
<input id="email" placeholder="Email"/><br/>
<input id="password" type="password" placeholder="Password"/><br/>
<button onclick="register()">Register</button>
<button onclick="login()">Login</button>
</div>

<div id="dashboard" class="hidden">
<h2>Dashboard</h2>
<p>Logged in as <span id="role"></span>: <b id="userName"></b></p>
<button onclick="logout()">Logout</button>

<div id="createRequest" class="hidden">
<h3>Create Request</h3>
<input id="reqTitle" placeholder="Title"/><br/>
<textarea id="reqDesc" placeholder="Description"></textarea><br/>
<button onclick="createRequest()">Add Request</button>
</div>

<div id="requestsList">
<h3>Requests</h3>
<div id="requests"></div>
</div>

<div id="chatBox" class="hidden">
<h3>Chat for Request <span id="chatRequestId"></span></h3>
<div id="messages" style="border:1px solid #ccc;height:200px;overflow:auto;padding:5px;"></div>
<input id="chatInput" placeholder="Type message"/><button onclick="sendMessage()">Send</button>
</div>

</div>

<script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
<script>
let token='';
let role='';
let userName='';
let requests=[];
let currentChatId=null;
const socket = io('http://localhost:5000');

// ----- AUTH -----
function register(){
  fetch('http://localhost:5000/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('name').value,email:document.getElementById('email').value,password:document.getElementById('password').value})})
  .then(r=>r.json()).then(console.log).catch(console.error);
}
function login(){
  fetch('http://localhost:5000/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value})})
  .then(r=>r.json()).then(res=>{
    token=res.token; role=res.role; userName=res.name;
    document.getElementById('role').innerText=role;
    document.getElementById('userName').innerText=userName;
    document.getElementById('loginBox').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    if(role!=='admin') document.getElementById('createRequest').classList.remove('hidden');
    loadRequests();
  }).catch(console.error);
}
function logout(){
  token=''; role=''; userName='';
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('loginBox').classList.remove('hidden');
}

// ----- REQUESTS -----
function createRequest(){
  const title=document.getElementById('reqTitle').value;
  const desc=document.getElementById('reqDesc').value;
  fetch('http://localhost:5000/api/requests',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({title,description:desc})})
  .then(r=>r.json()).then(()=>{loadRequests();}).catch(console.error);
}

function loadRequests(){
  fetch('http://localhost:5000/api/requests',{headers:{'Authorization':'Bearer '+token}})
  .then(r=>r.json()).then(data=>{
    requests=data;
    const div=document.getElementById('requests'); div.innerHTML='';
    requests.forEach(r=>{
      const box=document.createElement('div'); box.className='box';
      box.innerHTML=`<b>${r.title}</b><br/>${r.description}<br/>Status:${r.status} Price:${r.price||'-'} Delivery:${r.delivery_time||'-'}<br/>`;

      // Editable by owner or admin
      if(r.owner_id==userName || role==='admin'){
        box.innerHTML+=`<button onclick="editRequest(${r.id})">Edit</button> <button onclick="deleteRequest(${r.id})">Delete</button> `;
      }

      // Admin sets price/delivery if status pending
      if(role==='admin' && r.status==='pending'){
        box.innerHTML+=`<button onclick="setPriceDelivery(${r.id})">Set Price/Delivery</button>`;
      }

      // User accepts trade
      if(role!=='admin' && r.status==='price_set'){
        box.innerHTML+=`<button onclick="acceptTrade(${r.id})">Accept Trade</button>`;
      }

      // Admin confirms payment
      if(role==='admin' && r.status==='user_accepted'){
        box.innerHTML+=`<button onclick="confirmPayment(${r.id})">Confirm Payment</button>`;
      }

      // Chat button
      box.innerHTML+=`<button onclick="openChat(${r.id})">Chat</button>`;

      div.appendChild(box);
    });
  });
}

function editRequest(id){
  const newTitle=prompt('New title:');
  const newDesc=prompt('New description:');
  fetch('http://localhost:5000/api/requests/'+id,{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({title:newTitle,description:newDesc})})
  .then(r=>r.json()).then(()=>loadRequests());
}

function deleteRequest(id){
  fetch('http://localhost:5000/api/requests/'+id,{method:'DELETE',headers:{'Authorization':'Bearer '+token}})
  .then(r=>r.json()).then(()=>loadRequests());
}

// ----- NEGOTIATION -----
function setPriceDelivery(id){
  const price=prompt('Set Price:');
  const delivery=prompt('Set Delivery Time:');
  fetch('http://localhost:5000/api/requests/'+id,{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({price,delivery_time:delivery,status:'price_set'})})
  .then(r=>r.json()).then(()=>loadRequests());
}

function acceptTrade(id){
  fetch('http://localhost:5000/api/requests/'+id,{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({status:'user_accepted'})})
  .then(r=>r.json()).then(()=>loadRequests());
}

function confirmPayment(id){
  fetch('http://localhost:5000/api/requests/'+id,{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({status:'paid'})})
  .then(r=>r.json()).then(()=>loadRequests());
}

// ----- CHAT -----
function openChat(id){
  currentChatId=id;
  document.getElementById('chatBox').classList.remove('hidden');
  document.getElementById('chatRequestId').innerText=id;
  socket.emit('join',id);
  loadMessages();
}

function loadMessages(){
  fetch('http://localhost:5000/api/messages/'+currentChatId,{headers:{'Authorization':'Bearer '+token}})
  .then(r=>r.json()).then(data=>{
    const div=document.getElementById('messages'); div.innerHTML='';
    data.forEach(m=>{div.innerHTML+=`<b>${m.sender}:</b> ${m.content}<br/>`;});
  });
}

function sendMessage(){
  const msg=document.getElementById('chatInput').value;
  socket.emit('send',{room:currentChatId,sender:userName,content:msg});
  document.getElementById('chatInput').value='';
}

socket.on('receive',({sender,content})=>{
  if(currentChatId){
    const div=document.getElementById('messages');
    div.innerHTML+=`<b>${sender}:</b> ${content}<br/>`;
  }
});
</script>
</body>
</html>
