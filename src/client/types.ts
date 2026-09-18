export interface ConfigRecord {
  id: string;
  name: string;
  description: string;
  file: string;
  isTemplate: boolean;
  createdAt: string;
  updatedAt: string;
  subscribeUrl: string | null;
}

export interface RuleRecord {
  raw: string;
  type: string;
  payload: string;
  policy: string;
  options: string[];
}

export interface ConfigContent {
  proxies: Record<string, unknown>[];
  rules: RuleRecord[];
  proxyGroups: Record<string, unknown>[];
  policyOptions: string[];
}
