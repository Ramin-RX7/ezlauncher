/** What the launch code receives. It never knows how the user logged in. */
export interface LaunchIdentity {
  username: string;
  /** UUID without dashes (`${auth_uuid}`). */
  uuid: string;
  accessToken: string;
  /** `legacy` for offline accounts; `msa` for Microsoft later. */
  userType: string;
  xuid?: string;
  clientId?: string;
}

export interface Account {
  id: string;
  providerId: string;
  username: string;
  /** UUID without dashes. Fixed when the account is created; never recomputed. */
  uuid: string;
  /** Provider-specific data (tokens for online providers, stored with safeStorage). */
  data?: unknown;
}

export interface AuthProvider {
  id: string;
  displayName: string;
  createAccount(input: unknown): Promise<Account>;
  /** Rename keeps the UUID. Optional: online providers take the name from the service. */
  renameAccount?(account: Account, username: string): Promise<Account>;
  getLaunchIdentity(account: Account): Promise<LaunchIdentity>;
  removeAccount?(account: Account): Promise<void>;
}
