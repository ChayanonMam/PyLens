// Code completion for the editor (CodeMirror 5 + show-hint).
// Suggests keywords, builtins, snippets, names used in the code and module members.

(function(){
  const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

  const KEYWORDS = ['and','as','assert','break','class','continue','def','del','elif','else','except','finally',
    'for','from','global','if','import','in','is','lambda','nonlocal','not','or','pass','raise','return',
    'try','while','with','yield','True','False','None'];

  // keyword -> snippet (back = how many characters to move the cursor back after inserting)
  const SNIPPETS = {
    'for':   {insert:'for i in range():', back:2, desc:'วนลูป for'},
    'while': {insert:'while :', back:1, desc:'วนลูป while'},
    'if':    {insert:'if :', back:1, desc:'เงื่อนไข'},
    'elif':  {insert:'elif :', back:1, desc:'เงื่อนไขเพิ่มเติม'},
    'else':  {insert:'else:', back:0, desc:'กรณีอื่นๆ'},
    'def':   {insert:'def ():', back:3, desc:'สร้างฟังก์ชัน'},
    'class': {insert:'class :', back:1, desc:'สร้างคลาส'},
    'try':   {insert:'try:', back:0, desc:'ดักข้อผิดพลาด'},
    'except':{insert:'except Exception as e:', back:0, desc:'จัดการข้อผิดพลาด'},
    'with':  {insert:'with open() as f:', back:6, desc:'เปิดไฟล์'}
  };

  const BUILTINS = {
    print:'แสดงผลออกทางหน้าจอ', input:'รับข้อความจากผู้ใช้', len:'จำนวนสมาชิก', range:'ชุดตัวเลขต่อเนื่อง',
    int:'แปลงเป็นจำนวนเต็ม', float:'แปลงเป็นทศนิยม', str:'แปลงเป็นข้อความ', bool:'แปลงเป็นจริง/เท็จ',
    list:'สร้าง/แปลงเป็นลิสต์', dict:'สร้างดิกชันนารี', set:'สร้างเซ็ต', tuple:'สร้างทูเพิล',
    sum:'ผลรวม', min:'ค่าน้อยสุด', max:'ค่ามากสุด', abs:'ค่าสัมบูรณ์', round:'ปัดเศษ',
    sorted:'เรียงลำดับ', reversed:'กลับลำดับ', enumerate:'ลำดับพร้อมค่า', zip:'จับคู่หลายลิสต์',
    map:'ใช้ฟังก์ชันกับทุกตัว', filter:'กรองสมาชิก', open:'เปิดไฟล์', type:'ชนิดของข้อมูล',
    isinstance:'ตรวจชนิดข้อมูล', any:'มีตัวไหนเป็นจริง', all:'ทุกตัวเป็นจริง', chr:'รหัส → อักษร',
    ord:'อักษร → รหัส', pow:'ยกกำลัง', divmod:'หารเอาผลหารและเศษ', repr:'ข้อความแสดงค่า',
    id:'หมายเลขออบเจกต์', iter:'สร้าง iterator', next:'ค่าถัดไปของ iterator', format:'จัดรูปแบบ',
    hash:'ค่าแฮช', callable:'เรียกได้หรือไม่', vars:'attribute ของออบเจกต์', dir:'รายชื่อ attribute',
    getattr:'อ่าน attribute', setattr:'ตั้งค่า attribute', hasattr:'มี attribute ไหม'
  };

  // names ending with "()" are callable; others are constants/attributes
  const MODULES = {
    math: ['sqrt()','pow()','floor()','ceil()','fabs()','factorial()','gcd()','isqrt()','log()','log10()','log2()',
           'exp()','sin()','cos()','tan()','radians()','degrees()','hypot()','pi','e','inf','nan'],
    random: ['random()','randint()','randrange()','choice()','choices()','shuffle()','sample()','uniform()','seed()'],
    json: ['dumps()','loads()','dump()','load()'],
    time: ['time()','sleep()','perf_counter()','strftime()','localtime()'],
    datetime: ['datetime','date','timedelta','time','timezone'],
    re: ['match()','search()','findall()','finditer()','sub()','split()','compile()','fullmatch()','IGNORECASE'],
    sys: ['argv','exit()','stdout','stdin','version','path','maxsize'],
    os: ['path','listdir()','getcwd()','mkdir()','remove()','environ','sep'],
    collections: ['Counter()','defaultdict()','deque()','OrderedDict()','namedtuple()'],
    itertools: ['product()','permutations()','combinations()','chain()','count()','cycle()','groupby()','accumulate()','zip_longest()'],
    functools: ['reduce()','lru_cache()','partial()','wraps()','cmp_to_key()'],
    statistics: ['mean()','median()','mode()','stdev()','variance()'],
    string: ['ascii_letters','ascii_lowercase','ascii_uppercase','digits','punctuation','whitespace'],
    copy: ['copy()','deepcopy()'],
    heapq: ['heappush()','heappop()','heapify()','nlargest()','nsmallest()'],
    bisect: ['bisect_left()','bisect_right()','insort()'],
    csv: ['reader()','writer()','DictReader()','DictWriter()'],
    pprint: ['pprint()','pformat()'],
    numpy: ['array()','zeros()','ones()','arange()','linspace()','mean()','sum()','sort()','reshape()','dot()','max()','min()','random','pi'],
    pandas: ['DataFrame()','Series()','read_csv()','concat()','merge()'],
    matplotlib: ['pyplot'],
    'matplotlib.pyplot': ['plot()','show()','title()','xlabel()','ylabel()','bar()','hist()','scatter()','legend()','figure()','savefig()']
  };

  // methods of the common built-in types (we cannot know a variable's type statically)
  const METHODS = ['append()','extend()','insert()','remove()','pop()','clear()','sort()','reverse()','index()','count()','copy()',
    'keys()','values()','items()','get()','update()','setdefault()','add()','discard()','union()','intersection()',
    'upper()','lower()','strip()','lstrip()','rstrip()','split()','join()','replace()','find()','startswith()',
    'endswith()','format()','isdigit()','isalpha()','title()','capitalize()','center()','zfill()','read()','write()',
    'readline()','readlines()','close()'];

  function importedModules(doc){
    const map = {};
    let m;
    const re1 = /^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm;
    while((m = re1.exec(doc))) map[m[2] || m[1]] = m[1];
    const re2 = /^\s*from\s+([\w.]+)\s+import\s+([\w\s,]+)/gm;
    while((m = re2.exec(doc))){
      // "from matplotlib import pyplot as plt" is rare; keep it simple
      m[2].split(',').forEach(n => { n = n.trim().split(/\s+/)[0]; if(n) map[n] = m[1] + '.' + n; });
    }
    return map;
  }

  function docNames(doc, skip){
    const found = new Set();
    const re = /[A-Za-z_][A-Za-z0-9_]*/g;
    let m;
    while((m = re.exec(doc))) found.add(m[0]);
    found.delete(skip);
    KEYWORDS.forEach(k => found.delete(k));
    Object.keys(BUILTINS).forEach(k => found.delete(k));
    return [...found];
  }

  function item(text, kind, desc, extra){
    const label = text.replace(/\(\)$/, '');
    const it = Object.assign({
      text: label,
      insert: label + (/\(\)$/.test(text) ? '()' : ''),
      back: /\(\)$/.test(text) ? 1 : 0,
      kind: kind, desc: desc || '',
      render(el){
        el.innerHTML = '<span class="hn">' + esc(label) + (/\(\)$/.test(text) ? '()' : '') + '</span>'
          + '<span class="hk">' + esc(kind) + (desc ? ' · ' + esc(desc) : '') + '</span>';
      },
      hint(cm, data, c){
        cm.replaceRange(c.insert, data.from, data.to);
        const p = cm.getCursor();
        if(c.back) cm.setCursor({line: p.line, ch: p.ch - c.back});
      }
    }, extra || {});
    return it;
  }

  function pyHint(cm){
    const cur = cm.getCursor(), line = cm.getLine(cur.line);
    let start = cur.ch;
    while(start > 0 && /\w/.test(line.charAt(start - 1))) start--;
    const word = line.slice(start, cur.ch);
    const from = CodeMirror.Pos(cur.line, start), to = CodeMirror.Pos(cur.line, cur.ch);
    const low = word.toLowerCase();
    const doc = cm.getValue();
    let items = [];

    if(/^\s*(import|from)\s+[\w.]*$/.test(line.slice(0, cur.ch))){
      // module names after "import " / "from "
      Object.keys(MODULES).forEach(n => items.push(item(n, 'โมดูล', '')));
    } else if(start > 0 && line.charAt(start - 1) === '.'){
      // member access:  obj.<here>
      let e = start - 1, s = e;
      while(s > 0 && /[\w.]/.test(line.charAt(s - 1))) s--;
      const obj = line.slice(s, e);
      const mods = importedModules(doc);
      const modName = mods[obj];
      if(modName && MODULES[modName]){
        MODULES[modName].forEach(n => items.push(item(n, 'โมดูล ' + modName.split('.').pop())));
      } else if(MODULES[obj] && !(obj in mods)){
        MODULES[obj].forEach(n => items.push(item(n, 'โมดูล ' + obj)));
      } else {
        METHODS.forEach(n => items.push(item(n, 'เมธอด')));
      }
    } else {
      KEYWORDS.forEach(k => {
        const sn = SNIPPETS[k];
        if(sn) items.push(item(k, 'คีย์เวิร์ด', sn.desc, {insert: sn.insert, back: sn.back}));
        else items.push(item(k, 'คีย์เวิร์ด', ''));
      });
      Object.keys(BUILTINS).forEach(b => items.push(item(b + '()', 'ฟังก์ชัน', BUILTINS[b])));
      docNames(doc, word).forEach(n => items.push(item(n, 'ในโค้ด', '')));
    }

    items = items.filter(it => it.text.toLowerCase().startsWith(low) && it.text !== word);
    // prefix matches that keep the user's casing first, then alphabetical
    items.sort((a, b) => {
      const ka = a.kind === 'ในโค้ด' ? 1 : 0, kb = b.kind === 'ในโค้ด' ? 1 : 0;
      if(ka !== kb) return ka - kb;
      return a.text.localeCompare(b.text);
    });
    // drop duplicates (same text) keeping the first
    const seen = new Set();
    items = items.filter(it => { if(seen.has(it.text)) return false; seen.add(it.text); return true; }).slice(0, 30);
    return {list: items, from: from, to: to};
  }
  window.pyHint = pyHint;
  window.pyImportedModules = importedModules;

  window.setupCompletion = function(cm){
    cm.on('inputRead', (cmi) => {
      if(cmi.state.completionActive) return;
      const cur = cmi.getCursor();
      const tt = cmi.getTokenTypeAt(cur);
      if(tt && /string|comment/.test(tt)) return;
      const line = cmi.getLine(cur.line);
      const ch = line.charAt(cur.ch - 1);
      if(!/[\w.]/.test(ch)) return;
      let s = cur.ch;
      while(s > 0 && /\w/.test(line.charAt(s - 1))) s--;
      if(ch !== '.' && cur.ch - s < 2) return;
      cmi.showHint({hint: pyHint, completeSingle: false});
    });
    cm.addKeyMap({
      'Ctrl-Space': c => c.showHint({hint: pyHint, completeSingle: false}),
      'Alt-/': c => c.showHint({hint: pyHint, completeSingle: false})
    });
  };
})();
