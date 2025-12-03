/* app.js - ALL-IN-ONE Premium MLM frontend demo engine
   Features:
   - LocalStorage DB under key 'mlm_demo_db_v2'
   - Users, transactions, withdraw requests, kyc requests
   - Levels payouts: up to 5 levels (configurable)
   - Plans & ROI: purchase plan, ROI accrual simulation (manual 'credit ROI' button)
   - Payment gateway simulation: create fake order -> simulate success
   - KYC file upload stored as base64 in user profile
   - Team tree (expand/collapse)
   - Admin: approve KYC, settle withdrawals, CSV export, simple charts
*/

/* ------------------ DB Initialization ------------------ */
const DB_KEY = 'mlm_demo_db_v2';

const DEFAULT_DB = {
  settings: {
    levels: [40,25,15,10,5],      // L1..L5 percent (sum can be <=100)
    join_fee: 10,
    plans: [
      { id: 'starter', name:'Starter', price: 10, roi_percent: 5, roi_period_days: 7 },
      { id: 'growth', name:'Growth', price: 50, roi_percent: 8, roi_period_days: 7 },
      { id: 'pro', name:'Pro', price: 200, roi_percent: 12, roi_period_days: 7 }
    ]
  },
  users: [
    { username:'admin', name:'Administrator', password:'admin123', ref:null, balance: 200.00, bonus: 50.0, is_admin:true, kyc: null, plans: [], created: Date.now() - 86400000 },
    { username:'demo', name:'Demo User', password:'demo123', ref:'admin', balance: 45.50, bonus: 10.0, is_admin:false, kyc: null, plans: [], created: Date.now() - 600000 }
  ],
  tx: [
    // { id, username, type:'join'|'bonus'|'deposit'|'withdraw'|'roi'|'plan', amount, info, time }
  ],
  withdraws: [
    // { id, username, amount, status:'pending'|'approved'|'rejected', time }
  ],
  kycRequests: [
    // { username, fileBase64, status:'pending'|'approved'|'rejected', note, time }
  ]
};

