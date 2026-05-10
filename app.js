/* ============================================
   CONSTANTS & DATE UTILS
============================================ */
const WW=70,ROW_H=40,LBL_W=185,TWK=52;
const TC={Civil:'#2563eb',Steel:'#374151',Concrete:'#6b7280',Masonry:'#b45309',Mechanical:'#dc2626',Electrical:'#d97706',Plumbing:'#0891b2',FP:'#ea580c',Glazing:'#047857',Drywall:'#7c3aed',Roofing:'#9f1239',Insulation:'#0f766e',Default:'#6b7280'};
const RNC={DES:'Design Not Ready',MAT:'Material Delayed',LAB:'Labour Shortage',EQP:'Equipment Down',WEA:'Weather',PRE:'Predecessor Incomplete',OTH:'Other'};
const tC=t=>TC[t]||TC.Default;
const PLAN_DEF={free:{name:'Free',price:0,projects:1,archives:4,ops:200},pro:{name:'Pro',price:29,projects:10,archives:52,ops:2000},enterprise:{name:'Enterprise',price:99,projects:Infinity,archives:Infinity,ops:50000}};
const OP_COST={import:10,export:5,archive:25,recalc:2,create_project:20};

// Date utils
const pd=s=>{if(!s)return null;if(s instanceof Date)return s;const d=new Date(s);return isNaN(d)?null:d};
const iso=d=>{if(!d)return null;const dt=pd(d);return dt?dt.toISOString().slice(0,10):null};
const fmt=s=>{if(!s)return'—';const d=pd(s);return d?d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'}):s};
const fmtL=s=>{if(!s)return'—';const d=pd(s);return d?d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):s};
const addD=(s,n)=>{const d=pd(s);if(!d)return s;d.setDate(d.getDate()+n);return iso(d)};
const addW=(s,w)=>addD(s,w*7);
const daysB=(a,b)=>{const da=pd(a),db=pd(b);if(!da||!db)return 0;return Math.round((db-da)/864e5)};
function d2wk(s){const d=pd(s),st=pd(S.P.startDate);if(!d||!st)return 1;return Math.max(1,Math.floor((d-st)/(7*864e5))+1)}
function wk2d(w){const s=pd(S.P.startDate);if(!s)return null;const d=new Date(s);d.setDate(d.getDate()+(w-1)*7);return iso(d)}
function d2x(s){const d=pd(s),st=pd(S.P.startDate);if(!d||!st)return 0;return Math.max(0,(d-st)/(7*864e5)*WW)}
function x2d(x){const s=pd(S.P.startDate);if(!s)return null;const d=new Date(s);d.setDate(d.getDate()+Math.round(x/WW*7));return iso(d)}
const wkL=s=>`W${String(d2wk(s)).padStart(2,'0')}`;

/* ============================================
   AUTH SYSTEM (localStorage)
============================================ */

/* ============================================
   AUTH SYSTEM
   NOTE: STORE is defined in firebase.js which
   is loaded before this file in index.html.
   All data reads/writes go through STORE.
   Never call localStorage directly in this file.
============================================ */
let AUTH={
  session:null,
  users:STORE.get('users')||[],
  saveUsers(){STORE.set('users',this.users)},
  findUser(email){if(!email)return null;return this.users.find(u=>u&&u.email&&u.email.toLowerCase()===email.toLowerCase())||null;},
  register(email,password,plan){
    if(this.findUser(email))return{err:'Email already registered'};
    const u={id:'u_'+Date.now(),email,password,plan:plan||'free',opsUsed:0,opsReset:new Date().toISOString().slice(0,7),projects:[],createdAt:iso(new Date())};
    this.users.push(u);this.saveUsers();return{ok:true,user:u};
  },
  login(email,password){
    const u=this.findUser(email);
    if(!u)return{err:'Email not found'};
    if(u.password!==password)return{err:'Incorrect password'};
    this.session=u;STORE.set('session',u);return{ok:true,user:u};
  },
  logout(){this.session=null;STORE.del('session')},
  getUser(){if(!this.session)this.session=STORE.get('session');return this.session},
  updateUser(data){
    if(!this.session)return;
    Object.assign(this.session,data);
    this.users=this.users.map(u=>u.id===this.session.id?{...u,...data}:u);
    this.saveUsers();STORE.set('session',this.session);
  },
  canOp(op){
    const u=this.getUser();if(!u)return false;
    const plan=PLAN_DEF[u.plan]||PLAN_DEF.free;
    const cost=OP_COST[op]||1;
    // Reset monthly ops
    const thisMonth=new Date().toISOString().slice(0,7);
    if(u.opsReset!==thisMonth){this.updateUser({opsUsed:0,opsReset:thisMonth});return true}
    return u.opsUsed+cost<=plan.ops;
  },
  useOp(op){
    const cost=OP_COST[op]||1;
    const u=this.getUser();if(!u)return;
    this.updateUser({opsUsed:(u.opsUsed||0)+cost});
  }
};

/* ============================================
   PROJECT SYSTEM
============================================ */
const PROJECTS={
  getAll(){const u=AUTH.getUser();if(!u)return[];return u.projects||[]},
  get(id){return this.getAll().find(p=>p.id===id)},
  create(name, cfg={}){
    const u=AUTH.getUser();if(!u)return null;
    try{
      const p={
        id:'proj_'+Date.now(),name,createdAt:iso(new Date()),lastSaved:iso(new Date()),
        tasks:[],ppc:[],constraints:[],
        project:{name,num:cfg.num||'',gc:cfg.gc||'',startDate:cfg.startDate||iso(new Date()),dataDate:cfg.dataDate||iso(new Date()),ppcTarget:80},
        settings:{ppcTarget:80,riskLow:6,riskMed:12,riskHigh:16},archives:[]
      };
      if(!u.projects)u.projects=[];
      u.projects.push(p);AUTH.updateUser({projects:u.projects});return p;
    }catch(e){console.error('Create project failed:',e);return null}
  },
  createWithData(name,tasks,ppc,constraints,cfg={}){
    const u=AUTH.getUser();if(!u)return null;
    try{
      const p={
        id:'proj_'+Date.now(),name,createdAt:iso(new Date()),lastSaved:iso(new Date()),
        tasks:tasks.map(t=>({...t,pred:[...(t.pred||[])]})),
        ppc:[...ppc],constraints:[...constraints],
        project:{name,num:cfg.num||'',gc:cfg.gc||'',startDate:cfg.startDate||iso(new Date()),dataDate:cfg.dataDate||iso(new Date()),ppcTarget:80},
        settings:{ppcTarget:80,riskLow:6,riskMed:12,riskHigh:16},archives:[]
      };
      if(!u.projects)u.projects=[];
      u.projects.push(p);AUTH.updateUser({projects:u.projects});return p;
    }catch(e){console.error('createWithData failed:',e);return null}
  },
  save(projectId,data){
    const u=AUTH.getUser();if(!u)return;
    u.projects=(u.projects||[]).map(p=>p.id===projectId?{...p,...data,lastSaved:iso(new Date())}:p);
    AUTH.updateUser({projects:u.projects});
  },
  archive(projectId,weekLabel,data){
    const u=AUTH.getUser();if(!u)return;
    const plan=PLAN_DEF[u.plan]||PLAN_DEF.free;
    const p=u.projects.find(x=>x.id===projectId);if(!p)return;
    p.archives=(p.archives||[]);
    if(p.archives.length>=plan.archives){p.archives.shift()}
    p.archives.push({week:weekLabel,date:iso(new Date()),ppc:data.ppc,tasks:data.tasks.length,snapshot:JSON.stringify(data)});
    AUTH.updateUser({projects:u.projects});
  },
  delete(id){
    const u=AUTH.getUser();if(!u)return;
    u.projects=(u.projects||[]).filter(p=>p.id!==id);
    AUTH.updateUser({projects:u.projects});
  }
};

/* ============================================
   SAMPLE DATA
============================================ */
const IT=[
 {id:'T-01',wbs:'1.1.1',name:'Footing pour – Grid C',trade:'Civil',zone:'Foundation',startDate:'2026-03-16',finishDate:'2026-04-24',onGantt:true,wwp:'done',pred:[],constraint:'',ready:true,assignee:'Rivera',hours:8,rncCode:'',L:2,I:3},
 {id:'T-02',wbs:'1.1.2',name:'Column erection Level 3',trade:'Steel',zone:'Superstructure',startDate:'2026-03-30',finishDate:'2026-04-30',onGantt:true,wwp:'done',pred:['T-01'],constraint:'',ready:true,assignee:'Okafor',hours:16,rncCode:'',L:2,I:4},
 {id:'T-03',wbs:'2.1.1',name:'Ductwork install – Zone A',trade:'Mechanical',zone:'MEP',startDate:'2026-04-13',finishDate:'2026-04-30',onGantt:true,wwp:'at-risk',pred:['T-02'],constraint:'Drawing Rev D pending',ready:false,assignee:'Patel',hours:12,rncCode:'',L:3,I:4},
 {id:'T-04',wbs:'1.2.1',name:'Block wall – East elevation',trade:'Masonry',zone:'Exterior',startDate:'2026-04-13',finishDate:'2026-04-24',onGantt:true,wwp:'not-done',pred:['T-02'],constraint:'Material not on site',ready:false,assignee:'Kowalski',hours:14,rncCode:'MAT',L:4,I:3},
 {id:'T-05',wbs:'2.2.1',name:'Conduit rough-in – L2 South',trade:'Electrical',zone:'MEP',startDate:'2026-04-06',finishDate:'2026-04-24',onGantt:true,wwp:'done',pred:[],constraint:'',ready:true,assignee:'Nguyen',hours:10,rncCode:'',L:1,I:2},
 {id:'T-06',wbs:'1.1.3',name:'Slab pour Level 4',trade:'Concrete',zone:'Superstructure',startDate:'2026-04-20',finishDate:'2026-04-30',onGantt:true,wwp:'at-risk',pred:['T-02'],constraint:'Crane booking conflict',ready:false,assignee:'Morales',hours:20,rncCode:'',L:3,I:4},
 {id:'T-07',wbs:'3.1.1',name:'Framing – Units 201–210',trade:'Drywall',zone:'Interior',startDate:'2026-04-27',finishDate:'2026-05-08',onGantt:true,wwp:'promised',pred:['T-06'],constraint:'',ready:true,assignee:'Jackson',hours:8,rncCode:'',L:2,I:2},
 {id:'T-08',wbs:'1.1.4',name:'Waterproofing – North wall',trade:'Civil',zone:'Foundation',startDate:'2026-03-23',finishDate:'2026-04-24',onGantt:true,wwp:'done',pred:['T-01'],constraint:'',ready:true,assignee:'Singh',hours:6,rncCode:'',L:1,I:2},
 {id:'T-09',wbs:'1.3.1',name:'Curtainwall mock-up',trade:'Glazing',zone:'Exterior',startDate:'2026-04-20',finishDate:'2026-04-30',onGantt:true,wwp:'promised',pred:[],constraint:'',ready:true,assignee:'Park',hours:10,rncCode:'',L:2,I:3},
 {id:'T-10',wbs:'1.1.5',name:'L4 slab cure & strip',trade:'Concrete',zone:'Superstructure',startDate:'2026-04-27',finishDate:'2026-05-08',onGantt:true,wwp:'promised',pred:['T-06'],constraint:'',ready:true,assignee:'Morales',hours:8,rncCode:'',L:2,I:3},
 {id:'T-11',wbs:'1.1.6',name:'Steel erection Level 4',trade:'Steel',zone:'Superstructure',startDate:'2026-04-27',finishDate:'2026-05-15',onGantt:true,wwp:'promised',pred:['T-06'],constraint:'Anchor bolt inspection required',ready:false,assignee:'Okafor',hours:16,rncCode:'',L:4,I:4},
 {id:'T-12',wbs:'2.1.2',name:'MEP rough-in Level 3',trade:'Mechanical',zone:'MEP',startDate:'2026-04-27',finishDate:'2026-05-15',onGantt:true,wwp:'promised',pred:['T-03'],constraint:'BIM clash pending',ready:false,assignee:'Patel',hours:14,rncCode:'',L:3,I:4},
 {id:'T-13',wbs:'1.2.2',name:'Elevator shaft walls',trade:'Masonry',zone:'Superstructure',startDate:'2026-04-27',finishDate:'2026-05-15',onGantt:true,wwp:'promised',pred:['T-04'],constraint:'',ready:true,assignee:'Kowalski',hours:12,rncCode:'',L:2,I:3},
 {id:'T-14',wbs:'1.4.1',name:'Roofing – Phase 1',trade:'Roofing',zone:'Roofing',startDate:'2026-05-04',finishDate:'2026-05-29',onGantt:true,wwp:'promised',pred:[],constraint:'Material delivery pending',ready:false,assignee:'Chen',hours:20,rncCode:'',L:4,I:3},
 {id:'T-15',wbs:'1.1.7',name:'Level 5 formwork set',trade:'Concrete',zone:'Superstructure',startDate:null,finishDate:null,onGantt:false,wwp:'promised',pred:['T-10'],constraint:'',ready:false,assignee:'Morales',hours:16,rncCode:'',L:2,I:3},
 {id:'T-16',wbs:'1.3.2',name:'Exterior insulation South',trade:'Insulation',zone:'Exterior',startDate:null,finishDate:null,onGantt:false,wwp:'promised',pred:[],constraint:'',ready:true,assignee:'Kim',hours:10,rncCode:'',L:1,I:2},
 {id:'T-17',wbs:'2.3.1',name:'Fire protection L2',trade:'FP',zone:'MEP',startDate:null,finishDate:null,onGantt:false,wwp:'promised',pred:[],constraint:'',ready:true,assignee:'Davis',hours:12,rncCode:'',L:1,I:2},
 {id:'T-18',wbs:'1.1.8',name:'Level 5 concrete pour',trade:'Concrete',zone:'Superstructure',startDate:null,finishDate:null,onGantt:false,wwp:'promised',pred:['T-15'],constraint:'',ready:false,assignee:'Morales',hours:20,rncCode:'',L:2,I:4},
 {id:'T-19',wbs:'1.3.3',name:'Window install – Units 1–4',trade:'Glazing',zone:'Exterior',startDate:null,finishDate:null,onGantt:false,wwp:'promised',pred:['T-09'],constraint:'Shop drawing release needed',ready:false,assignee:'Park',hours:16,rncCode:'',L:3,I:3},
 {id:'T-20',wbs:'3.2.1',name:'Mech room equipment set',trade:'Mechanical',zone:'MEP',startDate:null,finishDate:null,onGantt:false,wwp:'promised',pred:[],constraint:'',ready:false,assignee:'',hours:24,rncCode:'',L:2,I:2},
];
const IPPC=[
 {lbl:'W01',startDate:'2026-03-02',planned:24,done:18},{lbl:'W02',startDate:'2026-03-09',planned:28,done:21},
 {lbl:'W03',startDate:'2026-03-16',planned:30,done:17},{lbl:'W04',startDate:'2026-03-23',planned:29,done:22},
 {lbl:'W05',startDate:'2026-03-30',planned:34,done:28},{lbl:'W06',startDate:'2026-04-06',planned:26,done:19},
 {lbl:'W07',startDate:'2026-04-13',planned:31,done:27},
];
const IC=[
 {id:'C-01',desc:'Structural drawing Rev D for Level 4 columns',linked:'T-02',owner:'Design Team',due:'2026-04-28',L:3,I:5,status:'OPEN'},
 {id:'C-02',desc:'Anchor bolt inspection – city inspector',linked:'T-11',owner:'Site Engineer',due:'2026-04-30',L:4,I:4,status:'OPEN'},
 {id:'C-03',desc:'Ductwork BIM clash outstanding',linked:'T-03',owner:'MEP Coord.',due:'2026-05-02',L:3,I:4,status:'OPEN'},
 {id:'C-04',desc:'Roofing membrane material delivery',linked:'T-14',owner:'Procurement',due:'2026-05-08',L:4,I:3,status:'OPEN'},
 {id:'C-05',desc:'Curtainwall shop drawings approved',linked:'T-09',owner:'Glazing Sub',due:'2026-05-01',L:2,I:3,status:'RESOLVED'},
 {id:'C-06',desc:'Crane booking conflict – Level 4 pour',linked:'T-06',owner:'GC Logistics',due:'2026-04-26',L:3,I:4,status:'OPEN'},
];

/* ============================================
   APP STATE
============================================ */
const S={
  screen:'auth', // auth | projects | app
  authTab:'login', // login | signup
  signupPlan:'pro',
  activeProjectId:null,
  tab:'import', win:4,
  P:{name:'',num:'',gc:'',startDate:'2026-03-02',dataDate:'2026-04-20',ppcTarget:80},
  tasks:[],ppc:[],constraints:[],
  SET:{ppcTarget:80,riskLow:6,riskMed:12,riskHigh:16},
  charts:{},drag:null,authErr:'',
};
let GD={on:false,resize:false,id:null,x0:0,s0:null,f0:null,moved:false};
let ucId=null;

/* ============================================
   ROUTER
============================================ */
function route(){
  const u=AUTH.getUser();
  if(!u){S.screen='auth';renderAuth();return}
  if(!S.activeProjectId){S.screen='projects';renderProjects();return}
  S.screen='app';renderApp();
}

