// "น้องงู" – the PyLens mascot.
// Idle float/breathing, blinking, follows the pointer, reacts to what the app does,
// falls asleep when nothing happens, and can be dragged anywhere.
(function(){
  const root = document.getElementById('mascot');
  if(!root) return;
  const bubble = document.getElementById('mbubble');
  const tilt = document.getElementById('mtilt');
  const body = document.getElementById('mbody');
  const mood = {name:'idle', timer:null};
  let bubbleTimer = null, enabled = true, sleeping = false;
  let lastActivity = Date.now(), lastTip = Date.now(), lastEnd = -1, lastSyntaxSay = 0;
  const clicks = [];

  const TIPS = [
    'กด ← → เพื่อเดินหน้า/ถอยหลังทีละขั้น และกด Space เพื่อเล่นอัตโนมัติ',
    'คลิกเลขบรรทัดในโค้ด เพื่อกระโดดไปขั้นที่รันบรรทัดนั้น',
    'คลิกชื่อตัวแปรในกล่องตัวแปร เพื่อติดตามค่าเป็นกราฟ',
    'ลองสวิตช์ “โหมดง่าย” ถ้าอยากเห็นแค่ค่าของตัวแปร',
    'แท็บ “ต้นไม้การเรียก” ช่วยให้เห็น recursion ทั้งภาพ',
    'พิมพ์ pri แล้วกด Enter ฉันจะช่วยเติม print() ให้นะ',
    'ใช้ Shift+Alt+F จัดรูปโค้ดให้เป็นระเบียบ',
    'ชี้เมาส์ที่จุดสีฟ้า เพื่อดูว่าตัวแปรชี้ไปที่ข้อมูลไหน',
    'เพิ่มโน้ตให้แต่ละขั้นได้ แล้วกดแชร์ลิงก์ให้เพื่อนดู',
    'ลากตัวฉันไปวางตรงไหนก็ได้นะ จะได้ไม่บังโค้ด',
    'ส่งออกเป็น GIF ได้จากเมนู “เครื่องมือ”'
  ];
  const pick = a => a[Math.floor(Math.random() * a.length)];

  function setMood(name, ms){
    clearTimeout(mood.timer);
    root.className = root.className.replace(/\bm-\w+\b/g, '').replace(/\s+/g, ' ').trim() + ' m-' + name;
    mood.name = name;
    const persistent = (name === 'idle' || name === 'think' || name === 'sleep');
    if(!persistent && ms !== 0){
      mood.timer = setTimeout(()=>setMood(sleeping ? 'sleep' : 'idle'), ms || 1400);
    }
  }

  function say(text, ms){
    if(!enabled || !text) return;
    bubble.textContent = text;
    root.classList.add('talking');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(()=>root.classList.remove('talking'), ms || 5200);
  }

  const shortError = m => { m = String(m || ''); return m.length > 60 ? m.slice(0, 58) + '…' : m; };

  function sleep(){
    if(sleeping) return;
    sleeping = true;
    root.classList.remove('talking');
    setMood('sleep');
  }
  function wake(msg){
    if(!sleeping) return;
    sleeping = false;
    setMood('startle', 900);
    say(msg || 'เอ๊ะ! ตื่นแล้ว มีอะไรให้ช่วยไหม', 4200);
  }
  function act(){
    lastActivity = Date.now();
    if(sleeping) wake();
  }

  const Mascot = {
    say: say,
    mood: setMood,
    event(name, data){
      lastActivity = Date.now();
      if(sleeping){ sleeping = false; }
      if(!enabled) return;
      switch(name){
        case 'run':
          setMood('think');
          break;
        case 'done':
          setMood('happy', 1500);
          say('เสร็จแล้ว! ' + (data && data.steps ? data.steps.length.toLocaleString() + ' ขั้นตอน — ' : '') + 'กด “ถัดไป” เพื่อดูทีละบรรทัดได้เลย');
          break;
        case 'error': {
          setMood('oops', 1300);
          let t = 'อุ๊ย เจอข้อผิดพลาดแล้ว';
          if(data && data.error){
            t += data.error.line ? ' ที่บรรทัด ' + data.error.line : '';
            t += ' — ' + shortError(data.error.msg);
          }
          say(t, 7000);
          break;
        }
        case 'input':
          setMood('ask', 2200);
          say('ช่วยพิมพ์ค่าให้ input() ในช่องใต้ผลลัพธ์หน่อยนะ', 6000);
          break;
        case 'end':
          if(data === lastEnd) break;
          lastEnd = data;
          setMood('clap', 1600);
          say('ถึงบรรทัดสุดท้ายแล้ว เก่งมาก! ปรบมือให้เลย', 4200);
          break;
        case 'syntax': {
          const now = Date.now();
          if(now - lastSyntaxSay < 20000) break;
          lastSyntaxSay = now;
          setMood('startle', 700);
          say('ตรงนี้ดูผิดรูปแบบนะ ลองเช็ควงเล็บ เครื่องหมายคำพูด หรือเครื่องหมาย : ดู', 6000);
          break;
        }
        case 'ready':
          setMood('wave', 1600);
          say('สวัสดี! ฉันคือน้องงู PyLens จะช่วยดูโค้ดของคุณทีละขั้นนะ', 6000);
          break;
        case 'reset':
          setMood('idle');
          break;
      }
    },
    setEnabled(on){
      enabled = !!on;
      root.classList.toggle('off', !enabled);
      try{ localStorage.setItem('pl-mascot', enabled ? '1' : '0'); }catch(e){}
      if(!enabled) root.classList.remove('talking');
    },
    resetPosition(){
      root.style.left = root.style.top = root.style.right = root.style.bottom = '';
      try{ localStorage.removeItem('pl-mascot-pos'); }catch(e){}
      updateSide();
    }
  };
  window.Mascot = Mascot;

  // ---------------- dragging ----------------
  let drag = null, suppressClick = false;

  function updateSide(){
    const r = root.getBoundingClientRect();
    root.classList.toggle('side-left', r.left + r.width / 2 < window.innerWidth / 2);
    root.classList.toggle('side-top', r.top < 150);
  }
  function place(x, y){
    const w = root.offsetWidth, h = root.offsetHeight;
    x = Math.max(0, Math.min(window.innerWidth - w, x));
    y = Math.max(0, Math.min(window.innerHeight - h, y));
    root.style.left = x + 'px'; root.style.top = y + 'px';
    root.style.right = 'auto'; root.style.bottom = 'auto';
    updateSide();
  }
  function savePos(){
    const w = root.offsetWidth, h = root.offsetHeight;
    const r = root.getBoundingClientRect();
    try{
      localStorage.setItem('pl-mascot-pos', JSON.stringify({
        x: r.left / Math.max(1, window.innerWidth - w),
        y: r.top / Math.max(1, window.innerHeight - h)
      }));
    }catch(e){}
  }
  function restorePos(){
    try{
      const p = JSON.parse(localStorage.getItem('pl-mascot-pos') || 'null');
      if(p && typeof p.x === 'number'){
        place(p.x * (window.innerWidth - root.offsetWidth), p.y * (window.innerHeight - root.offsetHeight));
      }
    }catch(e){}
  }

  body.addEventListener('pointerdown', e=>{
    if(e.button !== 0) return;
    const r = root.getBoundingClientRect();
    drag = {sx: e.clientX, sy: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, active: false};
    try{ body.setPointerCapture(e.pointerId); }catch(err){}
  });
  body.addEventListener('pointermove', e=>{
    if(!drag) return;
    if(!drag.active){
      if(Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
      drag.active = true;
      root.classList.add('dragging');
    }
    place(e.clientX - drag.ox, e.clientY - drag.oy);
  });
  function endDrag(){
    if(drag && drag.active){
      savePos();
      suppressClick = true;
      setTimeout(()=>{ suppressClick = false; }, 0);
    }
    drag = null;
    root.classList.remove('dragging');
  }
  body.addEventListener('pointerup', endDrag);
  body.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', ()=>{
    if(root.style.left){ restorePos(); } else { updateSide(); }
  });

  // ---------------- click / interaction ----------------
  body.addEventListener('click', ()=>{
    if(suppressClick) return;
    const now = Date.now();
    clicks.push(now);
    while(clicks.length && now - clicks[0] > 1500) clicks.shift();
    lastActivity = now;
    if(clicks.length >= 4){
      clicks.length = 0;
      setMood('startle', 800);
      say('โอ๊ย! อย่าจิ้มรัวสิ จั๊กจี้นะ', 3200);
      return;
    }
    setMood('wave', 1300);
    say(pick(TIPS), 5600);
  });
  root.querySelector('.mclose').addEventListener('click', e=>{
    e.stopPropagation();
    Mascot.setEnabled(false);
    const cb = document.getElementById('mascotToggle');
    if(cb) cb.checked = false;
  });

  // head follows the pointer a little
  let raf = 0, px = 0, py = 0;
  document.addEventListener('pointermove', e=>{
    if(e.pointerType === 'touch') return;
    act();
    if(!enabled || sleeping || drag) return;
    px = e.clientX; py = e.clientY;
    if(raf) return;
    raf = requestAnimationFrame(()=>{
      raf = 0;
      const r = body.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 3;
      const dx = Math.max(-1, Math.min(1, (px - cx) / 500));
      const dy = Math.max(-1, Math.min(1, (py - cy) / 500));
      tilt.style.transform = 'translate(' + (dx * 7).toFixed(1) + 'px,' + (dy * 4).toFixed(1) + 'px) rotate(' + (dx * 6).toFixed(1) + 'deg)';
    });
  }, {passive: true});
  ['keydown', 'pointerdown'].forEach(ev => document.addEventListener(ev, act, {passive: true}));

  // ---------------- blinking ----------------
  function blinkOnce(){
    root.classList.add('blink');
    setTimeout(()=>root.classList.remove('blink'), 130);
  }
  (function scheduleBlink(){
    setTimeout(()=>{
      if(enabled && !sleeping && !document.hidden && mood.name !== 'happy' && mood.name !== 'clap'){
        blinkOnce();
        if(Math.random() < 0.2) setTimeout(blinkOnce, 260);
      }
      scheduleBlink();
    }, 2200 + Math.random() * 3800);
  })();

  // ---------------- idle: tips, then sleep ----------------
  setInterval(()=>{
    if(!enabled || document.hidden || document.body.classList.contains('present')) return;
    const idle = Date.now() - lastActivity;
    if(!sleeping && mood.name !== 'think' && idle >= 120000){ sleep(); return; }
    if(sleeping) return;
    if(root.classList.contains('talking')) return;
    if(idle >= 45000 && Date.now() - lastTip >= 45000){
      lastTip = Date.now();
      setMood('wave', 1300);
      say(pick(TIPS), 6000);
    }
  }, 5000);

  // ---------------- preferences ----------------
  try{
    if(localStorage.getItem('pl-mascot') === '0'){ enabled = false; root.classList.add('off'); }
  }catch(e){}
  setMood('idle');
  restorePos();
  updateSide();
})();
