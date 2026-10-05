import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";

import { Layout } from "./components/Layout.tsx";
import { LogsPage } from "./pages/LogsPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { PreviewPage } from "./pages/PreviewPage.tsx";
import { PreviewsPage } from "./pages/PreviewsPage.tsx";
import { theme } from "./theme.tsx";

const root = document.getElementById("root");
if (!root) {
    throw new Error("#root is missing in index.html");
}

// The paths are the ones the pages of a preview host link to, see src/pages.ts.
createRoot(root).render(
    <StrictMode>
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <BrowserRouter>
                <Routes>
                    <Route element={<Layout />}>
                        <Route path="/" element={<PreviewsPage />} />
                        <Route path="/previews/:slug" element={<PreviewPage />} />
                        <Route path="/previews/:slug/logs" element={<LogsPage />} />
                        <Route path="*" element={<NotFoundPage />} />
                    </Route>
                </Routes>
            </BrowserRouter>
        </ThemeProvider>
    </StrictMode>,
);
