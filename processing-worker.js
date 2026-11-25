"use strict";

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const MAX_ASCII_OUTPUT_PIXELS=4000000,MAX_WORKER_IMAGE_PIXELS=24000000;
const workerResourceMetrics={scratchCanvasesCreated:0,scratchCanvasesReleased:0,scratchPixelsReleased:0,sourceBitmapsClosed:0,processBitmapsClosed:0,outputBitmapsTransferred:0,outputBitmapsClosed:0};
const releasedWorkerCanvases=new WeakSet();
let activeCanvasAllocation=null;
const document={
  createElement(tag){
    if(tag!=="canvas")throw new Error("Unsupported worker element: "+tag);
    const canvas=new OffscreenCanvas(1,1);
    if(activeCanvasAllocation){activeCanvasAllocation.push(canvas);workerResourceMetrics.scratchCanvasesCreated++}
    return canvas;
  }
};
function releaseWorkerCanvas(canvas){
  if(!canvas||releasedWorkerCanvases.has(canvas))return;
  releasedWorkerCanvases.add(canvas);
  const pixels=Math.max(0,Number(canvas.width)||0)*Math.max(0,Number(canvas.height)||0);
  try{canvas.width=0;canvas.height=0}catch(error){}
  workerResourceMetrics.scratchCanvasesReleased++;
  workerResourceMetrics.scratchPixelsReleased+=pixels;
}
function releaseWorkerBitmap(bitmap,kind="process"){
  if(!bitmap||typeof bitmap.close!=="function")return;
  try{bitmap.close()}catch(error){}
  const key=kind==="source"?"sourceBitmapsClosed":kind==="output"?"outputBitmapsClosed":"processBitmapsClosed";
  workerResourceMetrics[key]++;
}
function workerResourceSnapshot(){
  let sourcePixels=0;
  for(const bitmap of sourceImages.values())sourcePixels+=Math.max(0,Number(bitmap.width)||0)*Math.max(0,Number(bitmap.height)||0);
  return {...workerResourceMetrics,sourceCount:sourceImages.size,sourcePixels};
}
function runTrackedProcess(bitmap,cfg,paletteColors,kind){
  const previousScope=activeCanvasAllocation,allocated=[];
  activeCanvasAllocation=allocated;
  let result=null;
  try{result=processImage(bitmap,cfg,paletteColors,kind)}
  catch(error){for(const canvas of allocated)releaseWorkerCanvas(canvas);throw error}
  finally{activeCanvasAllocation=previousScope}
  for(const canvas of allocated)if(canvas!==result?.canvas)releaseWorkerCanvas(canvas);
  return {result,releaseOutput:()=>releaseWorkerCanvas(result?.canvas)};
}
let s={},pal={},ascii="";
const def={shapeBands:[
  {shape:"circle",size:55,color:"#334b2b",rotation:0,customPath:"",customViewBox:[0,0,100,100]},
  {shape:"circle",size:70,color:"#7a9a47",rotation:0,customPath:"",customViewBox:[0,0,100,100]},
  {shape:"circle",size:85,color:"#b8d785",rotation:0,customPath:"",customViewBox:[0,0,100,100]},
  {shape:"circle",size:100,color:"#d9efad",rotation:0,customPath:"",customViewBox:[0,0,100,100]}
]};
const sourceImages=new Map();

function configure(cfg,paletteColors){
  s=cfg&&typeof cfg==="object"?cfg:{};
  const colors=Array.isArray(paletteColors)&&paletteColors.length>=2?paletteColors:["#10160f","#334b2b","#7a9a47","#d9efad"];
  pal={[String(s.palette||"moss")]:{c:colors}};
  ascii="";
}
function processImage(bitmap,cfg,paletteColors,kind){
  configure(cfg,paletteColors);
  let canvas;
  if(kind==="video")canvas=raster(bitmap,s);
  else if(kind==="script"||((kind==="batch")&&s.algorithm==="ascii"))canvas=makeAscii(bitmap,s);
  else canvas=rasterPipeline(bitmap,s);
  return {
    canvas,
    ascii,
    width:canvas.width,
    height:canvas.height,
    asciiRowsLimited:!!canvas.tgrmlitherAsciiRowsLimited,
    asciiNaturalRows:canvas.tgrmlitherAsciiNaturalRows||0,
    asciiRows:canvas.tgrmlitherAsciiRows||0
  };
}
function sendBitmap(id,result,extra={}){
  const width=result.width||result.canvas.width,height=result.height||result.canvas.height;
  let bitmap=null,transferred=false;
  try{
    bitmap=result.canvas.transferToImageBitmap();
    releaseWorkerCanvas(result.canvas);
    workerResourceMetrics.outputBitmapsTransferred++;
    try{
      self.postMessage({id,type:"result",bitmap,width,height,ascii:result.ascii,
        asciiRowsLimited:result.asciiRowsLimited,asciiNaturalRows:result.asciiNaturalRows,asciiRows:result.asciiRows,
        workerResources:workerResourceSnapshot(),...extra},[bitmap]);
      transferred=true;
    }catch(error){
      workerResourceMetrics.outputBitmapsTransferred--;
      throw error;
    }
  }finally{
    if(bitmap&&!transferred)releaseWorkerBitmap(bitmap,"output");
  }
}

async function handleMessage(data){
  const {id,type}=data||{};
  if(type==="set-source"){
    const bitmap=data.bitmap,pixels=Math.max(0,Number(bitmap?.width)||0)*Math.max(0,Number(bitmap?.height)||0);
    if(!bitmap||!pixels||pixels>MAX_WORKER_IMAGE_PIXELS){releaseWorkerBitmap(bitmap,"source");throw new Error("Worker source image exceeds the pixel budget")}
    for(const [oldId,old] of sourceImages){releaseWorkerBitmap(old,"source");sourceImages.delete(oldId)}
    sourceImages.set(data.sourceId,bitmap);
    self.postMessage({id,type:"source-ready",sourceId:data.sourceId,workerResources:workerResourceSnapshot()});
    return;
  }
  if(type==="clear-source"){
    const old=sourceImages.get(data.sourceId);
    if(old)releaseWorkerBitmap(old,"source");
    sourceImages.delete(data.sourceId);
    self.postMessage({id,type:"source-cleared",sourceId:data.sourceId,workerResources:workerResourceSnapshot()});
    return;
  }
  if(type==="resources"){
    self.postMessage({id,type:"resources",workerResources:workerResourceSnapshot()});
    return;
  }
  if(type==="render"){
    const image=sourceImages.get(data.sourceId);
    if(!image)throw new Error("Worker source image is missing");
    const task=runTrackedProcess(image,data.cfg,data.paletteColors,data.kind||"preview");
    try{sendBitmap(id,task.result,{sourceId:data.sourceId,renderRevision:data.renderRevision})}
    finally{task.releaseOutput()}
    return;
  }
  if(type==="process"){
    const image=data.bitmap;
    let task=null,inputClosed=false;
    try{
      const pixels=Math.max(0,Number(image?.width)||0)*Math.max(0,Number(image?.height)||0);
      if(!image||!pixels||pixels>MAX_WORKER_IMAGE_PIXELS)throw new Error("Worker processing image exceeds the pixel budget");
      task=runTrackedProcess(image,data.cfg,data.paletteColors,data.kind||"batch");
      releaseWorkerBitmap(image,"process");inputClosed=true;
      if(data.outputType==="blob"){
        const blob=await task.result.canvas.convertToBlob({type:data.mimeType||"image/png"});
        task.releaseOutput();
        self.postMessage({id,type:"result",blob,width:task.result.width,height:task.result.height,ascii:task.result.ascii,
          asciiRowsLimited:task.result.asciiRowsLimited,asciiNaturalRows:task.result.asciiNaturalRows,asciiRows:task.result.asciiRows,
          workerResources:workerResourceSnapshot()});
      }else sendBitmap(id,task.result,{width:task.result.width,height:task.result.height});
    }finally{
      task?.releaseOutput();
      if(!inputClosed)releaseWorkerBitmap(image,"process");
    }
    return;
  }
  throw new Error("Unknown processing worker message: "+type);
}
self.onmessage=event=>{
  const data=event.data||{};
  handleMessage(data).catch(error=>{
    self.postMessage({id:data.id,type:"error",message:error&&error.message?String(error.message):"Processing failed"});
  });
};

