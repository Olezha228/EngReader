// Обёртка типов для react-native-webview 14: корневой index.d.ts объявляет класс
// `WebView<P = undefined> extends Component<WebViewProps & P>`, и в TS 6 `WebViewProps & undefined`
// схлопывается в never — JSX с любыми пропсами не проходит тайпчек. Рантайм не трогаем.
import type { ComponentType, RefAttributes } from 'react';
import { WebView as WebViewRuntime, type WebViewProps } from 'react-native-webview';

export type WebViewHandle = InstanceType<typeof WebViewRuntime>;

export const WebView = WebViewRuntime as unknown as ComponentType<WebViewProps & RefAttributes<WebViewHandle>>;

export type { WebViewMessageEvent } from 'react-native-webview';