/* ============================================
   AUTH SCREENS
============================================ */
function renderAuth(){
  const root=document.getElementById('app-root');
  root.innerHTML=`
  <div class="auth-shell">
   <div class="auth-glow auth-glow-1"></div>
   <div class="auth-glow auth-glow-2"></div>
   <div class="auth-card">
    <div class="auth-logo">
     <img id="auth-logo" class="logo-img" alt="PA" src="">
     <div class="auth-logo-text"><div class="brand">Project Assure</div><div class="sub">Last Planner System®</div></div>
    </div>
    <div class="auth-tabs">
     <button class="auth-tab ${S.authTab==='login'?'on':''}" onclick="S.authTab='login';renderAuth()">Sign In</button>
     <button class="auth-tab ${S.authTab==='signup'?'on':''}" onclick="S.authTab='signup';renderAuth()">Create Account</button>
    </div>
    ${S.authErr?`<div class="ib ib-ng mb12" style="margin-bottom:16px"><div class="ib-ico">⚠️</div><div>${S.authErr}</div></div>`:''}
    ${S.authTab==='login'?loginForm():signupForm()}
   </div>
  </div>`;
  setTimeout(function(){injectLogo('auth-logo');},10);
  // Demo auto-fill hint
  if(S.authTab==='login'){
   const em=document.getElementById('a-email');
   const pw=document.getElementById('a-pw');
   if(em&&!em.value)em.value='demo@projectassure.io';
   if(pw&&!pw.value)pw.value='demo1234';
  }
}
function loginForm(){return`
 <div class="fg"><label class="flbl">Email address</label><input class="fi" id="a-email" type="email" placeholder="you@example.com" onkeydown="if(event.key==='Enter')doLogin()"></div>
 <div class="fg" style="margin-bottom:20px"><label class="flbl">Password</label><input class="fi" id="a-pw" type="password" placeholder="••••••••" onkeydown="if(event.key==='Enter')doLogin()"></div>
 <button class="btn btn-pr btn-fw btn-xl" onclick="doLogin()" style="font-size:15px;padding:13px">Sign In →</button>
 <div style="text-align:center;margin-top:16px;font-size:12px;color:var(--tx3)">Demo: demo@projectassure.io / demo1234</div>
 <div style="text-align:center;margin-top:8px;font-size:12px;color:var(--tx3)">Don't have an account? <button onclick="S.authTab='signup';S.authErr='';renderAuth()" style="background:none;border:none;color:var(--pu);font-weight:600;cursor:pointer;font-family:var(--font);font-size:12px">Create one free →</button></div>`}
function signupForm(){return`
 <div class="fg2">
  <div class="fg"><label class="flbl">Email</label><input class="fi" id="a-email" type="email" placeholder="you@company.com"></div>
  <div class="fg"><label class="flbl">Password (min 8 chars)</label><input class="fi" id="a-pw" type="password" placeholder="••••••••"></div>
 </div>
 <div class="fg" style="margin-bottom:20px">
  <label class="flbl">Choose your plan</label>
  <div class="plan-cards">
   ${[['free','Free','$0','1 project · 4 archives · 200 ops/mo'],['pro','Pro','$29<span style="font-size:11px">/mo</span>','10 projects · 52 weeks · 2,000 ops/mo',true],['enterprise','Enterprise','$99<span style="font-size:11px">/mo</span>','Unlimited everything']].map(([k,n,p,f,badge])=>`
   <div class="plan-card ${S.signupPlan===k?'on':''}" onclick="S.signupPlan='${k}';renderAuth()">
    ${badge?'<div class="plan-badge">POPULAR</div>':''}
    <div class="plan-name">${n}</div>
    <div class="plan-price">${p}</div>
    <div class="plan-feat">${f}</div>
   </div>`).join('')}
  </div>
 </div>
 <button class="btn btn-pr btn-fw btn-xl" onclick="doSignup()" style="font-size:15px;padding:13px">Create Account →</button>
 <div style="text-align:center;margin-top:12px;font-size:12px;color:var(--tx3)">Already have an account? <button onclick="S.authTab='login';S.authErr='';renderAuth()" style="background:none;border:none;color:var(--pu);font-weight:600;cursor:pointer;font-family:var(--font);font-size:12px">Sign in →</button></div>`}
function doLogin(){
 const email=document.getElementById('a-email')?.value?.trim();
 const pw=document.getElementById('a-pw')?.value;
 if(!email||!pw){S.authErr='Please enter email and password';renderAuth();return}
 if(email==='demo@projectassure.io'&&!AUTH.findUser(email)){
  AUTH.register(email,'demo1234','pro');
 }
 const r=AUTH.login(email,pw);
 if(r.err){S.authErr=r.err;renderAuth();return}
 S.authErr='';
 // Create default project for new users with no projects
 const u=AUTH.getUser();
 if(u&&(!u.projects||u.projects.length===0)){
  PROJECTS.createWithData('Riverside Tower (Sample)',IT,IPPC,IC,{
   startDate:'2026-03-02',dataDate:'2026-04-20',num:'RT-2024-0142',gc:'Summit Build Group'
  });
 }
 route();
}
function doSignup(){
 const email=document.getElementById('a-email')?.value?.trim();
 const pw=document.getElementById('a-pw')?.value;
 if(!email||!pw||pw.length<8){S.authErr='Please enter a valid email and password (min 8 chars)';renderAuth();return}
 const r=AUTH.register(email,pw,S.signupPlan);
 if(r.err){S.authErr=r.err;renderAuth()}
 else{
  AUTH.login(email,pw);
  S.authErr='';
  // Auto-create a starter project with sample data for new users
  const p=PROJECTS.createWithData('Riverside Tower (Sample)',IT,IPPC,IC,{
   startDate:'2026-03-02',dataDate:'2026-04-20',num:'RT-2024-0142',gc:'Summit Build Group'
  });
  if(p)S.activeProjectId=p.id;
  route();
 }
}