function hex(h){return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]}
function lumin(r,g,b){return .2126*r+.7152*g+.0722*b}

function colors(){let base=(pal[s.palette]||pal.moss).c.map(hex).sort((a,b)=>lumin(...a)-lumin(...b));if(s.colorMode==="mono")base=[[0,0,0],[255,255,255]];if(s.colorMode==="duo")base=[base[0],base[base.length-1]];const count=s.colorMode==="duo"?2:clamp(Number(s.levels)||4,2,16);if(count===base.length)return base;const result=[];for(let i=0;i<count;i++){const pos=i*(base.length-1)/(count-1),lo=Math.floor(pos),hi=Math.min(base.length-1,Math.ceil(pos)),t=pos-lo;result.push(base[lo].map((v,k)=>Math.round(v*(1-t)+base[hi][k]*t)))}return result}
function nearest(r,g,b,cs){let best=cs[0],dist=Infinity;for(const c of cs){let d=(r-c[0])**2+(g-c[1])**2+(b-c[2])**2;if(d<dist){dist=d;best=c}}return best}
const bayerMatrixCache=new Map();
function getBayer(n,x,y){let m=bayerMatrixCache.get(n);if(!m){m=[[0]];while(m.length<n){const a=m,nn=a.length,next=Array.from({length:nn*2},()=>Array(nn*2).fill(0));for(let yy=0;yy<nn;yy++)for(let xx=0;xx<nn;xx++){const v=a[yy][xx]*4;next[yy][xx]=v;next[yy][xx+nn]=v+2;next[yy+nn][xx]=v+3;next[yy+nn][xx+nn]=v+1}m=next}bayerMatrixCache.set(n,m)}return (m[((y%n)+n)%n][((x%n)+n)%n]+.5)/(n*n)}
let blueNoiseRankTable=null;
let beehiveThresholdTable=null;
function getBeehive(x,y){
 // Precompute the deterministic 16x16 hexagonal threshold tile only once.
 if(!beehiveThresholdTable){
  const size=16,table=new Float32Array(size*size);
  for(let py=0;py<size;py++)for(let px=0;px<size;px++){
   let nearest=Infinity;
   for(let row=-2;row<=2;row++){
    const cy=4+row*8,cxOffset=(Math.abs(row)%2)*4;
    for(let col=-2;col<=2;col++){
     const cx=4+col*8+cxOffset,dx=(px-cx)*.8660254038,dy=py-cy;
     const distance=Math.max(Math.abs(dx),Math.abs(dy),Math.abs(dx+dy)*.5,Math.abs(dx-dy)*.5);
     if(distance<nearest)nearest=distance;
    }
   }
   table[py*size+px]=clamp(nearest/7.5,0,1);
  }
  beehiveThresholdTable=table;
 }
 const size=16,px=((Math.floor(x)%size)+size)%size,py=((Math.floor(y)%size)+size)%size;
 return beehiveThresholdTable[py*size+px];
}
function getBlueNoise(x,y){
 if(!blueNoiseRankTable){
  const size=16,total=size*size,ranks=new Int16Array(total);ranks.fill(-1);
  const nearestDistance=new Float64Array(total);nearestDistance.fill(Infinity);
  const dist=(a,b)=>{const ax=a%size,ay=Math.floor(a/size),bx=b%size,by=Math.floor(b/size),dx=Math.min(Math.abs(ax-bx),size-Math.abs(ax-bx)),dy=Math.min(Math.abs(ay-by),size-Math.abs(ay-by));return dx*dx+dy*dy};
  let chosen=(size/2)*size+size/2;ranks[chosen]=0;
  for(let p=0;p<total;p++)nearestDistance[p]=dist(p,chosen);
  for(let rank=1;rank<total;rank++){
   let best=-1,bestDistance=-1;
   for(let p=0;p<total;p++)if(ranks[p]<0){const jitter=(((p*1103515245+12345)>>>0)/4294967296)*1e-8,score=nearestDistance[p]+jitter;if(score>bestDistance){best=p;bestDistance=score}}
   chosen=best;ranks[chosen]=rank;
   for(let p=0;p<total;p++)if(ranks[p]<0)nearestDistance[p]=Math.min(nearestDistance[p],dist(p,chosen));
  }
  blueNoiseRankTable=ranks;
 }
 const ix=((Math.floor(y)%16+16)%16)*16+((Math.floor(x)%16+16)%16);
 return (blueNoiseRankTable[ix]+.5)/256;
}
const diffusionKernels={
floyd:[[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]],atkinson:[[1,0,1/8],[2,0,1/8],[-1,1,1/8],[0,1,1/8],[1,1,1/8],[0,2,1/8]],
jarvis:[[1,0,7/48],[2,0,5/48],[-2,1,3/48],[-1,1,5/48],[0,1,7/48],[1,1,5/48],[2,1,3/48],[-2,2,1/48],[-1,2,3/48],[0,2,5/48],[1,2,3/48],[2,2,1/48]],
stucki:[[1,0,8/42],[2,0,4/42],[-2,1,2/42],[-1,1,4/42],[0,1,8/42],[1,1,4/42],[2,1,2/42],[-2,2,1/42],[-1,2,2/42],[0,2,4/42],[1,2,2/42],[2,2,1/42]],
burkes:[[1,0,8/32],[2,0,4/32],[-2,1,2/32],[-1,1,4/32],[0,1,8/32],[1,1,4/32],[2,1,2/32]],
sierra:[[1,0,5/32],[2,0,3/32],[-2,1,2/32],[-1,1,4/32],[0,1,5/32],[1,1,4/32],[2,1,2/32],[-1,2,2/32],[0,2,3/32],[1,2,2/32]],
sierra2:[[1,0,4/16],[2,0,3/16],[-2,1,1/16],[-1,1,2/16],[0,1,3/16],[1,1,2/16],[2,1,1/16]],sierraLite:[[1,0,2/4],[-1,1,1/4],[0,1,1/4]],fan:[[1,0,7/16],[-1,1,1/16],[0,1,5/16],[1,1,3/16]],shiau2:[[1,0,1/2],[-1,1,1/4],[0,1,1/4]],shiau3:[[1,0,3/8],[2,0,1/8],[-1,1,1/8],[0,1,1/4],[1,1,1/8]],
stevenson:[[2,0,32/200],[3,0,12/200],[-3,1,12/200],[-1,1,26/200],[1,1,30/200],[3,1,16/200],[-2,2,12/200],[0,2,26/200],[2,2,12/200],[-3,3,5/200],[-1,3,12/200],[1,3,12/200],[3,3,5/200]],
falseFloyd:[[1,0,3/8],[0,1,3/8],[1,1,2/8]],twoRow:[[1,0,4/16],[2,0,3/16],[-2,1,1/16],[-1,1,2/16],[0,1,3/16],[1,1,2/16],[2,1,1/16]],simpleDiff:[[1,0,1/2],[0,1,1/2]]};
const patternAlgorithms=["halftone","shape","crosshatch","diagonal","waves","concentric","lines","modulation","spiral","beehive"];
const glitchAlgorithms=["glitch_jpeg","glitch_chromatic","glitch_scanlines","glitch_rows","glitch_pixels","glitch_blocks","glitch_tearing","glitch_static","glitch_bitcrush","glitch_interlace","glitch_vhs","glitch_wave","glitch_sort","glitch_mosh","glitch_color","glitch_negative","glitch_shift"];
const specialAlgorithms=["special_cmyk","special_threshold","special_posterize","special_edges","special_emboss","special_contour","special_mosaic","special_stipple","special_thermal","special_xray","special_relief","special_ditherMask","special_grainMap","special_invertBands","special_woodcut","special_outline"];

