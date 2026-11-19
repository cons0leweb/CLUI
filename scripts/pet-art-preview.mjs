import { writeFile } from 'node:fs/promises';
import { CatAnimator, PALETTE, pixelRuns } from '../dist/pet/CatAnimator.js';
import { CatWorld } from '../dist/pet/World.js';
const states=['sit','walk','run','jump','sleep','observe','type','approval','confused'];
const cells=[];
for(const [index,state] of states.entries()){
 const world=new CatWorld();world.updateSurfaces([{owner:1,x:0,y:400,width:500,kind:'window'}]);world.state=state;world.time=1;world.phase=.3;world.effect=({observe:'observe',type:'type',approval:'approval',confused:'error'})[state]??'idle';
 if(state==='jump'){world.support=undefined;world.vy=-100;}
 const animator=new CatAnimator();let frame;for(let i=0;i<50;i++)frame=animator.render(world,.03);
 const rectangles=[];for(const[color,runs]of pixelRuns(frame,3))for(const[x,y,w,h]of runs)rectangles.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#${PALETTE[color].toString(16).padStart(6,'0')}"/>`);
 const x=(index%3)*210,y=Math.floor(index/3)*210;
 cells.push(`<g transform="translate(${x+9},${y+4})">${rectangles.join('')}<text x="96" y="195" text-anchor="middle" fill="#d2dce9" font-family="sans-serif" font-size="13">${state}</text></g>`);
}
await writeFile(process.argv[2]??'/tmp/clui-cat-preview.svg',`<svg xmlns="http://www.w3.org/2000/svg" width="630" height="630" viewBox="0 0 630 630"><rect width="630" height="630" fill="#364052"/>${cells.join('')}</svg>`);
