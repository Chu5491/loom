import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { App } from "./App.js";
import { ConfirmProvider } from "./components/ConfirmDialog.js";
import { ThemeProvider } from "./context/ThemeContext.js";
import { I18nProvider } from "./context/I18nContext.js";
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
        <BrowserRouter>
          <ConfirmProvider>
            <App />
            <Toaster
              position="bottom-right"
              richColors
              closeButton
              theme="system"
              toastOptions={{ duration: 4000 }}
            />
          </ConfirmProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </I18nProvider>
  </ThemeProvider>,
);
