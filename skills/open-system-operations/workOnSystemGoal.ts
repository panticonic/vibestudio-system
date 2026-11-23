import {operatorDiscovery} from "natlang:services";
import chooseOperatorGoal from "./workOnSystemGoal/chooseOperatorGoal.nl";
import handleProfile from "./workOnSystemGoal/handleProfile.nl";
import handleDeployment from "./workOnSystemGoal/handleDeployment.nl";
import type {OperatorReport} from "./types.js";
export default async function workOnSystemGoal(goal:string):Promise<OperatorReport>{
 const choice=await chooseOperatorGoal(goal,await operatorDiscovery.list());
 if(!choice)return {status:"held",reason:"unknown-target",targetId:null,identity:null,evidenceIds:[]};
 const baseline=await operatorDiscovery.observe(choice.targetId);
 return baseline.target.surface==="terminal-profile"?handleProfile(choice,baseline):handleDeployment(choice,baseline);
}
