/** Which layer of a Vibestudio remote setup a failure belongs to. */
export type RemoteLayer =
  | "healthy"
  | "client-runtime"
  | "host-sandbox"
  | "server-deployment"
  | "device-credential"
  | "relay-config"
  | "hub-control"
  | "workspace-routing"
  | "child-endpoint";
