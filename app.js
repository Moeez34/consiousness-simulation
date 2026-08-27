const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const world = { width: 18, height: 18, cell: 32, flowers: [], hazards: [], hive: { x: 3, y: 14 } };
const bee = { x: 3, y: 14, angle: -0.8, nectar: 0, mode: 'exploring', target: null, distance: 0, heading: 0, activity: 0 };
const stats = { flowers: 0, delivered: 0, trips: 0 };
let paused = false, speed = 1, last = performance.now(), wanderPhase = 0, logUntil = 0;
const environmentArt = new Image();
environmentArt.src = 'assets/riverside-voxel-world.png';

const modules = [
  ['VISION', 8, 20], ['COMPASS', 44, 3], ['FLOWER', 75, 22],
  ['MEMORY', 65, 65], ['HOME', 23, 68], ['MOTOR', 45, 89]
];
modules.forEach(([label, left, top], i) => {
  const node = document.createElement('div'); node.className = 'neuron'; node.id = `neuron${i}`;
  node.style.left = `${left}%`; node.style.top = `${top}%`; node.style.setProperty('--link-angle', `${i * 53 - 30}deg`); node.textContent = label;
  $('neuralMap').appendChild(node);
});

function resetWorld() {
  world.flowers = [[13,3], [15,7], [10,10], [5,4], [14,14], [7,13]].map(([x,y], index) => ({ x, y, active: true, index }));
  world.hazards = [{x:8,y:5},{x:11,y:7},{x:6,y:9},{x:15,y:11}];
  Object.assign(bee, { x: world.hive.x, y: world.hive.y, angle: -0.8, nectar: 0, mode: 'exploring', target: null, distance: 0, heading: 0, activity: 0 });
  Object.assign(stats, { flowers: 0, delivered: 0, trips: 0 });
  report('Bee launched from hive.');
}
function dist(a,b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function nearestFlower() { return world.flowers.filter(f => f.active).sort((a,b) => dist(bee,a)-dist(bee,b))[0]; }
function nearbyHazard() { return world.hazards.some(h => dist(bee,h) < 1.5); }
function report(text) { $('eventLog').textContent = text; logUntil = performance.now() + 3600; }
function decide() {
  const flower = nearestFlower(); const near = flower && dist(bee, flower) < 7;
  if (bee.nectar >= 3 || (!flower && bee.nectar > 0)) { bee.mode = 'returning'; bee.target = world.hive; return; }
  if (near) { bee.mode = 'foraging'; bee.target = flower; return; }
  bee.mode = 'exploring'; bee.target = null;
}
function avoidHazards(dx, dy) {
  for (const h of world.hazards) { const d = dist(bee,h); if (d < 2.5) { dx += (bee.x-h.x) * (2.5-d) * .35; dy += (bee.y-h.y) * (2.5-d) * .35; } }
  return {dx,dy};
}
function update(dt) {
  decide();
  let dx, dy;
  if (bee.target) { dx = bee.target.x - bee.x; dy = bee.target.y - bee.y; }
  else { wanderPhase += dt * .0015; dx = Math.cos(wanderPhase * 1.7) + Math.cos(wanderPhase * .4) * .4; dy = Math.sin(wanderPhase * 1.2) + Math.sin(wanderPhase * .5) * .5; }
  ({dx,dy} = avoidHazards(dx,dy));
  const length = Math.hypot(dx,dy) || 1; const step = dt * .00115 * speed;
  bee.x += dx / length * step; bee.y += dy / length * step; bee.x = Math.max(.3, Math.min(world.width-.3, bee.x)); bee.y = Math.max(.3, Math.min(world.height-.3, bee.y));
  bee.angle = Math.atan2(dy, dx); bee.heading = (bee.angle * 180 / Math.PI + 450) % 360; bee.distance += step;
  if (bee.mode === 'foraging' && bee.target && dist(bee, bee.target) < .35) { bee.target.active = false; bee.nectar++; stats.flowers++; report(`Nectar collected at flower ${bee.target.index + 1}.`); }
  if (bee.mode === 'returning' && dist(bee, world.hive) < .4) { if (bee.nectar) { stats.delivered += bee.nectar; stats.trips++; report(`${bee.nectar} nectar delivered to the hive.`); bee.nectar = 0; } }
  bee.activity = Math.min(1, .3 + (bee.mode === 'foraging' ? .55 : bee.mode === 'returning' ? .45 : .25) + (nearbyHazard() ? .15 : 0));
}
function iso(x, y) { const ox = canvas.width / 2, oy = 70; return { x: ox + (x-y) * world.cell * .86, y: oy + (x+y) * world.cell * .43 }; }
function scenePosition(x, y, width, height) { return { x: width * (.16 + (x / world.width) * .68), y: height * (.68 - (y / world.height) * .38) }; }
function polygon(points, fill) { ctx.beginPath(); points.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y)); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }
function drawBlock(x,y) { const p = iso(x,y), s = world.cell*.86, h = 11; polygon([{x:p.x,y:p.y},{x:p.x+s,y:p.y+s*.5},{x:p.x,y:p.y+s},{x:p.x-s,y:p.y+s*.5}], (x+y)%2 ? '#294634' : '#31513b'); polygon([{x:p.x-s,y:p.y+s*.5},{x:p.x,y:p.y+s},{x:p.x,y:p.y+s+h},{x:p.x-s,y:p.y+s*.5+h}], '#203a2c'); polygon([{x:p.x+s,y:p.y+s*.5},{x:p.x,y:p.y+s},{x:p.x,y:p.y+s+h},{x:p.x+s,y:p.y+s*.5+h}], '#274531'); }
function drawObject(type,x,y) { const p=iso(x,y); p.y += world.cell*.35; if(type==='flower'){ ctx.strokeStyle='#78a46f'; ctx.lineWidth=3; ctx.beginPath();ctx.moveTo(p.x,p.y+8);ctx.lineTo(p.x,p.y-8);ctx.stroke(); ['#e28bc5','#bb77db','#efa7d1'].forEach((c,i)=>{ctx.fillStyle=c;ctx.beginPath();ctx.arc(p.x+Math.cos(i*2.1)*7,p.y-9+Math.sin(i*2.1)*7,5,0,7);ctx.fill();});ctx.fillStyle='#f5cf69';ctx.beginPath();ctx.arc(p.x,p.y-9,3.5,0,7);ctx.fill(); }
  if(type==='hive'){ ctx.fillStyle='#e5b75c';ctx.beginPath();ctx.ellipse(p.x,p.y-5,15,18,0,0,7);ctx.fill();ctx.strokeStyle='#a97b35';ctx.lineWidth=2;for(let i=-1;i<3;i++){ctx.beginPath();ctx.moveTo(p.x-14,p.y-10+i*7);ctx.lineTo(p.x+14,p.y-10+i*7);ctx.stroke();}ctx.fillStyle='#4f3518';ctx.beginPath();ctx.arc(p.x,p.y+4,4,0,7);ctx.fill();}
  if(type==='hazard'){ctx.fillStyle='#db746e';ctx.beginPath();ctx.moveTo(p.x,p.y-21);ctx.lineTo(p.x+12,p.y+9);ctx.lineTo(p.x-12,p.y+9);ctx.fill();ctx.fillStyle='#fff0dd';ctx.font='bold 15px sans-serif';ctx.fillText('!',p.x-2.5,p.y+5);} }
