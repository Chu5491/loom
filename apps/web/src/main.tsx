import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import { ThemeProvider } from "./context/ThemeContext.js";
import { I18nProvider } from "./context/I18nContext.js";
import { DialogProvider } from "./context/DialogContext.js";
import "./styles.css";

const qc = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 5_000 },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <I18nProvider>
      <QueryClientProvider client={qc}>
        <DialogProvider>
          <App />
        </DialogProvider>
      </QueryClientProvider>
    </I18nProvider>
  </ThemeProvider>,
);
