// /assets/header-auth.js
// Shared header module for OnlyRealRoles
// - Initializes Firebase (uses existing app if already inited)
// - Renders auth-aware header actions into #authArea
// - Shows live account points from Firestore (users/{uid}.points)
// - Exposes window.orrHeaderAuth for access to { app, auth, db, signOut }

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut as fbSignOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyC5Ug8_QjByQns-MMNnxVnb1XVyWcNRWgU',
  authDomain: 'onlyrealroles-896bc.firebaseapp.com',
  projectId: 'onlyrealroles-896bc',
  storageBucket: 'onlyrealroles-896bc.firebasestorage.app',
  messagingSenderId: '794319315637',
  appId: '1:794319315637:web:2c4862b9a9f6a8e7d554fc'
};

// Initialize (idempotent)
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function ensureStyles(){
  if(document.getElementById('orr-header-style')) return;
  const css = `
  .userarea{position:relative}
  .avatarBtn{display:flex;align-items:center;gap:10px;padding:6px 10px;border:1px solid var(--ring, #cbd5e1);border-radius:999px;background:#fff;cursor:pointer;box-shadow:0 10px 30px rgba(2,6,23,.08)}
  .miniava{width:28px;height:28px;border-radius:999px;display:grid;place-items:center;background:#e2e8f0;color:#0f172a;font-weight:800;overflow:hidden}
  .miniava img{width:28px;height:28px;object-fit:cover;border-radius:999px}
  .caret{font-size:12px;color:#64748b}
  .menu{position:absolute;right:0;top:44px;background:#fff;border:1px solid var(--ring,#cbd5e1);border-radius:12px;box-shadow:0 10px 30px rgba(2,6,23,.08);min-width:220px;padding:8px;display:none;z-index:1000}
  .menu.open{display:block}
  .menu a,.menu button{display:flex;width:100%;text-align:left;gap:8px;align-items:center;padding:8px 10px;border:none;background:none;color:#0f172a;border-radius:8px;cursor:pointer;text-decoration:none}
  .menu a:hover,.menu button:hover{background:#f1f5f9}
  .signout{color:#991b1b}
  .pts{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--ring,#cbd5e1);border-radius:999px;padding:4px 8px;font-size:12px;background:#ecfeff;color:#0369a1}
  `;
  const style = document.createElement('style');
  style.id = 'orr-header-style';
  style.textContent = css;
  document.head.appendChild(style);
}

function renderLoggedOut(area){
  const ret = encodeURIComponent(location.pathname + location.search);
  area.innerHTML = `
    <a class="btn ghost" href="/sign_in/index.html?return=${ret}">Sign in</a>
    <a class="btn primary" href="/sign_in/index.html?tab=signup&return=${ret}">Sign up</a>
  `;
}

function renderLoggedIn(area, user){
  const name = user.displayName || (user.email ? user.email.split('@')[0] : 'You');
  const initials = name.split(' ').map(s=>s[0]).join('').slice(0,2).toUpperCase();
  area.innerHTML = `
    <div class="userarea">
      <button class="avatarBtn" id="orrAvatarBtn" aria-haspopup="menu" aria-expanded="false">
        ${user.photoURL ? `<img src="${user.photoURL}" alt="" class="miniava" style="object-fit:cover"/>` : `<div class="miniava" aria-hidden="true">${initials}</div>`}
        <span>${name}</span>
        <span class="pts" id="orrPointsPill" title="Account points">— pts</span>
        <span class="caret">▾</span>
      </button>
      <div class="menu" id="orrUserMenu" role="menu">
        <a href="/profile/index.html" role="menuitem">Profile</a>
        <a href="/profile/edit/index.html" role="menuitem">Edit profile</a>
        <a href="/network/index.html" role="menuitem">Network</a>
        <a href="/report/index.html" role="menuitem">Report a ghost job</a>
        <button class="signout" id="orrLogoutBtn" role="menuitem">Sign out</button>
      </div>
    </div>`;

  const btn = document.getElementById('orrAvatarBtn');
  const menu = document.getElementById('orrUserMenu');
  btn?.addEventListener('click', ()=>{
    const open = menu.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e)=>{
    if(!menu?.contains(e.target) && !btn?.contains(e.target)) menu?.classList.remove('open');
  });
  document.getElementById('orrLogoutBtn')?.addEventListener('click', async ()=>{
    try{ await fbSignOut(auth); location.replace('/sign_in/index.html'); } catch(e){ alert('Sign out failed'); }
  });

  // Live points pill
  try{
    onSnapshot(doc(db, 'users', user.uid), (snap)=>{
      const pts = snap.exists() ? (snap.data().points || 0) : 0;
      const pill = document.getElementById('orrPointsPill');
      if(pill) pill.textContent = `${pts} pts`;
    });
  }catch(e){ /* ignore */ }
}

export function mountHeaderAuth(targetId = 'authArea'){
  ensureStyles();
  const area = document.getElementById(targetId);
  if(!area){ return; }
  if(area.dataset.orrBound === '1'){ return; }
  area.dataset.orrBound = '1';

  onAuthStateChanged(auth, (user)=>{
    if(!user){ renderLoggedOut(area); }
    else { renderLoggedIn(area, user); }
  });
}

// Auto-mount on DOM ready if #authArea exists
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', ()=> mountHeaderAuth());
}else{
  mountHeaderAuth();
}

// Expose helpers
window.orrHeaderAuth = {
  app, auth, db,
  signOut: ()=> fbSignOut(auth),
  mount: mountHeaderAuth,
};