function downsample(image,cfg){const budget=cfg.qualityMode==="ultra"?8294400:cfg.qualityMode==="max"?2400000:cfg.qualityMode==="detail"?1200000:480000;let step=Math.max(Number(cfg.scale)||1,Math.sqrt(image.width*image.height/budget)),w=Math.max(1,Math.ceil(image.width/step)),h=Math.max(1,Math.ceil(image.height/step));while(w*h>budget){step*=Math.sqrt((w*h)/budget)*1.01;w=Math.max(1,Math.ceil(image.width/step));h=Math.max(1,Math.ceil(image.height/step))}const c=document.createElement("canvas");c.width=w;c.height=h;const x=c.getContext("2d",{willReadFrequently:true});if(cfg.blur)x.filter="blur("+cfg.blur+"px)";x.drawImage(image,0,0,w,h);x.filter="none";const im=x.getImageData(0,0,w,h),d=im.data;for(let i=0;i<d.length;i+=4)for(let j=0;j<3;j++){let v=clamp((d[i+j]-128)*cfg.contrast/100+128+cfg.brightness+Number(cfg.threshold||0)*1.25,0,255)/255;v=Math.pow(v,Math.pow(2,(50-clamp(Number(cfg.midtones??50),0,100))/50));const hi=(Number(cfg.highlights??50)-50)/50;v=clamp(v+hi*Math.max(0,v-.5)*Math.max(0,v-.5)*1.4,0,1);if(cfg.invert)v=1-v;d[i+j]=Math.round(v*255)}return {w,h,step,im,d}}
function applyEffects(c,cfg,step){const order=[...(cfg.effectOrder||Object.keys(cfg.effectStrength||{}))];for(const k of Object.keys(cfg.effectStrength||{}))if(!order.includes(k))order.push(k);for(const key of order){if(!(cfg.effects||[]).includes(key))continue;const a=clamp(Number((cfg.effectStrength||{})[key]??50),0,100)/100;if(a)applyEffectLayer(c,key,a,step)}}
function applyEffectsBounded(image,cfg,step){const activeEffects=(Array.isArray(cfg.effects)?cfg.effects:[]).some(key=>clamp(Number((cfg.effectStrength||{})[key]??50),0,100)>0);if(!activeEffects)return;const budget=cfg.qualityMode==="ultra"?8294400:cfg.qualityMode==="max"?2400000:cfg.qualityMode==="detail"?1200000:480000;let factor=Math.max(1,Math.sqrt(image.width*image.height/budget)),w=Math.max(1,Math.ceil(image.width/factor)),h=Math.max(1,Math.ceil(image.height/factor));while(w*h>budget){factor*=Math.sqrt((w*h)/budget)*1.01;w=Math.max(1,Math.ceil(image.width/factor));h=Math.max(1,Math.ceil(image.height/factor))}if(factor<=1){applyEffects(image,cfg,step);return}const work=document.createElement("canvas");work.width=w;work.height=h;const wx=work.getContext("2d",{willReadFrequently:true});wx.imageSmoothingEnabled=false;wx.drawImage(image,0,0,w,h);applyEffects(work,cfg,Math.max(1,step/factor));const ctx=image.getContext("2d");ctx.clearRect(0,0,image.width,image.height);ctx.imageSmoothingEnabled=false;ctx.drawImage(work,0,0,image.width,image.height)}
function applyEffectLayer(c,key,a,step){const x=c.getContext("2d"),w=c.width,h=c.height;if(key==="chromatic"){const im=x.getImageData(0,0,w,h),d=im.data,s=new Uint8ClampedArray(d),sh=Math.max(1,Math.round(step*a));for(let y=0;y<h;y++)for(let xx=0;xx<w;xx++){let i=(y*w+xx)*4,l=(y*w+Math.max(0,xx-sh))*4,r=(y*w+Math.min(w-1,xx+sh))*4;d[i]=s[l];d[i+2]=s[r+2]}x.putImageData(im,0,0);return}if(key==="glow"||key==="epsilon"){const t=document.createElement("canvas");t.width=w;t.height=h;t.getContext("2d").drawImage(c,0,0);if(key==="epsilon"){const q=t.getContext("2d",{willReadFrequently:true}),im=q.getImageData(0,0,w,h),d=im.data;for(let i=0;i<d.length;i+=4){const l=(d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722)/255;d[i+3]=Math.round(d[i+3]*clamp((l-.18)*3.2,0,1))}q.putImageData(im,0,0)}x.save();x.globalCompositeOperation="screen";x.globalAlpha=(key==="epsilon"?.7:.5)*a;x.filter="blur("+Math.max(1,step*(key==="epsilon"?2:1.2)*a)+"px)";x.drawImage(t,0,0);x.restore();x.filter="none";return}if(key==="scanlines"||key==="modlines"){x.save();x.globalAlpha=(key==="scanlines"?.34:.45)*a;x.fillStyle="#030403";const gap=Math.max(3,Math.round(step*(key==="modlines"?.65:.9)));for(let y=0;y<h;y+=gap)x.fillRect(0,y+(key==="modlines"?Math.sin(y/Math.max(4,step*3))*step*a:0),w,Math.max(1,gap*.2));x.restore();return}if(key==="vignette"){const g=x.createRadialGradient(w/2,h/2,Math.min(w,h)*.18,w/2,h/2,Math.max(w,h)*.75);g.addColorStop(0,"rgba(0,0,0,0)");g.addColorStop(1,"rgba(0,0,0,"+(.9*a)+")");x.fillStyle=g;x.fillRect(0,0,w,h);return}if(key==="noise"){const im=x.getImageData(0,0,w,h),d=im.data;for(let i=0;i<d.length;i+=4){const n=(Math.random()-.5)*34*a;for(let k=0;k<3;k++)d[i+k]=clamp(d[i+k]+n,0,255)}x.putImageData(im,0,0);return}if(key==="jpeg"){const t=document.createElement("canvas"),q=Math.max(2,Math.round(step*(1+a*2)));t.width=Math.max(1,w/q|0);t.height=Math.max(1,h/q|0);t.getContext("2d").drawImage(c,0,0,t.width,t.height);x.save();x.globalAlpha=.8*a;x.imageSmoothingEnabled=false;x.drawImage(t,0,0,w,h);x.restore();return}if(key==="stress"){const t=document.createElement("canvas");t.width=w;t.height=h;t.getContext("2d").drawImage(c,0,0);x.clearRect(0,0,w,h);const row=Math.max(2,Math.round(step*.7));for(let y=0;y<h;y+=row){const sh=Math.round(Math.sin(y*.13)*step*3*a);x.drawImage(t,0,y,w,Math.min(row,h-y),sh,y,w,Math.min(row,h-y))}return}if(key==="lick"){const t=document.createElement("canvas");t.width=w;t.height=h;t.getContext("2d").drawImage(c,0,0);const q=t.getContext("2d",{willReadFrequently:true}),pixels=q.getImageData(0,0,w,h).data;x.save();x.globalAlpha=.5*a;x.lineCap="round";const stride=Math.max(4,Math.round(step*1.5));for(let y=0;y<h;y+=stride)for(let xx=0;xx<w;xx+=stride){const i=(y*w+xx)*4;x.strokeStyle="rgb("+pixels[i]+","+pixels[i+1]+","+pixels[i+2]+")";x.lineWidth=Math.max(1,stride*.22);x.beginPath();x.moveTo(xx,y);x.lineTo(xx+stride*.7,y+stride*.25);x.stroke()}x.restore();return}}

