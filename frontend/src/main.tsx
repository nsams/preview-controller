import "@fontsource-variable/roboto-flex/full.css";

import { MuiThemeProvider, RouterBrowserRouter } from "@dextinity/admin";
import CssBaseline from "@mui/material/CssBaseline";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IntlProvider } from "react-intl";
import { Redirect, Route, Switch } from "react-router-dom";

import { previewPath } from "./api.ts";
import { Layout } from "./components/Layout.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { PreviewPage } from "./pages/PreviewPage.tsx";
import { PreviewsPage } from "./pages/PreviewsPage.tsx";
import { theme } from "./theme.tsx";

const root = document.getElementById("root");
if (!root) {
    throw new Error("#root is missing in index.html");
}

// The paths are the ones the pages of a preview host link to, see src/pages.ts.
// The Dextinity components need an IntlProvider, their english default messages are all this uses.
createRoot(root).render(
    <StrictMode>
        <IntlProvider locale="en" defaultLocale="en">
            <MuiThemeProvider theme={theme}>
                <CssBaseline />
                <RouterBrowserRouter>
                    <Layout>
                        <Switch>
                            <Route path="/" exact>
                                <PreviewsPage />
                            </Route>
                            <Route path="/previews/:slug" exact>
                                <PreviewPage />
                            </Route>
                            {/* The logs used to have a page of their own, older links still lead there. */}
                            <Route
                                path="/previews/:slug/logs"
                                exact
                                render={({ match, location }) => <Redirect to={`${previewPath(match.params.slug ?? "")}${location.search}`} />}
                            />
                            <Route>
                                <NotFoundPage />
                            </Route>
                        </Switch>
                    </Layout>
                </RouterBrowserRouter>
            </MuiThemeProvider>
        </IntlProvider>
    </StrictMode>,
);
