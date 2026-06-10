// v2-core — 단일 화면. 라우터 없음: Connections가 곧 앱이다.
// 화면이 늘어나는 시점에 라우터를 다시 들인다 (rule of three).

import { ConnectionsPage } from "./pages/ConnectionsPage.js";

export function App() {
  return <ConnectionsPage />;
}