function drawVoxelBee(p, scale) {
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(bee.angle * .1);
  ctx.fillStyle = 'rgba(255,255,255,.72)';
  polygon([{x:-scale*1.2,y:-scale*.35},{x:-scale*.15,y:-scale*1.35},{x:scale*.55,y:-scale*.62},{x:-scale*.45,y:-scale*.05}], ctx.fillStyle);
  polygon([{x:scale*.1,y:-scale*.2},{x:scale*.95,y:-scale*1.15},{x:scale*1.4,y:-scale*.45},{x:scale*.5,y:scale*.05}], ctx.fillStyle);
  polygon([{x:-scale,y:-scale*.5},{x:scale*.8,y:-scale*.92},{x:scale*1.1,y:-scale*.05},{x:-scale*.65,y:scale*.35}], '#ffc630');
  polygon([{x:-scale*.65,y:scale*.35},{x:scale*1.1,y:-scale*.05},{x:scale*1.08,y:scale*.72},{x:-scale*.65,y:scale*.94}], '#e59514');
  polygon([{x:scale*.8,y:-scale*.92},{x:scale*1.5,y:-scale*.43},{x:scale*1.45,y:scale*.38},{x:scale*1.08,y:scale*.72},{x:scale*1.1,y:-scale*.05}], '#d55b0b');
  ctx.strokeStyle='#6d2a0d';ctx.lineWidth=scale*.16;[-.3,.15,.56].forEach(x=>{ctx.beginPath();ctx.moveTo(scale*x,-scale*.64);ctx.lineTo(scale*x,scale*.56);ctx.stroke();});
  polygon([{x:-scale*1.25,y:-scale*.42},{x:-scale*.65,y:-scale*.5},{x:-scale*.65,y:scale*.94},{x:-scale*1.25,y:scale*.65}], '#f0a41e');
  ctx.fillStyle='#102631';ctx.fillRect(-scale*1.12,-scale*.23,scale*.3,scale*.38);ctx.fillRect(-scale*.78,-scale*.32,scale*.2,scale*.31);
  ctx.restore();
}
function drawMarker(type, x, y) { const size = type === 'hive' ? 15 : 9; ctx.save();ctx.translate(x,y);if(type==='flower'){ctx.fillStyle='#e07bbb';for(let i=0;i<5;i++){ctx.rotate(Math.PI*2/5);ctx.fillRect(-2,-size,4,size);}ctx.fillStyle='#ffd56a';ctx.fillRect(-3,-3,6,6);}if(type==='hive'){ctx.fillStyle='#efbf55';ctx.fillRect(-size,-size*.65,size*2,size*1.3);ctx.fillStyle='#6f3d12';ctx.fillRect(-4,3,8,8);}if(type==='hazard'){ctx.fillStyle='#dd6d62';ctx.beginPath();ctx.moveTo(0,-size);ctx.lineTo(size,size);ctx.lineTo(-size,size);ctx.fill();}ctx.restore(); }
function draw(){ const rect=canvas.getBoundingClientRect(), ratio=window.devicePixelRatio||1, cw=rect.width, ch=rect.height; canvas.width=Math.round(cw*ratio);canvas.height=Math.round(ch*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,cw,ch); if(environmentArt.complete && environmentArt.naturalWidth){const imageRatio=environmentArt.naturalWidth/environmentArt.naturalHeight, targetRatio=cw/ch;let sw=environmentArt.naturalWidth,sh=environmentArt.naturalHeight,sx=0,sy=0;if(imageRatio>targetRatio){sw=sh*targetRatio;sx=(environmentArt.naturalWidth-sw)/2;}else{sh=sw/targetRatio;sy=(environmentArt.naturalHeight-sh)/2;}ctx.drawImage(environmentArt,sx,sy,sw,sh,0,0,cw,ch);}else{ctx.fillStyle='#2d6e82';ctx.fillRect(0,0,cw,ch);} ctx.fillStyle='rgba(8,24,18,.1)';ctx.fillRect(0,0,cw,ch);const hive=scenePosition(world.hive.x,world.hive.y,cw,ch);drawMarker('hive',hive.x,hive.y);world.flowers.filter(f=>f.active).forEach(f=>{const p=scenePosition(f.x,f.y,cw,ch);drawMarker('flower',p.x,p.y);});world.hazards.forEach(h=>{const p=scenePosition(h.x,h.y,cw,ch);drawMarker('hazard',p.x,p.y);});const b=scenePosition(bee.x,bee.y,cw,ch);drawVoxelBee(b,Math.max(14,cw*.027)); }
function updateUI(){ const labels={exploring:'EXPLORING',foraging:'FLOWER LOCKED',returning:'RETURNING HOME'}; $('modeReadout').textContent=labels[bee.mode];$('headingReadout').textContent=`${Math.round(bee.heading)}°`;$('homeReadout').textContent=`${dist(bee,world.hive).toFixed(1)} blocks`;$('nectarReadout').textContent=`${bee.nectar} / 3`;$('objective').textContent=bee.mode==='foraging'?'Flower signal detected':bee.mode==='returning'?'Home vector engaged':'Scanning meadow'; const percent=Math.round(bee.activity*100);$('signalValue').textContent=`${percent}%`;$('signalBar').style.width=`${percent}%`;$('flowersVisited').textContent=stats.flowers;$('nectarDelivered').textContent=stats.delivered;$('distanceFlown').textContent=`${Math.round(bee.distance)} b`;$('tripsCompleted').textContent=stats.trips; const active=[bee.mode==='foraging',true,bee.mode==='foraging',bee.nectar>0||bee.mode==='returning',bee.mode==='returning',true];active.forEach((isOn,i)=>$(`neuron${i}`).classList.toggle('active',isOn)); }
function frame(now){ const dt=Math.min(now-last,50);last=now;if(!paused)update(dt);draw();updateUI();requestAnimationFrame(frame); }
$('toggleButton').onclick=()=>{paused=!paused;$('toggleButton').textContent=paused?'Resume simulation':'Pause simulation';$('statusDot').style.background=paused?'#ef857f':'';report(paused?'Simulation paused.':'Simulation resumed.');};
$('resetButton').onclick=resetWorld;$('speedRange').oninput=e=>{speed=Number(e.target.value);$('speedOutput').textContent=`${speed.toFixed(1)}×`;};
resetWorld();requestAnimationFrame(frame);