function drawShapeGlyph(x,shape,size,step){
 const r=Math.max(.5,size/2);
 x.beginPath();
 if(shape==="circle"){x.arc(0,0,r,0,Math.PI*2);x.fill();return}
 if(shape==="square")x.rect(-r,-r,size,size);
 else if(shape==="diamond"){x.moveTo(0,-r);x.lineTo(r,0);x.lineTo(0,r);x.lineTo(-r,0);x.closePath()}
 else if(shape==="triangle"){x.moveTo(0,-r);x.lineTo(r,r);x.lineTo(-r,r);x.closePath()}
 else if(shape==="line")x.rect(-step/2,-Math.max(1,size*.1),step,Math.max(1,size*.2));
 else if(shape==="hexagon"){for(let i=0;i<6;i++){const a=-Math.PI/2+i*Math.PI/3,px=Math.cos(a)*r,py=Math.sin(a)*r;if(i===0)x.moveTo(px,py);else x.lineTo(px,py)}x.closePath()}
 else if(shape==="star"){for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rad=i%2?r*.43:r,px=Math.cos(a)*rad,py=Math.sin(a)*rad;if(i===0)x.moveTo(px,py);else x.lineTo(px,py)}x.closePath()}
 else if(shape==="ring"){x.arc(0,0,r,0,Math.PI*2);x.lineWidth=Math.max(1,size*.14);x.stroke();return}
 else if(shape==="chevron"){x.moveTo(-r,-r*.55);x.lineTo(0,0);x.lineTo(r,-r*.55);x.lineTo(r,r*.1);x.lineTo(0,r*.7);x.lineTo(-r,r*.1);x.closePath()}
 else{x.rect(-size*.11,-r,size*.22,size);x.rect(-r,-size*.11,size,size*.22)}
 x.fill()
}
function raster(image,cfg){let customPath=null;if(cfg.customShapePath)try{customPath=new Path2D(cfg.customShapePath)}catch(e){}const shapeThresholds=(Array.isArray(cfg.shapeThresholds)?cfg.shapeThresholds:[25,50,75]).map(v=>clamp(Number(v)||0,0,100)).sort((a,b)=>a-b);const customBandShapes=(cfg.shapeBands||[]).map(b=>{if(!b?.customPath)return null;try{return {path:new Path2D(b.customPath),viewBox:b.customViewBox}}catch(e){return null}});let p=downsample(image,cfg),{w,h,step,im,d}=p,cs=colors(),n=cs.length,alg=cfg.algorithm;
if(diffusionKernels[alg]){for(let y=0;y<h;y++){const reverse=!!cfg.serpentine&&y%2===1,start=reverse?w-1:0,stop=reverse?-1:w,inc=reverse?-1:1;for(let x=start;x!==stop;x+=inc){let i=(y*w+x)*4,old=[d[i],d[i+1],d[i+2]],co=nearest(...old,cs);for(let k=0;k<3;k++)d[i+k]=co[k];let er=old.map((v,k)=>v-co[k]);for(const [baseDx,dy,f] of diffusionKernels[alg]){const dx=reverse?-baseDx:baseDx,xx=x+dx,yy=y+dy;if(xx<0||xx>=w||yy<0||yy>=h)continue;let j=(yy*w+xx)*4;for(let k=0;k<3;k++)d[j+k]=clamp(d[j+k]+er[k]*f,0,255)}}}}
else if(["bayer2","bayer4","bayer8","bayer16","blueNoise","clustered4","clustered8","beehive","pixel"].includes(alg)){let size=alg==="bayer2"?2:alg==="bayer8"||alg==="clustered8"?8:alg==="bayer16"||alg==="blueNoise"||alg==="beehive"?16:4;for(let y=0;y<h;y++)for(let x=0;x<w;x++){let i=(y*w+x)*4,v=clamp(lumin(d[i],d[i+1],d[i+2])/255,0,1),t=alg==="blueNoise"?getBlueNoise(x,y):alg==="beehive"?getBeehive(x,y):getBayer(size,x,y);if(alg.startsWith("clustered")){const mid=size/2-.5;t=clamp(1-Math.hypot(x%size-mid,y%size-mid)/(size*.72),0,1)}else if(alg==="pixel")t=.5;v=clamp(v+(t-.5)/(n-1||1),0,1);let co=cs[Math.round(v*(n-1))];for(let k=0;k<3;k++)d[i+k]=co[k]}}
im.data.set(d);let low=document.createElement("canvas");low.width=w;low.height=h;low.getContext("2d").putImageData(im,0,0);let c=document.createElement("canvas");c.width=image.width;c.height=image.height;let x=c.getContext("2d");x.imageSmoothingEnabled=false;
if(patternAlgorithms.includes(alg)){let dark=cs[0],light=cs[cs.length-1];x.fillStyle="rgb("+dark.join(",")+")";x.fillRect(0,0,c.width,c.height);for(let y=0;y<h;y++)for(let xx=0;xx<w;xx++){
 let i=(y*w+xx)*4,v=clamp(lumin(d[i],d[i+1],d[i+2])/255+cfg.threshold/255,0,1),markScale=clamp(Number(cfg.markScale??100),20,180)/100;
 let cx=xx*step+step/2+(alg==="beehive"&&y%2?step/2:0),cy=y*step+step/2;
 if(alg==="halftone"||alg==="beehive"){
  const angle=clamp(Number(cfg.patternAngle??45),0,180)*Math.PI/180,dx=cx-c.width/2,dy=cy-c.height/2;
  if(angle){const cos=Math.cos(angle),sin=Math.sin(angle);cx=c.width/2+dx*cos-dy*sin;cy=c.height/2+dx*sin+dy*cos}
  const sampleX=Math.round((cx-step/2)/step),sampleY=Math.round((cy-step/2)/step);
  if(sampleX<0||sampleX>=w||sampleY<0||sampleY>=h)continue;
  i=(sampleY*w+sampleX)*4;v=clamp(lumin(d[i],d[i+1],d[i+2])/255+cfg.threshold/255,0,1);
 }
 if(v<.03)continue;
 let sz=step*(alg==="halftone"||alg==="beehive"?v:Math.max(.06,v))*(1-cfg.jitter/100+cfg.jitter/100*(((xx*17+y*13)%11)/10))*markScale;
 x.fillStyle="rgb("+light.join(",")+")";x.beginPath();let sh=alg==="halftone"?(cfg.patternShape||"circle"):alg==="beehive"?"hexagon":cfg.shape;
if(alg==="shape"){const bi=v*100<=shapeThresholds[0]?0:v*100<=shapeThresholds[1]?1:v*100<=shapeThresholds[2]?2:3,band=(cfg.shapeBands||def.shapeBands)[bi]||{};sh=band.shape||sh;sz*=clamp((Number(band.size)||100)/100,.2,1.8);x.fillStyle=band.color||"rgb("+light.join(",")+")";if(cfg.shapeDistribution==="radial")sz*=clamp(.5+Math.hypot(cx-c.width/2,cy-c.height/2)/Math.max(c.width,c.height),.5,1.3);else if(cfg.shapeDistribution==="horizontal")sz*=.55+.8*cy/c.height;else if(cfg.shapeDistribution==="vertical")sz*=.55+.8*cx/c.width;else if(cfg.shapeDistribution==="random")sz*=.7+(((xx*31+y*13)%17)/30);else if(cfg.shapeDistribution==="wave")sz*=.62+.38*(.5+.5*Math.sin((cx+cy)*Math.PI/Math.max(12,step*8)));else if(cfg.shapeDistribution==="edge"){const li=(y*w+Math.max(0,xx-1))*4,ri=(y*w+Math.min(w-1,xx+1))*4,edge=Math.abs(lumin(d[ri],d[ri+1],d[ri+2])-lumin(d[li],d[li+1],d[li+2]))/255;sz*=.55+Math.min(1.1,edge*4)}x.save();x.translate(cx,cy);x.rotate(((Number(cfg.shapeRotation)||0)+(Number(band.rotation)||0))*Math.PI/180);const custom=customBandShapes[bi]||(customPath?{path:customPath,viewBox:cfg.customShapeViewBox}:null);if(sh==="custom"&&custom){const raw=custom.viewBox,vb=Array.isArray(raw)&&raw.length===4&&raw[2]>0&&raw[3]>0?raw:[0,0,100,100];x.scale(sz/vb[2],sz/vb[3]);x.translate(-vb[0]-vb[2]/2,-vb[1]-vb[3]/2);x.fill(custom.path);x.restore();continue}drawShapeGlyph(x,sh,sz,step);x.restore();continue}
if(alg==="spiral"){x.save();x.translate(cx,cy);x.rotate((Number(cfg.patternAngle??45)||0)*Math.PI/180);x.strokeStyle="rgb("+light.join(",")+")";x.lineWidth=Math.max(.45,step*(.035+v*.045));x.beginPath();const turns=1.2+v*2.2,segments=30;for(let k=0;k<=segments;k++){const t=k/segments,rad=step*.46*t*(.2+v*.8),ang=t*turns*Math.PI*2;if(k===0)x.moveTo(Math.cos(ang)*rad,Math.sin(ang)*rad);else x.lineTo(Math.cos(ang)*rad,Math.sin(ang)*rad)}x.stroke();x.restore();continue}
if(alg==="crosshatch"||alg==="diagonal"){x.strokeStyle="rgb("+light.join(",")+")";x.lineWidth=Math.max(.5,step*.07);x.save();x.translate(cx,cy);x.rotate((Number(cfg.patternAngle??45)||0)*Math.PI/180);const count=Math.max(1,Math.round(v*5));for(let j=0;j<count;j++){const off=(j-(count-1)/2)*step/(count+1);x.beginPath();x.moveTo(-step*.55,off);x.lineTo(step*.55,off);x.stroke()}if(alg==="crosshatch"&&v>.55){x.rotate(Math.PI/2);for(let j=0;j<Math.ceil(v*3);j++){let off=(j-(Math.ceil(v*3)-1)/2)*step/4;x.beginPath();x.moveTo(-step*.55,off);x.lineTo(step*.55,off);x.stroke()}}x.restore();continue}
if(alg==="waves"||alg==="modulation"){x.strokeStyle="rgb("+light.join(",")+")";x.lineWidth=Math.max(.5,step*(.06+v*.17));x.beginPath();for(let k=0;k<=8;k++){let px=xx*step+k*step/8,py=cy+Math.sin(k*Math.PI/2+v*4+(Number(cfg.patternAngle)||0)*Math.PI/180)*step*(.12+(1-v)*.2);if(k===0)x.moveTo(px,py);else x.lineTo(px,py)}x.stroke();if(alg==="modulation"&&v>.35){x.beginPath();x.moveTo(xx*step,cy+step*.28);x.lineTo((xx+1)*step,cy+step*.28);x.stroke()}continue}
if(alg==="concentric"){x.strokeStyle="rgb("+light.join(",")+")";x.lineWidth=Math.max(.5,step*.06);for(let r=step*.13;r<step*.52;r+=Math.max(1,step/7)){x.beginPath();x.arc(cx,cy,r*(.45+v*.6),0,Math.PI*2);x.stroke()}continue}
if(alg==="lines"){x.fillStyle="rgb("+light.join(",")+")";x.fillRect(xx*step,cy-sz/2,step,Math.max(1,sz));continue}
if((alg==="halftone"||alg==="beehive")&&v<.03)continue;if(alg==="halftone"||alg==="beehive")sz=step*v*markScale;
x.save();x.translate(cx,cy);x.rotate((Number(cfg.patternAngle)||0)*Math.PI/180);drawShapeGlyph(x,sh,sz,step);x.restore()}}
else{}if(patternAlgorithms.includes(alg)){if((cfg.effects||[]).length){const post=document.createElement("canvas");post.width=w;post.height=h;const px=post.getContext("2d",{willReadFrequently:true});px.imageSmoothingEnabled=false;px.drawImage(c,0,0,w,h);applyEffects(post,cfg,1);x.clearRect(0,0,c.width,c.height);x.imageSmoothingEnabled=false;x.drawImage(post,0,0,c.width,c.height)}}else{if(specialAlgorithms.includes(alg))applySpecial(low,alg,1);if(glitchAlgorithms.includes(alg))applyGlitch(low,alg,1,cfg);applyEffects(low,cfg,1);x.drawImage(low,0,0,c.width,c.height)}return c}
function rasterPipeline(image,cfg){
 let current=raster(image,{...cfg,effects:[],algorithmLayers:[]});
 const layers=(cfg.algorithmLayers||[]).filter(layer=>layer&&layer.enabled!==false&&Number(layer.opacity)>0).slice(0,4);
 for(const layer of layers){
  const rendered=raster(current,{...cfg,algorithm:layer.algorithm,effects:[],algorithmLayers:[]});
  const ctx=current.getContext("2d");ctx.save();
  ctx.globalAlpha=clamp(Number(layer.opacity)||0,0,100)/100;
  ctx.globalCompositeOperation=({"normal":"source-over","multiply":"multiply","screen":"screen","overlay":"overlay","darken":"darken","lighten":"lighten","difference":"difference"})[layer.blend]||"source-over";
  ctx.drawImage(rendered,0,0);ctx.restore();
 }
 applyEffectsBounded(current,cfg,Math.max(1,Number(cfg.scale)||5));
 const smoothing=clamp(Number(cfg.smoothing??0),0,100)/100;
 if(smoothing>0){const softened=document.createElement("canvas");softened.width=current.width;softened.height=current.height;softened.getContext("2d").drawImage(current,0,0);const ctx=current.getContext("2d");ctx.save();ctx.globalAlpha=smoothing*.78;ctx.filter="blur("+Math.max(.2,Math.min(5,(Number(cfg.scale)||5)*.36*smoothing))+"px)";ctx.drawImage(softened,0,0);ctx.restore();ctx.filter="none"}
 const blend=clamp(Number(cfg.blend??100),0,100)/100;
 if(blend<1){const mixed=document.createElement("canvas");mixed.width=image.width;mixed.height=image.height;const ctx=mixed.getContext("2d");ctx.drawImage(image,0,0);ctx.globalAlpha=blend;ctx.drawImage(current,0,0);ctx.globalAlpha=1;current=mixed}
 return current;
}
function applySpecial(c,alg,step){const x=c.getContext("2d",{willReadFrequently:true}),w=c.width,h=c.height;if(alg==="special_mosaic"){const t=document.createElement("canvas"),q=Math.max(2,Math.round(step*1.8));t.width=Math.max(1,w/q|0);t.height=Math.max(1,h/q|0);t.getContext("2d").drawImage(c,0,0,t.width,t.height);x.imageSmoothingEnabled=false;x.clearRect(0,0,w,h);x.drawImage(t,0,0,w,h);return}if(alg==="special_cmyk"){const srcCan=document.createElement("canvas");srcCan.width=w;srcCan.height=h;const sc=srcCan.getContext("2d",{willReadFrequently:true});sc.drawImage(c,0,0);const src=sc.getImageData(0,0,w,h).data,cell=Math.max(4,Math.round(step)),angles=[Math.PI/4,Math.PI/4+Math.PI/3,Math.PI/4+2*Math.PI/3,0],inks=["#00a8e0","#e6007e","#f2d400","#1d1d1b"];x.fillStyle="#f3efe5";x.fillRect(0,0,w,h);for(let y=0;y<h;y+=cell)for(let xx=0;xx<w;xx+=cell){const i=(Math.min(h-1,y+(cell>>1))*w+Math.min(w-1,xx+(cell>>1)))*4,R=src[i]/255,G=src[i+1]/255,B=src[i+2]/255,K=1-Math.max(R,G,B),vals=[(1-R-K)/(1-K||1),(1-G-K)/(1-K||1),(1-B-K)/(1-K||1),K];for(let k=0;k<4;k++){const radius=cell*.48*clamp(vals[k],0,1);x.fillStyle=inks[k];x.beginPath();x.arc(xx+cell/2+Math.cos(angles[k])*cell*.04,y+cell/2+Math.sin(angles[k])*cell*.04,radius,0,Math.PI*2);x.fill()}}return}const im=x.getImageData(0,0,w,h),d=im.data,src=new Uint8ClampedArray(d);for(let y=0;y<h;y++)for(let xx=0;xx<w;xx++){const i=(y*w+xx)*4,l=(src[i]*.2126+src[i+1]*.7152+src[i+2]*.0722)/255;let v=l;if(alg==="special_threshold")v=l>.5?1:0;else if(alg==="special_posterize")v=Math.round(l*3)/3;else if(alg==="special_invertBands")v=Math.floor(l*6)%2?1-l:l;else if(alg==="special_thermal"){const r=[[8,8,56],[44,63,159],[28,177,168],[236,215,80],[255,100,20],[255,250,220]],p=l*5,a=p|0,b=Math.min(5,a+1),t=p-a;for(let k=0;k<3;k++)d[i+k]=Math.round(r[a][k]*(1-t)+r[b][k]*t);continue}else if(alg==="special_xray"){d[i]=255*(1-l);d[i+1]=100+155*l;d[i+2]=255;continue}else if(alg==="special_grainMap")v=clamp(l+((((xx*17+y*29+(xx*y)%23)%19)-9)*5)/255,0,1);else if(["special_edges","special_contour","special_emboss","special_relief","special_woodcut","special_outline"].includes(alg)){const le=(y*w+Math.max(0,xx-1))*4,ri=(y*w+Math.min(w-1,xx+1))*4,up=(Math.max(0,y-1)*w+xx)*4,dn=(Math.min(h-1,y+1)*w+xx)*4,gx=src[ri]*.2126+src[ri+1]*.7152+src[ri+2]*.0722-(src[le]*.2126+src[le+1]*.7152+src[le+2]*.0722),gy=src[dn]*.2126+src[dn+1]*.7152+src[dn+2]*.0722-(src[up]*.2126+src[up+1]*.7152+src[up+2]*.0722),edge=clamp(Math.hypot(gx,gy)*1.7,0,255)/255;if(alg==="special_emboss"||alg==="special_relief")v=clamp(.5+(gx+gy)/255*2,0,1);else if(alg==="special_contour"){const bands=8,leftL=lumin(src[le],src[le+1],src[le+2])/255,upL=lumin(src[up],src[up+1],src[up+2])/255,band=Math.floor(l*bands),boundary=band!==Math.floor(leftL*bands)||band!==Math.floor(upL*bands);v=boundary?0:clamp((band+.5)/bands,0,1)}else if(alg==="special_edges")v=edge>.14?1:0;else if(alg==="special_outline")v=edge>.12?0:1;else if(alg==="special_woodcut")v=edge>.14?0:l;else v=edge>.16?0:l}else if(alg==="special_ditherMask")v=l+getBayer(4,xx,y)*.4>.68?1:0;else if(alg==="special_stipple")v=l>getBlueNoise(xx,y)?1:0;for(let k=0;k<3;k++)d[i+k]=Math.round(clamp(v*255+(alg==="special_emboss"||alg==="special_relief"?(k===0?12:k===2?-12:0):0),0,255))}x.putImageData(im,0,0)}
function applyGlitch(c,alg,step,cfg){const x=c.getContext("2d"),w=c.width,h=c.height,a=clamp(Number(cfg.depth??70)/100,.1,1),tmp=document.createElement("canvas");tmp.width=w;tmp.height=h;tmp.getContext("2d").drawImage(c,0,0);if(["glitch_chromatic","glitch_shift"].includes(alg)){const im=x.getImageData(0,0,w,h),d=im.data,src=new Uint8ClampedArray(d),sh=Math.max(1,Math.round(step*(1+a*3)));for(let y=0;y<h;y++)for(let xx=0;xx<w;xx++){let i=(y*w+xx)*4,l=(y*w+Math.max(0,xx-sh))*4,r=(y*w+Math.min(w-1,xx+sh))*4;d[i]=src[l];d[i+2]=src[r+2]}x.putImageData(im,0,0);return}if(["glitch_scanlines","glitch_interlace"].includes(alg)){x.save();x.globalAlpha=.45*a;x.fillStyle="#050505";for(let y=0;y<h;y+=Math.max(2,Math.round(step*.8)))x.fillRect(0,y,w,Math.max(1,step*.13));if(alg==="glitch_interlace"){x.globalAlpha=.22;x.drawImage(tmp,step,0)}x.restore();return}if(["glitch_rows","glitch_tearing","glitch_wave","glitch_mosh"].includes(alg)){x.clearRect(0,0,w,h);const row=Math.max(2,Math.round(step*(alg==="glitch_wave"?1.5:.7)));for(let y=0;y<h;y+=row){let sh=alg==="glitch_wave"?Math.sin(y/Math.max(4,step*3))*step*4*a:(((Math.floor(y/row)*17)%13)-6)*step*a*(alg==="glitch_tearing"?2:1);if(alg==="glitch_mosh"&&Math.floor(y/row)%5===0)sh*=2.8;x.drawImage(tmp,0,y,w,Math.min(row,h-y),clamp(Math.round(sh),-w*.3,w*.3),y,w,Math.min(row,h-y))}return}if(["glitch_pixels","glitch_sort"].includes(alg)){const sm=document.createElement("canvas");sm.width=Math.min(400,w);sm.height=Math.max(1,Math.round(sm.width*h/w));const q=sm.getContext("2d",{willReadFrequently:true});q.drawImage(tmp,0,0,sm.width,sm.height);const im=q.getImageData(0,0,sm.width,sm.height),d=im.data;for(let y=0;y<sm.height;y++){let start=(y*7)%Math.max(1,sm.width),len=Math.min(sm.width-start,Math.max(4,Math.round(step*(2+a*8)))),r=[];for(let xx=start;xx<start+len;xx++){let i=(y*sm.width+xx)*4;r.push([d[i],d[i+1],d[i+2],d[i+3],d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722])}if(alg==="glitch_sort")r.sort((p,q)=>p[4]-q[4]);else r.reverse();r.forEach((v,k)=>{let i=(y*sm.width+start+k)*4;d[i]=v[0];d[i+1]=v[1];d[i+2]=v[2];d[i+3]=v[3]})}q.putImageData(im,0,0);x.imageSmoothingEnabled=false;x.globalAlpha=.9;x.drawImage(sm,0,0,w,h);x.globalAlpha=1;return}if(["glitch_blocks","glitch_color"].includes(alg)){x.save();x.globalAlpha=.5*a;for(let i=0;i<26;i++){let bx=(i*97)%Math.max(1,w),by=(i*53)%Math.max(1,h),bw=Math.min(w-bx,Math.max(2,step*(2+i%6))),bh=Math.min(h-by,Math.max(2,step*(1+i%4)));if(alg==="glitch_color"){x.fillStyle=["#ff426f","#43f6e8","#f9ec5d","#6e52ff"][i%4];x.fillRect(bx,by,bw,bh)}else x.drawImage(tmp,bx,by,bw,bh,clamp(bx+(i%2?1:-1)*step*3*a,0,w-bw),by,bw,bh)}x.restore();return}if(["glitch_static","glitch_vhs"].includes(alg)){const im=x.getImageData(0,0,w,h),d=im.data;for(let y=0;y<h;y++)for(let xx=0;xx<w;xx++){const i=(y*w+xx)*4,n=(((xx*37+y*17+(xx*y)%31)%23)-11)*a*3;for(let k=0;k<3;k++)d[i+k]=clamp(d[i+k]+n,0,255);if(alg==="glitch_vhs"&&y%Math.max(4,step*4)<step){d[i]=Math.min(255,d[i]+30*a);d[i+2]=Math.min(255,d[i+2]+55*a)}}x.putImageData(im,0,0);return}if(alg==="glitch_bitcrush"){const im=x.getImageData(0,0,w,h),d=im.data,n=Math.max(2,Math.round(10-8*a));for(let i=0;i<d.length;i+=4)for(let k=0;k<3;k++)d[i+k]=Math.round(d[i+k]/255*(n-1))*255/(n-1);x.putImageData(im,0,0);return}if(alg==="glitch_negative"){const im=x.getImageData(0,0,w,h),d=im.data;for(let y=0;y<h;y++)if(Math.floor(y/Math.max(4,step*2))%4===0)for(let xx=0;xx<w;xx++){let i=(y*w+xx)*4;for(let k=0;k<3;k++)d[i+k]=255-d[i+k]}x.putImageData(im,0,0);return}if(alg==="glitch_jpeg"){const sm=document.createElement("canvas"),q=Math.max(2,Math.round(step*(1+a*3)));sm.width=Math.max(1,Math.floor(w/q));sm.height=Math.max(1,Math.floor(h/q));sm.getContext("2d").drawImage(tmp,0,0,sm.width,sm.height);x.imageSmoothingEnabled=false;x.globalAlpha=.85*a;x.drawImage(sm,0,0,w,h);x.globalAlpha=1;return}}