/* ─── ACCOUNT MANAGEMENT MODAL ─── */
function showAccount(){
 const u=AUTH.getUser();if(!u)return;
 const plan=PLAN_DEF[u.plan||'free'];
 const opsUsed=u.opsUsed||0,opsMax=plan.ops;
 const pct=Math.min(100,opsMax>=50000?5:Math.round(opsUsed/opsMax*100));
 const projects=PROJECTS.getAll();
 const totalArcs=projects.reduce((a,p)=>a+(p.archives||[]).length,0);
 openML(`<div class="ml-hdr"><div class="ml-t">👤 Your Account</div><button class="ml-x" onclick="closeML()">✕</button></div>
 <div class="ml-body">
  <div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--bd);margin-bottom:16px">
   <div style="width:44px;height:44px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;font-weight:700;flex-shrink:0">${u.email[0].toUpperCase()}</div>
   <div>
    <div style="font-size:15px;font-weight:700;color:var(--tx);letter-spacing:-0.02em">${u.email}</div>
    <div style="font-size:12px;color:var(--tx3);margin-top:2px">Member since ${u.createdAt?fmt(u.createdAt):'recently'}</div>
   </div>
   <div style="margin-left:auto">
    <span class="bdg b-pu" style="font-size:12px;padding:4px 10px">${plan.name.toUpperCase()}</span>
   </div>
  </div>

  <div style="font-size:11px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px">Usage This Month</div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
   <div style="background:#f9fafb;border:1px solid var(--bd);border-radius:9px;padding:12px;text-align:center">
    <div style="font-size:24px;font-weight:800;letter-spacing:-0.03em;color:${pct>80?'var(--rd)':'var(--pu)'}">${opsUsed}<span style="font-size:12px;font-weight:400;color:var(--tx3)">/${opsMax>=50000?'∞':opsMax}</span></div>
    <div style="font-size:10px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:0.06em;margin-top:3px">Operations</div>
    <div style="height:4px;background:#e5e7eb;border-radius:2px;margin-top:7px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${pct>80?'var(--rd)':'var(--pu)'};border-radius:2px"></div></div>
   </div>
   <div style="background:#f9fafb;border:1px solid var(--bd);border-radius:9px;padding:12px;text-align:center">
    <div style="font-size:24px;font-weight:800;letter-spacing:-0.03em;color:var(--tx)">${projects.length}<span style="font-size:12px;font-weight:400;color:var(--tx3)">/${plan.projects>=Infinity?'∞':plan.projects}</span></div>
    <div style="font-size:10px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:0.06em;margin-top:3px">Projects</div>
   </div>
   <div style="background:#f9fafb;border:1px solid var(--bd);border-radius:9px;padding:12px;text-align:center">
    <div style="font-size:24px;font-weight:800;letter-spacing:-0.03em;color:var(--tx)">${totalArcs}</div>
    <div style="font-size:10px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:0.06em;margin-top:3px">Archives</div>
   </div>
  </div>

  <div style="font-size:11px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px">Plans</div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">
   ${[['free','Free','$0/mo','1 project','4 archives','200 ops/mo'],
      ['pro','Pro','$29/mo','10 projects','52 archives','2,000 ops/mo'],
      ['enterprise','Enterprise','$99/mo','Unlimited','Unlimited','50,000 ops/mo']
     ].map(([k,n,p,pr,ar,op])=>`
   <div style="border:2px solid ${u.plan===k?'var(--pu)':'var(--bd)'};border-radius:10px;padding:12px;text-align:center;background:${u.plan===k?'var(--pu-l)':'#fff'};transition:.2s;cursor:${u.plan===k?'default':'pointer'}" onclick="${u.plan===k?'':'upgradePlan(\''+k+'\')'}">
    ${u.plan===k?'<div style="font-size:9px;font-weight:700;color:var(--pu);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:5px">CURRENT PLAN</div>':''}
    <div style="font-size:14px;font-weight:700;letter-spacing:-0.02em;color:var(--tx)">${n}</div>
    <div style="font-size:18px;font-weight:800;letter-spacing:-0.025em;color:var(--pu);margin:4px 0">${p}</div>
    <div style="font-size:11px;color:var(--tx3);line-height:1.7">${pr}<br>${ar}<br>${op}</div>
    ${u.plan!==k?`<div style="margin-top:8px;font-size:11px;font-weight:600;color:var(--pu);border:1px solid var(--pu-b);border-radius:5px;padding:4px">Select →</div>`:''}
   </div>`).join('')}
  </div>

  <div style="font-size:11px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px">Op Cost Reference</div>
  <div style="background:#f9fafb;border:1px solid var(--bd);border-radius:8px;padding:10px 14px">
   ${Object.entries(OP_COST).map(([k,v])=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f3f4f6;font-size:12px"><span style="color:var(--tx2);font-weight:500;text-transform:capitalize">${k.replace('_',' ')}</span><span style="font-family:var(--mono);font-weight:600;color:var(--pu)">${v} ops</span></div>`).join('')}
  </div>
 </div>
 <div class="ml-ftr" style="justify-content:space-between">
  <button class="btn btn-rd btn-sm" onclick="AUTH.logout();closeML();route()">Sign out</button>
  <button class="btn btn-gh" onclick="closeML()">Close</button>
 </div>`);
}
function upgradePlan(plan){
 const u=AUTH.getUser();if(!u)return;
 AUTH.updateUser({plan});
 closeML();
 showAccount();
}

/* ============================================
   PROJECT SELECTOR SCREEN
============================================ */
function renderProjects(){
 const u=AUTH.getUser();if(!u)return route();
 const projects=PROJECTS.getAll();
 const plan=PLAN_DEF[u.plan||'free'];
 const opsUsed=u.opsUsed||0,opsMax=plan.ops;
 const canCreate=projects.length<plan.projects;
 const isNew=projects.length===0;
 document.getElementById('app-root').innerHTML=`
  <div class="proj-shell">
   <div class="proj-topbar">
    <img id="ptb-logo" class="logo-img" alt="PA" src="" style="height:32px;width:32px">
    <div style="font-size:15px;font-weight:700;letter-spacing:-0.02em;color:var(--tx)">Project Assure</div>
    <div class="mla fc" style="gap:8px">
     <div style="min-width:150px">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px">
       <span style="font-size:10px;font-weight:600;color:var(--tx3)">${plan.name} · ops used</span>
       <span style="font-size:10px;font-weight:600;color:var(--tx3)">${opsUsed}/${opsMax>=50000?'∞':opsMax}</span>
      </div>
      <div class="credit-track" style="cursor:pointer" onclick="showAccount()">
       <div class="credit-fill ${opsUsed/opsMax>.8?'warn':''}" style="width:${Math.min(100,opsMax>=50000?3:Math.round(opsUsed/opsMax*100))}%"></div>
      </div>
     </div>
     <button class="btn btn-gh btn-sm" onclick="showAccount()">👤 ${u.email.split('@')[0]}</button>
     <button class="btn btn-gh btn-sm" onclick="AUTH.logout();route()">Sign out</button>
    </div>
   </div>
   ${isNew?`<div style="background:var(--grad);padding:16px 24px;color:#fff;display:flex;align-items:center;gap:14px">
    <div style="font-size:22px">🎉</div>
    <div><div style="font-size:15px;font-weight:700;letter-spacing:-0.02em">Welcome to Project Assure!</div>
    <div style="font-size:12.5px;opacity:.85;margin-top:2px">Your sample project is ready below — or create a new blank project. Click any project card to open it.</div></div>
   </div>`:''}
   <div style="padding:16px 24px 0;max-width:1200px;margin:0 auto;width:100%;display:flex;align-items:center;justify-content:space-between">
    <div style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:var(--tx)">My Projects <span style="font-size:14px;font-weight:500;color:var(--tx3)">(${projects.length}/${plan.projects>=Infinity?'∞':plan.projects})</span></div>
    ${canCreate?`<button class="btn btn-pr" onclick="createProject()">+ New Project</button>`:''}
   </div>
   <div class="proj-grid">
    ${projects.map(p=>{
     const scheduled=(p.tasks||[]).filter(t=>t.onGantt).length;
     const openC=(p.constraints||[]).filter(c=>c.status==='OPEN').length;
     const arcs=(p.archives||[]).length;
     const lastArc=arcs>0?p.archives[arcs-1]:null;
     const pd2=p.project||{};
     return`<div class="proj-card" onclick="openProject('${p.id}')">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
       <div class="proj-name" style="flex:1">${p.name}</div>
       <div style="display:flex;gap:4px;flex-shrink:0">
        <button class="btn btn-gh btn-sm" style="padding:3px 7px;font-size:10px" onclick="event.stopPropagation();doArchiveFromSelector('${p.id}')" title="Archive">📦</button>
        <button class="btn btn-gh btn-sm" style="padding:3px 7px;font-size:10px;color:var(--rd)" onclick="event.stopPropagation();deleteProject('${p.id}')" title="Delete">✕</button>
       </div>
      </div>
      <div class="proj-meta">${pd2.gc||'No contractor'} · ${pd2.num||'No number'}</div>
      <div class="proj-meta" style="margin-top:-4px;margin-bottom:12px">Saved ${fmt(p.lastSaved)} · ${arcs} archive${arcs!==1?'s':''}</div>
      <div class="proj-stat">
       <div class="ps-item"><div class="ps-v">${scheduled}</div><div class="ps-l">On Gantt</div></div>
       <div class="ps-item"><div class="ps-v">${openC}</div><div class="ps-l">Constraints</div></div>
       <div class="ps-item"><div class="ps-v" style="color:${lastArc&&lastArc.ppc>=80?'var(--gn)':lastArc?'var(--rd)':'var(--tx4)'}">${lastArc?lastArc.ppc+'%':'—'}</div><div class="ps-l">Last PPC</div></div>
      </div>
     </div>`}).join('')}
    ${canCreate?`<div class="proj-card proj-card-new" onclick="createProject()">
     <div style="font-size:28px;margin-bottom:8px;opacity:.3">+</div>
     <div style="font-size:14px;font-weight:600">New Project</div>
     <div style="font-size:11.5px;color:var(--tx4);margin-top:4px">${projects.length}/${plan.projects>=Infinity?'∞':plan.projects} used</div>
    </div>`:`<div class="proj-card proj-card-new" style="cursor:default">
     <div style="font-size:22px;margin-bottom:6px">🔒</div>
     <div style="font-size:13px;font-weight:600">Plan limit reached</div>
     <div style="font-size:11px;margin-top:4px;color:var(--tx4)">Tap 👤 to upgrade</div>
    </div>`}
   </div>
  </div>`;
 const img=document.getElementById('ptb-logo');
 if(img)img.src=PA_LOGO;
}

function doArchiveFromSelector(id){
 const p=PROJECTS.get(id);if(!p)return;
 if(!AUTH.canOp('archive')){openML(`<div class="ml-hdr"><div class="ml-t">Op Limit</div><button class="ml-x" onclick="closeML()">✕</button></div><div class="ml-body"><div class="ib ib-ng mb0"><div class="ib-ico">⚠️</div><div>Monthly operation limit reached. Tap 👤 to upgrade.</div></div></div><div class="ml-ftr"><button class="btn btn-pr" onclick="closeML()">OK</button></div>`);return}
 const pSt=p.project?.startDate||iso(new Date());
 const dd=p.project?.dataDate||iso(new Date());
 const days=Math.round((new Date(dd)-new Date(pSt))/864e5);
 const wkNum=Math.max(1,Math.floor(days/7)+1);
 const wk=`W${String(wkNum).padStart(2,'0')}`;
 const wt=(p.tasks||[]).filter(t=>t.onGantt&&t.startDate&&t.finishDate);
 const dn=wt.filter(t=>t.wwp==='done').length,nd=wt.filter(t=>t.wwp==='not-done').length;
 const ppc=dn+nd>0?Math.round(dn/(dn+nd)*100):0;
 PROJECTS.archive(id,wk,{ppc,tasks:p.tasks||[]});
 AUTH.useOp('archive');
 openML(`<div class="ml-hdr"><div class="ml-t">Archived ✓</div><button class="ml-x" onclick="closeML();renderProjects()">✕</button></div><div class="ml-body"><div class="ib ib-ok mb0" style="margin:0"><div class="ib-ico">✅</div><div><strong>${p.name}</strong> — <strong>${wk}</strong> archived with PPC <strong>${ppc}%</strong>.</div></div></div><div class="ml-ftr"><button class="btn btn-pr" onclick="closeML();renderProjects()">Done</button></div>`);
}

function openProject(id){
 const p=PROJECTS.get(id);if(!p){toast('Project not found','ng');renderProjects();return}
 S.activeProjectId=id;
 S.tasks=(p.tasks||[]).map(t=>({...t,pred:[...(t.pred||[])]}));
 S.ppc=[...(p.ppc||[])];
 S.constraints=[...(p.constraints||[])];
 S.P={...(p.project||{name:p.name,num:'',gc:'',startDate:iso(new Date()),dataDate:iso(new Date()),ppcTarget:80})};
 S.SET={...(p.settings||{ppcTarget:80,riskLow:6,riskMed:12,riskHigh:16})};
 S.tab='import'; // always start on import for new/empty projects
 route();
}
function createProject(){
 const u=AUTH.getUser();if(!u)return;
 const plan=PLAN_DEF[u.plan||'free'];
 const projects=PROJECTS.getAll();
 if(projects.length>=plan.projects){
  openML(`<div class="ml-hdr"><div class="ml-t">Plan Limit Reached</div><button class="ml-x" onclick="closeML()">✕</button></div>
  <div class="ml-body"><div class="ib ib-wr mb12"><div class="ib-ico">🔒</div><div>Your <strong>${plan.name}</strong> plan allows up to <strong>${plan.projects} project${plan.projects>1?'s':''}</strong>. You are currently using ${projects.length}. Upgrade to Pro or Enterprise to add more.</div></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
   <div style="border:1px solid var(--bd);border-radius:10px;padding:14px;text-align:center"><div style="font-size:20px;font-weight:800;color:var(--pu);letter-spacing:-0.03em">$29<span style="font-size:12px;font-weight:400">/mo</span></div><div style="font-size:12px;font-weight:600;color:var(--tx);margin:2px 0">Pro</div><div style="font-size:11px;color:var(--tx3)">10 projects · 52 archives</div></div>
   <div style="border:1px solid var(--bd);border-radius:10px;padding:14px;text-align:center"><div style="font-size:20px;font-weight:800;color:var(--pu);letter-spacing:-0.03em">$99<span style="font-size:12px;font-weight:400">/mo</span></div><div style="font-size:12px;font-weight:600;color:var(--tx);margin:2px 0">Enterprise</div><div style="font-size:11px;color:var(--tx3)">Unlimited everything</div></div>
  </div></div>
  <div class="ml-ftr"><button class="btn btn-gh" onclick="closeML()">Close</button></div>`);
  return;
 }
 openML(`<div class="ml-hdr"><div class="ml-t">Create New Project</div><button class="ml-x" onclick="closeML()">✕</button></div>
 <div class="ml-body">
  <div class="fg"><label class="flbl">Project Name ★</label><input class="fi" id="cp-name" placeholder="e.g. Riverside Tower Phase 2" onkeydown="if(event.key==='Enter')confCreateProject()"></div>
  <div class="fg2">
   <div class="fg"><label class="flbl">Project Number</label><input class="fi" id="cp-num" placeholder="e.g. RT-2024-0142"></div>
   <div class="fg"><label class="flbl">General Contractor</label><input class="fi" id="cp-gc" placeholder="e.g. Summit Build Group"></div>
  </div>
  <div class="fg2">
   <div class="fg"><label class="flbl">Project Start Date (Week 1)</label><input class="fi" id="cp-start" type="date" value="${iso(new Date())}"></div>
   <div class="fg"><label class="flbl">Data Date (Planning today)</label><input class="fi" id="cp-dd" type="date" value="${iso(new Date())}"></div>
  </div>
  <div class="ib ib-bl mb0" style="margin-bottom:0"><div class="ib-ico">💡</div><div style="font-size:12px">The project starts empty. Use <strong>Import</strong> to load tasks, or <strong>Load Sample Data</strong> on the Import tab to explore with demo data.</div></div>
 </div>
 <div class="ml-ftr"><button class="btn btn-gh" onclick="closeML()">Cancel</button><button class="btn btn-pr" onclick="confCreateProject()">Create Project →</button></div>`);
 setTimeout(()=>document.getElementById('cp-name')?.focus(),80);
}
function confCreateProject(){
 const name=document.getElementById('cp-name')?.value?.trim();
 if(!name){document.getElementById('cp-name').style.borderColor='var(--rd)';document.getElementById('cp-name').focus();return}
 const num=document.getElementById('cp-num')?.value?.trim()||'';
 const gc=document.getElementById('cp-gc')?.value?.trim()||'';
 const startDate=document.getElementById('cp-start')?.value||iso(new Date());
 const dataDate=document.getElementById('cp-dd')?.value||iso(new Date());
 const p=PROJECTS.create(name,{num,gc,startDate,dataDate});
 if(p){closeML();openProject(p.id)}
 else{toast('Failed to create project — check console','ng');}
}
function archiveCurrent(id){
 const p=PROJECTS.get(id);if(!p)return;
 if(!AUTH.canOp('archive')){toast('Monthly op limit reached. Upgrade plan.','ng');return}
 const wt=p.tasks?p.tasks.filter(t=>t.onGantt):[];
 const dn=wt.filter(t=>t.wwp==='done').length,nd=wt.filter(t=>t.wwp==='not-done').length;
 const ppc=dn+nd>0?Math.round(dn/(dn+nd)*100):0;
 PROJECTS.archive(id,p.project?.dataDate?wkL(p.project.dataDate):'W??',{ppc,tasks:p.tasks||[]});
 AUTH.useOp('archive');
 toast('Archived ' + wk + ' · PPC ' + ppc + '%','ok');
 renderProjects();
}
function deleteProject(id){
 const p=PROJECTS.get(id);if(!p)return;
 openML(`<div class="ml-hdr"><div class="ml-t">Delete Project</div><button class="ml-x" onclick="closeML()">✕</button></div>
 <div class="ml-body"><div class="ib ib-ng mb12"><div class="ib-ico">⚠️</div><div>Permanently delete <strong>${p.name}</strong>? All tasks, constraints, archives and PPC history will be lost. This cannot be undone.</div></div></div>
 <div class="ml-ftr"><button class="btn btn-gh" onclick="closeML()">Cancel</button><button class="btn btn-rd" onclick="confirmDeleteProject('${id}')">Delete permanently</button></div>`);
}
function confirmDeleteProject(id){
 PROJECTS.delete(id);closeML();renderProjects();
}
function saveCurrentProject(){
 if(!S.activeProjectId)return;
 PROJECTS.save(S.activeProjectId,{tasks:S.tasks,ppc:S.ppc,constraints:S.constraints,project:S.P,settings:S.SET});
}

/* ---- block break ---- */

/* ============================================
   MAIN APP RENDER
============================================ */
function renderApp(){
 const u=AUTH.getUser();
 const plan=PLAN_DEF[u?.plan||'free'];
 const opsUsed=u?.opsUsed||0;
 const opsMax=plan.ops;
 document.getElementById('app-root').innerHTML=`
  <header class="hdr">
   <img id="app-logo" class="logo-img" alt="PA" src="" style="height:36px;width:36px">
   <div class="brand-mark"><div class="b1">PROJECT ASSURE</div><div class="b2">Last Planner System®</div></div>
   <div class="hdr-sep"></div>
   <div style="min-width:0;flex:1">
    <div class="hdr-proj-name" id="hd-pn">${S.P.name||'Unnamed Project'}</div>
    <div class="hdr-proj-meta" id="hd-pm">${S.P.num||''}${S.P.gc?' · '+S.P.gc:''}</div>
   </div>
   <div class="hd-r">
    <div class="dd-nav">
     <button class="dd-btn" onclick="ddD(-1)">‹</button>
     <div class="dd-center" onclick="ddE()"><div class="dd-wk" id="dd-wk">WK 08</div><div class="dd-dt" id="dd-dt">20 Apr 2026</div></div>
     <button class="dd-btn" onclick="ddD(1)">›</button>
    </div>
    <div class="win-sel" id="wsel">
     <button id="ws-4" class="ws-b" onclick="setWin(4)">4W</button>
     <button id="ws-6" class="ws-b" onclick="setWin(6)">6W</button>
     <button id="ws-8" class="ws-b" onclick="setWin(8)">8W</button>
     <button id="ws-12" class="ws-b" onclick="setWin(12)">12W</button>
    </div>
    <!-- Credit bar -->
    <div title="Monthly operations: ${opsUsed}/${opsMax>=50000?'∞':opsMax}" style="width:80px;cursor:pointer" onclick="showAccount()">
     <div style="font-size:9px;font-weight:500;color:#6b7280;text-align:right;margin-bottom:2px">${opsUsed}/${opsMax>=50000?'∞':opsMax} ops</div>
     <div style="background:rgba(255,255,255,.1);border-radius:3px;height:4px;overflow:hidden">
      <div style="width:${Math.min(100,opsMax>=50000?5:opsUsed/opsMax*100).toFixed(0)}%;height:100%;background:${opsUsed/opsMax>.8?'#ef4444':'#8b5cf6'};border-radius:3px"></div>
     </div>
    </div>
    <button class="btn btn-gh btn-sm" onclick="showAccount()" style="color:#9ca3af;border-color:rgba(255,255,255,.15);font-size:11px">👤</button>
    <button class="btn btn-gh btn-sm" onclick="S.activeProjectId=null;saveCurrentProject();route()" style="color:#9ca3af;border-color:rgba(255,255,255,.15);font-size:11px">← Projects</button>
   </div>
  </header>
  <nav class="nav">
   <button class="tab ${S.tab==='import'?'on':''}" onclick="ST('import')" data-tab="import">↕️ Import</button>
   <button class="tab ${S.tab==='gantt'?'on':''}" onclick="ST('gantt')" data-tab="gantt">📅 Gantt</button>
   <button class="tab ${S.tab==='board'?'on':''}" onclick="ST('board')" data-tab="board">📋 Board <span class="tnb" id="bbdg" style="display:none">0</span></button>
   <button class="tab ${S.tab==='dash'?'on':''}" onclick="ST('dash')" data-tab="dash">📊 Dashboard</button>
   <button class="tab ${S.tab==='archive'?'on':''}" onclick="ST('archive')" data-tab="archive">📦 Archives</button>
   <button class="tab ${S.tab==='export'?'on':''}" onclick="ST('export')" data-tab="export">📤 Export</button>
   <button class="tab ${S.tab==='settings'?'on':''}" onclick="ST('settings')" data-tab="settings">⚙️ Settings</button>
   <button class="tab ${S.tab==='help'?'on':''}" onclick="ST('help')" data-tab="help">❓ Help</button>
  </nav>
  <main class="main" id="mc"></main>
  <div class="guide" id="guide"><div class="g-ico" id="g-ico">💡</div><div class="g-txt" id="g-txt"></div><div class="g-acts" id="g-acts"></div></div>`;
 const img=document.getElementById('app-logo');
 // logo via CSS
 renderTab();updHdr();updWB();
}

function ST(t){S.tab=t;saveCurrentProject();renderTab();updBdg()}
function renderTab(){
 destroyCharts();
 const fns={import:rImport,gantt:rGantt,board:rBoard,dash:rDash,archive:rArchive,export:rExport,settings:rSet,help:rHelp};
 const el=document.getElementById('mc');if(!el)return;
 el.innerHTML=(fns[S.tab]||rImport)();
 document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('on',b.dataset&&b.dataset.tab===S.tab));
 renderGuide();setupEvt();updWB();updBdg();
}

function updHdr(){
 const wk=d2wk(S.P.dataDate);
 const el1=document.getElementById('dd-wk'),el2=document.getElementById('dd-dt');
 if(el1)el1.textContent=`WK ${String(wk).padStart(2,'0')}`;
 if(el2)el2.textContent=fmtL(S.P.dataDate);
 const p1=document.getElementById('hd-pn'),p2=document.getElementById('hd-pm');
 if(p1)p1.textContent=S.P.name||'Unnamed Project';
 if(p2)p2.textContent=`${S.P.num||''}${S.P.gc?' · '+S.P.gc:''}`;
}
function updWB(){[4,6,8,12].forEach(w=>{const b=document.getElementById('ws-'+w);if(b)b.classList.toggle('on',w===S.win)})}
function updBdg(){const n=wTasks().filter(t=>t.wwp!=='done').length;const b=document.getElementById('bbdg');if(b){b.textContent=n;b.style.display=n?'inline':'none'}}
function ddD(n){const d=pd(S.P.dataDate);if(!d)return;d.setDate(d.getDate()+n*7);S.P.dataDate=iso(d);updHdr();renderTab()}
function ddE(){
 openML(`<div class="ml-hdr"><div class="ml-t">Set Data Date</div><button class="ml-x" onclick="closeML()">✕</button></div>
 <div class="ml-body">
  <div class="ib ib-bl mb12"><div class="ib-ico">📅</div><div style="font-size:12.5px">The <strong>Data Date</strong> is your planning "today". It anchors the planning window and is shown as the red NOW line on the Gantt.</div></div>
  <div class="fg"><label class="flbl">Data Date</label><input class="fi" id="dd-inp" type="date" value="${S.P.dataDate||''}" onkeydown="if(event.key==='Enter')confDdE()"></div>
 </div>
 <div class="ml-ftr"><button class="btn btn-gh" onclick="closeML()">Cancel</button><button class="btn btn-pr" onclick="confDdE()">Set Date</button></div>`);
 setTimeout(()=>document.getElementById('dd-inp')?.focus(),60);
}
function confDdE(){
 const v=document.getElementById('dd-inp')?.value;
 if(v&&pd(v)){S.P.dataDate=iso(pd(v));updHdr();closeML();renderTab()}
}
function setWin(w){S.win=w;updWB();renderTab()}
const wStart=()=>S.P.dataDate;
const wEnd=()=>addW(S.P.dataDate,S.win);
function wTasks(){const ws=pd(wStart()),we=pd(wEnd());return S.tasks.filter(t=>t.onGantt&&t.startDate&&t.finishDate&&pd(t.finishDate)>=ws&&pd(t.startDate)<=we)}

/* ============================================
   IMPORT VIEW
============================================ */
function rImport(){
 var isEmpty=S.tasks.length===0;
 return '<div class="g2" style="gap:16px;align-items:start">'+
  '<div>'+
   (isEmpty?
    '<div class="card mb12" style="border:2px solid var(--pu-b)">'+
     '<div class="card-hdr" style="background:var(--pu-l)"><div class="card-t" style="color:var(--pu)">Quick Start</div></div>'+
     '<div class="card-body">'+
      '<p style="font-size:13px;color:var(--tx2);line-height:1.6;margin-bottom:12px">Load the Riverside Tower sample — 14 tasks, 6 constraints, 7 weeks PPC history — and explore every feature instantly.</p>'+
      '<button class="btn btn-pr btn-fw btn-xl" onclick="loadSample()" style="font-size:15px;padding:13px">Load Sample Data</button>'+
     '</div>'+
    '</div>':'')+
   '<div class="card mb12"><div class="card-hdr"><div class="card-t">Import Excel File</div></div>'+
    '<div class="card-body">'+
     '<div class="uz" onclick="document.getElementById(\'fi\').click()" ondragover="event.preventDefault();this.classList.add(\'dov\')" ondragleave="this.classList.remove(\'dov\')" ondrop="dropImp(event)">'+
      '<div class="uz-ico">&#128202;</div>'+
      '<div class="uz-t">Drop Excel file here or click to browse</div>'+
      '<div class="uz-s">.xlsx or .xls &mdash; must match the downloaded template</div>'+
     '</div>'+
     '<div id="imp-st" class="mt12"></div>'+
    '</div>'+
   '</div>'+
   '<div class="card mb12"><div class="card-hdr"><div class="card-t">Download Excel Template</div></div>'+
    '<div class="card-body">'+
     '<p style="font-size:13px;color:var(--tx2);line-height:1.6;margin-bottom:12px">Download the template, fill tasks with real Start and Finish Dates, set Project Start Date and Data Date in the Project_Info sheet.</p>'+
     '<button class="btn btn-ol btn-fw btn-lg" onclick="dlTemplate()">Download Excel Template (.xlsx)</button>'+
    '</div>'+
   '</div>'+
   '<div class="card" style="border-left:3px solid var(--am)">'+
    '<div class="card-hdr" style="background:var(--am-l)"><div class="card-t" style="color:var(--am)">Disclaimer</div></div>'+
    '<div class="card-body" style="font-size:12.5px;color:var(--tx2);line-height:1.7">'+
     '<p style="margin-bottom:8px">Project Assure LPS is a digital planning aid designed to support the Last Planner System methodology. It does <strong>not</strong> replace professional project management judgement, licensed scheduling software, or qualified site supervision.</p>'+
     '<p>All project data is stored <strong>locally in your browser only</strong> and is never transmitted to any external server. You are solely responsible for the accuracy of data entered and any decisions made based on outputs from this tool.</p>'+
    '</div>'+
   '</div>'+
  '</div>'+
  '<div>'+
   '<div class="card"><div class="card-hdr"><div class="card-t">Template Columns</div></div>'+
    '<div style="overflow:hidden;border-radius:0 0 11px 11px">'+
     '<table style="width:100%;border-collapse:collapse;font-size:12px">'+
      '<tr style="background:#f9fafb">'+
       '<th style="padding:7px 12px;text-align:left;font-size:10px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid var(--bd)">Column</th>'+
       '<th style="padding:7px 12px;border-bottom:1px solid var(--bd);font-size:10px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em">Format</th>'+
      '</tr>'+
      [['Task ID','T-01, T-02 ...'],['Task Name','Short description *'],['Trade','Civil / Steel / Concrete'],['Zone','Foundation / Structure / MEP'],['Start Date','YYYY-MM-DD *'],['Finish Date','YYYY-MM-DD *'],['Assignee','Person responsible'],['Hours','Planned hours (number)'],['Predecessor IDs','Comma-separated: T-01,T-03'],['Constraint','Blocker description or blank'],['Ready','YES or NO'],['Status','promised / done / at-risk / not-done'],['RNC Code','DES / MAT / LAB / EQP / WEA / PRE / OTH'],['Likelihood','1 to 5'],['Impact','1 to 5']].map(function(row){return '<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:6px 12px;font-family:var(--mono);font-size:10px;font-weight:600;color:var(--pu);white-space:nowrap">'+row[0]+'</td><td style="padding:6px 12px;color:var(--tx2);font-size:12px">'+row[1]+'</td></tr>';}).join('')+
      '<tr><td colspan="2" style="padding:8px 12px;background:var(--am-l);font-size:11.5px;color:var(--am)">* Required. Project_Info tab needs Project Start Date and Data Date.</td></tr>'+
     '</table>'+
    '</div>'+
   '</div>'+
  '</div>'+
 '</div>';
}

function rGantt(){
 const sched=S.tasks.filter(t=>t.onGantt&&t.startDate).sort((a,b)=>(pd(a.startDate)||0)-(pd(b.startDate)||0));
 const unsched=S.tasks.filter(t=>!t.onGantt);
 const totW=TWK*WW,wsX=d2x(wStart()),weX=d2x(wEnd()),nowX=d2x(S.P.dataDate);
 const pSt=pd(S.P.startDate)||new Date('2026-01-01');

 // Month header bands
 const mbs=[];let cur=new Date(pSt);cur.setDate(1);
 for(let i=0;i<18;i++){const ms=new Date(cur),me=new Date(cur);me.setMonth(me.getMonth()+1);const x1=Math.max(0,d2x(iso(ms))),x2=Math.min(totW,d2x(iso(me)));if(x1<totW&&x2>x1)mbs.push({l:ms.toLocaleDateString('en-GB',{month:'short',year:'2-digit'}),x:x1,w:x2-x1});cur.setMonth(cur.getMonth()+1)}

 // Week bands — only show label if wide enough
 const wbs=Array.from({length:TWK},(_,i)=>{
  const w=i+1,wd=wk2d(w),inWin=pd(wd)>=pd(wStart())&&pd(wd)<pd(wEnd()),isDD=w===d2wk(S.P.dataDate);
  return`<div class="g-wband" style="left:${i*WW}px;width:${WW}px;color:${isDD?'var(--rd)':inWin?'var(--pu)':'var(--tx4)'};font-weight:${isDD||inWin?700:400};background:${inWin?'rgba(109,40,217,.05)':'transparent'}"><div class="gwn">W${String(w).padStart(2,'0')}</div><div class="gwd">${fmt(wd).slice(0,5)}</div></div>`;
 }).join('');

 // Grid lines (every 4 weeks = month)
 const gls=Array.from({length:TWK},(_,i)=>`<div class="g-gl" style="left:${i*WW}px;${i%4===0?'background:#eaecf0;':''}" ></div>`).join('');

 // SVG arrows (fixed: using cubic bezier)
 const arrows=sched.flatMap((t,ti)=>(t.pred||[]).map(pid=>{
  const pi=sched.findIndex(x=>x.id===pid);if(pi<0)return'';
  const p=sched[pi];const x1=d2x(p.finishDate)+2,y1=pi*ROW_H+ROW_H/2;
  const x2=d2x(t.startDate),y2=ti*ROW_H+ROW_H/2;
  const mx=Math.max(x1+12,(x1+x2)/2);
  return`<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="#8b5cf6" stroke-width="1.5" opacity=".5" marker-end="url(#arr)"/>`;
 })).join('');

 // Per-row with window overlays + bars
 const rows=sched.map((t,i)=>{
  const c=tC(t.trade),bL=d2x(t.startDate),bR=d2x(t.finishDate),bW=Math.max(WW-4,bR-bL-2);
  return`<div class="g-row">
   <div class="g-lbl" style="width:${LBL_W}px">
    <div class="g-lid">${t.id} · ${t.wbs}</div>
    <div class="g-lnm" style="max-width:${LBL_W-20}px;overflow:hidden;text-overflow:ellipsis">${t.name}</div>
    <div class="g-ltr" style="color:${c}">${t.trade}${t.assignee?' · '+t.assignee:''}</div>
   </div>
   <div class="g-tl" style="height:${ROW_H}px">
    ${gls}
    <div class="g-past-ov" style="left:0;width:${wsX}px"></div>
    <div class="g-win-hl" style="left:${wsX}px;width:${weX-wsX}px"></div>
    <div class="g-future-ov" style="left:${weX}px;width:${Math.max(0,totW-weX)}px"></div>
    <div class="g-now-line" style="left:${nowX}px"></div>
    <div class="g-bar" id="bar-${t.id}" data-id="${t.id}"
     style="left:${bL}px;width:${bW}px;top:8px;background:${c};opacity:${t.wwp==='done'?.75:1}"
     onmousedown="barDn(event,'${t.id}',false)">
     <span style="pointer-events:none;overflow:hidden;text-overflow:ellipsis;flex:1">${t.name.length>24?t.name.substring(0,22)+'…':t.name}${(t.pred||[]).length?` <span style="opacity:.7">↑${t.pred.length}</span>`:''}</span>
     <div class="g-rh" onmousedown="barDn(event,'${t.id}',true)"></div>
    </div>
    ${t.wwp==='done'?`<div style="position:absolute;left:${bL+1}px;top:8px;height:23px;width:${bW}px;background:rgba(0,0,0,.1);border-radius:5px;pointer-events:none;display:flex;align-items:center;padding:0 8px;font-size:10px;font-weight:700;color:rgba(255,255,255,.9);letter-spacing:0.02em">✓ DONE</div>`:''}
   </div>
  </div>`;
 }).join('');

 return`
 <div class="ib ib-pu mb12"><div class="ib-ico">📅</div><div><strong>Gantt Schedule.</strong> Drag tasks from the sidebar into the timeline to schedule them. <strong>Grab bars to move.</strong> <strong>Drag ⇔ right edge to resize.</strong> Click a bar to edit details. The purple boundary marks your <strong>${S.win}-week planning window</strong> — tasks inside this zone appear on the Board.</div></div>
 <div class="g-shell">
  <div class="g-sb">
   <div class="g-sb-hdr"><div class="g-sb-t">Unscheduled (${unsched.length})</div><div class="g-sb-s">Drag into the timeline →</div></div>
   <div class="g-sb-body">
    ${unsched.length===0?'<div style="padding:14px;text-align:center;color:var(--tx4);font-size:12.5px;font-style:italic;line-height:1.6">All tasks scheduled ✓</div>':
     unsched.map(t=>`<div class="uc" draggable="true" data-id="${t.id}" ondragstart="ucDrag(event)" ondragend="this.style.opacity=1;ucId=null">
      <div class="uc-id">${t.id} · ${t.wbs}</div>
      <div class="uc-nm">${t.name}</div>
      <div class="uc-tr" style="color:${tC(t.trade)}">${t.trade}${t.assignee?' · '+t.assignee:''}</div>
     </div>`).join('')}
    <button class="btn btn-gh btn-fw btn-sm mt12" style="margin-top:10px" onclick="addBlank()">+ Add task</button>
   </div>
  </div>
  <div class="g-main">
   <div class="g-tb">
    <span style="font-size:11.5px;font-weight:500;color:var(--tx3)">${sched.length} scheduled · ${unsched.length} unscheduled</span>
    <div class="mla fc" style="gap:7px">
     <button class="btn btn-gh btn-sm" onclick="recalc()">↻ Recalc Dependencies</button>
    </div>
   </div>
   <div class="g-area" id="g-area" ondragover="event.preventDefault()" ondrop="gDrop(event)">
    <div class="g-inner" style="width:${LBL_W+totW}px">
     <div class="g-hdr">
      <div class="g-lhdr" style="width:${LBL_W}px;height:38px;font-size:10.5px">Task / Activity</div>
      <div class="g-thdr" style="width:${totW}px;height:38px;position:relative">
       ${mbs.map(m=>`<div class="g-mband" style="left:${m.x}px;width:${m.w}px">${m.l}</div>`).join('')}
       ${wbs}
      </div>
     </div>
     <!-- Window boundary banner — single clean row -->
     <div style="height:24px;display:flex;background:#f9fafb;border-bottom:1px solid var(--bd);position:relative;overflow:hidden">
      <div style="width:${LBL_W}px;flex-shrink:0;border-right:1px solid var(--bd);padding:0 10px;display:flex;align-items:center">
       <span style="font-size:10px;font-weight:500;color:var(--tx3)">Timeline markers</span>
      </div>
      <div style="flex:1;position:relative;overflow:hidden">
       <!-- Data date marker -->
       <div style="position:absolute;left:${nowX}px;top:0;bottom:0;display:flex;align-items:center;z-index:20;pointer-events:none">
        <div style="width:2px;height:100%;background:var(--rd);flex-shrink:0"></div>
        <div style="background:var(--rd);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:0 4px 4px 0;white-space:nowrap;font-family:var(--mono);letter-spacing:0.02em">DATA DATE ${fmt(S.P.dataDate)} ${wkL(S.P.dataDate)}</div>
       </div>
       <!-- Window start marker -->
       <div style="position:absolute;left:${wsX}px;top:0;bottom:0;display:flex;align-items:center;z-index:15;pointer-events:none">
        <div style="width:2px;height:100%;background:var(--pu);flex-shrink:0"></div>
        <div style="background:var(--pu);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:0 4px 4px 0;white-space:nowrap;font-family:var(--mono);letter-spacing:0.02em">WINDOW START ${fmt(wStart())} ${wkL(wStart())}</div>
       </div>
       <!-- Window end marker -->
       <div style="position:absolute;left:${weX}px;top:0;bottom:0;display:flex;align-items:center;z-index:15;pointer-events:none">
        <div style="width:2px;height:100%;background:rgba(109,40,217,.5);border-style:dashed;flex-shrink:0"></div>
        <div style="background:var(--pu-l);color:var(--pu);border:1px solid var(--pu-b);font-size:9px;font-weight:700;padding:2px 6px;border-radius:0 4px 4px 0;white-space:nowrap;font-family:var(--mono);letter-spacing:0.02em">WINDOW END ${fmt(wEnd())} ${wkL(wEnd())}</div>
       </div>
      </div>
     </div>
     <div style="position:relative">
      <svg id="g-svg" style="position:absolute;top:0;left:${LBL_W}px;pointer-events:none;z-index:40;overflow:visible" width="${totW}" height="${sched.length*ROW_H}">
       <defs><marker id="arr" markerWidth="7" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,7 3,0 6" fill="#8b5cf6" opacity=".7"/></marker></defs>${arrows}
      </svg>
      ${sched.length===0?`<div class="g-empty" style="margin-left:${LBL_W}px"><div style="font-size:28px;opacity:.25;margin-bottom:10px">📅</div><div style="font-size:13px;font-weight:500">Drag tasks from the sidebar to schedule them</div></div>`:rows}
     </div>
    </div>
   </div>
  </div>
 </div>`;
}

/* === GANTT DRAG (bug-fixed) === */
function barDn(e,id,resize){
 e.preventDefault();e.stopPropagation();
 const t=S.tasks.find(x=>x.id===id);if(!t)return;
 GD={on:true,resize,id,x0:e.clientX,s0:t.startDate,f0:t.finishDate,moved:false};
 document.addEventListener('mousemove',barMv);
 document.addEventListener('mouseup',barUp);
}
function barMv(e){
 if(!GD.on)return;const dx=e.clientX-GD.x0;
 if(Math.abs(dx)<4&&!GD.moved)return;
 GD.moved=true;
 const daysDelta=Math.round(dx/WW*7);
 const ns=GD.resize?GD.s0:addD(GD.s0,daysDelta);
 const nf=addD(GD.f0,daysDelta);
 if(!ns||!nf)return;
 const bar=document.getElementById('bar-'+GD.id);if(!bar)return;
 const nx=d2x(ns),nw=Math.max(WW-4,d2x(GD.resize?nf:addD(GD.f0,daysDelta))-nx);
 if(!GD.resize)bar.style.left=nx+'px';
 bar.style.width=Math.max(20,nw)+'px';
 bar.classList.add('drag');
 const tip=document.getElementById('g-tip');
 if(tip){tip.style.display='block';tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY-40)+'px';
  tip.textContent=`${fmt(ns)} → ${fmt(GD.resize?nf:addD(GD.f0,daysDelta))} · ${Math.abs(daysB(ns,GD.resize?nf:addD(GD.f0,daysDelta)))}d`}
}
function barUp(e){
 if(!GD.on)return;
 document.removeEventListener('mousemove',barMv);document.removeEventListener('mouseup',barUp);
 const tip=document.getElementById('g-tip');if(tip)tip.style.display='none';
 const wasMoved=GD.moved,barId=GD.id,isResize=GD.resize,s0=GD.s0,f0=GD.f0,x0=GD.x0;
 if(wasMoved){
  const dx=e.clientX-x0,dD=Math.round(dx/WW*7);
  const ns=isResize?s0:addD(s0,dD),nf=addD(f0,dD);
  if(ns&&nf)S.tasks=S.tasks.map(t=>t.id===barId?{...t,startDate:ns,finishDate:nf}:t);
 }
 const bar=document.getElementById('bar-'+barId);if(bar)bar.classList.remove('drag');
 GD={on:false};
 if(!wasMoved)editBar(barId);
 else{saveCurrentProject();renderTab();}
}

/* Sidebar drag — fixed: reset ucId on dragend */
function ucDrag(e){ucId=e.currentTarget.dataset.id;e.dataTransfer.effectAllowed='move';e.currentTarget.style.opacity='.4'}
function gDrop(e){
 e.preventDefault();
 if(!ucId)return;
 const area=document.getElementById('g-area');
 const rect=area.getBoundingClientRect();
 const x=e.clientX-rect.left+area.scrollLeft-LBL_W;
 const dd=x2d(Math.max(0,x));
 if(dd)openSchedML(ucId,dd);
 ucId=null;document.querySelectorAll('.uc').forEach(el=>el.style.opacity='1');
}

/* === SCHEDULE DIALOG === */
function openSchedML(id,startStr){
 const t=S.tasks.find(x=>x.id===id);if(!t)return;
 const sd=startStr||S.P.dataDate,fd=addW(sd,1);
 const others=S.tasks.filter(x=>x.id!==id&&x.onGantt&&x.startDate);
 openML(`<div class="ml-hdr"><div class="ml-t">📅 Schedule Task</div><button class="ml-x" onclick="closeML()">✕</button></div>
 <div class="ml-body">
  <div style="background:var(--pu-l);border:1px solid var(--pu-b);border-radius:9px;padding:12px 14px;margin-bottom:16px">
   <div style="font-size:15px;font-weight:700;letter-spacing:-0.02em;color:var(--tx)">${t.name}</div>
   <div style="font-size:11.5px;color:var(--pu);font-weight:500;margin-top:2px">${t.id} · ${t.wbs} · ${t.trade}${t.zone?' · '+t.zone:''}</div>
  </div>
  <div class="fg3 mb12">
   <div class="fg"><label class="flbl">Start Date ★</label><input class="fi" id="sd-s" type="date" value="${sd}" oninput="sdSyn()"></div>
   <div class="fg"><label class="flbl">Duration (weeks)</label><input class="fi" id="sd-dur" type="number" value="1" min="1" oninput="sdSynF()"></div>
   <div class="fg"><label class="flbl">Finish Date ★</label><input class="fi" id="sd-f" type="date" value="${fd}" oninput="sdSyn()"></div>
  </div>
  <div id="sd-info" style="font-family:var(--mono);font-size:12px;font-weight:600;color:var(--pu);padding:8px 12px;background:var(--pu-l);border-radius:7px;margin-bottom:14px;letter-spacing:-0.01em"></div>
  <div class="fg2 mb12">
   <div class="fg"><label class="flbl">Assignee</label><input class="fi" id="sd-asgn" value="${t.assignee||''}"></div>
   <div class="fg"><label class="flbl">Hours</label><input class="fi" id="sd-hrs" type="number" value="${t.hours||8}"></div>
  </div>
  <div class="fg mb12"><label class="flbl">Constraint / Blocker</label><input class="fi" id="sd-con" value="${t.constraint||''}" placeholder="Describe any blocker — leave blank if none"></div>
  <div class="fg"><label class="flbl">Predecessors — select to draw dependency arrows</label>
   <div style="max-height:160px;overflow-y:auto;border:1px solid var(--bd2);border-radius:8px;background:#fff">
    ${others.length?others.map(o=>`<label style="display:flex;gap:9px;align-items:flex-start;padding:7px 10px;cursor:pointer;border-bottom:1px solid #f3f4f6;transition:.1s" onmouseenter="this.style.background='#f5f3ff'" onmouseleave="this.style.background=''">
     <input type="checkbox" value="${o.id}" ${(t.pred||[]).includes(o.id)?'checked':''} style="accent-color:var(--pu);width:14px;height:14px;flex-shrink:0;margin-top:2px">
     <div><div style="font-size:11.5px;font-weight:600;color:var(--tx);letter-spacing:-0.01em">${o.name.substring(0,46)}</div><div style="font-size:10px;color:var(--tx3);font-family:var(--mono)">${o.id} · ${fmt(o.startDate)} → ${fmt(o.finishDate)}</div></div>
    </label>`).join(''):`<div style="padding:12px;text-align:center;color:var(--tx4);font-size:12.5px">No other tasks on Gantt yet</div>`}
   </div>
  </div>
 </div>
 <div class="ml-ftr"><button class="btn btn-gh" onclick="closeML()">Cancel</button><button class="btn btn-pr" onclick="confSched('${id}')">Add to Gantt →</button></div>`);
 setTimeout(sdSyn,50);
}
function sdSyn(){
 const s=document.getElementById('sd-s')?.value,f=document.getElementById('sd-f')?.value;if(!s||!f)return;
 const d=daysB(s,f);const dur=document.getElementById('sd-dur');if(dur)dur.value=Math.max(1,Math.round(d/7));
 const info=document.getElementById('sd-info');if(info)info.textContent=`${d} days · ${wkL(s)} → ${wkL(f)} · ${fmt(s)} – ${fmt(f)}`;
}
function sdSynF(){
 const s=document.getElementById('sd-s')?.value,d=+document.getElementById('sd-dur')?.value||1;
 if(!s)return;const f=addD(s,d*7);const el=document.getElementById('sd-f');if(el)el.value=f;sdSyn();
}
function confSched(id){
 const s=document.getElementById('sd-s')?.value,f=document.getElementById('sd-f')?.value;
 if(!s||!f){toast('Enter both Start Date and Finish Date','ng');return}
 const preds=[...document.querySelectorAll('#ml-bx input[type=checkbox]:checked')].map(c=>c.value);
 S.tasks=S.tasks.map(t=>t.id===id?{...t,onGantt:true,startDate:s,finishDate:f,pred:preds,
  assignee:document.getElementById('sd-asgn')?.value||t.assignee,
  hours:+document.getElementById('sd-hrs')?.value||t.hours,
  constraint:document.getElementById('sd-con')?.value||'',
  ready:!(document.getElementById('sd-con')?.value)}:t);
 closeML();renderTab();
 setTimeout(()=>{const a=document.getElementById('g-area');if(a)a.scrollLeft=Math.max(0,d2x(s)-120)},80);
}
function editBar(id){
 const t=S.tasks.find(x=>x.id===id);if(!t)return;
 const others=S.tasks.filter(x=>x.id!==id&&x.onGantt&&x.startDate);
 const dur=Math.max(1,Math.round(daysB(t.startDate,t.finishDate)/7));
 openML(`<div class="ml-hdr"><div class="ml-t">✏️ ${t.name.substring(0,30)}</div><button class="ml-x" onclick="closeML()">✕</button></div>
 <div class="ml-body">
  <div class="fg3 mb12">
   <div class="fg"><label class="flbl">Start Date</label><input class="fi" id="sd-s" type="date" value="${t.startDate||''}" oninput="sdSyn()"></div>
   <div class="fg"><label class="flbl">Duration (wks)</label><input class="fi" id="sd-dur" type="number" value="${dur}" min="1" oninput="sdSynF()"></div>
   <div class="fg"><label class="flbl">Finish Date</label><input class="fi" id="sd-f" type="date" value="${t.finishDate||''}" oninput="sdSyn()"></div>
  </div>
  <div id="sd-info" style="font-family:var(--mono);font-size:12px;font-weight:600;color:var(--pu);padding:8px 12px;background:var(--pu-l);border-radius:7px;margin-bottom:14px"></div>
  <div class="fg2 mb12">
   <div class="fg"><label class="flbl">Assignee</label><input class="fi" id="sd-asgn" value="${t.assignee||''}"></div>
   <div class="fg"><label class="flbl">Hours</label><input class="fi" id="sd-hrs" type="number" value="${t.hours||8}"></div>
  </div>
  <div class="fg mb12"><label class="flbl">Constraint</label><input class="fi" id="sd-con" value="${t.constraint||''}" placeholder="Blank if none"></div>
  <div class="fg mb12"><label class="flbl">Status</label><div style="display:flex;gap:6px">
   ${[['promised','Planned','#6366f1'],['done','Done ✓','var(--gn)'],['at-risk','At Risk','var(--am)'],['not-done','Not Done','var(--rd)']].map(([k,l,c])=>`<button style="flex:1;padding:8px 4px;border-radius:7px;border:1.5px solid ${t.wwp===k?c:'var(--bd2)'};background:${t.wwp===k?c+'18':'#fff'};color:${t.wwp===k?c:'var(--tx3)'};font-weight:${t.wwp===k?700:500};cursor:pointer;font-family:var(--font);font-size:12px;transition:.15s" onclick="S.tasks=S.tasks.map(x=>x.id==='${id}'?{...x,wwp:'${k}'}:x)">${l}</button>`).join('')}
  </div></div>
  <div class="fg"><label class="flbl">Predecessors</label>
   <div style="max-height:140px;overflow-y:auto;border:1px solid var(--bd2);border-radius:8px">
    ${others.length?others.map(o=>`<label style="display:flex;gap:8px;align-items:center;padding:6px 10px;cursor:pointer;border-bottom:1px solid #f3f4f6;transition:.1s" onmouseenter="this.style.background='#f5f3ff'" onmouseleave="this.style.background=''">
     <input type="checkbox" value="${o.id}" ${(t.pred||[]).includes(o.id)?'checked':''} style="accent-color:var(--pu)">
     <div><div style="font-size:12px;font-weight:600">${o.name.substring(0,42)}</div><div style="font-size:10px;color:var(--tx3);font-family:var(--mono)">${o.id}</div></div>
    </label>`).join(''):'<div style="padding:12px;text-align:center;color:var(--tx4);font-size:12.5px">No other tasks</div>'}
   </div>
  </div>
 </div>
 <div class="ml-ftr">
  <button class="btn btn-rd btn-sm" onclick="rmBar('${id}')">Remove from Gantt</button>
  <div class="mla fc" style="gap:7px"><button class="btn btn-gh" onclick="closeML()">Cancel</button><button class="btn btn-pr" onclick="saveBar('${id}')">Save Changes</button></div>
 </div>`);
 setTimeout(sdSyn,50);
}
function saveBar(id){
 const s=document.getElementById('sd-s')?.value,f=document.getElementById('sd-f')?.value;
 const preds=[...document.querySelectorAll('#ml-bx input[type=checkbox]:checked')].map(c=>c.value);
 S.tasks=S.tasks.map(t=>t.id===id?{...t,startDate:s,finishDate:f,pred:preds,
  assignee:document.getElementById('sd-asgn')?.value||t.assignee,
  hours:+document.getElementById('sd-hrs')?.value||t.hours,
  constraint:document.getElementById('sd-con')?.value||''}:t);
 closeML();renderTab();
}
function rmBar(id){
 const t=S.tasks.find(x=>x.id===id);
 if(!t)return;
 openML(`<div class="ml-hdr"><div class="ml-t">Remove Task</div><button class="ml-x" onclick="closeML()">✕</button></div>
 <div class="ml-body"><p style="font-size:14px;line-height:1.6;color:var(--tx2)">Remove <strong>${t.name}</strong> from the Gantt?<br>It returns to the unscheduled sidebar with dates cleared.</p></div>
 <div class="ml-ftr"><button class="btn btn-gh" onclick="closeML()">Cancel</button><button class="btn btn-rd" data-rmid="${id}" onclick="doRmBar(this.dataset.rmid)">Remove from Gantt</button></div>`);
}
function doRmBar(id){S.tasks=S.tasks.map(t=>t.id===id?{...t,onGantt:false,startDate:null,finishDate:null}:t);closeML();toast('Task removed from Gantt','ok');renderTab()}
function addBlank(){const id='T-'+String(S.tasks.length+1).padStart(2,'0');S.tasks.push({id,wbs:'',name:'New Task',trade:'Civil',zone:'',startDate:null,finishDate:null,onGantt:false,wwp:'promised',pred:[],constraint:'',ready:false,assignee:'',hours:8,rncCode:'',L:2,I:2});renderTab();setTimeout(()=>openSchedML(id,S.P.dataDate),100)}
function recalc(){
 if(!AUTH.canOp('recalc')){toast('Monthly op limit reached','ng');return}
 const sc=S.tasks.filter(t=>t.onGantt&&t.startDate&&t.finishDate);
 for(let p=0;p<15;p++)sc.forEach(t=>{
  if(!t.pred||!t.pred.length)return;
  let mx=null;
  t.pred.forEach(pid=>{const pr=S.tasks.find(x=>x.id===pid&&x.onGantt&&x.finishDate);if(pr&&(!mx||pd(pr.finishDate)>pd(mx)))mx=pr.finishDate});
  if(mx&&pd(t.startDate)<=pd(mx)){const dur=daysB(t.startDate,t.finishDate);t.startDate=addD(mx,1);t.finishDate=addD(t.startDate,dur)}
 });
 AUTH.useOp('recalc');S.tasks=[...S.tasks];renderTab();
}
/* ============================================
   BOARD VIEW
============================================ */
function rBoard(){
 const wt=wTasks();const dn=wt.filter(t=>t.wwp==='done').length,nd=wt.filter(t=>t.wwp==='not-done').length,ar=wt.filter(t=>t.wwp==='at-risk').length,pr=wt.filter(t=>t.wwp==='promised').length;
 const ppc=dn+nd>0?Math.round(dn/(dn+nd)*100):null;const pt=S.SET.ppcTarget;
 const pC=ppc!==null&&ppc>=0?(ppc>=pt?'var(--gn)':ppc>=(pt-20)?'var(--am)':'var(--rd)'):'var(--tx4)';
 const cols=[
  {k:'promised',l:`COMMITTED · ${wkL(wStart())}`,c:'#6366f1',bg:'#eef2ff',d:'Tasks in planning window'},
  {k:'done',l:'✓ DONE',c:'var(--gn)',bg:'var(--gn-l)',d:'Completed successfully'},
  {k:'at-risk',l:'⚠ AT RISK',c:'var(--am)',bg:'var(--am-l)',d:'Needs immediate action'},
  {k:'not-done',l:'✗ NOT DONE',c:'var(--rd)',bg:'var(--rd-l)',d:'RNC code required'},
 ];
 return`
 <div class="ppc-g">
  <div style="flex-shrink:0;text-align:center;min-width:88px">
   <div class="ppc-num" style="font-size:46px;color:${pC}">${ppc!==null?ppc+'%':'—'}</div>
   <div class="ppc-lbl">${S.win}-wk Window PPC</div>
  </div>
  <div class="ppc-area">
   <div style="font-size:10.5px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:2px">Percent Plan Complete — Target: ${pt}%</div>
   <div class="ppc-track">
    <div class="ppc-fill" style="width:${ppc||0}%;background:${ppc!==null?(ppc>=pt?'linear-gradient(90deg,#059669,#10b981)':ppc>=(pt-20)?'linear-gradient(90deg,#b45309,#d97706)':'linear-gradient(90deg,#b91c1c,#dc2626)'):'#e5e7eb'}"></div>
    <div style="position:absolute;top:-5px;bottom:-5px;width:2.5px;left:${pt}%;background:var(--pu);border-radius:2px">
     <div style="position:absolute;bottom:calc(100%+3px);left:50%;transform:translateX(-50%);font-size:9px;font-weight:700;color:var(--pu);white-space:nowrap;font-family:var(--mono)">${pt}%</div>
    </div>
   </div>
   <div class="ppc-stats">${[['Committed',wt.length,'#6366f1'],['Done',dn,'var(--gn)'],['At Risk',ar,'var(--am)'],['Not Done',nd,'var(--rd)'],['Pending',pr,'#9ca3af']].map(([l,v,c])=>`<div><div class="ppc-sv" style="color:${c}">${v}</div><div class="ppc-sl">${l}</div></div>`).join('')}</div>
  </div>
  <div style="flex-shrink:0;background:var(--pu-l);border:1px solid var(--pu-b);border-radius:10px;padding:12px 16px;text-align:center">
   <div style="font-size:9.5px;font-weight:600;color:var(--pu);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:3px">Target</div>
   <div style="font-size:30px;font-weight:800;color:var(--pu);letter-spacing:-0.03em;line-height:1">${pt}%</div>
   <button class="btn btn-gh btn-sm" style="margin-top:8px;font-size:10px" onclick="ST('settings')">Edit ⚙</button>
  </div>
 </div>
 ${wt.length===0?`<div class="ib ib-wr mb12"><div class="ib-ico">⚠️</div><div>No tasks fall within the ${S.win}-week window (<strong>${fmt(wStart())} → ${fmt(wEnd())}</strong>). Schedule tasks on the Gantt with dates in this range, or move the data date.</div></div>`:''}
 <div class="kb">
  ${cols.map(({k,l,c,bg,d})=>{const col=wt.filter(t=>t.wwp===k);return`<div class="kc">
   <div class="kc-hdr" style="background:${bg};border:1px solid ${c}28;border-bottom:none;border-radius:10px 10px 0 0">
    <div class="kc-t" style="color:${c}">${l}</div>
    <div class="kc-s" style="color:${c}">${d} · ${col.length} task${col.length!==1?'s':''}</div>
   </div>
   <div class="kc-body" data-wwp="${k}" ondragover="event.preventDefault();this.classList.add('dov')" ondragleave="this.classList.remove('dov')" ondrop="dropWWP(event,this)">
    ${col.length===0?'<div style="text-align:center;padding:20px 8px;color:var(--tx4);font-size:12.5px;font-style:italic">Drag tasks here</div>':col.map(t=>tCard(t)+(k==='not-done'&&!t.rncCode?`<div style="cursor:pointer;margin:-4px 0 6px;padding:4px 10px;background:var(--rd-l);border:1px solid var(--rd-b);border-radius:0 0 6px 6px;font-size:11px;font-weight:600;color:var(--rd)" onclick="pickRNC('${t.id}')">Tap to assign RNC code →</div>`:'') ).join('')}
   </div>
  </div>`}).join('')}
 </div>
 <div style="padding:11px 14px;background:#f9fafb;border:1px solid var(--bd);border-radius:8px;font-size:12px;color:var(--tx3);margin-top:12px">
  <strong style="color:var(--tx);font-weight:600">RNC codes:</strong> ${Object.entries(RNC).map(([k,v])=>`<strong style="color:var(--tx2);font-weight:600">${k}</strong> = ${v}`).join(' · ')}
 </div>`;
}

/* ---- block break ---- */

/* ============================================
   DASHBOARD
============================================ */
function rDash(){
 const wt=wTasks();const dn=wt.filter(t=>t.wwp==='done').length,nd=wt.filter(t=>t.wwp==='not-done').length;
 const lPPC=dn+nd>0?Math.round(dn/(dn+nd)*100):-1;
 const validPpc=S.ppc.filter(w=>w.planned>0);
 const allP=[...validPpc.map(w=>({l:w.lbl,v:Math.min(100,Math.round(w.done/w.planned*100))})),...(lPPC>=0?[{l:wkL(S.P.dataDate),v:lPPC}]:[])];
 const avg=allP.length>0?Math.round(allP.reduce((a,b)=>a+b.v,0)/allP.length):0;
 const openC=S.constraints.filter(c=>c.status==='OPEN').length;
 const CELL=48,GAP=2,mW=5*CELL+4*GAP,mH=5*CELL+4*GAP;
 const zC=(l,i)=>{const s=l*i;return s>=S.SET.riskHigh?'#fee2e2':s>=S.SET.riskMed?'#fef3c7':s>=S.SET.riskLow?'#ede9fe':'#d1fae5'};
 const zB=(l,i)=>{const s=l*i;return s>=S.SET.riskHigh?'#dc2626':s>=S.SET.riskMed?'#d97706':s>=S.SET.riskLow?'#7c3aed':'#059669'};
 const dC=(l,i)=>{const s=l*i;return s>=S.SET.riskHigh?'#dc2626':s>=S.SET.riskMed?'#d97706':s>=S.SET.riskLow?'#8b5cf6':'#059669'};
 let cells='',dots='';
 for(let i=5;i>=1;i--)for(let l=1;l<=5;l++){const x=(l-1)*(CELL+GAP),y=(5-i)*(CELL+GAP);cells+=`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="4" fill="${zC(l,i)}" stroke="${zB(l,i)}" stroke-width="0.5"/><text x="${x+CELL/2}" y="${y+CELL/2+4}" text-anchor="middle" font-size="11" font-weight="600" fill="${zB(l,i)}" opacity=".5">${l*i}</text>`}
 const placed={};
 S.constraints.filter(c=>c.L&&c.I).forEach(c=>{
  const l=Math.max(1,Math.min(5,c.L)),im=Math.max(1,Math.min(5,c.I)),key=`${l}_${im}`;
  placed[key]=(placed[key]||0)+1;const off=(placed[key]-1)*13-6;
  const cx=(l-1)*(CELL+GAP)+CELL/2+off,cy=(5-im)*(CELL+GAP)+CELL/2;
  const res=c.status==='RESOLVED';
  dots+=`<circle cx="${cx}" cy="${cy}" r="11" fill="${dC(l,im)}" opacity="${res?.3:.92}" stroke="white" stroke-width="2" style="cursor:pointer" onclick="showCon('${c.id}')"/>
  <text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="9" font-weight="700" fill="white" pointer-events="none">${c.id.replace('C-','')}</text>`;
 });
 const xL=['1','2','3','4','5'].map((n,i)=>`<text x="${i*(CELL+GAP)+CELL/2}" y="${mH+14}" text-anchor="middle" font-size="10" font-weight="500" fill="#9ca3af">${n}</text>`).join('');
 const yL=['1','2','3','4','5'].map((n,i)=>`<text x="-5" y="${(4-i)*(CELL+GAP)+CELL/2+4}" text-anchor="end" font-size="10" font-weight="500" fill="#9ca3af">${n}</text>`).join('');

 return`
 <div class="krow k5 mb14">
  <div class="kpi" style="border-left-color:${lPPC>=S.SET.ppcTarget?'var(--gn)':'var(--rd)'}"><div class="kpi-l">PPC · ${S.win}-wk</div><div class="kpi-v" style="color:${lPPC>=S.SET.ppcTarget?'var(--gn)':'var(--rd)'}">${lPPC<0?'—':lPPC+'%'}</div><div class="kpi-s">${lPPC<0?'No data yet':lPPC>=S.SET.ppcTarget?'On target':'Below target'}</div></div>
  <div class="kpi" style="border-left-color:var(--bl)"><div class="kpi-l">${allP.length}-wk Avg</div><div class="kpi-v" style="color:var(--bl)">${avg}%</div><div class="kpi-s">Rolling average</div></div>
  <div class="kpi" style="border-left-color:var(--rd)"><div class="kpi-l">Open Constraints</div><div class="kpi-v" style="color:var(--rd)">${openC}</div><div class="kpi-s">${S.constraints.filter(c=>c.L*c.I>=S.SET.riskHigh&&c.status==='OPEN').length} critical</div></div>
  <div class="kpi" style="border-left-color:var(--pu)"><div class="kpi-l">In Window</div><div class="kpi-v" style="color:var(--pu)">${wt.length}</div><div class="kpi-s">${S.win}-wk tasks</div></div>
  <div class="kpi" style="border-left-color:var(--am)"><div class="kpi-l">Target PPC</div><div class="kpi-v" style="color:var(--am)">${S.SET.ppcTarget}%</div><div class="kpi-s"><a href="#" onclick="ST('settings');return false" style="color:var(--pu);font-size:11px;font-weight:500">Customise</a></div></div>
 </div>
 <div class="g2 mb14">
  <div class="ch-box">
   <div class="ch-t">PPC Trend vs Target</div>
   <div class="ch-s">Click legend items to show/hide · Dashed line = ${S.SET.ppcTarget}% benchmark</div>
   <canvas id="ch-ppc" height="185"></canvas>
  </div>
  <div class="ch-box">
   <div class="ch-t">Risk Matrix</div>
   <div class="ch-s">Likelihood × Impact · Click numbered dots for detail · Faded = resolved</div>
   <div style="display:flex;gap:14px;align-items:flex-start;margin-top:6px">
    <svg width="${mW+44}" height="${mH+24}" style="overflow:visible;flex-shrink:0">
     <g transform="translate(40,0)">${cells}${dots}${xL}${yL}
      <text x="${mW/2}" y="${mH+24}" text-anchor="middle" font-size="10" font-weight="500" fill="#9ca3af">Likelihood →</text>
      <text x="-32" y="${mH/2}" text-anchor="middle" transform="rotate(-90,-32,${mH/2})" font-size="10" font-weight="500" fill="#9ca3af">Impact ↑</text>
     </g>
    </svg>
    <div style="flex:1">
     <div style="font-size:10px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px">Risk Zones</div>
     ${[['CRITICAL',S.SET.riskHigh,25,'var(--rd)'],['HIGH',S.SET.riskMed,S.SET.riskHigh-1,'var(--am)'],['MEDIUM',S.SET.riskLow,S.SET.riskMed-1,'var(--pu)'],['LOW',1,S.SET.riskLow-1,'var(--gn)']].map(([l,lo,hi,c])=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="width:10px;height:10px;border-radius:50%;background:${c};flex-shrink:0"></div><span style="font-size:12px;font-weight:600;color:${c};min-width:58px">${l}</span><span style="font-size:11px;color:var(--tx3)">${lo}–${hi}</span></div>`).join('')}
     <div style="margin-top:10px;display:grid;gap:5px">
      ${S.constraints.filter(c=>c.status==='OPEN').sort((a,b)=>(b.L*b.I)-(a.L*a.I)).slice(0,4).map(c=>{const s=c.L*c.I,cl=s>=S.SET.riskHigh?'b-ng':s>=S.SET.riskMed?'b-wr':'b-pu';return`<div style="font-size:11.5px;padding:5px 8px;background:#f9fafb;border-radius:6px;cursor:pointer;border:1px solid var(--bd);transition:.15s" onmouseenter="this.style.borderColor='var(--pu-b)'" onmouseleave="this.style.borderColor='var(--bd)'" onclick="showCon('${c.id}')"><span class="bdg ${cl}" style="margin-right:5px">${c.id} · ${s}</span>${c.desc.substring(0,30)}</div>`}).join('')}
     </div>
    </div>
   </div>
  </div>
 </div>
 <div class="ch-box">
  <div class="ch-t">Root Cause Analysis (RNC Pareto)</div>
  <div class="ch-s">Reasons for non-completion sorted by frequency — informs constraint prevention strategy</div>
  <canvas id="ch-rnc" height="110"></canvas>
 </div>`;
}
function showCon(id){
 const c=S.constraints.find(x=>x.id===id);if(!c)return;const s=c.L*c.I;
 openML(`<div class="ml-hdr"><div class="ml-t">${c.id} — Risk Detail</div><button class="ml-x" onclick="closeML()">✕</button></div>
 <div class="ml-body">
  <p style="font-size:15px;font-weight:700;letter-spacing:-0.02em;margin-bottom:14px">${c.desc}</p>
  <div class="fg3 mb14">
   <div style="text-align:center;background:#eff6ff;border:1px solid #bfdbfe;border-radius:9px;padding:12px"><div style="font-size:28px;font-weight:800;letter-spacing:-0.03em;color:var(--bl)">${c.L}</div><div style="font-size:10px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:0.07em">Likelihood</div></div>
   <div style="text-align:center;background:var(--rd-l);border:1px solid var(--rd-b);border-radius:9px;padding:12px"><div style="font-size:28px;font-weight:800;letter-spacing:-0.03em;color:var(--rd)">${c.I}</div><div style="font-size:10px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:0.07em">Impact</div></div>
   <div style="text-align:center;background:${s>=S.SET.riskHigh?'var(--rd-l)':s>=S.SET.riskMed?'var(--am-l)':'var(--pu-l)'};border:1px solid ${s>=S.SET.riskHigh?'var(--rd-b)':s>=S.SET.riskMed?'var(--am-b)':'var(--pu-b)'};border-radius:9px;padding:12px"><div style="font-size:28px;font-weight:800;letter-spacing:-0.03em;color:${s>=S.SET.riskHigh?'var(--rd)':s>=S.SET.riskMed?'var(--am)':'var(--pu)'}">${s}</div><div style="font-size:10px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:0.07em">Score</div></div>
  </div>
  <div class="fg3"><div class="fg"><label class="flbl">Likelihood (1–5)</label><input class="fi" id="rl" type="number" value="${c.L}" min="1" max="5"></div><div class="fg"><label class="flbl">Impact (1–5)</label><input class="fi" id="ri" type="number" value="${c.I}" min="1" max="5"></div><div class="fg"><label class="flbl">Status</label><select class="fs" id="rs"><option ${c.status==='OPEN'?'selected':''}>OPEN</option><option value="IN PROGRESS" ${c.status==='IN PROGRESS'?'selected':''}>IN PROGRESS</option><option ${c.status==='RESOLVED'?'selected':''}>RESOLVED</option></select></div></div>
  <div class="fg"><label class="flbl">Description</label><input class="fi" id="rd" value="${c.desc}"></div>
  <div class="fg2"><div class="fg"><label class="flbl">Owner</label><input class="fi" id="ro" value="${c.owner||''}"></div><div class="fg"><label class="flbl">Due Date</label><input class="fi" id="rdu" type="date" value="${c.due||''}"></div></div>
 </div>
 <div class="ml-ftr"><button class="btn btn-gh" onclick="closeML()">Close</button><button class="btn btn-pr" onclick="saveCon('${id}')">Save Changes</button></div>`);
}
function saveCon(id){S.constraints=S.constraints.map(c=>c.id===id?{...c,L:+document.getElementById('rl').value,I:+document.getElementById('ri').value,status:document.getElementById('rs').value,desc:document.getElementById('rd')?.value||c.desc,owner:document.getElementById('ro')?.value||c.owner,due:document.getElementById('rdu')?.value||c.due}:c);closeML();renderTab()}

/* ============================================
   ARCHIVE VIEW
============================================ */
function rExport(){
 var isEmpty=S.tasks.length===0;
 var wt=wTasks();
 var dn=wt.filter(function(t){return t.wwp==='done';}).length;
 var nd=wt.filter(function(t){return t.wwp==='not-done';}).length;
 var ppc=dn+nd>0?Math.round(dn/(dn+nd)*100):0;
 var p=PROJECTS.get(S.activeProjectId);
 var arcs=(p&&p.archives)?p.archives.length:0;
 var u=AUTH.getUser();
 var plan=PLAN_DEF[u&&u.plan?u.plan:'free'];
 var arcLimit=plan.archives>=52?'unlimited':String(plan.archives);
 return '<div class="g2" style="gap:16px;align-items:start">'+
  '<div>'+
   '<div class="card mb12">'+
    '<div class="card-hdr"><div class="card-t">Export to Excel</div></div>'+
    '<div class="card-body">'+
     '<p style="font-size:13px;color:var(--tx2);line-height:1.6;margin-bottom:12px">Export all tasks, constraints and PPC history in the same template structure. Re-import next Monday to continue the planning cycle. Costs <strong>5 ops</strong>.</p>'+
     (isEmpty?'<div class="ib ib-wr mb12"><div class="ib-ico">!</div><div>Load or import project data first.</div></div>':
      '<div style="background:#f9fafb;border:1px solid var(--bd);border-radius:8px;padding:11px 14px;margin-bottom:14px;font-size:12.5px;color:var(--tx2)">'+
      '<strong>'+S.tasks.length+' tasks</strong> &nbsp;&middot;&nbsp; <strong>'+S.constraints.length+' constraints</strong> &nbsp;&middot;&nbsp; <strong>'+S.ppc.length+' PPC weeks</strong><br>'+
      '<span style="color:var(--tx3);font-size:12px">Data Date: '+fmt(S.P.dataDate)+' &nbsp;('+wkL(S.P.dataDate)+')</span></div>')+
     '<button class="btn btn-ok btn-fw btn-xl" onclick="doExport()" style="font-size:15px;padding:13px" '+(isEmpty?'disabled':'')+'>Export to Excel (.xlsx)</button>'+
    '</div>'+
   '</div>'+
   '<div class="card">'+
    '<div class="card-hdr"><div class="card-t">Archive This Week</div></div>'+
    '<div class="card-body">'+
     '<p style="font-size:13px;color:var(--tx2);line-height:1.6;margin-bottom:12px">Save a permanent weekly snapshot. Archive every Friday. Costs <strong>25 ops</strong>.</p>'+
     '<button class="btn btn-pu btn-fw btn-lg" onclick="doArchiveNow()" '+(isEmpty?'disabled':'')+'>Archive Week '+wkL(S.P.dataDate)+' &mdash; '+fmt(S.P.dataDate)+'</button>'+
     '<div style="margin-top:10px;font-size:12px;color:var(--tx3)">'+arcs+' / '+arcLimit+' archives used &nbsp;&middot;&nbsp; <span style="cursor:pointer;color:var(--pu);text-decoration:underline" onclick="ST(String.fromCharCode(97,114,99,104,105,118,101))">View history</span></div>'+
    '</div>'+
   '</div>'+
  '</div>'+
  '<div>'+
   (ppc>0?
    '<div class="card mb12">'+
     '<div class="card-hdr"><div class="card-t">Current Window PPC</div></div>'+
     '<div class="card-body" style="text-align:center;padding:24px">'+
      '<div style="font-size:56px;font-weight:800;letter-spacing:-.04em;color:'+(ppc>=S.SET.ppcTarget?'var(--gn)':'var(--rd)')+'">'+ppc+'%</div>'+
      '<div style="font-size:13px;color:var(--tx3);margin-top:4px">'+S.win+'-week window &middot; Target '+S.SET.ppcTarget+'%</div>'+
      '<div style="height:8px;background:#e5e7eb;border-radius:4px;margin:14px 0;overflow:hidden"><div style="width:'+Math.min(100,ppc)+'%;height:100%;background:'+(ppc>=S.SET.ppcTarget?'var(--gn)':'var(--rd)')+';border-radius:4px"></div></div>'+
      '<div style="font-size:12.5px;color:var(--tx3)">'+dn+' done / '+(dn+nd)+' committed</div>'+
     '</div>'+
    '</div>':'') +
   '<div class="card">'+
    '<div class="card-hdr"><div class="card-t">Weekly Workflow</div></div>'+
    '<div class="card-body" style="font-size:12.5px;color:var(--tx2)">'+
     '<div style="display:flex;flex-direction:column;gap:10px">'+
      [['Friday PM','Update all board statuses and assign RNC codes to every Not Done task.'],
       ['Friday PM','Archive this week using the button on the left.'],
       ['Friday PM','Export to Excel and distribute to site teams.'],
       ['Monday AM','Re-import the exported file to continue tracking.']].map(function(row,i){
       return '<div style="display:flex;gap:10px;align-items:flex-start">'+
        '<div style="width:22px;height:22px;border-radius:50%;background:var(--grad);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">'+(i+1)+'</div>'+
        '<div><div style="font-weight:600;color:var(--tx);font-size:12px">'+row[0]+'</div><div style="color:var(--tx3);margin-top:1px">'+row[1]+'</div></div></div>';}).join('')+
     '</div>'+
    '</div>'+
   '</div>'+
  '</div>'+
 '</div>';
}

function rArchive(){
 const p=PROJECTS.get(S.activeProjectId);
 const arcs=(p?.archives||[]).slice().reverse();
 const u=AUTH.getUser();const plan=PLAN_DEF[u?.plan||'free'];
 return`
 <div class="g2" style="gap:16px;align-items:start">
  <div>
   <div class="ib ib-pu mb12"><div class="ib-ico">📦</div><div>Weekly archives are permanent snapshots of your project data. Each archive captures all tasks, constraints and PPC at that moment. <strong>${arcs.length} / ${plan.archives>=52?'∞':plan.archives} archives used.</strong></div></div>
   <div class="card mb12"><div class="card-hdr"><div class="card-t">📅 Archive Current Week</div></div>
    <div class="card-body">
     <p style="font-size:13px;color:var(--tx2);line-height:1.6;margin-bottom:12px">Saves a snapshot of the current project state — tasks, constraints, PPC. This costs <strong>25 ops</strong>. Archive at the end of each Friday.</p>
     <button class="btn btn-pu btn-fw btn-lg" onclick="doArchiveNow()">📦 Archive Week ${wkL(S.P.dataDate)} — ${fmt(S.P.dataDate)}</button>
    </div>
   </div>
   <div class="card"><div class="card-hdr"><div class="card-t">📋 Archive History</div></div>
    <div class="card-body" style="padding:12px">
     ${arcs.length===0?'<div style="text-align:center;padding:20px;color:var(--tx4);font-size:13px">No archives yet. Archive your first week to start the history.</div>':
      arcs.map((a,ai)=>`
      <div class="arc-row">
       <div><div class="arc-wk">${a.week}</div><div class="arc-dt">${fmt(a.date)}</div></div>
       <div style="flex:1">
        <div style="font-size:12.5px;font-weight:600;color:var(--tx)">${a.tasks} tasks · PPC <strong style="color:${(a.ppc||0)>=80?'var(--gn)':'var(--rd)'}">${a.ppc||'—'}%</strong></div>
        <div style="height:4px;background:#e5e7eb;border-radius:2px;margin-top:6px;overflow:hidden"><div style="width:${Math.min(100,a.ppc||0)}%;height:100%;background:${(a.ppc||0)>=80?'var(--gn)':'var(--rd)'};border-radius:2px"></div></div>
       </div>
       <button class="btn btn-gh btn-sm" data-arc-week="${a.week}" data-arc-date="${a.date}" onclick="restoreArchive(this)" style="font-size:11px">Restore</button>
      </div>`).join('')}
    </div>
   </div>
  </div>
  <div>
   <div class="card"><div class="card-hdr"><div class="card-t">📊 PPC History</div></div>
    <div class="card-body" style="padding:12px">
     ${S.ppc.length===0?'<div style="text-align:center;padding:20px;color:var(--tx4);font-size:13px">No PPC history yet. Import a file with PPC_History data or archive each week.</div>':
      [...S.ppc].reverse().slice(0,10).map(w=>{const ppc=w.planned>0?Math.min(100,Math.round(w.done/w.planned*100)):0;return`
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6">
       <span style="font-family:var(--mono);font-size:12px;font-weight:600;color:var(--tx);min-width:36px">${w.lbl}</span>
       <span style="font-size:11px;color:var(--tx3);min-width:70px">${fmt(w.startDate)}</span>
       <div style="flex:1;height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden"><div style="width:${ppc}%;height:100%;background:${ppc>=80?'var(--gn)':'var(--rd)'};border-radius:3px"></div></div>
       <span style="font-size:13px;font-weight:700;letter-spacing:-0.02em;color:${ppc>=80?'var(--gn)':'var(--rd)'};min-width:38px;text-align:right">${ppc}%</span>
      </div>`}).join('')}
    </div>
   </div>
  </div>
 </div>`;
}
function doArchiveNow(){
 const u=AUTH.getUser();const plan=PLAN_DEF[u?.plan||'free'];
 const p=PROJECTS.get(S.activeProjectId);const usedArcs=(p?.archives||[]).length;
 if(!AUTH.canOp('archive')){
  openML(`<div class="ml-hdr"><div class="ml-t">Op Limit Reached</div><button class="ml-x" onclick="closeML()">✕</button></div><div class="ml-body"><div class="ib ib-ng mb0"><div class="ib-ico">⚠️</div><div>Monthly operation limit reached. Upgrade your plan to archive more.</div></div></div><div class="ml-ftr"><button class="btn btn-pr" onclick="closeML()">OK</button></div>`);return;
 }
 if(usedArcs>=plan.archives){
  openML(`<div class="ml-hdr"><div class="ml-t">Archive Limit Reached</div><button class="ml-x" onclick="closeML()">✕</button></div><div class="ml-body"><div class="ib ib-wr mb0"><div class="ib-ico">📦</div><div>Your <strong>${plan.name}</strong> plan allows <strong>${plan.archives} archives</strong>. The oldest archive will be removed to make room for the new one.</div></div></div><div class="ml-ftr"><button class="btn btn-gh" onclick="closeML()">Cancel</button><button class="btn btn-pu" onclick="confArchive()">Archive Anyway</button></div>`);return;
 }
 confArchive();
}
function confArchive(){
 const wt=wTasks();const dn=wt.filter(t=>t.wwp==='done').length,nd=wt.filter(t=>t.wwp==='not-done').length;
 const ppc=dn+nd>0?Math.round(dn/(dn+nd)*100):0;
 const wk=wkL(S.P.dataDate);
 PROJECTS.archive(S.activeProjectId,wk,{ppc,tasks:S.tasks});
 AUTH.useOp('archive');saveCurrentProject();
 openML(`<div class="ml-hdr"><div class="ml-t">Week Archived ✓</div><button class="ml-x" onclick="closeML();renderTab()">✕</button></div>
 <div class="ml-body"><div class="ib ib-ok mb0" style="margin:0"><div class="ib-ico">✅</div><div><strong>${wk} (${fmt(S.P.dataDate)})</strong> archived with PPC <strong>${ppc}%</strong>.<br>This snapshot is saved permanently in your project.</div></div></div>
 <div class="ml-ftr"><button class="btn btn-pr" onclick="closeML();renderTab()">Done</button></div>`);
}
function restoreArchive(btn){
 const week=btn.dataset.arcWeek,date=btn.dataset.arcDate;
 const p=PROJECTS.get(S.activeProjectId);
 const arc=p?.archives?.find(a=>a.week===week&&a.date===date);
 if(!arc){toast('Archive not found','ng');return}
 openML(`<div class="ml-hdr"><div class="ml-t">Restore Archive</div><button class="ml-x" onclick="closeML()">✕</button></div>
 <div class="ml-body">
  <div class="ib ib-wr mb12"><div class="ib-ico">⚠️</div><div>This will replace your current tasks, constraints and PPC history with the <strong>${arc.week}</strong> snapshot (${fmt(arc.date)}). Unsaved changes will be lost.</div></div>
  <div style="background:#f9fafb;border:1px solid var(--bd);border-radius:8px;padding:12px;font-size:13px;color:var(--tx2)">
   <strong>Snapshot details:</strong> ${arc.tasks} tasks · PPC ${arc.ppc||'—'}%
  </div>
 </div>
 <div class="ml-ftr"><button class="btn btn-gh" onclick="closeML()">Cancel</button><button class="btn btn-rd" onclick="doRestore('${week}','${date}')">Restore this snapshot</button></div>`);
}
function doRestore(week,date){
 const p=PROJECTS.get(S.activeProjectId);
 const arc=p?.archives?.find(a=>a.week===week&&a.date===date);
 if(!arc){closeML();toast('Archive not found','ng');return}
 try{
  const d=JSON.parse(arc.snapshot);
  if(d.tasks)S.tasks=d.tasks;
  if(d.ppc)S.ppc=d.ppc;
  if(d.constraints)S.constraints=d.constraints;
  closeML();renderTab();
 }catch(e){closeML();toast('Restore failed: '+e.message,'ng');}
}

/* ============================================
   SETTINGS VIEW
============================================ */
function rSet(){return`
<div class="g2" style="gap:14px;align-items:start">
 <div>
  <div class="card mb12"><div class="card-hdr"><div class="card-t">🎯 Performance Targets</div></div><div class="card-body">
   <div class="srow"><div class="slbl"><div class="sname">PPC Target</div><div class="sdesc">Lean Construction Institute benchmark is 80%. Adjust to your team's commitment. Updates all gauges instantly.</div></div>
   <div class="range-wrap"><input type="range" min="50" max="100" step="5" value="${S.SET.ppcTarget}" oninput="S.SET.ppcTarget=+this.value;S.P.ppcTarget=+this.value;document.getElementById('rv-p').textContent=this.value+'%'"><div class="rv" id="rv-p">${S.SET.ppcTarget}%</div></div></div>
  </div></div>
  <div class="card"><div class="card-hdr"><div class="card-t">⚠️ Risk Matrix Thresholds</div></div><div class="card-body">
   <div class="ib ib-bl mb12" style="margin-bottom:14px"><div class="ib-ico">ℹ️</div><div style="font-size:12.5px">Risk Score = Likelihood × Impact (1–25). These thresholds define where each coloured zone begins on the Dashboard Risk Matrix.</div></div>
   ${[['riskLow','Medium zone starts at','Scores below this = Low (green)','rv-l'],['riskMed','High zone starts at','Below = Medium (purple)','rv-m'],['riskHigh','Critical zone starts at','Below = High (amber)','rv-h']].map(([k,n,d,rid])=>`<div class="srow"><div class="slbl"><div class="sname">${n}</div><div class="sdesc">${d}</div></div><div class="range-wrap"><input type="range" min="2" max="22" value="${S.SET[k]}" oninput="S.SET.${k}=+this.value;document.getElementById('${rid}').textContent=this.value"><div class="rv" style="font-size:17px" id="${rid}">${S.SET[k]}</div></div></div>`).join('')}
   <div style="display:flex;gap:6px;margin-top:12px">${[['Low','var(--gn)','1–'+(S.SET.riskLow-1)],['Medium','var(--pu)',S.SET.riskLow+'–'+(S.SET.riskMed-1)],['High','var(--am)',S.SET.riskMed+'–'+(S.SET.riskHigh-1)],['Critical','var(--rd)',S.SET.riskHigh+'–25']].map(([l,c,r])=>`<div style="flex:1;text-align:center;background:${c}14;border:1px solid ${c}40;border-radius:7px;padding:7px 4px"><div style="font-size:11px;font-weight:600;color:${c}">${l}</div><div style="font-size:10.5px;color:var(--tx2);margin-top:1px">${r}</div></div>`).join('')}</div>
  </div></div>
 </div>
 <div>
  <div class="card mb12"><div class="card-hdr"><div class="card-t">📅 Project Configuration</div></div><div class="card-body">
   <div class="fg"><label class="flbl">Project Name</label><input class="fi" value="${S.P.name||''}" onchange="S.P.name=this.value;updHdr()"></div>
   <div class="fg2"><div class="fg"><label class="flbl">Project Number</label><input class="fi" value="${S.P.num||''}" onchange="S.P.num=this.value"></div><div class="fg"><label class="flbl">General Contractor</label><input class="fi" value="${S.P.gc||''}" onchange="S.P.gc=this.value;updHdr()"></div></div>
   <div class="fg2">
    <div class="fg"><label class="flbl">Project Start Date (Week 1 start)</label><input class="fi" type="date" value="${S.P.startDate||''}" onchange="S.P.startDate=this.value;updHdr();renderTab()"><div style="font-size:11px;color:var(--tx3);margin-top:3px">Anchor for all week number calculations</div></div>
    <div class="fg"><label class="flbl">Data Date (Planning today)</label><input class="fi" type="date" value="${S.P.dataDate||''}" onchange="S.P.dataDate=this.value;updHdr();renderTab()"><div style="font-size:11px;color:var(--tx3);margin-top:3px">Shown as red marker on Gantt</div></div>
   </div>
   <div class="fg"><label class="flbl">Planning Window Size</label><div style="display:flex;gap:6px;margin-top:4px">${[4,6,8,12].map(w=>`<button style="flex:1;padding:9px;border-radius:7px;border:1.5px solid ${S.win===w?'var(--pu)':'var(--bd2)'};background:${S.win===w?'var(--pu)':'#fff'};color:${S.win===w?'#fff':'var(--tx2)'};font-weight:${S.win===w?700:500};cursor:pointer;font-family:var(--font);font-size:13px;transition:.15s" onclick="setWin(${w});renderTab()">${w} Weeks</button>`).join('')}</div></div>
   <button class="btn btn-ok btn-fw mt12" onclick="saveCurrentProject();toast('Settings saved','ok')">✓ Save Settings</button>
  </div></div>
  <div class="card"><div class="card-hdr"><div class="card-t">🔒 Constraints</div><button class="btn btn-pu btn-sm" onclick="addCon()">+ Add</button></div>
   <div style="max-height:260px;overflow-y:auto">
    ${S.constraints.map(c=>`<div style="display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid #f3f4f6;background:${c.status==='RESOLVED'?'var(--gn-l)':'#fff'};transition:.15s" onmouseenter="this.style.background='#f9fafb'" onmouseleave="this.style.background='${c.status==='RESOLVED'?'var(--gn-l)':'#fff'}'">
     <span style="font-family:var(--mono);font-size:10px;font-weight:600;color:var(--pu);min-width:30px">${c.id}</span>
     <span style="flex:1;font-size:12.5px;color:var(--tx);font-weight:400">${c.desc.substring(0,40)}</span>
     <span style="font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:5px;background:${c.L*c.I>=S.SET.riskHigh?'var(--rd-l)':c.L*c.I>=S.SET.riskMed?'var(--am-l)':'var(--pu-l)'};color:${c.L*c.I>=S.SET.riskHigh?'var(--rd)':c.L*c.I>=S.SET.riskMed?'var(--am)':'var(--pu)'}">${c.L}×${c.I}=${c.L*c.I}</span>
     <button class="btn btn-gh btn-sm" style="padding:3px 8px;font-size:11px" onclick="showCon('${c.id}')">Edit</button>
    </div>`).join('')}
   </div>
  </div>
 </div>
</div>`}
function addCon(){const id='C-'+String(S.constraints.length+1).padStart(2,'0');S.constraints.push({id,desc:'New constraint',linked:'',owner:'',due:'',L:2,I:2,status:'OPEN'});renderTab();setTimeout(()=>showCon(id),100)}

/* ============================================
   HELP VIEW
============================================ */
function rHelp(){return`
<div class="g2" style="gap:16px;align-items:start">
 <div>
  <div style="background:var(--grad);border-radius:14px;padding:20px 22px;margin-bottom:14px;color:#fff">
   <div style="font-size:22px;font-weight:800;letter-spacing:-0.03em;margin-bottom:6px">Last Planner System® Guide</div>
   <div style="font-size:13px;opacity:.9;line-height:1.6;font-weight:400">LPS is a lean construction planning method. It improves schedule reliability by replacing push-planning with a pull-based commitment system — teams only commit to work they are truly ready to start.</div>
  </div>
  <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
   ${[['1','↕️','Import','Load Excel data'],['2','📅','Gantt','Review & drag-plan'],['3','📋','Workshop','Commit with foremen'],['4','📊','Track daily','Update status'],['5','📦','Archive','Friday snapshot'],['6','📤','Export','Share & repeat']].map(([n,ico,t,d])=>`<div style="flex:1;min-width:80px;background:#fff;border:1px solid var(--bd);border-radius:10px;padding:12px 8px;text-align:center;box-shadow:var(--sh)">
    <div style="width:26px;height:26px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;margin:0 auto 5px">${n}</div>
    <div style="font-size:15px;margin-bottom:3px">${ico}</div>
    <div style="font-size:12px;font-weight:600;color:var(--tx);letter-spacing:-0.01em;margin-bottom:2px">${t}</div>
    <div style="font-size:10.5px;color:var(--tx3);font-weight:400;line-height:1.4">${d}</div>
   </div>`).join('')}
  </div>
  ${[['↕️ Import Tab','Your starting point every Monday. Download the template once, fill tasks with real calendar dates. The tool places tasks on the Gantt and calculates week numbers automatically from your Project Start Date.'],['📅 Gantt Schedule Tab','Master schedule view. <strong>Drag task chips</strong> from the sidebar into the timeline. <strong>Grab bars</strong> and drag left/right to reschedule. <strong>Drag the ⇔ handle</strong> on the right edge to extend duration. Arrows show predecessor links. The purple band = your planning window.'],['📋 Weekly Board','Daily tracking hub. Shows all tasks overlapping the planning window. Drag cards between status columns. <strong>Every Not Done card must have an RNC code</strong> — tap the red prompt below the card to assign.'],['📊 Dashboard Tab','Review PPC trend and risk profile. The Risk Matrix plots each constraint by Likelihood × Impact — click numbered dots to edit risk ratings and track resolution. RNC Pareto shows top failure causes.'],['📦 Archives Tab','Create weekly snapshots of the complete project state. Archives are stored permanently in your project (up to your plan limit). Restore any past week for reference.'],['⚙️ Settings Tab','Adjust PPC target and risk zone thresholds with sliders — changes update the Dashboard immediately. Set or correct Project Start Date and Data Date.']].map(([t,d],i)=>`<div class="hs"><div class="hs-n">${i+1}</div><div><div class="hs-t">${t}</div><div class="hs-d">${d}</div></div></div>`).join('')}
 </div>
 <div>
  <div style="font-size:10.5px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px">LPS Glossary</div>
  ${[['Project Start Date','The calendar date of Week 1. All week numbers are calculated from this anchor. Set in the Excel template and in Settings → Project Configuration.'],['Data Date','Your planning "today" — the red marker on the Gantt. Move it weekly using the ‹ WK XX › navigator in the header. Also adjustable in Settings.'],['Planning Window','The active lookahead (4/6/8/12 weeks). Tasks within this window appear on the Board. The purple boundary on the Gantt marks both edges with date labels.'],['PPC — Percent Plan Complete','Completed ÷ Committed × 100%. The primary reliability metric. Target = 80%+ consistently. Low PPC means the plan is unreliable — use RNC Pareto to find root causes.'],['Constraint','Any blocker preventing a task starting — late design, missing material, unavailable equipment. Every constraint needs an owner, removal date, and Likelihood/Impact rating.'],['RNC Code','Reason for Non-Completion. DES=Design, MAT=Material, LAB=Labour, EQP=Equipment, WEA=Weather, PRE=Predecessor, OTH=Other. Collected weekly for Pareto analysis.'],['Risk Score','Likelihood (1–5) × Impact (1–5). Range 1–25. Plotted on the Risk Matrix. Critical scores (≥16 by default) need immediate PM escalation.'],['Predecessor Link','Task dependency shown as an arrow on the Gantt. Select predecessors in the schedule dialog. Use Recalc Dependencies to auto-shift dates based on the chain.']].map(([t,d])=>`<div class="gt"><div class="gt-n">${t}</div><div class="gt-d">${d}</div></div>`).join('')}
  <div style="background:#f9fafb;border-radius:10px;padding:14px;margin-top:10px;border:1px solid var(--bd)">
   <div style="font-size:10.5px;font-weight:600;color:var(--tx3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px">Pro Tips</div>
   ${[['Before Monday meeting','Pre-import the latest data file. Check Dashboard for open constraints. Identify talking points before the team arrives.'],['During pull planning','Show Gantt on the screen. Only accept commitments where Ready = YES. Drag bars together with foremen to align the window.'],['Friday afternoon','Update all Board statuses. Assign RNC codes to every Not Done. Archive, export, and distribute to site teams.'],['PPC trending below 70%','Run a constraint root-cause workshop. Use the RNC Pareto chart to target the top 1–2 failure categories systematically.']].map(([t,d])=>`<div style="margin-bottom:9px"><div style="font-size:12.5px;font-weight:600;color:var(--tx);letter-spacing:-0.01em">${t}</div><div style="font-size:12.5px;color:var(--tx2);line-height:1.5;margin-top:2px;font-weight:400">${d}</div></div>`).join('')}
  </div>
 </div>
</div>`}

/* ============================================
   TASK CARD
============================================ */
function tCard(t){
 const c=tC(t.trade);
 return`<div class="tc" style="border-left-color:${c}" draggable="true" data-id="${t.id}" ondragstart="bdDrag(event)">
  <div class="tc-id">${t.id} · ${fmt(t.startDate)} → ${fmt(t.finishDate)}</div>
  <div class="tc-nm">${t.name}</div>
  <div class="tc-tags">
   <span class="tc-tag" style="background:${c}18;color:${c};border:1px solid ${c}30">${t.trade}</span>
   ${t.assignee?`<span class="tc-tag" style="background:#f3f4f6;color:var(--tx2);border:1px solid var(--bd)">${t.assignee}</span>`:''}
   ${!t.ready?`<span class="tc-tag" style="background:var(--am-l);color:var(--am);border:1px solid var(--am-b)">⚑ Blocked</span>`:`<span class="tc-tag" style="background:var(--gn-l);color:var(--gn);border:1px solid var(--gn-b)">✓ Ready</span>`}
  </div>
  ${t.constraint?`<div class="tc-con">⚑ ${t.constraint}</div>`:''}
 </div>`;
}

/* ============================================
   GUIDE BAR — fixed: use function not const
============================================ */
function getGuide(){const wsLbl=S.P.dataDate?wkL(wStart()):'WK--';return{
 import:{ico:'↕️',msg:'<strong>Import.</strong> Download the template, fill with real Start/Finish Dates, and import. Week numbers calculate automatically from your Project Start Date.',btns:[{l:'⬇ Template',fn:'dlTemplate()',c:'btn-pr'},{l:'Gantt →',fn:"ST('gantt')",c:'btn-ol'}]},
 gantt:{ico:'📅',msg:`<strong>Gantt Schedule.</strong> Drag sidebar tasks into the timeline. Grab bars to move. Drag ⇔ right edge to resize. Purple boundary = your <strong>${S.win}-week window</strong>.`,btns:[{l:'← Import',fn:"ST('import')",c:'btn-gh'},{l:'Board →',fn:"ST('board')",c:'btn-pr'}]},
 board:{ico:'📋',msg:`<strong>Weekly Board.</strong> ${wTasks().length} tasks in the ${S.win}-week window (${wsLbl}). Drag cards to update status. Every Not Done task needs an RNC code.`,btns:[{l:'← Gantt',fn:"ST('gantt')",c:'btn-gh'},{l:'Dashboard →',fn:"ST('dash')",c:'btn-pr'}]},
 dash:{ico:'📊',msg:'<strong>Dashboard.</strong> PPC trend vs target · Risk Matrix (click dots) · RNC Pareto. Risk zones and PPC target adjustable in Settings.',btns:[{l:'← Board',fn:"ST('board')",c:'btn-gh'},{l:'Archive →',fn:"ST('archive')",c:'btn-pr'}]},
 export:{ico:'📤',msg:'<strong>Export & Archive.</strong> Export to Excel for re-import Monday. Archive creates a permanent weekly snapshot.',btns:[{l:'← Archives',fn:"ST('archive')",c:'btn-gh'},{l:'Settings →',fn:"ST('settings')",c:'btn-pr'}]},
 archive:{ico:'📦',msg:'<strong>Archives.</strong> Create weekly snapshots of the full project state. Stored permanently in your project — browse and restore any past week.',btns:[{l:'← Dashboard',fn:"ST('dash')",c:'btn-gh'},{l:'Settings →',fn:"ST('settings')",c:'btn-pr'}]},
 settings:{ico:'⚙️',msg:'<strong>Settings.</strong> Adjust PPC target and risk thresholds — changes update the Dashboard live. Configure Project Start Date and Data Date here.',btns:[{l:'← Archive',fn:"ST('archive')",c:'btn-gh'},{l:'Help →',fn:"ST('help')",c:'btn-pr'}]},
 help:{ico:'❓',msg:'<strong>How to Use.</strong> Complete LPS workflow guide, glossary, and pro tips for effective pull planning sessions.',btns:[{l:'← Settings',fn:"ST('settings')",c:'btn-gh'},{l:'Start: Import →',fn:"ST('import')",c:'btn-pr'}]},
}}
function renderGuide(){
 const g=getGuide()[S.tab]||getGuide().import;
 const gi=document.getElementById('g-ico'),gt=document.getElementById('g-txt'),ga=document.getElementById('g-acts');
 if(gi)gi.textContent=g.ico;if(gt)gt.innerHTML=g.msg;
 if(ga)ga.innerHTML=g.btns.map(b=>`<button class="btn ${b.c}" style="font-size:12px;padding:7px 13px" onclick="${b.fn}">${b.l}</button>`).join('');
}

/* ============================================
   BOARD DRAG & RNC
============================================ */
function bdDrag(e){S.drag=e.currentTarget.dataset.id;e.dataTransfer.effectAllowed='move'}
function dropWWP(e,col){e.preventDefault();col.classList.remove('dov');if(!S.drag)return;S.tasks=S.tasks.map(t=>t.id===S.drag?{...t,wwp:col.dataset.wwp}:t);S.drag=null;renderTab()}
function pickRNC(id){
 openML(`<div class="ml-hdr"><div class="ml-t">Assign RNC Code</div><button class="ml-x" onclick="closeML()">✕</button></div>
 <div class="ml-body"><div class="ib ib-ng mb12"><div class="ib-ico">⚑</div><div style="font-size:13px">Select the main reason this task was not completed. This feeds the root cause Pareto chart on the Dashboard.</div></div>
 <div style="display:grid;gap:7px">${Object.entries(RNC).map(([k,v])=>`<button style="padding:11px 14px;border-radius:8px;border:1px solid var(--rd-b);background:var(--rd-l);color:var(--rd);text-align:left;cursor:pointer;font-family:var(--font);font-size:13px;font-weight:500;transition:.15s;letter-spacing:-0.01em" onmouseenter="this.style.background='var(--rd)';this.style.color='#fff'" onmouseleave="this.style.background='var(--rd-l)';this.style.color='var(--rd)'" onclick="S.tasks=S.tasks.map(t=>t.id==='${id}'?{...t,rncCode:'${k}'}:t);closeML();renderTab()"><strong style="font-family:var(--mono);font-weight:700">${k}</strong> &nbsp;—&nbsp; ${v}</button>`).join('')}</div></div>`);
}

/* MODAL */

function toast(msg,type,dur){
 type=type||'ok';dur=dur||3000;
 const d=document.createElement('div');
 d.className='toast toast-'+type;
 const ico={ok:'✓',ng:'✕',pu:'ℹ',wr:'⚠'}[type]||'ℹ';
 d.innerHTML='<span>'+ico+'</span> '+msg;
 document.body.appendChild(d);
 setTimeoutwindow.onerror=function(msg,src,line,col,err){
 var d=document.getElementById('app-root');
 if(d)d.innerHTML='<div style="padding:40px;font-family:system-ui;color:#dc2626;max-width:600px;margin:0 auto"><h2 style="margin-bottom:12px">⚠ App Error</h2><p style="margin-bottom:8px;font-size:14px">'+msg+'</p><p style="font-size:12px;color:#6b7280">Line '+line+'</p><p style="margin-top:16px;font-size:12px">Try: reload the page, or clear browser storage (F12 → Application → Storage → Clear)</p></div>';
 return false;
};
(function(){try{d.style.opacity='0';d.style.transition='opacity .3s'}catch{}},dur-350);
 setTimeout(function(){try{document.body.removeChild(d)}catch{}},dur);
}
function openML(h){document.getElementById('ml-bx').innerHTML=h;document.getElementById('ml-ov').classList.remove('hi')}
function closeML(){document.getElementById('ml-ov').classList.add('hi')}

/* SETUP — fixed: only addEventListener if needed, inline ondragstart handles board drag */
function setupEvt(){
 if(S.tab==='dash')setTimeout(initCharts,80);
}

/* ============================================
   CHARTS
============================================ */
function destroyCharts(){Object.values(S.charts).forEach(c=>{try{c&&c.destroy()}catch(e){}});S.charts={}}
function initCharts(){
 if(typeof Chart==='undefined'){const c=document.getElementById('ch-ppc');if(c)c.parentElement.innerHTML+='<p style="text-align:center;padding:20px;color:var(--tx3);font-size:13px">Charts require an internet connection to load.</p>';return}
 const wt=wTasks();const dn=wt.filter(t=>t.wwp==='done').length,nd=wt.filter(t=>t.wwp==='not-done').length;
 const lPPC=dn+nd>0?Math.round(dn/(dn+nd)*100):79;
 const pD=[...S.ppc.map(w=>({l:w.lbl,v:Math.round(w.done/w.planned*100)})),{l:wkL(S.P.dataDate),v:lPPC}];
 const fonts={family:'Inter',size:11};
 const ttFonts={titleFont:{family:'Inter',weight:'600',size:12},bodyFont:{family:'Inter',size:11}};
 const cf={responsive:true,plugins:{legend:{display:true,position:'bottom',labels:{font:fonts,usePointStyle:true,padding:14}},tooltip:ttFonts}};

 const c1=document.getElementById('ch-ppc');
 if(c1)S.charts.ppc=new Chart(c1,{type:'line',data:{labels:pD.map(w=>w.l),datasets:[
  {label:'PPC %',data:pD.map(w=>w.v),borderColor:'#7c3aed',backgroundColor:'rgba(124,58,237,.08)',fill:true,tension:.4,pointBackgroundColor:'#7c3aed',pointRadius:4,pointHoverRadius:6,borderWidth:2.5},
  {label:`${S.SET.ppcTarget}% Target`,data:pD.map(()=>S.SET.ppcTarget),borderColor:'#6366f1',borderDash:[5,4],pointRadius:0,borderWidth:1.5,fill:false}
 ]},options:{...cf,scales:{y:{min:30,max:100,ticks:{callback:v=>v+'%',font:fonts},title:{display:true,text:'PPC (%)',font:{...fonts,weight:'600'}},grid:{color:'#f3f4f6'}},x:{ticks:{font:{...fonts,size:10}},title:{display:true,text:'Project Week',font:{...fonts,weight:'600'}},grid:{display:false}}}}});

 const rc={};S.tasks.filter(t=>t.rncCode).forEach(t=>{rc[t.rncCode]=(rc[t.rncCode]||0)+1});
 const rd=Object.entries(RNC).map(([k,v])=>({l:v,k,c:rc[k]||0})).filter(r=>r.c>0).sort((a,b)=>b.c-a.c);
 const c2=document.getElementById('ch-rnc');
 if(c2){
  if(rd.length)S.charts.rnc=new Chart(c2,{type:'bar',data:{labels:rd.map(r=>r.l),datasets:[{label:'Count',data:rd.map(r=>r.c),backgroundColor:['#dc2626','#d97706','#7c3aed','#2563eb','#059669','#ea580c'],borderRadius:5,barThickness:26}]},options:{...cf,indexAxis:'y',plugins:{...cf.plugins,legend:{display:false}},scales:{x:{ticks:{font:fonts},title:{display:true,text:'Count',font:{...fonts,weight:'600'}},grid:{color:'#f3f4f6'}},y:{ticks:{font:{...fonts,size:11}}}}}});
  else c2.closest('.ch-box').insertAdjacentHTML('beforeend','<div style="text-align:center;padding:20px;color:var(--tx4);font-size:13px">No RNC data yet — mark tasks as Not Done and assign codes on the Board.</div>');
 }
}

/* ============================================
   IMPORT / EXPORT / TEMPLATE
============================================ */
function dropImp(e){e.preventDefault();const f=e.dataTransfer.files[0];if(f){const r=new FileReader();r.onload=ev=>processImp(ev.target.result);r.readAsBinaryString(f)}}
function doImport(input){if(input.files[0]){const r=new FileReader();r.onload=e=>processImp(e.target.result);r.readAsBinaryString(input.files[0])}}
function processImp(data){
 if(typeof XLSX==='undefined'){toast('Excel library not loaded. Check internet connection.','ng');return}
 if(!AUTH.canOp('import')){toast('Monthly op limit reached. Upgrade plan.','ng');return}
 try{
  const wb=XLSX.read(data,{type:'binary',cellDates:true});
  const rs=n=>{const ws=wb.Sheets[n];return ws?XLSX.utils.sheet_to_json(ws,{defval:'',raw:false}):[]};
  const cD=v=>{if(!v)return null;if(v instanceof Date)return iso(v);if(typeof v==='string'&&/\d{4}-\d{2}-\d{2}/.test(v))return v;if(typeof v==='string'){const d=new Date(v);return isNaN(d)?null:iso(d)}return null};
  const pi={};rs('Project_Info').forEach(r=>{if(r.Field)pi[r.Field]=r.Value});
  if(pi['Project Start Date'])S.P.startDate=cD(pi['Project Start Date'])||S.P.startDate;
  if(pi['Data Date'])S.P.dataDate=cD(pi['Data Date'])||S.P.dataDate;
  if(pi['Project Name'])S.P.name=pi['Project Name'];
  if(pi['General Contractor'])S.P.gc=pi['General Contractor'];
  if(pi['Project Number'])S.P.num=pi['Project Number'];
  if(pi['PPC Target'])S.SET.ppcTarget=+pi['PPC Target']||80;
  const tasks=rs('Tasks').map((r,i)=>{
   const sd=cD(r['Start Date']),fd=cD(r['Finish Date']),ps=String(r['Predecessor IDs']||'');
   return{id:String(r['Task ID']||'T-'+String(i+1).padStart(2,'0')),wbs:String(r['WBS Code']||''),name:String(r['Task Name']||''),
    trade:String(r['Trade']||'Civil'),zone:String(r['Zone']||''),startDate:sd,finishDate:fd,onGantt:!!(sd&&fd),
    wwp:String(r['Status']||'promised').toLowerCase().replace(/\s+/g,'-'),
    pred:ps?ps.split(',').map(x=>x.trim()).filter(Boolean):[],
    constraint:String(r['Constraint']||''),ready:(String(r['Ready (YES/NO)']||'')).toUpperCase()==='YES',
    assignee:String(r['Assignee']||''),hours:+r['Hours']||8,rncCode:String(r['RNC Code']||''),
    notes:String(r['Notes']||''),L:+r['Likelihood']||2,I:+r['Impact']||2};
  });
  const ppc=rs('PPC_History').map(r=>({lbl:String(r['Week Label']||''),startDate:cD(r['Week Start Date']),planned:+r['Planned']||0,done:+r['Done']||0})).filter(r=>r.planned>0);
  const cons=rs('Constraints').map(r=>({id:String(r['ID']||''),desc:String(r['Description']||''),linked:String(r['Linked Task']||''),owner:String(r['Owner']||''),due:cD(r['Due Date'])||'',L:+r['Likelihood']||2,I:+r['Impact']||2,status:String(r['Status']||'OPEN')})).filter(c=>c.id);
  if(tasks.length)S.tasks=tasks;if(ppc.length)S.ppc=ppc;if(cons.length)S.constraints=cons;
  AUTH.useOp('import');saveCurrentProject();updHdr();
  if(S.tab!=='import'){S.tab='import';renderTab();}
  const st=document.getElementById('imp-st');
  if(st)st.innerHTML=`<div class="ib ib-ok" style="margin:0"><div class="ib-ico">✅</div><div><strong>Import successful!</strong> ${tasks.length} tasks (${tasks.filter(t=>t.onGantt).length} on Gantt), ${cons.length} constraints. Project Start: <strong>${fmt(S.P.startDate)}</strong> · Data Date: <strong>${fmt(S.P.dataDate)}</strong> (${wkL(S.P.dataDate)}).</div></div>`;
  renderTab();
 }catch(e){const st=document.getElementById('imp-st');if(st)st.innerHTML=`<div class="ib ib-ng" style="margin:0"><div class="ib-ico">❌</div><div><strong>Import failed:</strong> ${e.message}. Use the downloaded template.</div></div>`;console.error(e)}
}
function loadSample(){
 S.tasks=IT.map(t=>({...t,pred:[...(t.pred||[])]}));S.ppc=[...IPPC];S.constraints=[...IC];
 S.P={...S.P,name:'Riverside Tower — Midtown District',num:'RT-2024-0142',gc:'Summit Build Group',startDate:'2026-03-02',dataDate:'2026-04-20',ppcTarget:80};
 S.SET.ppcTarget=80;S.tab='import';updHdr();saveCurrentProject();renderTab();
 const st=document.getElementById('imp-st');if(st)st.innerHTML=`<div class="ib ib-pu" style="margin:0"><div class="ib-ico">🏗️</div><div><strong>Riverside Tower loaded!</strong> 14 tasks on Gantt · 6 unscheduled · 6 constraints · Project Start: 02-Mar-2026 · Data Date: 20-Apr-2026 · Week 8. Explore every tab.</div></div>`;
}
function dlTemplate(){
 if(typeof XLSX==='undefined'){toast('Excel library not loaded. Check internet connection.','ng');return}
 const wb=XLSX.utils.book_new();
 function a(d,n){XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(d),n)}
 a([['PROJECT ASSURE — LPS TEMPLATE v4'],['DATES: Use YYYY-MM-DD format. Tasks WITH Start+Finish Date are placed on the Gantt. Tasks WITHOUT dates appear as unscheduled.'],['STATUS: promised|done|at-risk|not-done. RNC: DES|MAT|LAB|EQP|WEA|PRE|OTH'],['RISK: Likelihood 1-5, Impact 1-5. Risk Score = L×I. Used in Risk Matrix.']],'README');
 a([['Field','Value','Notes'],['Project Name',S.P.name||'',''],['Project Number',S.P.num||'',''],['General Contractor',S.P.gc||'',''],['Project Start Date',S.P.startDate,'★ Week 1 anchor date'],['Data Date',S.P.dataDate,'★ Planning today date'],['PPC Target',S.SET.ppcTarget,'']],'Project_Info');
 a([['Task ID','WBS Code','Task Name','Trade','Zone','Start Date','Finish Date','Assignee','Hours','Predecessor IDs','Constraint','Ready (YES/NO)','Status','RNC Code','Notes','Likelihood','Impact'],
  ...S.tasks.map(t=>[t.id,t.wbs||'',t.name,t.trade,t.zone||'',t.startDate||'',t.finishDate||'',t.assignee||'',t.hours,(t.pred||[]).join(','),t.constraint||'',t.ready?'YES':'NO',t.wwp,t.rncCode||'',t.notes||'',t.L||2,t.I||2]),
  ['','','→ Add tasks below','','','YYYY-MM-DD','YYYY-MM-DD','','','','','','','','','','']],'Tasks');
 a([['Week Label','Week Start Date','Planned','Done'],...S.ppc.map(w=>[w.lbl,w.startDate||'',w.planned,w.done])],'PPC_History');
 a([['ID','Description','Linked Task','Owner','Due Date','Likelihood','Impact','Status'],...S.constraints.map(c=>[c.id,c.desc||'',c.linked||'',c.owner||'',c.due||'',c.L||2,c.I||2,c.status||'OPEN'])],'Constraints');
 XLSX.writeFile(wb,`PA_LPS_Template_${S.P.dataDate||iso(new Date())}.xlsx`);
}
function doExport(){
 if(typeof XLSX==='undefined'){toast('Excel library not loaded. Check internet connection.','ng');return}
 if(!AUTH.canOp('export')){toast('Monthly op limit reached','ng');return}
 try{
  const wb=XLSX.utils.book_new();
  function a(d,n){XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(d),n)}
  a([['Field','Value'],['Project Name',S.P.name||''],['Project Number',S.P.num||''],['General Contractor',S.P.gc||''],['Project Start Date',S.P.startDate],['Data Date',S.P.dataDate],['PPC Target',S.SET.ppcTarget],['Export Date',iso(new Date())]],'Project_Info');
  a([['Task ID','WBS Code','Task Name','Trade','Zone','Start Date','Finish Date','Assignee','Hours','Predecessor IDs','Constraint','Ready (YES/NO)','Status','RNC Code','Notes','Likelihood','Impact'],
   ...S.tasks.map(t=>[t.id,t.wbs||'',t.name,t.trade,t.zone||'',t.startDate||'',t.finishDate||'',t.assignee||'',t.hours,(t.pred||[]).join(','),t.constraint||'',t.ready?'YES':'NO',t.wwp,t.rncCode||'',t.notes||'',t.L||2,t.I||2])],'Tasks');
  const wt=wTasks();const dn=wt.filter(t=>t.wwp==='done').length;
  a([['Week Label','Week Start Date','Planned','Done'],...S.ppc.map(w=>[w.lbl,w.startDate||'',w.planned,w.done]),[wkL(S.P.dataDate),S.P.dataDate,wt.length,dn]],'PPC_History');
  a([['ID','Description','Linked Task','Owner','Due Date','Likelihood','Impact','Status'],...S.constraints.map(c=>[c.id,c.desc||'',c.linked||'',c.owner||'',c.due||'',c.L||2,c.I||2,c.status||''])],'Constraints');
  XLSX.writeFile(wb,`PA_LPS_Export_${S.P.dataDate||iso(new Date())}.xlsx`);
  AUTH.useOp('export');
  toast('Exported successfully!','ok');
 }catch(e){toast('Export failed: '+e.message,'ng');console.error(e)}
}

