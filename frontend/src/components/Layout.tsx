import { AppHeader, MainContent } from "@dextinity/admin";
import Container from "@mui/material/Container";
import Link from "@mui/material/Link";
import type { ReactNode } from "react";

const headerHeight = 60;

export function Layout({ children }: { children: ReactNode }) {
    return (
        <>
            <AppHeader position="sticky" headerHeight={headerHeight}>
                <Link href="/" color="inherit" underline="none" variant="h4" sx={{ px: 4 }}>
                    Preview Controller
                </Link>
                {/* Served by oauth2-proxy, see src/auth.ts - a plain anchor, it is no route of the frontend. */}
                <Link component="a" href="/__oauth2/sign_out" color="inherit" sx={{ ml: "auto", px: 4 }}>
                    Sign out
                </Link>
            </AppHeader>
            <Container maxWidth="lg" disableGutters>
                <MainContent>{children}</MainContent>
            </Container>
        </>
    );
}