const asciiSets={"classic":"@%#*+=-:. ","lowercase":"@abcdefghij","uppercase":"@ABCDEFGHIJ","latin":"ÆØÅÐÞßæøå","digits":"9876543210","hex":"0123456789ABCDEF","binary":"10","binaryBlocks":"█ ░█▓","punctuation":".,:;!?/\\\\|()[]{}<>","symbols":"◆◇○●□■△▲▽▼◈","math":"∑∏∫√∞≈≠≤≥±×÷","currency":"$€£¥₿¢₽₹₩","morse":"·−−··−·−·","monospaced":"▉▊▋▌▍▎▏ ","geometric":"■◆●▲· ","squares":"■□▪▫▣▤▥▦▧","triangles":"▲△▶▷▼▽◀◁","circles":"●○◉◎◌◍◐◑","stars":"★☆✦✧✩✪✫✬","blocks":"█▓▒░ .","shades":"█▓▒░ ","boxdraw":"┏┳┓┣╋┫┗┻┛","arrows":"←↖↑↗→↘↓↙↔↕","arrowsWide":"⇐⇖⇑⇗⇒⇘⇓⇙⇔⇕","ornamental":"❦❧❖✤✥✣✢✺","emoji":"█▓▒░◆◇●○","cards":"♠♥♦♣♤♡♢♧","chess":"♔♕♖♗♘♙♚♛♜♝♞♟","dice":"⚀⚁⚂⚃⚄⚅","domino":"🁣🁤🁥🁦🁧🁨","music":"♩♪♫♬♭♮♯","astrology":"☉☽☿♀♁♂♃♄","alchemy":"🜁🜂🜃🜄🜍🜔🜚","medieval":"♜♞♝♛♚⚔☩✠†‡","runes":"ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾ","runes2":"ᚠᚦᚩᚱᚳᚷᚹᛉᛏ","braille":"⣿⣷⣤⣀⠀","brailleFine":"⣿⣷⣯⣟⡿⢿⠿⠛","cyrillic":"ЖФЦЩЪЫЬЭЮЯ","greek":"ΩΨΦΧΥΤΣΡΠΝΜΛΚΙΘΗΖΕΔΓΒΑ","hebrew":"אבגדהוזחטי","arabic":"ابجدهوزحطي","hiragana":"あいうえおかきくけ","katakana":"アイウエオカキクケ","hangul":"가나다라마바사아자","kanji":"日月山川木火水金土","thai":"กขฃคฅฆงจฉชซ","devanagari":"अआइईउऊऋएऐओऔ"};

