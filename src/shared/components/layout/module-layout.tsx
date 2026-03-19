import { Footer } from './footer';
import { Header } from './header';

interface ModuleLayoutProps {
  children: React.ReactNode;
  footerTitle?: string;
  footerSubtitle?: string;
}

export function ModuleLayout({
  children,
  footerTitle,
  footerSubtitle,
}: ModuleLayoutProps) {
  return (
    <>
      <Header />
      {children}
      <Footer subtitle={footerSubtitle} title={footerTitle} />
    </>
  );
}
