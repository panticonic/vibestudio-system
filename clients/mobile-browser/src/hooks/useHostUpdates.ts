import { useEffect } from "react";
import { Alert } from "react-native";
import { useSetAtom } from "jotai";
import {
  createHostUpdateModel,
  observeHostUpdates,
  presentClientUpdates,
} from "@workspace/client-kit-native";
import { clientApi } from "@workspace/client-kit-native/host";
import { pushToastAtom } from "../state/toastAtoms";

/**
 * Ask the person about ready builds of this client. The host announces them;
 * choosing Install asks the host to reload this client's instance, so nothing
 * here outlives the answer.
 */
export function useHostUpdates(): void {
  const pushToast = useSetAtom(pushToastAtom);
  useEffect(() => {
    const api = clientApi();
    const model = createHostUpdateModel(api);
    const stopPresenting = presentClientUpdates(model, {
      alert: Alert.alert,
      notify: pushToast,
    });
    const stopObserving = observeHostUpdates(api, model);
    return () => {
      stopObserving();
      stopPresenting();
    };
  }, [pushToast]);
}
