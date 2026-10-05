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
            </AppHeader>
            <Container maxWidth="lg" disableGutters>
                <MainContent>{children}</MainContent>
            </Container>
        </>
    );
}
