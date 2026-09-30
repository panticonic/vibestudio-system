import { Modal, type ModalProps } from "react-native";

/** Native overlays follow the same orientation policy as the mobile host. */
export function AppModal(props: Omit<ModalProps, "supportedOrientations">) {
  return (
    <Modal
      {...props}
      supportedOrientations={["portrait", "landscape-left", "landscape-right"]}
    />
  );
}