function loadDB(){
  const raw = localStorage.getItem(DB_KEY);
  if(!raw){
    localStorage.setItem(DB_KEY, JSON.stringify(DEFAULT_DB));
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
  try { return JSON.parse(raw); } catch(e){ localStorage.setItem(DB_KEY, JSON.stringify(DEFAULT_DB)); return JSON.parse(JSON.stringify(DEFAULT_DB)); }
}
function saveDB(db){ localStorage.setItem(DB_KEY, JSON.stringify(db)); }

let DB = loadDB();

/* ------------------ Utilities ------------------ */
function now(){ return Date.now(); }
function uid(prefix='id'){ return prefix + Math.floor(Math.random()*900000 + 100000); }
function findUser(username){ return DB.users.find(u=>u.username === username) || null; }
function persist(){ saveDB(DB); }

/* ------------------ Auth Module ------------------ */
const Auth = {
  login(username, password){
    const u = findUser(username);
    if(u && u.password === password){
      localStorage.setItem('mlm_demo_session_v2', JSON.stringify({ username: u.username, name: u.name, is_admin: !!u.is_admin }));
      return { ok:true };
    }
    return { ok:false, error:'Invalid credentials' };
  },
  logout(){ localStorage.removeItem('mlm_demo_session_v2'); location.href='login.html'; },
  isLogged(){ return !!localStorage.getItem('mlm_demo_session_v2'); },
  current(){ return JSON.parse(localStorage.getItem('mlm_demo_session_v2') || 'null') || null; }
};

/* ------------------ Transactions ------------------ */
function addTx(username, type, amount, info=''){
  DB.tx.unshift({ id: uid('tx'), username, type, amount: Number(amount), info, time: now() });
  persist();
}

/* ------------------ Registration & Join flow ------------------ */
const Users = {
  register({name, username, password, ref}){
    if(!name || !username || !password) return { ok:false, error:'Missing fields' };
    if(findUser(username)) return { ok:false, error:'Username exists' };

    const newUser = { username, name, password, ref: ref || null, balance: 0, bonus:0, is_admin:false, kyc:null, plans: [], created: now() };
    DB.users.push(newUser);
    addTx(username, 'join', 0, `joined (ref: ${ref||'none'})`);

    // distribute join fee as referral bonus per levels
    const joinFee = Number(DB.settings.join_fee || 10);
    let curRef = ref;
    for(let lvl=0; lvl<DB.settings.levels.length; lvl++){
      if(!curRef) break;
      const up = findUser(curRef);
      if(!up) break;
      const pct = Number(DB.settings.levels[lvl]) / 100.0;
      const amt = +(joinFee * pct).toFixed(8);
      up.balance = +(Number(up.balance || 0) + amt).toFixed(8);
      up.bonus = +(Number(up.bonus || 0) + amt).toFixed(8);
      addTx(up.username, 'bonus', amt, `referral bonus from ${username} (L${lvl+1})`);
      curRef = up.ref;
    }
    persist();
    return { ok:true };
  },

  list(){ return DB.users.slice().sort((a,b)=>b.created - a.created); },
  get(username){ return findUser(username); },

  // simulate signup under current user (used by dashboard button)
  simulateJoinUnder(username){
    const id = 'u'+Math.floor(Math.random()*900000+1000);
    const name = 'User ' + id.slice(-4);
    const out = Users.register({ name, username: id, password: 'pass123', ref: username });
    return out;
  },

  // purchase plan (simulate payment then assign plan)
  purchasePlan(username, planId){
    const u = findUser(username);
    const plan = DB.settings.plans.find(p=>p.id===planId);
    if(!u || !plan) return { ok:false, error:'Invalid' };

    // deduct price if wallet sufficient, else require deposit
    if(Number(u.balance || 0) < plan.price) return { ok:false, error:'Insufficient wallet - please deposit' };

    u.balance = +(Number(u.balance) - plan.price).toFixed(8);
    u.plans.push({ id: plan.id, name: plan.name, purchasedAt: now(), nextROI: now() + plan.roi_period_days*24*3600*1000, roiPercent: plan.roi_percent });
    addTx(u.username, 'plan', -plan.price, `bought ${plan.name}`);
    persist();
    return { ok:true };
  },

  // credit ROI for a user's plans (manual action or scheduled on server)
  creditROIForUser(username){
    const u = findUser(username);
    if(!u) return { ok:false, error:'no user' };
    let totalCred = 0;
    (u.plans || []).forEach(pl=>{
      // simple: credit roiPercent of plan price (we don't store original price per plan here; so approximate with plan price from settings)
      const planDef = DB.settings.plans.find(p=>p.id === pl.id);
      if(!planDef) return;
      // if time reached (we'll ignore recurring for demo); credit once per call
      const amt = +(planDef.price * (planDef.roi_percent/100.0)).toFixed(8);
      u.balance = +(Number(u.balance || 0) + amt).toFixed(8);
      addTx(u.username, 'roi', amt, `ROI credited for ${planDef.name}`);
      totalCred += amt;
    });
    persist();
    return { ok:true, credited: totalCred };
  }
};

/* ------------------ Deposits (Fake Gateway) ------------------ */
const Payments = {
  // create fake order (client asks to "pay", then call simulateGatewaySuccess to complete)
  createOrder(username, amount){
    const order = { id: uid('order'), username, amount: Number(amount), created: now(), status: 'created' };
    // store short-lived in localStorage for demo
    let orders = JSON.parse(localStorage.getItem('mlm_demo_orders')||'[]');
    orders.unshift(order);
    localStorage.setItem('mlm_demo_orders', JSON.stringify(orders));
    return order;
  },

  simulateGatewaySuccess(orderId){
    let orders = JSON.parse(localStorage.getItem('mlm_demo_orders')||'[]');
    const o = orders.find(x=>x.id===orderId);
    if(!o) return { ok:false, error:'order not found' };
    o.status = 'paid';
    localStorage.setItem('mlm_demo_orders', JSON.stringify(orders));

    // credit user balance
    const u = findUser(o.username);
    if(!u) return { ok:false, error:'user missing' };
    u.balance = +(Number(u.balance||0) + Number(o.amount)).toFixed(8);
    addTx(u.username, 'deposit', o.amount, `gateway paid order ${orderId}`);
    persist();
    return { ok:true };
  }
};

/* ------------------ Withdraw Requests ------------------ */
const Withdraws = {
  request(username, amount){
    const u = findUser(username);
    if(!u) return { ok:false, error:'user missing' };
    amount = Number(amount);
    if(amount <= 0) return { ok:false, error:'invalid amount' };
    if(amount > Number(u.balance || 0)) return { ok:false, error:'insufficient' };

    const rec = { id: uid('wd'), username, amount, status:'pending', time: now() };
    DB.withdraws.unshift(rec);
    addTx(username, 'withdraw_request', -amount, `requested ${amount}`);
    persist();
    return { ok:true, id: rec.id };
  },

  approve(id, adminUser){
    const r = DB.withdraws.find(x=>x.id===id);
    if(!r) return { ok:false };
    if(r.status !== 'pending') return { ok:false, error:'not pending' };
    const u = findUser(r.username);
    if(!u) return { ok:false, error:'user' };
    // admin approves: money deducted (already reserved at request time in tx simulation), record settle
    r.status = 'approved'; r.handledBy = adminUser; r.handledAt = now();
    addTx(r.username, 'withdraw', -r.amount, `withdraw approved by ${adminUser}`);
    persist();
    return { ok:true };
  },

  reject(id, adminUser){
    const r = DB.withdraws.find(x=>x.id===id);
    if(!r) return { ok:false };
    if(r.status !== 'pending') return { ok:false, error:'not pending' };
    // on rejection, refund amount to user balance
    const u = findUser(r.username);
    if(u){
      u.balance = +(Number(u.balance || 0) + Number(r.amount)).toFixed(8);
    }
    r.status = 'rejected'; r.handledBy = adminUser; r.handledAt = now();
    addTx(r.username, 'withdraw_reject', r.amount, `withdraw rejected by ${adminUser}`);
    persist();
    return { ok:true };
  }
};

/* ------------------ KYC Module ------------------ */
const KYC = {
  submit(username, fileBase64){
    const existing = DB.kycRequests.find(x=>x.username===username);
    if(existing) {
      existing.fileBase64 = fileBase64; existing.status = 'pending'; existing.time = now();
    } else {
      DB.kycRequests.unshift({ username, fileBase64, status:'pending', note:'', time: now() });
    }
    persist();
    return { ok:true };
  },
  approve(username, adminUser){
    const req = DB.kycRequests.find(x=>x.username===username);
    if(!req) return { ok:false };
    req.status = 'approved'; req.handledBy = adminUser; req.handledAt = now();
    const u = findUser(username);
    if(u) u.kyc = { status:'approved', at: now() };
    persist();
    return { ok:true };
  },
  reject(username, adminUser, note=''){
    const req = DB.kycRequests.find(x=>x.username===username);
    if(!req) return { ok:false };
    req.status = 'rejected'; req.handledBy = adminUser; req.note = note; req.handledAt = now();
    const u = findUser(username);
    if(u) u.kyc = { status:'rejected', at: now() };
    persist();
    return { ok:true };
  }
};

/* ------------------ Team Tree ------------------ */
function getDirects(username){
  return DB.users.filter(u => u.ref === username);
}
function buildTree(username){
  const node = findUser(username);
  if(!node) return null;
  return {
    username: node.username,
    name: node.name,
    children: DB.users.filter(u=>u.ref===username).map(u=>buildTree(u.username))
  };
}

/* ------------------ Admin helpers & reports ------------------ */
const Admin = {
  users(){ return Users.list(); },
  withdraws(){ return DB.withdraws.slice(); },
  kycRequests(){ return DB.kycRequests.slice(); },
  exportUsersCSV(){
    const rows = DB.users.map(u => `${u.username},${u.name},${u.balance},${u.bonus},${u.ref || ''}`);
    const csv = 'username,name,balance,bonus,ref\n' + rows.join('\n');
    const blob = new Blob([csv], { type:'text/csv' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'mlm_users.csv'; a.click(); URL.revokeObjectURL(url);
  },
  summary(){
    const totalUsers = DB.users.length;
    const totalBalance = DB.users.reduce((s,u)=>s+Number(u.balance||0),0);
    const totalPendingWithdraw = DB.withdraws.filter(x=>x.status==='pending').reduce((s,w)=>s+w.amount,0);
    return { totalUsers, totalBalance, totalPendingWithdraw };
  }
};

/* ------------------ Expose global API ------------------ */
window.App = {
  DB, persist,
  Auth, Users, Payments, Withdraws, KYC, Admin,
  util: { buildTree, getDirects }
};

/* ------------------ Ensure DB persisted ------------------ */
persist();
