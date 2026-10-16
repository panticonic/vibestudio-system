jest.mock("react-native-haptic-feedback", () => ({
  trigger: jest.fn(),
}));

jest.mock("react-native-svg", () => {
  const React = require("react");
  const { View } = require("react-native");
  const NativeSvgElement = React.forwardRef(
    ({ children, ...props }: { children?: unknown }, ref: unknown) =>
      React.createElement(View, { ...props, ref }, children),
  );
  const SvgUri = React.forwardRef(
    (props: Record<string, unknown>, ref: unknown) =>
      React.createElement(View, { ...props, ref }),
  );
  NativeSvgElement.displayName = "NativeSvgElement";
  SvgUri.displayName = "SvgUri";
  return {
    __esModule: true,
    default: NativeSvgElement,
    SvgUri,
    Svg: NativeSvgElement,
    G: NativeSvgElement,
    Path: NativeSvgElement,
    Circle: NativeSvgElement,
    Rect: NativeSvgElement,
    Line: NativeSvgElement,
    Polyline: NativeSvgElement,
    Polygon: NativeSvgElement,
    Ellipse: NativeSvgElement,
    Defs: NativeSvgElement,
    ClipPath: NativeSvgElement,
    Mask: NativeSvgElement,
    Use: NativeSvgElement,
    Text: NativeSvgElement,
    TSpan: NativeSvgElement,
    Image: NativeSvgElement,
    LinearGradient: NativeSvgElement,
    RadialGradient: NativeSvgElement,
    Stop: NativeSvgElement,
  };
});

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(async () => ({
      isConnected: true,
      isInternetReachable: true,
    })),
  },
}));

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaView: "SafeAreaView",
  initialWindowMetrics: {
    frame: { x: 0, y: 0, width: 0, height: 0 },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  },
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
}));
