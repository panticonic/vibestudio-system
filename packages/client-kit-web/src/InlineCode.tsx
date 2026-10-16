import type { ReactNode } from "react";
import { Code } from "@radix-ui/themes";

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <Code size="1" variant="soft" style={{ maxWidth: "100%" }}>
      {children}
    </Code>
  );
}