/* ============================================
   INIT
============================================ */
// Embed logo into both auth and app screens on demand
const PA_LOGO='data:image/png;base64,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';
function injectLogo(id){var el=document.getElementById(id);if(el)el.src=PA_LOGO;}
// Override route to inject logo after render
const _route=route;
function routeAndLogo(){_route();setTimeout(function(){['auth-logo','ptb-logo','app-logo'].forEach(injectLogo);},50);}
// Ensure demo user exists
// Auto-create demo user with starter project if not exists
(function(){
  // BULLETPROOF INIT - if anything goes wrong, clear localStorage and start fresh
  try {
    // Clean up any corrupted user records
  try{
    var us=JSON.parse(localStorage.getItem('pa_users')||'[]');
    if(Array.isArray(us)){
      var cleaned=us.filter(function(u){return u&&u.email&&typeof u.email==='string'});
      if(cleaned.length!==us.length){
        localStorage.setItem('pa_users',JSON.stringify(cleaned));
        AUTH.users=cleaned;
      }
    }
  }catch(e){console.warn('User storage cleanup:',e);}
  if(!AUTH.findUser('demo@projectassure.io')){
    AUTH.register('demo@projectassure.io','demo1234','pro');
    const r2=AUTH.login('demo@projectassure.io','demo1234');
    if(r2.ok){
      PROJECTS.createWithData('Riverside Tower (Sample)',IT,IPPC,IC,{
        startDate:'2026-03-02',dataDate:'2026-04-20',num:'RT-2024-0142',gc:'Summit Build Group'
      });
      AUTH.logout();
    }
  }
  routeAndLogo();
  } catch(initErr) {
    console.error('Init failed - clearing storage and reloading:', initErr);
    try {
      localStorage.removeItem('pa_users');
      localStorage.removeItem('pa_session');
      localStorage.clear();
    } catch{}
    document.body.innerHTML = '<div style="padding:40px;font-family:system-ui;max-width:500px;margin:60px auto;text-align:center;background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.1)"><h2 style="color:#dc2626;margin-bottom:12px;font-size:20px">Storage Reset Required</h2><p style="color:#374151;margin-bottom:18px;font-size:14px">Local storage from a previous version conflicted with this build. It has been cleared. Click below to start fresh.</p><button onclick="location.reload()" style="background:linear-gradient(135deg,#4f46e5,#9333ea);color:#fff;border:none;padding:11px 28px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Reload App</button></div>';
  }
})();
