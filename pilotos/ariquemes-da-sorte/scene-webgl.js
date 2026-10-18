/* FS Cinematic / WebGL1 — original geometry, progressive enhancement, no paid dependencies */
(() => {
  'use strict';
  const stage = document.querySelector('[data-cinematic-stage]');
  if (!stage || !('IntersectionObserver' in window)) return;
  const region = stage.closest('[data-cinematic-region]') || stage;
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const compact = matchMedia('(max-width: 700px)');
  const colors = stage.dataset.cinematicTheme === 'sorte'
    ? [[.95,.68,.26],[.37,.80,.39],[.61,.30,.83]]
    : [[.36,.86,.94],[.63,.45,.91],[.97,.65,.37]];
  let canvas, gl, state, visible = false, frameId = 0, last = 0, initialized = false, progress = 0;
  const clamp = (n) => Math.max(0, Math.min(1, n));
  const stopped = () => media.matches || document.hidden ||
    document.body.classList.contains('motion-paused') ||
    document.body.classList.contains('motion-off');
  function scrollProgress() {
    const box = region.getBoundingClientRect();
    const travel = Math.max(1, box.height - innerHeight);
    progress = clamp(-box.top / travel);
    region.style.setProperty('--cinematic-progress', progress.toFixed(4));
    const steps = region.querySelectorAll('[data-cinematic-step]');
    steps.forEach((el, i) => {
      const current = Math.min(steps.length - 1, Math.floor(progress * steps.length));
      el.classList.toggle('is-current', current === i);
    });
  }
  function lineData() {
    const lines = [], points = [];
    const add = (arr,p,c,s=2) => arr.push(p[0],p[1],p[2],c[0],c[1],c[2],s);
    const segment = (a,b,c) => { add(lines,a,c); add(lines,b,c); };
    // Three distinct tilted orbit planes, representing connected digital systems.
    for (let ring=0;ring<3;ring++) {
      const radius=[1.18,.91,1.43][ring], col=colors[ring], N=132;
      function pos(t) {
        const x = Math.cos(t)*radius, y = Math.sin(t)*radius;
        if (ring===0) return [x,y*.36,y*.93];
        if (ring===1) return [x*.48,y,x*.87];
        return [x*.72,y*.65,x*.55+y*.55];
      }
      for(let i=0;i<N;i++) segment(pos(i*2*Math.PI/N), pos((i+1)*2*Math.PI/N), col);
      for(let i=0;i<10;i++) add(points,pos((i+.4)*2*Math.PI/10),col,4.2);
    }
    // Architectural outlines: compact 3D modules orbit around the identity.
    const vertices = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
    const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    for (let cube=0;cube<6;cube++) {
      const theta=cube*2*Math.PI/6, cx=Math.cos(theta)*1.37, cy=Math.sin(theta*2)*.36, cz=Math.sin(theta)*1.37;
      const size=(cube%2?.09:.13), col=colors[cube%3];
      vertices.forEach(()=>{});
      edges.forEach(([a,b])=>{
        const p=vertices[a],q=vertices[b];
        segment([cx+p[0]*size,cy+p[1]*size,cz+p[2]*size],[cx+q[0]*size,cy+q[1]*size,cz+q[2]*size],col);
      });
    }
    // Deterministic particles: stable rendering across visits.
    for(let i=0;i<190;i++){
      const t=i*2.39996323, z=1-2*(i+.5)/190, radius=Math.sqrt(1-z*z);
      const r=1.55+(i%7)*.095;
      add(points,[Math.cos(t)*radius*r,z*r*.86,Math.sin(t)*radius*r],colors[i%3],i%9===0?3.5:1.7);
    }
    return { lines:new Float32Array(lines),points:new Float32Array(points) };
  }
  function makeShader(type,src) {
    const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)||'shader compilation');
    return s;
  }
  function initialize() {
    if (initialized || media.matches || (compact.matches && (navigator.connection?.saveData || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)))) return;
    canvas=document.createElement('canvas');
    canvas.className='cinematic-webgl';
    canvas.setAttribute('aria-hidden','true');
    canvas.setAttribute('role','presentation');
    stage.insertBefore(canvas,stage.firstChild);
    gl=canvas.getContext('webgl',{alpha:true,antialias:true,powerPreference:'low-power',premultipliedAlpha:false});
    if(!gl){canvas.remove();canvas=null;return;}
    try {
      const vert=makeShader(gl.VERTEX_SHADER,`
      attribute vec3 aPosition;attribute vec3 aColor;attribute float aSize;
      uniform float uTime;uniform float uProgress;uniform float uAspect;
      varying vec3 vColor;
      void main(){
        float a=uTime*.10+uProgress*2.3;
        float co=cos(a),si=sin(a);
        vec3 p=vec3(aPosition.x*co-aPosition.z*si,aPosition.y,aPosition.x*si+aPosition.z*co);
        float pitch=.27+sin(uTime*.16)*.07;
        p=vec3(p.x,p.y*cos(pitch)-p.z*sin(pitch),p.y*sin(pitch)+p.z*cos(pitch));
        float persp=3.5/(4.25-p.z);
        gl_Position=vec4(p.x*persp/uAspect,p.y*persp,0.,1.);
        gl_PointSize=min(12.,aSize*persp*2.);
        vColor=aColor;
      }`);
      const frag=makeShader(gl.FRAGMENT_SHADER,`
      precision mediump float;uniform float uPointMode;varying vec3 vColor;
      void main(){
        float opacity=.56;
        if(uPointMode>.5){
          vec2 uv=gl_PointCoord*2.-1.;
          float dist=dot(uv,uv);
          if(dist>1.)discard;
          opacity=.78*pow(1.-dist,1.4);
        }
        gl_FragColor=vec4(vColor,opacity);
      }`);
      const program=gl.createProgram();gl.attachShader(program,vert);gl.attachShader(program,frag);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)||'link');
      gl.useProgram(program);
      const geometry=lineData();
      const makeBuffer=data=>{const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);return b;};
      state={program,lines:makeBuffer(geometry.lines),points:makeBuffer(geometry.points),lineCount:geometry.lines.length/7,pointCount:geometry.points.length/7,
        attrs:[gl.getAttribLocation(program,'aPosition'),gl.getAttribLocation(program,'aColor'),gl.getAttribLocation(program,'aSize')],
        uniforms:[gl.getUniformLocation(program,'uTime'),gl.getUniformLocation(program,'uProgress'),gl.getUniformLocation(program,'uAspect'),gl.getUniformLocation(program,'uPointMode')]};
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.disable(gl.DEPTH_TEST);
      initialized=true;resize();
      canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();cancelAnimationFrame(frameId);initialized=false;state=null;});
    }catch(e){console.warn('Cinematic WebGL fallback:',e.message);canvas?.remove();canvas=null;gl=null;}
  }
  function resize(){
    if(!canvas||!gl)return;
    const w=canvas.clientWidth,h=canvas.clientHeight;
    const dpr=Math.min(devicePixelRatio||1,compact.matches ? 1 : 1.5);
    canvas.width=Math.min(1200,Math.max(1,Math.round(w*dpr)));
    canvas.height=Math.min(1000,Math.max(1,Math.round(h*dpr)));
    gl.viewport(0,0,canvas.width,canvas.height);
  }
  function bind(buffer){
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    const stride=7*4;
    for(const [i,size,offset] of [[0,3,0],[1,3,12],[2,1,24]]){
      if(state.attrs[i]===-1)continue;
      gl.enableVertexAttribArray(state.attrs[i]);
      gl.vertexAttribPointer(state.attrs[i],size,gl.FLOAT,false,stride,offset);
    }
  }
  function draw(now){
    frameId=0;
    if(!visible||stopped()||!gl||!state)return;
    if(now-last >= (compact.matches ? 40 : 33)){
      last=now;scrollProgress();
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(state.program);
      gl.uniform1f(state.uniforms[0],now*.001);
      gl.uniform1f(state.uniforms[1],progress);
      gl.uniform1f(state.uniforms[2],canvas.width/canvas.height);
      gl.uniform1f(state.uniforms[3],0);
      bind(state.lines);gl.drawArrays(gl.LINES,0,state.lineCount);
      gl.uniform1f(state.uniforms[3],1);
      bind(state.points);gl.drawArrays(gl.POINTS,0,state.pointCount);
    }
    frameId=requestAnimationFrame(draw);
  }
  function tick(){
    scrollProgress();
    if(!visible||stopped()){cancelAnimationFrame(frameId);frameId=0;return;}
    if(!initialized)initialize();
    if(gl&&state&&!frameId)frameId=requestAnimationFrame(draw);
  }
  const observer=new IntersectionObserver(entries=>{visible=entries.some(x=>x.isIntersecting);tick();},{rootMargin:'140px'});
  observer.observe(stage);
  addEventListener('scroll',scrollProgress,{passive:true});
  addEventListener('resize',()=>{resize();tick();},{passive:true});
  document.addEventListener('visibilitychange',tick);
  media.addEventListener?.('change',tick);
  compact.addEventListener?.('change',tick);
  document.querySelector('.motion-switch')?.addEventListener('click',()=>requestAnimationFrame(tick));
  document.querySelector('#show-cine')?.addEventListener('click',()=>requestAnimationFrame(tick));
  scrollProgress();
})();