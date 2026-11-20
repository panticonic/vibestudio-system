/** Scripted executor for checking the mounted call tree without a provider. */
export const remoteCommissionReferenceSteps: Record<string, string> = {
  runWorkflow: `
    const item = request.work[0];
    const operation = domains.remoteAccess[item.operation];
    const report = await operation(item.input);
    return {results:[{kind:"domain",domain:item.domain,operation:item.operation,report}],remaining:[]};
  `,
  commissionRemoteWorkspace: `
    const deployment = await deployRemoteServer(request);
    if (deployment.status !== "deployment-ready" && deployment.status !== "already-running") {
      return {deployment, handoff:null, access:null};
    }
    const handoff = await bindVerifiedWorkspace(deployment.evidenceIds.at(-1));
    const access = handoff.state === "assigned"
      ? await openRemoteWorkspace({operationId:handoff.operationId}) : null;
    return {deployment, handoff, access};
  `,
  bindVerifiedWorkspace:
    "return await remoteDeploymentHandoff.open(deploymentReceipt);",
  deployRemoteServer: `
    const baseline = await observeBaseline(request.operationId);
    const decision = await decideDeployment(baseline);
    const evidenceIds = [baseline.receipt];
    if (decision !== "apply") return {status:decision, identity:null, evidenceIds};
    const attempt = await applyDeployment(baseline.receipt);
    evidenceIds.push(attempt.receipt);
    if (attempt.state !== "applied") {
      return {status:attempt.state === "failed" ? "installer-failed" : "baseline-changed", identity:null, evidenceIds};
    }
    const report = await checkReadiness(attempt.receipt);
    return {...report, evidenceIds:[...evidenceIds, ...report.evidenceIds]};
  `,
  observeBaseline: "return await remoteDeploymentRead.observe(operationId);",
  decideDeployment: `
    if (baseline.state === "unverified") return "baseline-unverified";
    if (baseline.intent === "update") return baseline.hasPriorIdentity ? "apply" : "update-needs-existing-server";
    return baseline.state === "ready" ? "already-running" : "apply";
  `,
  applyDeployment: "return await remoteDeploymentApply.apply(baselineReceipt);",
  checkReadiness: `
    const result = await observeReadiness(actionReceipt);
    return {status:await interpretReadiness(result), identity:result.identity, evidenceIds:[result.receipt]};
  `,
  observeReadiness:
    "return await remoteDeploymentVerify.verify(actionReceipt);",
  interpretReadiness: `
    return {verified:"deployment-ready", unready:"readiness-unverified",
      "unchanged-boot":"boot-unchanged", "identity-changed":"server-identity-changed"}[verified.state];
  `,
  openRemoteWorkspace: `
    const profile = await readAssignedProfile(request.operationId);
    const gate = await decideAdmission(profile);
    const evidenceIds = [profile.receipt];
    if (gate !== "pair" && gate !== "route") return {status:gate, workspaceId:null, evidenceIds};
    if (gate === "pair") {
      const paired = await pairAssignedProfile(profile.receipt);
      evidenceIds.push(paired.receipt);
      if (paired.state !== "paired") return {status:"pairing-failed", workspaceId:null, evidenceIds};
    }
    const report = await openAssignedRoute(evidenceIds.at(-1));
    return {...report, evidenceIds:[...evidenceIds, ...report.evidenceIds]};
  `,
  readAssignedProfile: "return await remoteAccessRead.observe(operationId);",
  decideAdmission: `
    if (observed.state === "foreign") return "different-profile";
    if (observed.state === "unusable") return "recover-profile";
    if (observed.state === "unpaired") return observed.inviteAssigned ? "pair" : "invite-required";
    return "route";
  `,
  pairAssignedProfile: "return await remoteAccessPair.pair(profileReceipt);",
  openAssignedRoute: `
    const route = await routeThroughHub(priorReceipt);
    if (route.state !== "routed") return {status:"route-unavailable", workspaceId:null, evidenceIds:[route.receipt]};
    const child = await observeChild(route.receipt);
    return {status:await interpretChild(child), workspaceId:child.workspaceId, evidenceIds:[route.receipt, child.receipt]};
  `,
  routeThroughHub: "return await remoteAccessRoute.select(priorReceipt);",
  observeChild: "return await remoteAccessVerify.verify(routeReceipt);",
  interpretChild: `
    if (child.state === "verified") return "workspace-ready";
    return child.state === "identity-mismatch" ? "child-identity-mismatch" : "child-unreachable";
  `,
};
