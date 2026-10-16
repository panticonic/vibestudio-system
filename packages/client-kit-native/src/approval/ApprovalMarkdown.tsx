import { useKitColors } from "../ui/theme";
import {
  type ApprovalMarkdownInline,
  parseApprovalMarkdown,
} from "@vibestudio/shared/approvalMarkdown";
import { Text, View } from "react-native";
import { styles } from "./styles";

export function ApprovalMarkdown({
  source,
  tone = "default",
  compact = false,
}: {
  source: string;
  tone?: "default" | "muted" | "danger";
  compact?: boolean;
}) {
  const colors = useKitColors();
  const blocks = parseApprovalMarkdown(source);
  if (blocks.length === 0) return null;
  const color =
    tone === "danger"
      ? colors.danger
      : tone === "muted"
        ? colors.textSecondary
        : colors.text;
  return (
    <View
      style={[
        styles.markdownBlock,
        compact ? styles.markdownBlockCompact : null,
      ]}
    >
      {blocks.map((block, index) => {
        if (block.kind === "code-block") {
          return (
            <Text
              key={index}
              selectable
              style={[
                styles.markdownCodeBlock,
                { color: colors.text, backgroundColor: colors.codeBackground },
              ]}
            >
              {block.text}
            </Text>
          );
        }
        if (block.kind === "bullet-list" || block.kind === "ordered-list") {
          return (
            <View key={index} style={styles.markdownList}>
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} style={styles.markdownListRow}>
                  <Text style={[styles.markdownBullet, { color }]}>
                    {block.kind === "ordered-list" ? `${itemIndex + 1}.` : "-"}
                  </Text>
                  <Text style={[styles.markdownText, { color }]}>
                    <ApprovalMarkdownInlineNodes nodes={item} color={color} />
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={index} style={[styles.markdownText, { color }]}>
            <ApprovalMarkdownInlineNodes nodes={block.children} color={color} />
          </Text>
        );
      })}
    </View>
  );
}

function ApprovalMarkdownInlineNodes({
  nodes,
  color,
}: {
  nodes: ApprovalMarkdownInline[];
  color: string;
}) {
  const colors = useKitColors();
  return (
    <>
      {nodes.map((node, index) => {
        if (node.kind === "code") {
          return (
            <Text
              key={index}
              style={[
                styles.markdownInlineCode,
                { color: colors.text, backgroundColor: colors.codeBackground },
              ]}
            >
              {node.text}
            </Text>
          );
        }
        if (node.kind === "strong") {
          return (
            <Text key={index} style={styles.markdownStrong}>
              <ApprovalMarkdownInlineNodes
                nodes={node.children}
                color={color}
              />
            </Text>
          );
        }
        if (node.kind === "emphasis") {
          return (
            <Text key={index} style={styles.markdownEmphasis}>
              <ApprovalMarkdownInlineNodes
                nodes={node.children}
                color={color}
              />
            </Text>
          );
        }
        return (
          <Text key={index} style={{ color }}>
            {node.text}
          </Text>
        );
      })}
    </>
  );
}
