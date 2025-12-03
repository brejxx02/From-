/*
  app.js - frontend-only demo engine
  Stores data in localStorage under key 'mlm_demo_db_v1'
  Provides App.users and App.auth APIs used by pages
*/

(function(){
  const DB_KEY = 'mlm_demo_db_v1';

  // default demo dataset
  const DEFAULT = {
    users: [
      { username:'admin', name:'Administrator', password:'admin123', ref:null, balance: 120.00, is_admin:true, created: Date.now() - 86400000 },
      { username:'demo', name:'Demo User', password:'demo123', ref:'admin', balance: 45.50, is_admin:false, created: Date.now() - 600000 }
    ],
    transactions: [
      { username:'admin', type:'join', amount:0, info:'seed', time: Date.now()-900000 },
      { username:'demo', type:'join', amount:0, info:'seed', time: Date.now()-600000 },
      { username:'admin', type:'bonus', amount:20.00, info:'upline bonus', time: Date.now()-300000 }
    ],
    settings: { levels: [50,25,15,10], join_fee: 10 }
  };

  function load(){
    const raw = localStorage.getItem(DB_KEY);
    if(!raw){ localStorage.setItem(DB_KEY, JSON.stringify(DEFAULT)); return JSON.parse(JSON.stringify(DEFAULT)); }
    try { return JSON.parse(raw); } catch(e){ localStorage.setItem(DB_KEY, JSON.stringify(DEFAULT)); return JSON.parse(JSON.stringify(DEFAULT)); }
  }
  function save(db){ localStorage.setItem(DB_KEY, JSON.stringify(db)); }

  // initialize db
  let db = load();

  // utility
  function findUser(u){ return db.users.find(x=>x.username===u) || null; }
  function now(){ return Date.now(); }
  function addTx(username,type,amount,info){
    db.transactions.unshift({ username, type, amount, info, time: now() });
    save(db);
  }

  // Auth module
  const auth = {
    login(username,password){
      const user = findUser(username);
      if(user && user.password === password){
        localStorage.setItem('mlm_demo_session', JSON.stringify({ username:user.username, name:user.name, is_admin: !!user.is_admin }));
        return { ok:true };
      }
      return { ok:false, error:'Invalid credentials' };
    },
    logout(){
      localStorage.removeItem('mlm_demo_session');
      location.href = 'login.html';
    },
    isLogged(){
      return !!localStorage.getItem('mlm_demo_session');
    },
    current(){
      return JSON.parse(localStorage.getItem('mlm_demo_session') || 'null') || null;
    }
  };

  // Users module
  const users = {
    register({name,username,password,ref}){
      if(!name || !username || !password) return { ok:false, error:'Missing fields' };
      if(findUser(username)) return { ok:false, error:'Username already exists' };
      // create user
      const u = { username, name, password, ref: ref || null, balance: 0, is_admin:false, created: now() };
      db.users.push(u);
      addTx(username, 'join', 0, JSON.stringify({ref}));
      // distribute join fee bonuses up the chain according to settings
      const joinFee = Number(db.settings.join_fee || 10);
      const levels = db.settings.levels || [50,25,15,10];
      let cur = ref;
      for(let i=0;i<levels.length;i++){
        if(!cur) break;
        const up = findUser(cur);
        if(!up) break;
        const pct = Number(levels[i]) / 100.0;
        const amt = +(joinFee * pct).toFixed(8);
        up.balance = +(Number(up.balance || 0) + amt).toFixed(8);
        addTx(up.username, 'bonus', amt, 'bonus from '+username+' level '+(i+1));
        cur = up.ref;
      }
      save(db);
      return { ok:true, username };
    },
    list(){ return db.users.slice().sort((a,b)=>b.created - a.created); },
    get(username){ return findUser(username); },
    getDirect(username){ return db.users.filter(u=>u.ref === username); },
    getTeamCount(username){
      // simple DFS
      let count=0; const stack=[username];
      while(stack.length){
        const cur = stack.pop();
        const deps = db.users.filter(u=>u.ref===cur).map(x=>x.username);
        count += deps.length;
        stack.push(...deps);
      }
      return count;
    },
    getTransactions(username){ return db.transactions.filter(t=>t.username===username).slice(0,100); },
    simulateJoinUnderMe(){
      const me = auth.current();
      if(!me) { alert('Login required'); return; }
      // create fake user
      const id = 'u'+Math.floor(Math.random()*90000+10000);
      const name = 'User '+id.slice(-4);
      const out = users.register({name, username: id, password: 'pass123', ref: me.username});
      if(out.ok){ alert('Simulated user '+id+' joined under you.'); save(db); window._renderDashboard && window._renderDashboard(); }
      else alert(out.error || 'Err');
    },
    exportMyData(){
      const me = auth.current();
      if(!me) return alert('Login required');
      const payload = { user: findUser(me.username), tx: users.getTransactions(me.username) };
      const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download = me.username + '.json'; a.click(); URL.revokeObjectURL(url);
    }
  };

  // Admin module
  const admin = {
    listUsers(){ return users.list(); },
    settle(username){
      const u = findUser(username);
      if(!u) return alert('User not found');
      const amt = Number(u.balance || 0);
      if(amt <= 0) return alert('Zero balance');
      u.balance = 0;
      addTx(username, 'admin_settle', amt, 'settled by admin');
      save(db);
      alert('Settled $'+amt.toFixed(2)+' for '+username);
      // refresh admin page if open
      location.reload();
    },
    exportAll(){
      const rows = db.users.map(u=> ({ username:u.username, name:u.name, balance:u.balance, ref:u.ref }) );
      const csv = ['username,name,balance,ref'].concat(rows.map(r=>`${r.username},${r.name.replace(',','')},${r.balance},${r.ref||''}`)).join('\n');
      const blob = new Blob([csv], { type:'text/csv' }); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='mlm_users.csv'; a.click(); URL.revokeObjectURL(url);
    },
    resetDemo(){
      if(!confirm('Reset demo data?')) return;
      localStorage.removeItem(DB_KEY);
      location.reload();
    },
    view(username){
      const u = findUser(username);
      if(!u) return alert('not found');
      alert('User: '+u.username+'\nName: '+u.name+'\nBalance: $'+(Number(u.balance||0)).toFixed(2));
    }
  };

  // public App
  window.App = { users, auth, admin };

  // auto-login demo if session exists - keep session on login page
})();
