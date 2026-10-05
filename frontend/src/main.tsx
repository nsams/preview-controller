import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router";

import { previewPath } from "./api.ts";
import { Layout } from "./components/Layout.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { PreviewPage } from "./pages/PreviewPage.tsx";
import { PreviewsPage } from "./pages/PreviewsPage.tsx";
import { theme } from "./theme.tsx";

function LogsRedirect() {
    const { search } = useLocation();
    return <Navigate to={`${previewPath(useParams().slug ?? "")}${search}`} replace />;
}

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
                        {/* The logs used to have a page of their own, older links still lead there. */}
                        <Route path="/previews/:slug/logs" element={<LogsRedirect />} />
                        <Route path="*" element={<NotFoundPage />} />
                    </Route>
                </Routes>
            </BrowserRouter>
        </ThemeProvider>
    </StrictMode>,
);
