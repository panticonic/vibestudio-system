import { Modal, type ModalProps } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

/** Native overlays follow the same orientation policy as the mobile host. */
export function AppModal({
  children,
  ...props
}: Omit<ModalProps, "supportedOrientations">) {
  return (
    <Modal
      {...props}
      supportedOrientations={["portrait", "landscape-left", "landscape-right"]}
    >
      <SafeAreaProvider>
        <SafeAreaView edges={["left", "right"]} style={{ flex: 1 }}>
          {children}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
