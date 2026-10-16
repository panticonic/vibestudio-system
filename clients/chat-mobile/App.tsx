import "./src/setupGlobals";
import { useEffect, useState } from "react";
import { AppRegistry, Text, View } from "react-native";
import { CLIENT_ROOT_COMPONENT, type RnClientApi } from "@vibestudio/rn-client-api";
import { connectNativeClientApi } from "@vibestudio/rn-client-api/native";
import { ChatClient } from "./src/ChatClient";

/** The client UI over an injected host API; tests supply a fake. */
export function ClientRoot({ api }: { api: RnClientApi }) {
  return <ChatClient api={api} />;
}

function App() {
  const [host, setHost] = useState<{ api: RnClientApi } | { error: string } | null>(null);
  useEffect(() => {
    let active = true;
    connectNativeClientApi().then(
      (api) => active && setHost({ api }),
      (error: unknown) =>
        active && setHost({ error: error instanceof Error ? error.message : String(error) })
    );
    return () => {
      active = false;
    };
  }, []);
  if (!host) return null;
  if ("error" in host) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
        <Text>{host.error}</Text>
      </View>
    );
  }
  return <ClientRoot api={host.api} />;
}

AppRegistry.registerComponent(CLIENT_ROOT_COMPONENT, () => App);

export default App;
