// Web Worker entry. Serialised with toString() and started from a Blob URL.
function workerMain(PYSRC, BASE, WHEELS){
  const prog = (pct, text)=>postMessage({type:'progress', pct:pct, text:text});
  prog(1, 'เริ่มโหลดตัวรัน Python…');
  importScripts(BASE + 'pyodide.js');
  prog(5, 'โหลดตัวเริ่มระบบแล้ว');
  let py = null;
  let fmtReady = false;

  // Download the two big runtime files ourselves so we can report progress,
  // then hand the bytes to Pyodide (it asks for them with fetch, so we answer from memory).
  const pre = new Map();
  const realFetch = self.fetch.bind(self);
  self.fetch = function(input, init){
    const url = (typeof input === 'string') ? input : (input && input.url);
    const e = pre.get(url);
    if(e){
      pre.delete(url);
      return Promise.resolve(new Response(e.buf, {status:200, headers:{'Content-Type': e.type}}));
    }
    return realFetch(input, init);
  };
  async function prefetch(file, type, from, to, label, approx){
    const url = BASE + file;
    const res = await realFetch(url);
    if(!res.ok) throw new Error('HTTP ' + res.status + ' ' + file);
    const reader = res.body.getReader();
    const chunks = []; let loaded = 0;
    for(;;){
      const r = await reader.read();
      if(r.done) break;
      chunks.push(r.value); loaded += r.value.length;
      const frac = Math.min(0.99, loaded / approx);
      prog(from + (to - from) * frac, label + ' ' + (loaded / 1048576).toFixed(1) + ' / ' + (approx / 1048576).toFixed(1) + ' MB');
    }
    const buf = new Uint8Array(loaded); let o = 0;
    for(const c of chunks){ buf.set(c, o); o += c.length; }
    pre.set(url, {buf: buf.buffer, type: type});
    prog(to, label + ' เสร็จแล้ว');
  }

  const ready = (async()=>{
    try{
      await prefetch('pyodide.asm.wasm', 'application/wasm', 5, 66, 'ดาวน์โหลดตัวรัน Python', 10088051);
      await prefetch('python_stdlib.zip', 'application/zip', 66, 76, 'ดาวน์โหลดไลบรารีมาตรฐาน', 2341872);
    }catch(e){ /* progress is optional: Pyodide will download the files itself */ }
    prog(77, 'กำลังเริ่มระบบ Python…');
    py = await loadPyodide({indexURL: BASE});
    prog(94, 'กำลังเตรียมตัวไล่โค้ด…');
    py.runPython(PYSRC);
    prog(100, 'พร้อมแล้ว');
  })();
  ready.then(()=>postMessage({type:'ready'}), e=>postMessage({type:'initfail', error:String(e)}));
  onmessage = async ev=>{
    const m = ev.data;
    if(m.type === 'check'){
      try{ await ready; postMessage({type:'rpc', id:m.id, data:py.globals.get('__viz_check')(m.code)}); }
      catch(e){ postMessage({type:'rpc', id:m.id, data:'null'}); }
      return;
    }
    if(m.type === 'format'){
      try{
        await ready;
        let via = 'basic';
        try{
          if(!fmtReady){
            await py.loadPackage('micropip');
            const mp = py.pyimport('micropip');
            if(WHEELS && WHEELS.length){
              for(const u of WHEELS) await mp.install.callKwargs(u, {deps: false});
            } else {
              await mp.install('autopep8');
            }
            fmtReady = true;
          }
          via = 'autopep8';
        }catch(e){}
        postMessage({type:'rpc', id:m.id, data:py.globals.get('__viz_format')(m.code, via === 'autopep8'), via:via});
      }catch(e){ postMessage({type:'rpc', id:m.id, error:String(e)}); }
      return;
    }
    if(m.type !== 'run') return;
    try{
      await ready;
      postMessage({type:'status', text:'กำลังเตรียมแพ็กเกจ…'});
      try{ await py.loadPackagesFromImports(m.code); }catch(e){}
      const miss = py.globals.get('__viz_missing')(m.code).toJs();
      if(miss.length){
        try{
          await py.loadPackage('micropip');
          const mp = py.pyimport('micropip');
          for(const x of miss){
            postMessage({type:'status', text:'ติดตั้ง ' + x + '…'});
            try{ await mp.install(x); }catch(e){}
          }
        }catch(e){}
      }
      (m.files || []).forEach(([name, data])=>{
        try{
          const i = name.lastIndexOf('/');
          if(i > 0) py.FS.mkdirTree(name.slice(0, i));
          py.FS.writeFile(name, data);
        }catch(e){}
      });
      postMessage({type:'status', text:'กำลังวิเคราะห์…'});
      const f = py.globals.get('__viz_run');
      const res = f(m.code, m.stdin, m.max);
      postMessage({type:'result', id:m.id, data:res});
    }catch(e){
      postMessage({type:'fail', id:m.id, error:String(e)});
    }
  };
}
