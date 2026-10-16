import { createTypedRpcServiceClient } from "@vibestudio/shared/typedRpcServiceClient";
import {
  accountMethods,
  type AccountProfile,
  type AccountProfileUpdate,
} from "@vibestudio/service-schemas/account";

import { hubControlMethods } from "@vibestudio/service-schemas/hubControl";

export type MobileAccountProfile = AccountProfile;
export type MobileAccountProfileUpdate = AccountProfileUpdate;

interface AccountProfileTransport {
  call: import("@vibestudio/rpc").RpcCaller["call"];
}

export class MobileAccountProfileClient {
  private profile: MobileAccountProfile | null = null;
  private readonly account;
  private readonly hubControl;

  constructor(transport: AccountProfileTransport) {
    this.account = createTypedRpcServiceClient(transport, { targetId: "main", namespace: "account" }, accountMethods);
    this.hubControl = createTypedRpcServiceClient(transport, { targetId: "main", namespace: "hubControl" }, hubControlMethods);
  }

  get current(): MobileAccountProfile | null {
    return this.profile;
  }

  async refresh(): Promise<MobileAccountProfile> {
    const profile = await this.account.getProfile();
    if (!profile) {
      throw new Error("The connected session does not have an active workspace account.");
    }
    this.profile = profile;
    return profile;
  }

  async update(input: MobileAccountProfileUpdate): Promise<MobileAccountProfile> {
    const profile = await this.hubControl.updateProfile(input);
    this.profile = profile;
    return profile;
  }

  resolve(userIds: readonly string[]): Promise<Record<string, MobileAccountProfile>> {
    return this.account.resolveProfiles([...userIds]);
  }
}