function makeAscii(image,cfg){
 const cols=clamp(Number(cfg.asciiWidth)||100,16,220),cell=clamp(Number(cfg.asciiCellSize)||8,4,20),cw=cell,ch=Math.round(cell*1.45);
 const naturalRows=Math.max(1,Math.round(cols*image.height/image.width*.52));
 const maxRows=Math.max(1,Math.floor(MAX_ASCII_OUTPUT_PIXELS/(cols*cw*ch)));
 const rows=Math.min(naturalRows,maxRows),sample=document.createElement("canvas");
 sample.width=cols;sample.height=rows;
 const sx=sample.getContext("2d",{willReadFrequently:true});
 sx.drawImage(image,0,0,cols,rows);
 const d=sx.getImageData(0,0,cols,rows).data,sets=asciiSets,base=sets[cfg.asciiSet]||sets.classic,extra=Array.from((cfg.asciiCustomChars||"").slice(0,10)),all=Array.from(new Set([...Array.from(base),...extra])),depth=clamp(Number(cfg.asciiDepth)||10,2,all.length),chars=[];
 for(let i=0;i<depth;i++){const idx=Math.round(i*(all.length-1)/Math.max(1,depth-1));chars.push(all[idx])}
 const out=document.createElement("canvas");out.width=cols*cw;out.height=rows*ch;
 out.tgrmlitherAsciiRowsLimited=rows<naturalRows;out.tgrmlitherAsciiNaturalRows=naturalRows;out.tgrmlitherAsciiRows=rows;
 const ctx=out.getContext("2d");
 if(cfg.asciiBgMode==="solid"){ctx.fillStyle=cfg.asciiBgColor||"#07110a";ctx.fillRect(0,0,out.width,out.height)}
 ctx.font=ch+"px monospace";ctx.textBaseline="top";
 const cs=colors(),mono=cfg.asciiTextColor||"#cafa6a",lines=[];
 for(let y=0;y<rows;y++){
  let line="";
  for(let xx=0;xx<cols;xx++){
   const i=(y*cols+xx)*4;let lv=clamp(lumin(d[i],d[i+1],d[i+2])+Number(cfg.asciiOffset||0)*2.55,0,255);if(cfg.invert)lv=255-lv;
   const ix=clamp(Math.floor((lv/255)*(chars.length-1)),0,chars.length-1),glyph=chars[ix];line+=glyph;
   let color=mono;if(cfg.asciiColorMode==="palette"){const pi=Math.round(lv/255*(cs.length-1));color="rgb("+cs[pi].join(",")+")"}else if(cfg.asciiColorMode==="source"){color="rgb("+d[i]+","+d[i+1]+","+d[i+2]+")"}
   let glow=0;
   if(cfg.neoGlowEnabled){
    const pos=cfg.neoGlowDirection==="vertical"?y/Math.max(1,rows-1):cfg.neoGlowDirection==="reverse"?1-xx/Math.max(1,cols-1):cfg.neoGlowDirection==="radial"?1-Math.min(1,Math.hypot(xx-cols/2,y-rows/2)/Math.max(1,Math.hypot(cols/2,rows/2))):xx/Math.max(1,cols-1);
    const phase=clamp(Number(cfg.neoGlowPhase??50),0,100)/100,center=phase%1,delta=Math.abs(pos-center),dist=Math.min(delta,1-delta),half=Math.max(.01,Number(cfg.neoGlowLength??18)/200);
    const falloff=clamp(1-dist/half,0,1);
    glow=Math.pow(falloff,.7)*clamp(Number(cfg.neoGlowBrightness??90),0,100)/100;
    if(glow===0)ctx.globalAlpha=clamp(Number(cfg.neoGlowVisibility??12)/100,0,1);
    else{
     ctx.globalAlpha=Math.max(clamp(Number(cfg.neoGlowVisibility??12)/100,0,1),glow);
     const baseColor=color.startsWith("rgb")?(color.match(/[\d.]+/g)||[]).slice(0,3).map(Number):hex(color),hot=hex(cfg.neoGlowColor||"#cafa6a");
     color="rgb("+baseColor.map((v,k)=>Math.round(v*(1-glow)+hot[k]*glow)).join(",")+")";
     ctx.shadowColor=cfg.neoGlowColor||"#cafa6a";
     ctx.shadowBlur=Math.max(0,cell*1.35*glow);
    }
   }
   ctx.fillStyle=color;ctx.fillText(glyph,xx*cw,y*ch);ctx.shadowBlur=0;ctx.globalAlpha=1;
  }
  lines.push(line);
 }
 ascii=lines.join("\n");applyEffects(out,cfg,cell);return out;
}
