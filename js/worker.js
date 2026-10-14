// Web Worker entry. Serialised with toString() and started from a Blob URL.
function workerMain(PYSRC, BASE, WHEELS){
  importScripts(BASE + 'pyodide.js');
  let py = null;
  let fmtReady = false;
  const ready = (async()=>{ py = await loadPyodide({indexURL: BASE}); py.runPython(PYSRC); })();
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
