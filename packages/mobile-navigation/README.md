# Mobile navigation

This package owns the React Navigation integration used by the native app. Its
peer versions match the React Native host; browser validation must not merge
this dependency realm with desktop React packages.

Keep native, stack, and drawer dependency floors aligned with the native host's
`apps/mobile` dependencies. Native 7.4.1 requires core 7.22.1, which supplies the
`render` contract used by stack 7.11.2 and drawer 7.14.2. Let Native resolve its
compatible core instead of overriding that transitive dependency independently.

Core 7.22.1 no longer depends on query-string, so the old query-string import
patch and core pin are unnecessary. Pinning core 7.21.13 while allowing newer
navigators to resolve caused the hosted app to fail on its first render.
