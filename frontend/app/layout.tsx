import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KeyStone MacroDesk',
  description: 'Macroeconomic research dashboard',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // browser extensions add attributes to <html> before hydration
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
