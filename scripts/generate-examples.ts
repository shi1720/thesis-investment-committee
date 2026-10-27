import fs from 'node:fs/promises';
import {defaultProfile, type ResearchProfile} from '../lib/contracts';
import {runResearch} from '../lib/research/engine';
import {recallResearchMemory,rememberResearch} from '../lib/providers/hmem';
import {researchReport} from '../lib/server/report';
const mandates:{name:string;profile:ResearchProfile}[]=[
 {name:'balanced-us-india',profile:defaultProfile},
 {name:'china-uae',profile:{...defaultProfile,markets:['China','UAE'],targetReturn:10,maxVolatility:30,maxDrawdown:35,horizonMonths:60,baseCurrency:'AED'}},
 {name:'infeasible-return-goal',profile:{...defaultProfile,targetReturn:40,maxVolatility:10,maxDrawdown:10}},
];
let memory;
await fs.mkdir('examples/research',{recursive:true});
for(const [i,entry]of mandates.entries()){
 const recalled=recallResearchMemory(entry.profile,[],memory);
 const run=await runResearch(entry.profile,{now:new Date('2026-10-27T05:00:00Z'),id:`2649c8bf-12a7-4f5e-9fa2-861b5f71000${i}`,memoryLessons:recalled.lessons});
 memory=rememberResearch(run,recalled.snapshot);
 await fs.writeFile(`examples/research/${entry.name}.input.json`,JSON.stringify(entry.profile,null,2)+'\n');
 await fs.writeFile(`examples/research/${entry.name}.output.json`,JSON.stringify(run,null,2)+'\n');
 await fs.writeFile(`examples/research/${entry.name}.html`,researchReport(run));
 console.log(`${entry.name}: ${run.eligibleCount} qualified, abstained=${run.abstained}, memoryReused=${run.memory.reused}`);
}
